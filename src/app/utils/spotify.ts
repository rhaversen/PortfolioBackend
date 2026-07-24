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

/**
 * Searches the Spotify catalog for a track by artist + track name.
 * Used to resolve Last.fm scrobbles (which lack Spotify IDs) to Song documents.
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

	const res = await fetch(`${SPOTIFY_API_BASE_URL}/search?${query.toString()}`, {
		headers: { Authorization: `Bearer ${accessToken}` }
	})

	if (!res.ok) {
		const errorBody = await res.text()
		throw new Error(`Spotify search failed (${res.status}): ${errorBody}`)
	}

	const json = await res.json() as SpotifySearchResponse
	return json.tracks.items
}
