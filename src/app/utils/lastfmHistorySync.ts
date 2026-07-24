import { type Types } from 'mongoose'

import ListenModel from '../models/Listen.js'
import SongModel from '../models/Song.js'
import SpotifyAccountModel from '../models/SpotifyAccount.js'

import { type LastfmRecentTracksResponse, type LastfmTrack, getRecentTracks } from './lastfm.js'
import logger from './logger.js'
import config from './setupConfig.js'
import { searchTracks } from './spotify.js'
import { ensureValidAccessToken, upsertSong } from './spotifyHistorySync.js'

const {
	lastfmBackfillMaxPages,
	lastfmPollLimit
} = config

const MAX_RETRIES = 5
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30_000

export interface LastfmSyncResult {
	songsResolved: number
	songsSkipped: number
	listensInserted: number
	listensSkipped: number
	pagesFetched: number
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Resolves a Last.fm scrobble to a Song document. Strategy:
 * 1. Check backend cache by normalized artist+name match
 * 2. If not found and user has a connected Spotify account, search Spotify
 *    catalog and upsert the result into the Song collection
 * 3. If no Spotify account or search returns nothing, skip the scrobble
 */
async function resolveSong (
	track: LastfmTrack,
	spotifyAccessToken: string | null
): Promise<Types.ObjectId | null> {
	const artistName = track.artist['#text']
	const trackName = track.name
	if (artistName === '' || trackName === '') { return null }

	// 1. Backend cache: look for an existing Song with matching artist + name
	const existing = await SongModel.findOne({
		artists: artistName,
		name: trackName
	}).exec()

	if (existing !== null) {
		return existing._id
	}

	// 2. Spotify search to resolve to a canonical track
	if (spotifyAccessToken === null) { return null }

	try {
		const results = await searchTracks(spotifyAccessToken, artistName, trackName, 1)
		if (results.length === 0) { return null }

		const spotifyTrack = results[0]
		const songId = await upsertSong(spotifyTrack)
		return songId
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Unknown error'
		logger.warn(`Spotify search failed for "${artistName} - ${trackName}": ${message}`)
		return null
	}
}

/**
 * Stores a batch of Last.fm scrobbles as Song + Listen documents.
 * Each scrobble is resolved to a Song (backend cache → Spotify search).
 * Listens are inserted only if the { userId, songId, playedAt } combination
 * doesn't already exist (enforced by the unique compound index).
 */
async function storeScrobbleBatch (
	userId: Types.ObjectId,
	tracks: LastfmTrack[],
	spotifyAccessToken: string | null
): Promise<{ songsResolved: number, songsSkipped: number, inserted: number, skipped: number }> {
	let songsResolved = 0
	let songsSkipped = 0
	let inserted = 0
	let skipped = 0

	for (const track of tracks) {
		// Skip "now playing" tracks — they have no completed timestamp
		if (track['@attr']?.nowplaying === 'true') { continue }
		if (track.date === undefined) { continue }

		const songId = await resolveSong(track, spotifyAccessToken)
		if (songId === null) {
			songsSkipped++
			continue
		}
		songsResolved++

		try {
			await ListenModel.create({
				userId,
				songId,
				playedAt: new Date(Number(track.date.uts) * 1000)
			})
			inserted++
		} catch (err: unknown) {
			if (err !== null && typeof err === 'object' && 'code' in err && err.code === 11000) {
				skipped++
			} else {
				throw err
			}
		}
	}

	return { songsResolved, songsSkipped, inserted, skipped }
}

/**
 * Gets a valid Spotify access token for the user, or null if they have no
 * connected Spotify account. Used to search the Spotify catalog for resolving
 * Last.fm scrobbles to Song documents.
 */
async function getSpotifyToken (userId: Types.ObjectId): Promise<string | null> {
	const account = await SpotifyAccountModel.findOne({ userId }).exec()
	if (account === null) { return null }

	try {
		return await ensureValidAccessToken(userId, account)
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Unknown error'
		logger.warn(`Could not get Spotify access token for user ${userId}: ${message}`)
		return null
	}
}

/**
 * Backfills all available Last.fm scrobble history by paging from page 1
 * forward. Last.fm provides full all-time history (unlike Spotify's finite
 * window). Stops when we reach the last page or hit the max page limit.
 */
export async function backfillLastfmHistory (
	userId: Types.ObjectId,
	lastfmUsername: string
): Promise<LastfmSyncResult> {
	logger.info(`Last.fm backfill started for user ${userId} (username: ${lastfmUsername})`)
	const result: LastfmSyncResult = { songsResolved: 0, songsSkipped: 0, listensInserted: 0, listensSkipped: 0, pagesFetched: 0 }

	const spotifyToken = await getSpotifyToken(userId)
	if (spotifyToken === null) {
		logger.warn(`User ${userId} has no connected Spotify account — Last.fm scrobbles cannot be resolved to songs`)
	}

	let page = 1
	let totalPages = 1

	while (page <= totalPages && page <= lastfmBackfillMaxPages) {
		let response: LastfmRecentTracksResponse | null = null
		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			try {
				response = await getRecentTracks(lastfmUsername, page, 200)
				break
			} catch (err: unknown) {
				if (attempt >= MAX_RETRIES) { throw err }
				const backoff = Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS)
				const message = err instanceof Error ? err.message : String(err)
				logger.warn(`Last.fm page ${page} failed, retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES}): ${message}`)
				await sleep(backoff)
			}
		}
		if (response === null) { break }
		result.pagesFetched++

