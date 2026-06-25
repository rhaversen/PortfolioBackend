import { expect } from 'chai'
import { describe, it } from 'mocha'

describe('Development Setup', function () {
	before(function () {
		process.env.ANTHROPIC_API_KEY = 'DUMMY_ANTHROPIC_API_KEY'
	})

	after(function () {
		setTimeout(() => {
			// eslint-disable-next-line n/no-process-exit
			process.exit()
		}, 5000)
	})

	it('should start the development environment', async function () {
		this.timeout(20000)
		let errorOccurred = false
		try {
			await import('../../development/index.js')
			const app = await import('../../app/index.js')
			await app.shutDown()
		} catch {
			errorOccurred = true
		}
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		expect(errorOccurred).to.be.false
	})
})
