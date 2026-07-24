import { type Types } from 'mongoose'

import ListenModel from '../models/Listen.js'
import SongModel from '../models/Song.js'

import { type LastfmRecentTracksResponse, type LastfmTrack, getRecentTracks } from './lastfm.js'
import logger from './logger.js'
import config from './setupConfig.js'
import { getClientCredentialsToken, searchTracks } from './spotify.js'
import { upsertSong } from './spotifyHistorySync.js'

const {
	lastfmBackfillMaxPages,
	lastfmPollLimit
} = config

const MAX_RETRIES = 5
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30_000
const SPOTIFY_SEARCH_DELAY_MS = 250

export interface LastfmSyncResult {
	songsResolved: number
	songsSkipped: number
	listensInserted: number
	listensSkipped: number
	pagesFetched: number
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function songCacheKey (artist: string, name: string): string {
	return `${artist}\0${name}`
}

/**
 * Stores a batch of Last.fm scrobbles as Song + Listen documents.
 *
 * Song resolution strategy:
 * 1. Batch-check the backend cache with a single MongoDB query for all
 *    tracks on the page (avoids N individual findOne calls)
 * 2. For uncached tracks, search the Spotify catalog one at a time with
 *    throttling (SPOTIFY_SEARCH_DELAY_MS between calls) to avoid 429s
 * 3. Listens are inserted only if the { userId, songId, playedAt } combination
 *    doesn't already exist (enforced by the unique compound index)
 */
async function storeScrobbleBatch (
	userId: Types.ObjectId,
	tracks: LastfmTrack[],
	spotifyAccessToken: string
): Promise<{ songsResolved: number, songsSkipped: number, inserted: number, skipped: number }> {
	// Filter to valid scrobbles: not "now playing", has timestamp, has artist + name
	const validTracks = tracks.filter((t) =>
		t['@attr']?.nowplaying !== 'true' &&
		t.date !== undefined &&
		t.artist['#text'] !== '' &&
		t.name !== ''
	)

	if (validTracks.length === 0) {
		return { songsResolved: 0, songsSkipped: 0, inserted: 0, skipped: 0 }
	}

	// Batch cache lookup: single query for all tracks on this page
	const cacheConditions = validTracks.map((t) => ({
		artists: t.artist['#text'],
		name: t.name
	}))
	const cachedSongs = await SongModel.find({ $or: cacheConditions }).exec()
	const songCache = new Map<string, Types.ObjectId>()
	for (const song of cachedSongs) {
		const key = songCacheKey(song.artists[0] ?? '', song.name)
		if (!songCache.has(key)) {
			songCache.set(key, song._id)
		}
	}

	let songsResolved = 0
	let songsSkipped = 0
	let inserted = 0
	let skipped = 0
	let lastSearchTime = 0

	for (const track of validTracks) {
		const artistName = track.artist['#text']
		const trackName = track.name
		const key = songCacheKey(artistName, trackName)

		let songId = songCache.get(key) ?? null

		if (songId === null) {
			// Throttle Spotify searches to avoid 429 rate limits
			const elapsed = Date.now() - lastSearchTime
			if (elapsed < SPOTIFY_SEARCH_DELAY_MS) {
				await sleep(SPOTIFY_SEARCH_DELAY_MS - elapsed)
			}

			try {
				const results = await searchTracks(spotifyAccessToken, artistName, trackName, 1)
				if (results.length > 0) {
					songId = await upsertSong(results[0])
					songCache.set(key, songId)
				}
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : 'Unknown error'
				logger.warn(`Spotify search failed for "${artistName} - ${trackName}": ${message}`)
			}
			lastSearchTime = Date.now()
		}

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
 * Gets a server-to-server Spotify access token via the Client Credentials flow.
 * No user context needed — used to search the Spotify catalog for resolving
 * Last.fm scrobbles to Song documents.
 */
async function getServerSpotifyToken (): Promise<string> {
	return await getClientCredentialsToken()
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

	const spotifyToken = await getServerSpotifyToken()

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
	const spotifyToken = await getServerSpotifyToken()

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
