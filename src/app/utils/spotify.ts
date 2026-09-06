import Cryptr from 'cryptr'

import config from './setupConfig.js'

const {
	spotifyClientId,
	spotifyClientSecret,
	spotifyRedirectUri,
	spotifyScopes
} = config

let cryptrInstance: Cryptr | undefined
function getCryptr (): Cryptr {
	if (cryptrInstance === undefined) {
		cryptrInstance = new Cryptr(process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY as string)
	}
	return cryptrInstance
}

const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize'
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const SPOTIFY_API_BASE_URL = 'https://api.spotify.com/v1'

export function encryptToken (token: string): string {
	return getCryptr().encrypt(token)
}

export function decryptToken (encrypted: string): string {
	return getCryptr().decrypt(encrypted)
}

export function buildAuthUrl (state: string): string {
	const params = new URLSearchParams({
		client_id: spotifyClientId,
		response_type: 'code',
		redirect_uri: spotifyRedirectUri,
		scope: spotifyScopes,
		state
	})
	return `${SPOTIFY_AUTHORIZE_URL}?${params.toString()}`
}

export interface SpotifyTokens {
	access_token: string
	refresh_token: string
	expires_in: number
	scope: string
	token_type: string
}

export async function exchangeCodeForTokens (code: string): Promise<SpotifyTokens> {
	const authHeader = 'Basic ' + Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString('base64')

	const res = await fetch(SPOTIFY_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Authorization: authHeader
		},
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: spotifyRedirectUri
		})
	})

	if (!res.ok) {
		const errorBody = await res.text()
		throw new Error(`Spotify token exchange failed (${res.status}): ${errorBody}`)
	}

	return await res.json() as SpotifyTokens
}

export async function refreshAccessToken (refreshToken: string): Promise<SpotifyTokens> {
	const authHeader = 'Basic ' + Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString('base64')

	const res = await fetch(SPOTIFY_TOKEN_URL, {
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

	if (!res.ok) {
		const errorBody = await res.text()
		throw new Error(`Spotify token refresh failed (${res.status}): ${errorBody}`)
	}

	return await res.json() as SpotifyTokens
}

let cachedClientToken: string | null = null
let cachedClientTokenExpiry = 0

/**
 * Gets a server-to-server access token via the Client Credentials flow.
 * No user context — used for catalog searches (e.g. resolving Last.fm scrobbles).
 * The token is cached until 1 minute before expiry.
 */
export async function getClientCredentialsToken (): Promise<string> {
	const now = Date.now()
	if (cachedClientToken !== null && now < cachedClientTokenExpiry - 60_000) {
		return cachedClientToken
	}

	const authHeader = 'Basic ' + Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString('base64')

	const res = await fetch(SPOTIFY_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Authorization: authHeader
		},
		body: new URLSearchParams({ grant_type: 'client_credentials' })
	})

	if (!res.ok) {
		const errorBody = await res.text()
		throw new Error(`Spotify client credentials token failed (${res.status}): ${errorBody}`)
	}

	const json = await res.json() as { access_token: string, expires_in: number, token_type: string }
	cachedClientToken = json.access_token
	cachedClientTokenExpiry = now + json.expires_in * 1000
	return json.access_token
}

export interface SpotifyUserProfile {
	id: string
	display_name: string | null
	email: string
}

export async function getSpotifyUserId (accessToken: string): Promise<SpotifyUserProfile> {
	const res = await fetch(`${SPOTIFY_API_BASE_URL}/me`, {
		headers: { Authorization: `Bearer ${accessToken}` }
	})

	if (!res.ok) {
		const errorBody = await res.text()
		throw new Error(`Spotify profile fetch failed (${res.status}): ${errorBody}`)
	}

	return await res.json() as SpotifyUserProfile
}

export interface SpotifyArtist {
	id: string
	name: string
}

export interface SpotifyAlbum {
	id: string
	name: string
	images: Array<{ url: string, height: number, width: number }>
}

export interface SpotifyTrack {
	id: string
	name: string
	artists: SpotifyArtist[]
	album: SpotifyAlbum
	duration_ms: number
	external_urls: { spotify: string }
}

export interface SpotifyPlayHistoryItem {
	track: SpotifyTrack
	played_at: string
}

export interface SpotifyRecentlyPlayedResponse {
	href: string
	limit: number
	next: string | null
	cursors: { after: string, before: string }
	total: number
	items: SpotifyPlayHistoryItem[]
}

export async function getRecentlyPlayed (accessToken: string, limit = 20): Promise<SpotifyRecentlyPlayedResponse> {
	const res = await fetch(`${SPOTIFY_API_BASE_URL}/me/player/recently-played?limit=${limit}`, {
		headers: { Authorization: `Bearer ${accessToken}` }
	})

	if (!res.ok) {
		const errorBody = await res.text()
		throw new Error(`Spotify recently played fetch failed (${res.status}): ${errorBody}`)
	}

	return await res.json() as SpotifyRecentlyPlayedResponse
}

export async function getRecentlyPlayedBefore (accessToken: string, before: number, limit = 50): Promise<SpotifyRecentlyPlayedResponse> {
	const params = new URLSearchParams({
		limit: String(limit),
		before: String(before)
	})
	const res = await fetch(`${SPOTIFY_API_BASE_URL}/me/player/recently-played?${params.toString()}`, {
		headers: { Authorization: `Bearer ${accessToken}` }
	})

	if (!res.ok) {
		const errorBody = await res.text()
		throw new Error(`Spotify recently played fetch failed (${res.status}): ${errorBody}`)
	}

	return await res.json() as SpotifyRecentlyPlayedResponse
}

export interface SpotifySearchResponse {
	tracks: {
		href: string
		items: SpotifyTrack[]
	}
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Searches the Spotify catalog for a track by artist + track name.
 * Used to resolve Last.fm scrobbles (which lack Spotify IDs) to Song documents.
 * Retries on 429 rate limit, respecting the Retry-After header when present.
 */
export async function searchTracks (
	accessToken: string,
	artist: string,
	trackName: string,
	limit = 1
): Promise<SpotifyTrack[]> {
	const query = new URLSearchParams({
		q: `artist:"${artist}" track:"${trackName}"`,
		type: 'track',
		limit: String(limit)
	})

	const MAX_RETRIES = 5
	const INITIAL_BACKOFF_MS = 1000
	const MAX_BACKOFF_MS = 30_000

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const res = await fetch(`${SPOTIFY_API_BASE_URL}/search?${query.toString()}`, {
			headers: { Authorization: `Bearer ${accessToken}` }
		})

		if (res.ok) {
			const json = await res.json() as SpotifySearchResponse
			return json.tracks.items
		}

		const errorBody = await res.text()

		if (res.status !== 429 || attempt >= MAX_RETRIES) {
			throw new Error(`Spotify search failed (${res.status}): ${errorBody}`)
		}

		const retryAfterHeader = res.headers.get('retry-after')
		const backoff = retryAfterHeader !== null
			? Math.min(Number(retryAfterHeader) * 1000, MAX_BACKOFF_MS)
			: Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS)
		await sleep(backoff)
	}

	return []
}
