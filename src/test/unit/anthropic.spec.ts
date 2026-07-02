/* eslint-disable @typescript-eslint/no-unused-expressions */
import Anthropic from '@anthropic-ai/sdk'
import { expect } from 'chai'
import { describe, it } from 'mocha'

import {
	buildSystemPromptOrFallback,
	buildSystemPromptWithSuffix,
	clampMaxTokens,
	createAnthropicWrappers,
	sanitizeAnthropicRequest,
	truncateTail,
	truncateText
} from '../../app/utils/anthropic.js'

describe('anthropic helpers', function () {
	it('truncates text from the front and back', function () {
		expect(truncateText('abcdef', 3)).to.equal('abc')
		expect(truncateText('abcdef', -1)).to.equal('')
		expect(truncateTail('abcdef', 3)).to.equal('def')
		expect(truncateTail('abcdef', -1)).to.equal('')
	})

	it('clamps token counts to the safe range', function () {
		expect(clampMaxTokens(0, 50)).to.equal(1)
		expect(clampMaxTokens(7.8, 50)).to.equal(7)
		expect(clampMaxTokens(999, 50)).to.equal(50)
		expect(clampMaxTokens(Number.NaN, 50, 12)).to.equal(12)
	})

	it('builds bounded system prompts with and without fallbacks', function () {
		expect(buildSystemPromptOrFallback(undefined, 'fallback', 20)).to.equal('fallback')
		expect(buildSystemPromptOrFallback('', 'fallback', 20)).to.equal('fallback')
		expect(buildSystemPromptOrFallback('abcdefghijklmnopqrstuvwxyz', 'fallback', 5)).to.equal('abcde')

		expect(buildSystemPromptWithSuffix(undefined, ' suffix', 20)).to.equal(' suffix')
		expect(buildSystemPromptWithSuffix('', ' suffix', 20)).to.equal(' suffix')
		expect(buildSystemPromptWithSuffix('abcdefghijklmnopqrstuvwxyz', ' suffix', 5)).to.equal('abcde suffix')
	})

	it('sanitizes system prompts, message text, and message count before the SDK sees them', function () {
		const request = sanitizeAnthropicRequest({
			model: 'claude-sonnet-4-5',
			max_tokens: 10,
			system: 's'.repeat(2500),
			messages: [
				...Array.from({ length: 101 }, (_, index) => ({
					role: 'user' as const,
					content: `message-${index}-${'x'.repeat(9000)}`
				})),
				{
					role: 'assistant' as const,
					content: [
						{ type: 'text', text: 'y'.repeat(9000) },
						{ type: 'tool_result', tool_use_id: 'tool-1', content: 'z'.repeat(9000) }
					]
				}
			]
		})

		expect(typeof request.system).to.equal('string')
		expect((request.system as string)).to.have.length(2000)
		expect(request.messages).to.have.length(100)
		expect(request.messages[0].content).to.equal(`message-2-${'x'.repeat(7990)}`)

		const lastMessage = request.messages[request.messages.length - 1]
		expect(Array.isArray(lastMessage.content)).to.be.true
		const [textBlock, toolResultBlock] = lastMessage.content as Array<Anthropic.TextBlockParam | Anthropic.ToolResultBlockParam>
		expect(textBlock).to.deep.equal({ type: 'text', text: 'y'.repeat(8000) })
		expect(toolResultBlock).to.deep.equal({ type: 'tool_result', tool_use_id: 'tool-1', content: 'z'.repeat(8000) })
	})

	it('charges for create and stream responses and still sanitizes the payload', async function () {
		const charges: Array<{ ip: string; usage: { input_tokens: number; output_tokens: number } }> = []
		const createCalls: Array<Anthropic.MessageCreateParamsNonStreaming> = []
		const streamCalls: Array<Anthropic.MessageStreamParams> = []
		const response = {
			content: [],
			id: 'msg-1',
			model: 'claude-sonnet-4-5',
			role: 'assistant',
			stop_reason: 'end_turn',
			stop_sequence: null,
			type: 'message',
			usage: { input_tokens: 11, output_tokens: 7 }
		} as unknown as Anthropic.Message
		const stream = {
			async finalMessage (): Promise<Anthropic.Message> {
				return response
			},
			async *[Symbol.asyncIterator] (): AsyncGenerator<unknown> {
				yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'chunk' } }
			}
		}
		const wrappers = createAnthropicWrappers(
			{
				messages: {
					async create (params: Anthropic.MessageCreateParamsNonStreaming) {
						createCalls.push(params)
						return response
					},
					stream (params: Anthropic.MessageStreamParams) {
						streamCalls.push(params)
						return stream
					}
				}
			} as never,
			(ip, usage) => { charges.push({ ip, usage }) }
		)

		await wrappers.createAnthropicMessage('10.0.0.1', {
			model: 'claude-sonnet-4-5',
			max_tokens: 10,
			system: 's'.repeat(2500),
			messages: Array.from({ length: 101 }, (_, index) => ({
				role: 'user' as const,
				content: `message-${index}-${'x'.repeat(9000)}`
			}))
		})

		const wrappedStream = wrappers.streamAnthropicMessage('10.0.0.2', {
			model: 'claude-sonnet-4-5',
			max_tokens: 10,
			system: 's'.repeat(2500),
			messages: Array.from({ length: 101 }, (_, index) => ({
				role: 'user' as const,
				content: `message-${index}-${'x'.repeat(9000)}`
			}))
		})
		await wrappedStream.finalMessage()

		expect(createCalls).to.have.length(1)
		expect(streamCalls).to.have.length(1)
		expect((createCalls[0].system as string)).to.have.length(2000)
		expect(createCalls[0].messages).to.have.length(100)
		expect((createCalls[0].messages[0].content as string)).to.equal(`message-1-${'x'.repeat(7990)}`)
		expect((streamCalls[0].system as string)).to.have.length(2000)
		expect(streamCalls[0].messages).to.have.length(100)
		expect(charges).to.deep.equal([
			{ ip: '10.0.0.1', usage: { input_tokens: 11, output_tokens: 7 } },
			{ ip: '10.0.0.2', usage: { input_tokens: 11, output_tokens: 7 } }
		])
	})
})