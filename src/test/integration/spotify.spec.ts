// file deepcode ignore NoHardcodedPasswords/test: Hardcoded credentials are only used for testing purposes

import { expect } from 'chai'
import { describe, it } from 'mocha'
import { stub } from 'sinon'

import emailService from '../../app/utils/emailService.js'
import { chaiAppServer } from '../testSetup.js'

const TEST_EMAIL = 'spotifyuser@example.com'
const TEST_PASSWORD = 'password123'

async function registerAndLogin (): Promise<{ userId: string, cookie: string }> {
	const sendStub = stub(emailService, 'sendConfirmationEmail').resolves({ sent: true })

	await chaiAppServer
		.post('/api/v1/users')
		.send({ email: TEST_EMAIL, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD })

	const loginRes = await chaiAppServer
		.post('/api/v1/auth/login-user-local')
		.send({ email: TEST_EMAIL, password: TEST_PASSWORD })

	expect(loginRes.status).to.equal(200)
	sendStub.restore()

	const cookie = loginRes.header['set-cookie'][0].split(';')[0]
	return { userId: loginRes.body.user._id, cookie }
}

function mockSpotifyFetch (): { restore: () => void } {
	const originalFetch = global.fetch
	const fetchStub = stub(global, 'fetch').callsFake(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
		if (url.includes('/api/token')) {
			const body = init?.body instanceof URLSearchParams ? init.body.toString() : ''
			if (body.includes('grant_type=refresh_token')) {
				return new Response(JSON.stringify({
					access_token: 'refreshed-access-token',
					refresh_token: 'test-refresh-token',
					expires_in: 3600,
					scope: 'user-top-read user-read-recently-played',
					token_type: 'Bearer'
				}), { status: 200, headers: { 'Content-Type': 'application/json' } })
			}
			return new Response(JSON.stringify({
				access_token: 'test-access-token',
				refresh_token: 'test-refresh-token',
				expires_in: 3600,
				scope: 'user-top-read user-read-recently-played',
				token_type: 'Bearer'
			}), { status: 200, headers: { 'Content-Type': 'application/json' } })
		}
		if (url.includes('/v1/me')) {
			return new Response(JSON.stringify({
				id: 'spotify-user-123',
				display_name: 'Test User',
				email: 'spotifyuser@example.com'
			}), { status: 200, headers: { 'Content-Type': 'application/json' } })
		}
		return new Response('Not found', { status: 404 })
	})
	return {
		restore: () => {
			fetchStub.restore()
			global.fetch = originalFetch
		}
	}
}

