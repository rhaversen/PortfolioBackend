import './utils/verifyEnvironmentSecrets.js'

import { createServer } from 'node:http'

import MongoStore from 'connect-mongo'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import RateLimit from 'express-rate-limit'
import session from 'express-session'
import helmet from 'helmet'
import mongoose from 'mongoose'
import passport from 'passport'
import { Server } from 'socket.io'

import globalErrorHandler from './middleware/globalErrorHandler.js'
import authRoutes from './routes/auth.js'
import serviceRoutes from './routes/service.js'
import userRoutes from './routes/users.js'
import databaseConnector from './utils/databaseConnector.js'
import logger from './utils/logger.js'
import configurePassport from './utils/passportConfig.js'
import config from './utils/setupConfig.js'
import { registerAgentGiveUpHandlers } from './websockets/agentGiveUp.js'
import { registerBrainwashHandlers } from './websockets/brainwash.js'
import { registerGhostWriterHandlers } from './websockets/ghostWriter.js'
import { registerOneWordStoryHandlers } from './websockets/oneWordStory.js'
import { registerSentientUselessBoxHandlers } from './websockets/sentientUselessBox.js'
import { registerTerminatorHandlers } from './websockets/terminator.js'

const { NODE_ENV, SESSION_SECRET } = process.env as Record<string, string>

const app = express()
const server = createServer(app)
const io = new Server(server, {
	cors: config.corsConfig
})

logger.info(`Node environment: ${NODE_ENV}`)

app.set('trust proxy', 1)

app.use(helmet())
app.use(express.json({ limit: '10kb' }))
app.use(cors(config.corsConfig))

if (NODE_ENV === 'production' || NODE_ENV === 'staging') {
	await databaseConnector.connectToMongoDB()
}

const sessionStore = mongoose.connection.readyState === 1
	? MongoStore.create({
		client: mongoose.connection.getClient(),
		autoRemove: 'interval',
		autoRemoveInterval: 1
	})
	: undefined

const sessionMiddleware = session({
	resave: true,
	rolling: true,
	secret: SESSION_SECRET,
	saveUninitialized: false,
	...(sessionStore !== undefined ? { store: sessionStore } : {}),
	cookie: config.cookieOptions
})

app.use(cookieParser())
app.use(sessionMiddleware)
app.use(passport.initialize())
app.use(passport.session())
configurePassport(passport)

const burstLimiter = RateLimit({
	...config.burstLimiterConfig,
	standardHeaders: 'draft-7',
	legacyHeaders: false
})
const sustainedLimiter = RateLimit({
	...config.sustainedLimiterConfig,
	standardHeaders: 'draft-7',
	legacyHeaders: false
})
app.use(burstLimiter)
app.use(sustainedLimiter)

app.use('/api/service', serviceRoutes)
app.use('/api/v1/auth', authRoutes)
app.use('/api/v1/users', userRoutes)

app.use(globalErrorHandler)

io.on('connection', (socket) => {
	logger.info(`WebSocket client connected: ${socket.id}`)
	registerAgentGiveUpHandlers(io, socket)
	registerBrainwashHandlers(io, socket)
	registerGhostWriterHandlers(io, socket)
	registerOneWordStoryHandlers(io, socket)
	registerSentientUselessBoxHandlers(io, socket)
	registerTerminatorHandlers(io, socket)
	socket.on('disconnect', () => {
		logger.info(`WebSocket client disconnected: ${socket.id}`)
	})
})

server.listen(config.expressPort, () => {
	logger.info(`Server listening on port ${config.expressPort}`)
})

export async function shutDown (): Promise<void> {
	logger.info('Closing server...')
	server.close()
	if (sessionStore !== undefined) {
		await sessionStore.close().catch((err: unknown) => logger.error('Error closing session store', { error: err }))
	}
	await mongoose.connection.close().catch((err: unknown) => logger.error('Error closing mongoose connection', { error: err }))
	logger.info('Server closed')
}

export { server, sessionStore }
export default app
