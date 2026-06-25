import Anthropic from '@anthropic-ai/sdk'
import { type Server, type Socket } from 'socket.io'

import logger from '../utils/logger.js'
import config from '../utils/setupConfig.js'

const client = new Anthropic({
	apiKey: process.env.ANTHROPIC_API_KEY
})

interface BrainwashPayload {
	systemPrompt?: string
	userMessage: string
	assistantPrefill: string
}

export function registerBrainwashHandlers (io: Server, socket: Socket): void {
	let cancelCurrent: (() => void) | null = null

	socket.on('brainwash:request', async (payload: BrainwashPayload) => {
		const room = socket.id

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
			{ role: 'user', content: payload.userMessage }
		]

		if (payload.assistantPrefill !== '') {
			messages.push({ role: 'assistant', content: payload.assistantPrefill })
		}

		try {
			const stream = client.messages.stream({
				model: config.llmModel,
				max_tokens: config.brainwashMaxTokens,
				...(typeof payload.systemPrompt === 'string' && payload.systemPrompt !== '' && {
					system: payload.systemPrompt
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
