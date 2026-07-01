import { type Server, type Socket } from 'socket.io'

import { clampMaxTokens, streamAnthropicMessage, truncateTail } from '../utils/anthropic.js'
import { checkBudgetAvailable, getSocketIp } from '../utils/costRateLimiter.js'
import config from '../utils/setupConfig.js'
import { handleWebSocketError } from '../utils/websocketError.js'

interface PredictPayload {
	text: string
	requestId: string
	maxTokens?: number
}

const MAX_COMPLETION_TEXT_CHARS = 3000

export function registerGhostWriterHandlers (io: Server, socket: Socket): void {
	const active = new Map<string, () => void>() // requestId → cancel

	socket.on('predict:cancel', ({ requestId }: { requestId: string }) => {
		active.get(requestId)?.()
		active.delete(requestId)
	})

	socket.on('predict:request', async (payload: PredictPayload) => {
		const room = socket.id

		if (typeof payload?.requestId !== 'string') { return }

		const { requestId } = payload
		const ip = getSocketIp(socket)

		const budget = checkBudgetAvailable(ip)
		if (!budget.allowed) {
			io.to(room).emit('predict:error', { requestId, error: 'Rate limit exceeded, please try again later', retryAfterMs: budget.retryAfterMs })
			return
		}

		if (typeof payload?.text !== 'string' || payload.text.trim() === '') {
			io.to(room).emit('predict:error', { requestId, error: 'text is required' })
			return
		}

		let cancelled = false
		const cancel = () => { cancelled = true }
		active.set(requestId, cancel)
		socket.once('disconnect', cancel)

		const requestedTokens = typeof payload.maxTokens === 'number' ? payload.maxTokens : 24
		const maxTokens = clampMaxTokens(requestedTokens, config.ghostWriterMaxTokens, 24)

		const trimmed = truncateTail(payload.text.trimEnd(), MAX_COMPLETION_TEXT_CHARS)

		try {
			const stream = streamAnthropicMessage(ip, {
				model: config.llmModel,
				max_tokens: maxTokens,
				stop_sequences: ['.', '!', '?'],
				system: 'Continue the text. Output only the continuation.',
				messages: [
					{ role: 'user', content: trimmed },
					{ role: 'assistant', content: trimmed }
				]
			})

			for await (const event of stream) {
				if (cancelled) { break }
				if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
					io.to(room).emit('predict:chunk', { requestId, text: event.delta.text })
				}
			}

			if (!cancelled) {
				await stream.finalMessage()
				io.to(room).emit('predict:done', { requestId })
			}
		} catch (err) {
			if (!cancelled) {
				handleWebSocketError(io, room, err, {
					logMessage: 'Ghost writer WebSocket error',
					clientEvent: 'predict:error',
					clientPayload: { requestId, error: 'LLM request failed' }
				})
			}
		} finally {
			socket.off('disconnect', cancel)
			active.delete(requestId)
		}
	})
}
