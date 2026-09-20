import Anthropic from '@anthropic-ai/sdk'
import { type Server, type Socket } from 'socket.io'

import { createAnthropicMessage, getTextContent, truncateText } from '../utils/anthropic.js'
import { checkBudgetAvailable, getSocketIp } from '../utils/costRateLimiter.js'
import config from '../utils/setupConfig.js'
import { handleWebSocketError } from '../utils/websocketError.js'

interface SelfConversationPayload {
	systemPrompt?: string
	messages: string[]
}

const MAX_SYSTEM_PROMPT_CHARS = 2000
const MAX_MESSAGE_CHARS = 2000
const MAX_MESSAGES = 100
const MAX_REPLY_CHARS = 800

const USER_MESSAGE = 'We are playing a "talking with yourself" game. I will show you the conversation so far, followed by "NEXT:". Reply with only the single next conversation message — no explanation, no quotes, no stage directions, no extra formatting.'

function extractReply (raw: string): string {
	return raw.trim().replace(/^["']|["']$/g, '').slice(0, MAX_REPLY_CHARS).trim()
}

export function registerSelfConversationHandlers (io: Server, socket: Socket): void {
	let cancelCurrent: (() => void) | null = null

	socket.on('selfconvo:cancel', () => {
		cancelCurrent?.()
	})

	socket.on('selfconvo:request', async (payload: SelfConversationPayload) => {
		const room = socket.id
		const ip = getSocketIp(socket)

		const budget = checkBudgetAvailable(ip)
		if (!budget.allowed) {
			io.to(room).emit('selfconvo:error', { error: 'Rate limit exceeded, please try again later', retryAfterMs: budget.retryAfterMs })
			return
		}

		if (!Array.isArray(payload?.messages) || payload.messages.length === 0 || payload.messages.some(m => typeof m !== 'string')) {
			io.to(room).emit('selfconvo:error', { error: 'messages must be a non-empty array of strings' })
			return
		}

		cancelCurrent?.()
		let cancelled = false
		const cancel = () => { cancelled = true }
		cancelCurrent = cancel
		socket.once('disconnect', cancel)

		const history = payload.messages.slice(-MAX_MESSAGES).map(m => truncateText(m, MAX_MESSAGE_CHARS))
		const prefill = `CONVERSATION SO FAR:\n${history.map((m, i) => `${i + 1}. ${m}`).join('\n')}\nNEXT:`

		const messages: Anthropic.MessageParam[] = [
			{ role: 'user', content: USER_MESSAGE },
			{ role: 'assistant', content: prefill }
		]

		try {
			const response = await createAnthropicMessage(ip, {
				model: config.llmModel,
				max_tokens: config.selfConvoMaxTokens,
				...(typeof payload.systemPrompt === 'string' && payload.systemPrompt !== '' && {
					system: truncateText(payload.systemPrompt, MAX_SYSTEM_PROMPT_CHARS)
				}),
				messages
			})

			if (cancelled) { return }

			const reply = extractReply(getTextContent(response.content))

			if (reply === '') {
				io.to(room).emit('selfconvo:error', { error: 'Model failed to produce a valid message' })
				return
			}

			io.to(room).emit('selfconvo:reply', { reply })
		} catch (err) {
			if (!cancelled) {
				handleWebSocketError(io, room, err, {
					logMessage: 'Self Conversation WebSocket error',
					clientEvent: 'selfconvo:error',
					clientPayload: { error: 'LLM request failed' }
				})
			}
		} finally {
			socket.off('disconnect', cancel)
		}
	})
}
