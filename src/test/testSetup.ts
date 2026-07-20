// file deepcode ignore NoHardcodedPasswords/test: Hardcoded credentials are only used for testing purposes
// file deepcode ignore NoHardcodedCredentials/test: Hardcoded credentials are only used for testing purposes
// file deepcode ignore HardcodedNonCryptoSecret/test: Hardcoded credentials are only used for testing purposes

import { type Server } from 'http'
import process from 'process'

import * as chai from 'chai'
import chaiHttp, { request as chaiRequest } from 'chai-http'
import type MongoStore from 'connect-mongo'
import { after, afterEach, before, beforeEach } from 'mocha'
import mongoose from 'mongoose'
import { restore } from 'sinon'

import logger from '../app/utils/logger.js'

import { disconnectFromInMemoryMongoDB } from './mongoMemoryReplSetConnector.js'

process.env.NODE_ENV = 'test'
process.env.SESSION_SECRET = 'TEST_SESSION_SECRET'
process.env.ANTHROPIC_API_KEY = 'TEST_ANTHROPIC_API_KEY'

const chaiHttpObject = chai.use(chaiHttp)
let app: { server: Server, sessionStore: MongoStore | undefined }
let chaiAppServer: ReturnType<typeof chaiRequest.execute>

const cleanDatabase = async function (): Promise<void> {
	if (process.env.NODE_ENV !== 'test') {
		logger.warn('Database wipe attempted in non-test environment! Shutting down.')
		return
	}
	logger.debug('Cleaning databases')
	if (mongoose.connection.db !== undefined) {
		await mongoose.connection.db.dropDatabase()
	}
}

before(async function () {
	this.timeout(20000)
	process.env.NODE_ENV = 'test'

	const database = await import('./mongoMemoryReplSetConnector.js')
	await database.default()

	app = await import('../app/index.js')
})

beforeEach(async function () {
	chaiAppServer = chaiRequest.execute(app.server).keepOpen()
})

afterEach(async function () {
	restore()
	await cleanDatabase()
	await new Promise<void>((resolve) => {
		chaiAppServer.close(() => {
			resolve()
		})
	})
})

after(async function () {
	this.timeout(20000)
	app.server.close()
	await disconnectFromInMemoryMongoDB(app.sessionStore)
})

export { chaiAppServer }