describe('Spotify API', function () {
	describe('GET /api/v1/spotify/status', function () {
		it('should return 401 when not authenticated', async function () {
			const res = await chaiAppServer.get('/api/v1/spotify/status')
			expect(res.status).to.equal(401)
		})

		it('should return connected: false when not connected', async function () {
			this.timeout(20000)
			const { cookie } = await registerAndLogin()

			const res = await chaiAppServer.get('/api/v1/spotify/status').set('Cookie', cookie)
			expect(res.status).to.equal(200)
			expect(res.body.connected).to.equal(false)
			expect(res.body.connectedAt).to.equal(null)
			expect(res.body.scopes).to.equal(null)
		})
	})

	describe('GET /api/v1/spotify/auth', function () {
		it('should return 401 when not authenticated', async function () {
			const res = await chaiAppServer.get('/api/v1/spotify/auth')
			expect(res.status).to.equal(401)
		})

		it('should return an auth URL containing client_id and state', async function () {
			this.timeout(20000)
			const { cookie } = await registerAndLogin()

			const res = await chaiAppServer.get('/api/v1/spotify/auth').set('Cookie', cookie)
			expect(res.status).to.equal(200)
			expect(res.body.url).to.include('https://accounts.spotify.com/authorize')
			expect(res.body.url).to.include('client_id=')
			expect(res.body.url).to.include('state=')
		})
	})

	describe('GET /api/v1/spotify/callback', function () {
		it('should redirect with spotify=error when state is missing', async function () {
			const res = await chaiAppServer.get('/api/v1/spotify/callback?code=fakecode').redirects(0)
			expect(res.status).to.equal(302)
			expect(res.header.location).to.include('spotify=error')
		})

		it('should redirect with spotify=error when state does not match', async function () {
			const res = await chaiAppServer.get('/api/v1/spotify/callback?code=fakecode&state=wrongstate').redirects(0)
			expect(res.status).to.equal(302)
			expect(res.header.location).to.include('spotify=error')
		})

		it('should upsert SpotifyAccount and redirect with spotify=connected on valid callback', async function () {
			this.timeout(20000)
			const { userId, cookie } = await registerAndLogin()
			const mock = mockSpotifyFetch()

			// Seed a valid state by calling /auth first
			const authRes = await chaiAppServer.get('/api/v1/spotify/auth').set('Cookie', cookie)
			const authUrl = new URL(authRes.body.url)
			const state = authUrl.searchParams.get('state')

			const res = await chaiAppServer
				.get(`/api/v1/spotify/callback?code=fakecode&state=${state}`)
				.redirects(0)
			expect(res.status).to.equal(302)
			expect(res.header.location).to.include('spotify=connected')
			expect(res.header.location).to.include(userId)

			// Verify status now shows connected
			const statusRes = await chaiAppServer.get('/api/v1/spotify/status').set('Cookie', cookie)
			expect(statusRes.status).to.equal(200)
			expect(statusRes.body.connected).to.equal(true)
			expect(statusRes.body.scopes).to.equal('user-top-read user-read-recently-played')

			mock.restore()
		})

		it('should redirect with spotify=error when token exchange fails', async function () {
			this.timeout(20000)
			const { cookie } = await registerAndLogin()

			const originalFetch = global.fetch
			const fetchStub = stub(global, 'fetch').rejects(new Error('Token exchange failed'))

			// Seed a valid state
			const authRes = await chaiAppServer.get('/api/v1/spotify/auth').set('Cookie', cookie)
			const authUrl = new URL(authRes.body.url)
			const state = authUrl.searchParams.get('state')

			const res = await chaiAppServer
				.get(`/api/v1/spotify/callback?code=fakecode&state=${state}`)
				.redirects(0)
			expect(res.status).to.equal(302)
			expect(res.header.location).to.include('spotify=error')

			fetchStub.restore()
			global.fetch = originalFetch
		})
	})

	describe('POST /api/v1/spotify/disconnect', function () {
		it('should return 401 when not authenticated', async function () {
			const res = await chaiAppServer.post('/api/v1/spotify/disconnect')
			expect(res.status).to.equal(401)
		})

		it('should return 200 when not connected', async function () {
			this.timeout(20000)
			const { cookie } = await registerAndLogin()

			const res = await chaiAppServer.post('/api/v1/spotify/disconnect').set('Cookie', cookie)
			expect(res.status).to.equal(200)
		})

		it('should disconnect and set connected: false after being connected', async function () {
			this.timeout(20000)
			const { cookie } = await registerAndLogin()
			const mock = mockSpotifyFetch()

			// Connect first
			const authRes = await chaiAppServer.get('/api/v1/spotify/auth').set('Cookie', cookie)
			const authUrl = new URL(authRes.body.url)
			const state = authUrl.searchParams.get('state')
			await chaiAppServer
				.get(`/api/v1/spotify/callback?code=fakecode&state=${state}`)
				.redirects(0)

			// Verify connected
			const statusBefore = await chaiAppServer.get('/api/v1/spotify/status').set('Cookie', cookie)
			expect(statusBefore.body.connected).to.equal(true)

			// Disconnect
			const res = await chaiAppServer.post('/api/v1/spotify/disconnect').set('Cookie', cookie)
			expect(res.status).to.equal(200)

			// Verify not connected
			const statusAfter = await chaiAppServer.get('/api/v1/spotify/status').set('Cookie', cookie)
			expect(statusAfter.body.connected).to.equal(false)

			mock.restore()
		})
	})
})
