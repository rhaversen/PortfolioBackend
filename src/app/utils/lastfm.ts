import config from './setupConfig.js'

const { lastfmApiKey, lastfmApiBaseUrl } = config

export interface LastfmTrack {
	artist: { mbid: string, '#text': string }
	name: string
	mbid: string
	album: { mbid: string, '#text': string }
	url: string
	date: { uts: string, '#text': string }
	image: Array<{ size: string, '#text': string }>
	'@attr'?: { nowplaying: string }
}

export interface LastfmRecentTracksResponse {
	recenttracks: {
		track: LastfmTrack[]
		'@attr': {
			user: string
			totalPages: string
			page: string
			perPage: string
			total: string
		}
	}
}

export interface LastfmUser {
	name: string
	playcount: string
	registered: { unixtime: string, '#text': string }
	url: string
}

export interface LastfmUserInfoResponse {
	user: LastfmUser
}

/**
 * Low-level Last.fm API call. All responses are JSON.
 * Last.fm uses API key only for read operations — no OAuth needed.
 */
async function lastfmGet (params: Record<string, string>): Promise<Record<string, unknown>> {
	const query = new URLSearchParams({
		format: 'json',
		api_key: lastfmApiKey,
		...params
	})

	const res = await fetch(`${lastfmApiBaseUrl}?${query.toString()}`)

	if (!res.ok) {
		const errorBody = await res.text()
		throw new Error(`Last.fm API request failed (${res.status}): ${errorBody}`)
	}

	const json = await res.json() as Record<string, unknown>

	if ('error' in json) {
		const code = json.error
		const message = json.message ?? 'Unknown Last.fm error'
		throw new Error(`Last.fm API error ${code}: ${message}`)
	}

	return json
}

/**
 * Fetches a user's scrobble history (user.getRecentTracks).
 * Page-based pagination, max 200 per page.
 */
export async function getRecentTracks (
	username: string,
	page = 1,
	limit = 200,
	from?: number
): Promise<LastfmRecentTracksResponse> {
	const params: Record<string, string> = {
		method: 'user.getrecenttracks',
		user: username,
		limit: String(limit),
		page: String(page)
	}
	if (from !== undefined) {
		params.from = String(from)
	}

	return await lastfmGet(params) as unknown as LastfmRecentTracksResponse
}

/**
 * Fetches user info (user.getInfo) — validates the username and gets total play count.
 */
export async function getUserInfo (username: string): Promise<LastfmUser> {
	const response = await lastfmGet({ method: 'user.getinfo', user: username }) as unknown as LastfmUserInfoResponse
	return response.user
}
