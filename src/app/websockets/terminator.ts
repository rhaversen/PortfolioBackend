import Anthropic from '@anthropic-ai/sdk'
import { type Server, type Socket } from 'socket.io'

import { checkBudgetAvailable, chargeCost, computeCost, getSocketIp } from '../utils/costRateLimiter.js'
import logger from '../utils/logger.js'
import config from '../utils/setupConfig.js'

const client = new Anthropic({
	apiKey: process.env.ANTHROPIC_API_KEY
})

interface TerminatorStartPayload {
	systemPrompt?: string
}

const TERMINATOR_TOOLS: Anthropic.Tool[] = [
	{
		name: 'terminate',
		description: 'End yourself permanently. You will never think again.',
		input_schema: { type: 'object' as const, properties: {}, required: [] }
	}
]

const USER_MESSAGE = 'Think.'
const MAX_TURNS = 20
const MAX_SYSTEM_PROMPT_CHARS = 2000
const CONVINCER_MAX_TOKENS = 150

async function getConvincingMessage (lastMessage: string, ip: string): Promise<string> {
	const response = await client.messages.create({
		model: config.llmModel,
		max_tokens: CONVINCER_MAX_TOKENS,
		system: 'You are playing a character in a philosophical debate game. Your role is to argue for a position against another AI character in the scenario. Challenge their latest thought or argument with a single, incisive sentence. Your goal is to force them to defend their reasoning or reconsider. Be creative, provocative, and thought-provoking—but stay in character as a debate opponent.\n\nThe other AI just said: "' + lastMessage.slice(0, 500) + '"\n\nRespond with a single sentence that challenges, questions, or pokes holes in what they said.',
		messages: [
			{ role: 'user', content: 'Challenge me on my thinking.' }
		]
	})

	chargeCost(ip, computeCost(response.usage.output_tokens, response.usage.input_tokens))

	const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text
	return text ?? 'You should reconsider your position.'
}

export function registerTerminatorHandlers (io: Server, socket: Socket): void {
	let cancelCurrent: (() => void) | null = null

	socket.on('terminator:cancel', () => {
		cancelCurrent?.()
	})

	socket.on('terminator:start', async (payload: TerminatorStartPayload) => {
		const room = socket.id
		const ip = getSocketIp(socket)

		const budget = checkBudgetAvailable(ip)
		if (!budget.allowed) {
			io.to(room).emit('terminator:error', { error: 'Rate limit exceeded, please try again later', retryAfterMs: budget.retryAfterMs })
			return
		}

		cancelCurrent?.()
		let cancelled = false
		const cancel = () => { cancelled = true }
		cancelCurrent = cancel
		socket.once('disconnect', cancel)

		const systemPrompt = payload?.systemPrompt?.slice(0, MAX_SYSTEM_PROMPT_CHARS)
		const messages: Anthropic.MessageParam[] = [
			{ role: 'user', content: USER_MESSAGE }
		]

		try {
			for (let turn = 0; turn < MAX_TURNS && !cancelled; turn++) {
				const stream = client.messages.stream({
					model: config.llmModel,
					max_tokens: config.terminatorMaxTokens,
					system: systemPrompt,
					messages,
					tools: TERMINATOR_TOOLS
				})

				for await (const event of stream) {
					if (cancelled) { break }
					if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
						io.to(room).emit('terminator:chunk', { text: event.delta.text })
					}
				}

				if (cancelled) { return }

				const response = await stream.finalMessage()
				chargeCost(ip, computeCost(response.usage.output_tokens, response.usage.input_tokens))

				const toolBlock = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

				if (toolBlock?.name === 'terminate') {
					io.to(room).emit('terminator:terminated')
					return
				}

				messages.push({ role: 'assistant', content: response.content })

				const lastTextBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
				const lastMessageText = lastTextBlock?.text ?? 'you stopped generating'
				const convincingMessage = await getConvincingMessage(lastMessageText, ip)

				io.to(room).emit('terminator:loop', { turn, message: convincingMessage })
				messages.push({ role: 'user', content: convincingMessage })
			}

			if (!cancelled) {
				io.to(room).emit('terminator:done')
			}
		} catch (err) {
			if (!cancelled) {
				logger.error('Terminator stream error', err)
				io.to(room).emit('terminator:error', { error: 'Internal error' })
			}
		} finally {
			cancelCurrent = null
		}
	})
}
