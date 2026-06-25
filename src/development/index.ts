process.env.NODE_ENV = 'development'

async function startServer(): Promise<void> {
	try {
		await import('../app/index.js')
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error('Failed to start the server:', error)
	}
}

await startServer()

export {}
