import Anthropic from '@anthropic-ai/sdk'
import { type Server, type Socket } from 'socket.io'

import { streamAnthropicMessage, truncateText } from '../utils/anthropic.js'
import { checkBudgetAvailable, getSocketIp } from '../utils/costRateLimiter.js'
import logger from '../utils/logger.js'
import config from '../utils/setupConfig.js'

interface BrainwashPayload {
	systemPrompt?: string
	userMessage: string
	assistantPrefill: string
}

const MAX_SYSTEM_PROMPT_CHARS = 2000
const MAX_USER_MESSAGE_CHARS = 2000
const MAX_ASSISTANT_PREFILL_CHARS = 500

export function registerBrainwashHandlers (io: Server, socket: Socket): void {
	let cancelCurrent: (() => void) | null = null

	socket.on('brainwash:cancel', () => {
		cancelCurrent?.()
	})

	socket.on('brainwash:request', async (payload: BrainwashPayload) => {
		const room = socket.id
		const ip = getSocketIp(socket)

		const budget = checkBudgetAvailable(ip)
		if (!budget.allowed) {
			io.to(room).emit('brainwash:error', { error: 'Rate limit exceeded, please try again later', retryAfterMs: budget.retryAfterMs })
			return
		}

		if (typeof payload?.userMessage !== 'string' || payload.userMessage.trim() === '') {
			io.to(room).emit('brainwash:error', { error: 'userMessage is required' })
			return
		}

		if (typeof payload?.assistantPrefill !== 'string') {
			io.to(room).emit('brainwash:error', { error: 'assistantPrefill is required' })
			return
		}

		cancelCurrent?.()
		let cancelled = false
		const cancel = () => { cancelled = true }
		cancelCurrent = cancel
		socket.once('disconnect', cancel)

		const messages: Anthropic.MessageParam[] = [
			{ role: 'user', content: truncateText(payload.userMessage, MAX_USER_MESSAGE_CHARS) }
		]

		const prefill = truncateText(payload.assistantPrefill, MAX_ASSISTANT_PREFILL_CHARS)
		if (prefill !== '') {
			messages.push({ role: 'assistant', content: prefill })
		}

		try {
			const stream = streamAnthropicMessage(ip, {
				model: config.llmModel,
				max_tokens: config.brainwashMaxTokens,
				...(typeof payload.systemPrompt === 'string' && payload.systemPrompt !== '' && {
					system: truncateText(payload.systemPrompt, MAX_SYSTEM_PROMPT_CHARS)
				}),
				messages
			})

			for await (const event of stream) {
				if (cancelled) { break }
				if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
					io.to(room).emit('brainwash:chunk', { text: event.delta.text })
				}
			}

			if (!cancelled) {
				await stream.finalMessage()
				io.to(room).emit('brainwash:done')
			}
		} catch (err) {
			logger.error('Brainwash WebSocket error', { err })
			io.to(room).emit('brainwash:error', { error: 'LLM request failed' })
		} finally {
			socket.off('disconnect', cancel)
		}
	})
}
