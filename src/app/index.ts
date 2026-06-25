import './utils/verifyEnvironmentSecrets.js'

import { createServer } from 'node:http'

import cors from 'cors'
import express from 'express'
import RateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { Server } from 'socket.io'

import globalErrorHandler from './middleware/globalErrorHandler.js'
import serviceRoutes from './routes/service.js'
import logger from './utils/logger.js'
import config from './utils/setupConfig.js'
import { registerBrainwashHandlers } from './websockets/brainwash.js'
import { registerSentientUselessBoxHandlers } from './websockets/sentientUselessBox.js'

const { NODE_ENV } = process.env as Record<string, string>

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

const apiLimiter = RateLimit(config.apiLimiterConfig)
app.use(apiLimiter)

app.use('/api/service', serviceRoutes)

app.use(globalErrorHandler)

io.on('connection', (socket) => {
	logger.info(`WebSocket client connected: ${socket.id}`)
	registerBrainwashHandlers(io, socket)
	registerSentientUselessBoxHandlers(io, socket)
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
	logger.info('Server closed')
}

export { server }
export default app
