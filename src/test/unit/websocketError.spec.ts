/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai'
import { describe, it } from 'mocha'

import { getWebSocketErrorDetails, handleWebSocketError } from '../../app/utils/websocketError.js'

describe('WebSocket error helper', function () {
	it('extracts standard error details', function () {
		const err = new Error('boom')
		const details = getWebSocketErrorDetails(err)

		expect(details.message).to.equal('boom')
		expect(details.status).to.be.undefined
		expect(details.errorBody).to.be.undefined
		expect(details.stack).to.be.a('string')
	})

	it('stringifies non-error values', function () {
		const details = getWebSocketErrorDetails('boom')

		expect(details.message).to.equal('boom')
		expect(details.status).to.be.undefined
		expect(details.errorBody).to.be.undefined
		expect(details.stack).to.be.undefined
	})

	it('logs and emits through the shared handler', function () {
		const emitted: Array<{ room: string; event: string; payload: Record<string, unknown> }> = []
		const logged: Array<{ message: string; details: unknown }> = []
		const io = {
			to (room: string) {
				return {
					emit (event: string, payload: Record<string, unknown>) {
						emitted.push({ room, event, payload })
					}
				}
			}
		} as never

		handleWebSocketError(
			io,
			'room-1',
			new Error('boom'),
			{
				logMessage: 'Test websocket error',
				clientEvent: 'test:error',
				clientPayload: { error: 'LLM request failed' }
			},
			{
				error (message: string, details: unknown) {
					logged.push({ message, details })
				}
			}
		)

		expect(logged).to.have.length(1)
		expect(logged[0].message).to.equal('Test websocket error')
		expect(emitted).to.deep.equal([
			{
				room: 'room-1',
				event: 'test:error',
				payload: { error: 'LLM request failed' }
			}
		])
	})
})