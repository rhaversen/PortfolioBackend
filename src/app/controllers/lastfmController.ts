import { type Request, type Response } from 'express'
import { type Types } from 'mongoose'

import UserModel from '../models/User.js'
import { getUserInfo } from '../utils/lastfm.js'
import { backfillLastfmHistory } from '../utils/lastfmHistorySync.js'
import logger from '../utils/logger.js'

export async function connect (req: Request, res: Response): Promise<void> {
	const user = req.user

	if (user === undefined) {
		res.status(401).json({ error: 'Unauthorized' })
		return
	}

	const { lastfmUsername } = req.body

	if (lastfmUsername === undefined || typeof lastfmUsername !== 'string' || lastfmUsername.trim() === '') {
		res.status(400).json({ error: 'lastfmUsername is required' })
		return
	}

	const username = lastfmUsername.trim()

	try {
		// Validate the username by fetching user info
		const info = await getUserInfo(username)
		logger.info(`User ${user.id} connecting Last.fm account ${username} (${info.playcount} scrobbles)`)

		await UserModel.updateOne(
			{ _id: user.id },
			{ lastfmUsername: username }
		).exec()

		res.status(200).json({
			connected: true,
			lastfmUsername: username,
			playcount: Number(info.playcount)
		})

		// Fire-and-forget backfill so the response isn't delayed
		void backfillLastfmHistory(user.id as unknown as Types.ObjectId, username)
			.then((result) => {
				logger.info(`Auto-backfill after connect for user ${user.id}: ${result.listensInserted} listens, ${result.songsResolved} songs resolved`)
				return null
			})
			.catch((err: unknown) => {
				const message = err instanceof Error ? err.message : 'Unknown error'
				logger.error(`Auto-backfill after connect failed for user ${user.id}: ${message}`, { error: err })
			})
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Unknown error'
		logger.error(`Last.fm connection failed for user ${user.id}: ${message}`, { error: err })
		res.status(502).json({ error: 'Failed to connect Last.fm account — check username' })
	}
}

export async function getStatus (req: Request, res: Response): Promise<void> {
	const user = req.user

	if (user === undefined) {
		res.status(401).json({ error: 'Unauthorized' })
		return
	}

	const lastfmUsername = user.lastfmUsername ?? ''
	if (lastfmUsername === '') {
		res.status(200).json({ connected: false, lastfmUsername: null })
		return
	}

	res.status(200).json({
		connected: true,
		lastfmUsername
	})
}

export async function disconnect (req: Request, res: Response): Promise<void> {
	const user = req.user

	if (user === undefined) {
		res.status(401).json({ error: 'Unauthorized' })
		return
	}

	await UserModel.updateOne(
		{ _id: user.id },
		{ lastfmUsername: '' }
	).exec()

	logger.info(`User ${user.id} disconnected Last.fm account`)
	res.status(200).json({ message: 'Last.fm account disconnected' })
}
