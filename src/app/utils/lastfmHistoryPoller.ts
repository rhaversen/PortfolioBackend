import { type Types } from 'mongoose'

import UserModel from '../models/User.js'

import { pollRecentScrobbles } from './lastfmHistorySync.js'
import logger from './logger.js'
import config from './setupConfig.js'

const POLL_INTERVAL_MS = config.lastfmPollIntervalMs

let intervalId: NodeJS.Timeout | undefined
let running = false

async function pollAllAccounts (): Promise<void> {
	if (running) {
		logger.debug('Last.fm history poll already in progress, skipping')
		return
	}
	running = true

	try {
		const users = await UserModel.find(
			{ lastfmUsername: { $ne: '' } },
			{ _id: 1, lastfmUsername: 1 }
		).exec()

		logger.info(`Last.fm history poll cycle started for ${users.length} account(s)`)

		for (const user of users) {
			try {
				await pollRecentScrobbles(user._id as Types.ObjectId, user.lastfmUsername as string)
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : 'Unknown error'
				logger.warn(`Last.fm poll failed for user ${user._id}: ${message}`, { error: err })
			}
		}

		logger.debug('Last.fm history poll cycle complete')
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Unknown error'
		logger.error(`Last.fm history poll cycle failed: ${message}`, { error: err })
	} finally {
		running = false
	}
}

export function startLastfmHistoryPoller (): void {
	if (intervalId !== undefined) {
		logger.warn('Last.fm history poller already started')
		return
	}

	logger.info(`Starting Last.fm history poller (every ${POLL_INTERVAL_MS / 1000}s)`)

	setTimeout(() => void pollAllAccounts(), 15_000)

	intervalId = setInterval(() => {
		void pollAllAccounts()
	}, POLL_INTERVAL_MS)
}

export function stopLastfmHistoryPoller (): void {
	if (intervalId !== undefined) {
		clearInterval(intervalId)
		intervalId = undefined
		logger.info('Last.fm history poller stopped')
	}
}
