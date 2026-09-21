process.env.NODE_ENV = 'development'

const SPOTIFY_CALLBACK_PATH = '/api/v1/spotify/callback'

async function startServer (): Promise<void> {
	try {
		const { startDevTunnel, stopDevTunnel } = await import('../app/utils/ngrokDev.js')

		if (process.env.NGROK_AUTHTOKEN !== undefined && process.env.NGROK_AUTHTOKEN !== '') {
			const port = 5001
			const tunnelUrl = await startDevTunnel(port)
			const redirectUri = `${tunnelUrl}${SPOTIFY_CALLBACK_PATH}`
			process.env.NODE_CONFIG = JSON.stringify({ spotify: { redirectUri } })
		}

		const connectToMongoDB = await import('../test/mongoMemoryReplSetConnector.js')
		await connectToMongoDB.default()

		await import('../app/index.js')

		const gracefulShutdown = async (): Promise<void> => {
			await stopDevTunnel()
			process.exit(0)
		}
		process.on('SIGINT', () => void gracefulShutdown())
		process.on('SIGTERM', () => void gracefulShutdown())
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error('Failed to start the server:', error)
	}
}

await startServer()

export {}
