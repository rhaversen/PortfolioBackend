// file deepcode ignore NoHardcodedPasswords/test: Hardcoded credentials are only used for testing purposes

import { expect } from 'chai'
import { describe, it } from 'mocha'
import { stub } from 'sinon'

import emailService from '../../app/utils/emailService.js'
import { chaiAppServer } from '../testSetup.js'

describe('Auth API', function () {
	describe('POST /api/v1/users (register)', function () {
		it('should register a new user, send confirmation email, and return the created user', async function () {
			this.timeout(20000)
			const sendStub = stub(emailService, 'sendConfirmationEmail').resolves({ sent: true })

			const res = await chaiAppServer
				.post('/api/v1/users')
				.send({ email: 'testuser@example.com', password: 'password123', confirmPassword: 'password123' })

			expect(res.status).to.equal(201)
			expect(res.body.email).to.equal('testuser@example.com')
			expect(res.body.confirmed).to.equal(false)
			expect(sendStub.calledOnce).to.equal(true)

			sendStub.restore()
		})

		it('should reject registration when passwords do not match', async function () {
			const res = await chaiAppServer
				.post('/api/v1/users')
				.send({ email: 'mismatch@example.com', password: 'password123', confirmPassword: 'different' })

			expect(res.status).to.equal(400)
			expect(res.body.error).to.include('do not match')
		})

		it('should reject registration when the user already exists', async function () {
			this.timeout(20000)
			const sendStub = stub(emailService, 'sendConfirmationEmail').resolves({ sent: true })

			await chaiAppServer
				.post('/api/v1/users')
				.send({ email: 'existing@example.com', password: 'password123', confirmPassword: 'password123' })

			const res = await chaiAppServer
				.post('/api/v1/users')
				.send({ email: 'existing@example.com', password: 'password123', confirmPassword: 'password123' })

			expect(res.status).to.equal(409)
			expect(res.body.error).to.include('already exists')

			sendStub.restore()
		})
	})

	describe('POST /api/v1/auth/login-user-local', function () {
		it('should log in an existing user', async function () {
			this.timeout(20000)
			const sendStub = stub(emailService, 'sendConfirmationEmail').resolves({ sent: true })

			await chaiAppServer
				.post('/api/v1/users')
				.send({ email: 'loginuser@example.com', password: 'password123', confirmPassword: 'password123' })

			sendStub.restore()

			const res = await chaiAppServer
				.post('/api/v1/auth/login-user-local')
				.send({ email: 'loginuser@example.com', password: 'password123' })

			expect(res.status).to.equal(200)
			expect(res.body.auth).to.equal(true)
			expect(res.body.user.email).to.equal('loginuser@example.com')
		})

		it('should reject login with wrong password', async function () {
			this.timeout(20000)
			const sendStub = stub(emailService, 'sendConfirmationEmail').resolves({ sent: true })

			await chaiAppServer
				.post('/api/v1/users')
				.send({ email: 'wrongpw@example.com', password: 'password123', confirmPassword: 'password123' })

			const res = await chaiAppServer
				.post('/api/v1/auth/login-user-local')
				.send({ email: 'wrongpw@example.com', password: 'wrongpassword' })

			expect(res.status).to.equal(401)
			expect(res.body.auth).to.equal(false)

			sendStub.restore()
		})
	})

	describe('POST /api/v1/auth/forgot-password', function () {
		it('should always return 200 regardless of email existence', async function () {
			const res = await chaiAppServer
				.post('/api/v1/auth/forgot-password')
				.send({ email: 'nonexistent@example.com' })

			expect(res.status).to.equal(200)
			expect(res.body.message).to.include('If that email exists')
		})
	})

	describe('POST /api/v1/auth/reset-password', function () {
		it('should reject reset with invalid code', async function () {
			const res = await chaiAppServer
				.post('/api/v1/auth/reset-password')
				.send({ passwordResetCode: 'invalidcode', newPassword: 'newpass123', confirmPassword: 'newpass123' })

			expect(res.status).to.equal(404)
		})

		it('should reject reset when passwords do not match', async function () {
			const res = await chaiAppServer
				.post('/api/v1/auth/reset-password')
				.send({ passwordResetCode: 'somecode', newPassword: 'newpass123', confirmPassword: 'different' })

			expect(res.status).to.equal(400)
		})
	})

	describe('GET /api/v1/auth/is-authenticated', function () {
		it('should return 401 when not authenticated', async function () {
			const res = await chaiAppServer.get('/api/v1/auth/is-authenticated')
			expect(res.status).to.equal(401)
		})
	})
})
