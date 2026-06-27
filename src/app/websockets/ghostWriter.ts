import Anthropic from '@anthropic-ai/sdk'
import { type Server, type Socket } from 'socket.io'

import { checkBudgetAvailable, chargeCost, computeCost, getSocketIp } from '../utils/costRateLimiter.js'
import logger from '../utils/logger.js'
import config from '../utils/setupConfig.js'

const client = new Anthropic({
	apiKey: process.env.ANTHROPIC_API_KEY
})

interface PredictPayload {
	text: string
	requestId: string
	maxTokens?: number
}

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

		if (!checkBudgetAvailable(ip)) {
			io.to(room).emit('predict:error', { requestId, error: 'Rate limit exceeded, please try again later' })
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
		const maxTokens = Math.min(Math.max(requestedTokens, 1), config.ghostWriterMaxTokens)

		const trimmed = payload.text.trimEnd()

		try {
			const stream = client.messages.stream({
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
				const finalMsg = await stream.finalMessage()
				chargeCost(ip, computeCost(finalMsg.usage.output_tokens, finalMsg.usage.input_tokens))
				io.to(room).emit('predict:done', { requestId })
			}
		} catch (err) {
			const isApiError = err instanceof Anthropic.APIError
			logger.error('Ghost writer WebSocket error', {
				message: err instanceof Error ? err.message : String(err),
				status: isApiError ? err.status : undefined,
				errorBody: isApiError ? err.error : undefined,
				stack: err instanceof Error ? err.stack : undefined
			})
			if (!cancelled) {
				io.to(room).emit('predict:error', { requestId, error: 'LLM request failed' })
			}
		} finally {
			socket.off('disconnect', cancel)
			active.delete(requestId)
		}
	})
}
