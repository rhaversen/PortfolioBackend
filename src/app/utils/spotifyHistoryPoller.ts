import { type Types } from 'mongoose'

import SpotifyAccountModel from '../models/SpotifyAccount.js'

import logger from './logger.js'
import { ensureValidAccessToken, pollRecentListens } from './spotifyHistorySync.js'

const POLL_INTERVAL_MS = 5 * 60 * 1000

let intervalId: NodeJS.Timeout | undefined
let running = false

async function pollAllAccounts (): Promise<void> {
	if (running) {
		logger.debug('Spotify history poll already in progress, skipping')
		return
	}
	running = true

	try {
		const accounts = await SpotifyAccountModel.find({}).exec()
		logger.info(`Spotify history poll cycle started for ${accounts.length} account(s)`)

		for (const account of accounts) {
			try {
				const accessToken = await ensureValidAccessToken(account.userId, account)
				await pollRecentListens(account.userId as Types.ObjectId, accessToken)
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : 'Unknown error'
				logger.warn(`Spotify poll failed for user ${account.userId}: ${message}`, { error: err })
			}
		}

		logger.debug('Spotify history poll cycle complete')
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Unknown error'
		logger.error(`Spotify history poll cycle failed: ${message}`, { error: err })
	} finally {
		running = false
	}
}

export function startSpotifyHistoryPoller (): void {
	if (intervalId !== undefined) {
		logger.warn('Spotify history poller already started')
		return
	}

	logger.info(`Starting Spotify history poller (every ${POLL_INTERVAL_MS / 1000}s)`)

	// Poll shortly after startup so we don't wait a full interval for the first cycle
	setTimeout(() => void pollAllAccounts(), 10_000)

	intervalId = setInterval(() => {
		void pollAllAccounts()
	}, POLL_INTERVAL_MS)
}

export function stopSpotifyHistoryPoller (): void {
	if (intervalId !== undefined) {
		clearInterval(intervalId)
		intervalId = undefined
		logger.info('Spotify history poller stopped')
	}
}
