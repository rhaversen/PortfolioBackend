import logger from './logger.js'

let ngrokUrl: string | undefined

export function getNgrokUrl (): string | undefined {
	return ngrokUrl
}

const SPOTIFY_CALLBACK_PATH = '/api/v1/spotify/callback'
const DEFAULT_INTERNAL_DOMAIN = 'default.internal'

/**
 * Starts an internal ngrok Agent Endpoint that forwards to the local dev server.
 *
 * This assumes a persistent Cloud Endpoint (created in the ngrok dashboard) is
 * already configured with a Traffic Policy that uses `forward-internal` to route
 * public traffic to this internal domain. The dev server only starts the agent —
 * it never claims the public domain, so there are no "already online" conflicts.
 *
 * The returned URL is the public Cloud Endpoint domain (stable across restarts),
 * suitable for registering once with Spotify.
 */
export async function startDevTunnel (port: number): Promise<string> {
	const ngrok = await import('@ngrok/ngrok')

	const internalDomain = process.env.NGROK_INTERNAL_DOMAIN ?? DEFAULT_INTERNAL_DOMAIN

	const listener = await ngrok.forward({
		addr: port,
		authtoken_from_env: true,
		binding: 'internal',
		domain: internalDomain
	})

	const listenerUrl = listener.url()
	if (listenerUrl === null) {
		throw new Error('ngrok listener returned no URL')
	}
	ngrokUrl = listenerUrl

	const publicDomain = process.env.NGROK_DOMAIN
	if (publicDomain === undefined || publicDomain === '') {
		throw new Error('NGROK_DOMAIN is required — set it to your Cloud Endpoint URL')
	}

	// Normalize to a full https:// URL — NGROK_DOMAIN may be a bare hostname
	const publicUrl = publicDomain.startsWith('https://') ? publicDomain : `https://${publicDomain}`

	const redirectUri = `${publicUrl}${SPOTIFY_CALLBACK_PATH}`
	logger.info(`ngrok internal agent endpoint established at ${listenerUrl}`)
	logger.info(`Cloud Endpoint (public): ${publicUrl}`)
	logger.info(`Spotify redirect URI: ${redirectUri}`)
	logger.info('Make sure your Cloud Endpoint Traffic Policy forwards-internal to this domain')

	return publicUrl
}

export async function stopDevTunnel (): Promise<void> {
	if (ngrokUrl === undefined) {
		return
	}
	const ngrok = await import('@ngrok/ngrok')
	try {
		await ngrok.disconnect(ngrokUrl)
	} catch {
		await ngrok.kill()
	}
	ngrokUrl = undefined
	logger.info('ngrok internal agent endpoint closed')
}
