import { type Request, type Response } from 'express'
import { type Types } from 'mongoose'
import { nanoid } from 'nanoid'

import SpotifyAccountModel from '../models/SpotifyAccount.js'
import SpotifyOAuthStateModel from '../models/SpotifyOAuthState.js'
import logger from '../utils/logger.js'
import config from '../utils/setupConfig.js'
import {
	buildAuthUrl,
	decryptToken,
	encryptToken,
	exchangeCodeForTokens,
	getSpotifyUserId
} from '../utils/spotify.js'
import { backfillHistory } from '../utils/spotifyHistorySync.js'

const {
	spotifyFrontendRedirectPath,
	emailFrontendBaseUrl
} = config

function buildFrontendRedirect (userId: string, status: string): string {
	return `${emailFrontendBaseUrl}${spotifyFrontendRedirectPath}/${userId}?spotify=${status}`
}

export async function getAuthUrl (req: Request, res: Response): Promise<void> {
	const user = req.user

	if (user === undefined) {
		res.status(401).json({ error: 'Unauthorized' })
		return
	}

	const state = nanoid()
	await SpotifyOAuthStateModel.create({ state, userId: user.id })

	const url = buildAuthUrl(state)
	logger.debug(`Generated Spotify auth URL for user ${user.id}`)
	res.status(200).json({ url })
}

export async function handleCallback (req: Request, res: Response): Promise<void> {
	const { code, state, error } = req.query

	if (error !== undefined) {
		logger.warn(`Spotify auth callback received error: ${error}`)
		res.redirect(`${emailFrontendBaseUrl}${spotifyFrontendRedirectPath}?spotify=error`)
		return
	}

	if (code === undefined || state === undefined) {
		logger.warn('Spotify auth callback missing code or state')
		res.redirect(`${emailFrontendBaseUrl}${spotifyFrontendRedirectPath}?spotify=error`)
		return
	}

	const stateDoc = await SpotifyOAuthStateModel.findOneAndDelete({ state: String(state) }).exec()

	if (stateDoc === null) {
		logger.warn('Spotify auth callback: state mismatch or expired')
		res.redirect(`${emailFrontendBaseUrl}${spotifyFrontendRedirectPath}?spotify=error`)
		return
	}

	const userId = stateDoc.userId

	try {
		const tokens = await exchangeCodeForTokens(String(code))
		const profile = await getSpotifyUserId(tokens.access_token)

		await SpotifyAccountModel.findOneAndUpdate(
			{ userId },
			{
				userId,
				spotifyUserId: profile.id,
				accessToken: encryptToken(tokens.access_token),
				refreshToken: encryptToken(tokens.refresh_token),
				expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
				scopes: tokens.scope,
				connectedAt: new Date()
			},
			{ upsert: true, returnDocument: 'after' }
		)

		logger.info(`User ${userId} connected Spotify account ${profile.id}`)
		res.redirect(buildFrontendRedirect(String(userId), 'connected'))

		// Fire-and-forget backfill so the redirect isn't delayed. The background
		// poller will also pick up ongoing plays every 5 minutes.
		void backfillHistory(userId as unknown as Types.ObjectId, tokens.access_token)
			.then((result) => {
				logger.info(`Auto-backfill after connect for user ${userId}: ${result.listensInserted} listens, ${result.songsUpserted} songs`)
			})
			.catch((err: unknown) => {
				const message = err instanceof Error ? err.message : 'Unknown error'
				logger.error(`Auto-backfill after connect failed for user ${userId}: ${message}`, { error: err })
			})
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error'
		logger.error(`Spotify connection failed for user ${userId}: ${message}`, { error: err })
		res.redirect(buildFrontendRedirect(String(userId), 'error'))
	}
}

export async function getStatus (req: Request, res: Response): Promise<void> {
	const user = req.user

	if (user === undefined) {
		res.status(401).json({ error: 'Unauthorized' })
		return
	}

	const account = await SpotifyAccountModel.findOne({ userId: user.id }).exec()

	if (account === null) {
		res.status(200).json({ connected: false, connectedAt: null, scopes: null })
		return
	}

	res.status(200).json({
		connected: true,
		connectedAt: account.connectedAt,
		scopes: account.scopes
	})
}

export async function disconnect (req: Request, res: Response): Promise<void> {
	const user = req.user

	if (user === undefined) {
		res.status(401).json({ error: 'Unauthorized' })
		return
	}

	const account = await SpotifyAccountModel.findOneAndDelete({ userId: user.id }).exec()

	if (account === null) {
		res.status(200).json({ message: 'Spotify account not connected' })
		return
	}

	// Spotify has no documented token-revocation endpoint, so we rely on deleting
	// the stored tokens. Without our storage the tokens are effectively useless.
	let refreshToken: string | undefined
	try {
		refreshToken = decryptToken(account.refreshToken)
	} catch (err) {
		logger.warn('Failed to decrypt refresh token during disconnect', { error: err })
	}

	if (refreshToken !== undefined) {
		try {
			const authHeader = 'Basic ' + Buffer.from(
				`${config.spotifyClientId}:${config.spotifyClientSecret}`
			).toString('base64')
			await fetch('https://accounts.spotify.com/api/token', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Authorization: authHeader
				},
				body: new URLSearchParams({
					grant_type: 'refresh_token',
					refresh_token: refreshToken
				})
			})
		} catch (err) {
			logger.warn('Best-effort Spotify token invalidation failed (non-fatal)', { error: err })
		}
	}

	logger.info(`User ${user.id} disconnected Spotify account ${account.spotifyUserId}`)
	res.status(200).json({ message: 'Spotify account disconnected' })
}