		totalPages = Number(response.recenttracks['@attr'].totalPages)
		if (!Number.isFinite(totalPages) || totalPages < 1) { totalPages = 1 }

		const tracks = response.recenttracks.track
		if (tracks === undefined || tracks.length === 0) { break }

		const batch = await storeScrobbleBatch(userId, tracks, spotifyToken)
		result.songsResolved += batch.songsResolved
		result.songsSkipped += batch.songsSkipped
		result.listensInserted += batch.inserted
		result.listensSkipped += batch.skipped

		logger.debug(`Last.fm backfill page ${page}/${totalPages} for user ${userId}: ${batch.inserted} new, ${batch.skipped} duplicates, ${batch.songsSkipped} unresolved`)

		page++
	}

	logger.info(`Last.fm backfill complete for user ${userId}: ${result.listensInserted} listens stored, ${result.listensSkipped} duplicates, ${result.songsResolved} songs resolved, ${result.songsSkipped} unresolved, ${result.pagesFetched} pages`)
	return result
}

/**
 * Polls the most recent scrobbles and stores only new ones. Intended to be
 * called periodically by the background job. Uses the unique compound index
 * to skip listens that are already stored.
 */
export async function pollRecentScrobbles (
	userId: Types.ObjectId,
	lastfmUsername: string
): Promise<LastfmSyncResult> {
	const spotifyToken = await getSpotifyToken(userId)

	const response = await getRecentTracks(lastfmUsername, 1, lastfmPollLimit)
	const tracks = response.recenttracks.track
	if (tracks === undefined || tracks.length === 0) {
		return { songsResolved: 0, songsSkipped: 0, listensInserted: 0, listensSkipped: 0, pagesFetched: 1 }
	}

	const batch = await storeScrobbleBatch(userId, tracks, spotifyToken)

	if (batch.inserted > 0) {
		logger.info(`Last.fm poll for user ${userId}: ${batch.inserted} new scrobbles, ${batch.skipped} duplicates`)
	} else {
		logger.debug(`Last.fm poll for user ${userId}: no new scrobbles`)
	}

	return {
		songsResolved: batch.songsResolved,
		songsSkipped: batch.songsSkipped,
		listensInserted: batch.inserted,
		listensSkipped: batch.skipped,
		pagesFetched: 1
	}
}
