import { type Types } from 'mongoose'

import ListenModel from '../models/Listen.js'
import SongModel from '../models/Song.js'
import SpotifyAccountModel from '../models/SpotifyAccount.js'

import logger from './logger.js'
import {
	decryptToken,
	encryptToken,
	getRecentlyPlayed,
	getRecentlyPlayedBefore,
	refreshAccessToken,
	type SpotifyPlayHistoryItem,
	type SpotifyTrack
} from './spotify.js'

const BACKFILL_MAX_PAGES = 20
const POLL_LIMIT = 50

export interface SyncResult {
	songsUpserted: number
	listensInserted: number
	listensSkipped: number
	pagesFetched: number
}

/**
 * Upserts a track into the Song collection (dedup by spotifyId).
 * Returns the mongoose document id.
 */
async function upsertSong (track: SpotifyTrack): Promise<Types.ObjectId> {
	const doc = await SongModel.findOneAndUpdate(
		{ spotifyId: track.id },
		{
			spotifyId: track.id,
			name: track.name,
			artists: track.artists.map((a) => a.name),
			album: track.album.name,
			albumImage: track.album.images.length > 0 ? track.album.images[0].url : null,
			durationMs: track.duration_ms,
			spotifyUrl: track.external_urls.spotify
		},
		{ upsert: true, returnDocument: 'after' }
	).exec()
	return doc._id
}

/**
 * Stores a batch of play-history items as Song + Listen documents.
 * Songs are upserted (dedup by spotifyId). Listens are inserted only if the
 * { userId, songId, playedAt } combination doesn't already exist (enforced by
 * the unique compound index on the Listen collection).
 */
async function storeHistoryBatch (userId: Types.ObjectId, items: SpotifyPlayHistoryItem[]): Promise<{ songs: number, inserted: number, skipped: number }> {
	let songs = 0
	let inserted = 0
	let skipped = 0

	for (const item of items) {
		if (item.track.id === undefined || item.track.id === '') { continue }

		const songId = await upsertSong(item.track)
		songs++

		try {
			await ListenModel.create({
				userId,
				songId,
				playedAt: new Date(item.played_at)
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

	return { songs, inserted, skipped }
}

/**
 * Returns a valid (unexpired) access token for the user, refreshing it from
 * Spotify and persisting the new tokens if the stored one has expired.
 */
export async function ensureValidAccessToken (userId: Types.ObjectId, account: { accessToken: string, refreshToken: string, expiresAt: Date }): Promise<string> {
	const now = Date.now()
	if (account.expiresAt.getTime() - now > 10_000) {
		return decryptToken(account.accessToken)
	}

	const refreshToken = decryptToken(account.refreshToken)
	const tokens = await refreshAccessToken(refreshToken)

	await SpotifyAccountModel.updateOne(
		{ userId },
		{
			accessToken: encryptToken(tokens.access_token),
			expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
			scopes: tokens.scope
		}
	)

	logger.debug(`Refreshed Spotify access token for user ${userId}`)
	return tokens.access_token
}

/**
 * Backfills all available recently-played history by paging backwards using the
 * `before` cursor. Spotify caps this at a finite window, so we stop when a page
 * comes back empty or we hit BACKFILL_MAX_PAGES.
 */
export async function backfillHistory (userId: Types.ObjectId, accessToken: string): Promise<SyncResult> {
	logger.info(`Spotify backfill started for user ${userId}`)
	const result: SyncResult = { songsUpserted: 0, listensInserted: 0, listensSkipped: 0, pagesFetched: 0 }

	let response = await getRecentlyPlayed(accessToken, POLL_LIMIT)
	result.pagesFetched++

	const { songs, inserted, skipped } = await storeHistoryBatch(userId, response.items)
	result.songsUpserted += songs
	result.listensInserted += inserted
	result.listensSkipped += skipped
	logger.debug(`Backfill page 1 for user ${userId}: ${inserted} new, ${skipped} duplicates`)

	let page = 1
	while (response.items.length === POLL_LIMIT && response.cursors.before !== null && page < BACKFILL_MAX_PAGES) {
		const before = Number(response.cursors.before)
		if (!Number.isFinite(before) || before <= 0) { break }

		response = await getRecentlyPlayedBefore(accessToken, before, POLL_LIMIT)
		result.pagesFetched++
		page++

		const batch = await storeHistoryBatch(userId, response.items)
		result.songsUpserted += batch.songs
		result.listensInserted += batch.inserted
		result.listensSkipped += batch.skipped
		logger.debug(`Backfill page ${page} for user ${userId}: ${batch.inserted} new, ${batch.skipped} duplicates`)
	}

	logger.info(`Spotify backfill complete for user ${userId}: ${result.listensInserted} listens stored, ${result.listensSkipped} duplicates skipped, ${result.songsUpserted} songs upserted, ${result.pagesFetched} pages`)
	return result
}

/**
 * Polls the most recent plays and stores only new ones. Intended to be called
 * periodically by the background job. Uses the unique compound index to skip
 * listens that are already stored.
 */
export async function pollRecentListens (userId: Types.ObjectId, accessToken: string): Promise<SyncResult> {
	const response = await getRecentlyPlayed(accessToken, POLL_LIMIT)
	const { songs, inserted, skipped } = await storeHistoryBatch(userId, response.items)

	if (inserted > 0) {
		logger.info(`Spotify poll for user ${userId}: ${inserted} new listens, ${skipped} duplicates`)
	} else {
		logger.debug(`Spotify poll for user ${userId}: no new listens`)
	}

	return {
		songsUpserted: songs,
		listensInserted: inserted,
		listensSkipped: skipped,
		pagesFetched: 1
	}
}
