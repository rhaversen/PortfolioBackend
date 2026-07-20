import { describe, it, before, after } from 'mocha'

describe('Development Setup', function () {
	before(async function () {
		this.timeout(20000)
		process.env.ANTHROPIC_API_KEY = 'DUMMY_ANTHROPIC_API_KEY'
		process.env.SESSION_SECRET = 'DUMMY_SESSION_SECRET'
		process.env.NODE_ENV = 'development'

		await import('../../development/index.js')
	})

	after(function () {
		setTimeout(() => {
			process.exit()
		}, 5000)
	})

	it('should start the development environment', function () {
		this.timeout(20000)
	})
})
