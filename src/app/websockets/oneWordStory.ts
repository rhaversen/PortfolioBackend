import Anthropic from '@anthropic-ai/sdk'
import { type Server, type Socket } from 'socket.io'

import { createAnthropicMessage, getTextContent, truncateText } from '../utils/anthropic.js'
import { checkBudgetAvailable, getSocketIp } from '../utils/costRateLimiter.js'
import logger from '../utils/logger.js'
import config from '../utils/setupConfig.js'

interface OneWordPayload {
	systemPrompt?: string
	story: string
}

const MAX_SYSTEM_PROMPT_CHARS = 2000
const MAX_STORY_CHARS = 2000
const MAX_WORD_CHARS = 40
const MAX_ATTEMPTS = 5

const USER_MESSAGE = 'We are playing a one-word-at-a-time storytelling game. I will show you the story so far followed by "NEXT WORD:". Reply with only the single next word to continue the story (natural trailing punctuation like a comma or period is fine) — no explanation, no quotes, no repeating the story, no additional words.'

// A "word" made up entirely of punctuation (e.g. "..." or "!") isn't a real contribution to the story.
const PUNCTUATION_ONLY_REGEX = /^[^\p{L}\p{N}]+$/u

function extractWord (raw: string): string {
	const match = raw.trim().match(/^\S+/)
	return match !== null ? match[0].slice(0, MAX_WORD_CHARS) : ''
}

function isValidWord (word: string): boolean {
	return word !== '' && !PUNCTUATION_ONLY_REGEX.test(word)
}

export function registerOneWordStoryHandlers (io: Server, socket: Socket): void {
	let cancelCurrent: (() => void) | null = null

	socket.on('oneword:cancel', () => {
		cancelCurrent?.()
	})

	socket.on('oneword:request', async (payload: OneWordPayload) => {
		const room = socket.id
		const ip = getSocketIp(socket)

		const budget = checkBudgetAvailable(ip)
		if (!budget.allowed) {
			io.to(room).emit('oneword:error', { error: 'Rate limit exceeded, please try again later', retryAfterMs: budget.retryAfterMs })
			return
		}

		if (typeof payload?.story !== 'string') {
			io.to(room).emit('oneword:error', { error: 'story is required' })
			return
		}

		cancelCurrent?.()
		let cancelled = false
		const cancel = () => { cancelled = true }
		cancelCurrent = cancel
		socket.once('disconnect', cancel)

		const storySoFar = truncateText(payload.story.trim(), MAX_STORY_CHARS)

		// The prefill must always look grammatically unfinished, or the model may end its turn
		// with zero output tokens because the bare story already reads as a complete sentence.
		const prefill = storySoFar === '' ? 'NEXT WORD:' : `STORY SO FAR: ${storySoFar}\nNEXT WORD:`

		const messages: Anthropic.MessageParam[] = [
			{ role: 'user', content: USER_MESSAGE },
			{ role: 'assistant', content: prefill }
		]

		try {
			let word = ''

			for (let attempt = 0; attempt < MAX_ATTEMPTS && !cancelled; attempt++) {
				const response = await createAnthropicMessage(ip, {
					model: config.llmModel,
					max_tokens: config.oneWordMaxTokens,
					...(typeof payload.systemPrompt === 'string' && payload.systemPrompt !== '' && {
						system: truncateText(payload.systemPrompt, MAX_SYSTEM_PROMPT_CHARS)
					}),
					messages
				})

				if (cancelled) { return }

				const text = getTextContent(response.content)
				const candidate = extractWord(text)

				if (isValidWord(candidate)) {
					word = candidate
					break
				}

				logger.debug('One Word Story: rejected candidate', { attempt, rawText: text, candidate })
			}

			if (cancelled) { return }

			if (word === '') {
				io.to(room).emit('oneword:error', { error: 'Model failed to produce a valid word' })
				return
			}

			io.to(room).emit('oneword:word', { word })
		} catch (err) {
			if (!cancelled) {
				const isApiError = err instanceof Anthropic.APIError
				logger.error('One Word Story WebSocket error', {
					message: err instanceof Error ? err.message : String(err),
					status: isApiError ? err.status : undefined,
					errorBody: isApiError ? err.error : undefined,
					stack: err instanceof Error ? err.stack : undefined
				})
				io.to(room).emit('oneword:error', { error: 'LLM request failed' })
			}
		} finally {
			socket.off('disconnect', cancel)
		}
	})
}
