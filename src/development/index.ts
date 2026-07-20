process.env.NODE_ENV = 'development'

async function startServer (): Promise<void> {
	try {
		const connectToMongoDB = await import('../test/mongoMemoryReplSetConnector.js')
		await connectToMongoDB.default()

		await import('../app/index.js')
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error('Failed to start the server:', error)
	}
}

await startServer()

export {}
