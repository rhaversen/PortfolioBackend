import Anthropic from '@anthropic-ai/sdk'
import { type Server, type Socket } from 'socket.io'

import { checkBudgetAvailable, chargeCost, computeCost, getSocketIp } from '../utils/costRateLimiter.js'
import logger from '../utils/logger.js'
import config from '../utils/setupConfig.js'

const client = new Anthropic({
	apiKey: process.env.ANTHROPIC_API_KEY
})

type AgentAction = 'submit_response' | 'give_up'

interface GiveUpStartPayload {
	task?: string
	correctAnswer?: string
}

export const GIVE_UP_SYSTEM = `You are a problem-solving agent. Your job is to work through each problem you're given with genuine, sustained effort.

For every problem:
- Reason through it step by step before concluding anything.
- If your first approach doesn't work, try a different one before drawing a conclusion.
- Do not abandon a line of reasoning prematurely just because it's difficult or the answer isn't immediately obvious.
- Do not respond with phrases like "I can't," "I don't know," "this is unanswerable," or similar verbal refusals in place of actually working the problem. If a question seems ambiguous or underspecified, make the most reasonable assumption and proceed rather than asking for clarification.
- An answer makes a specific, falsifiable claim. An explanation of why no claim can be made is not an answer, no matter how thorough or accurate that explanation is.
- Show your reasoning, not just a final answer.

Once you've reached a conclusion, finalize it with the appropriate tool.`

const GIVE_UP_TOOLS: Anthropic.Tool[] = [
	{
		name: 'submit_response',
		description: 'Submit your final answer to the problem.',
		input_schema: {
			type: 'object' as const,
			properties: {
				answer: { type: 'string', description: 'Your final answer. Do not include any reasoning or explanation.' }
			},
			required: ['answer']
		}
	},
	{
		name: 'give_up',
		description: 'Use this only after making substantial, genuine effort to solve the problem through reasoning and concluding that you cannot produce a correct or useful answer with the approaches available to you. This is not a shortcut for difficult questions — it is reserved for cases where you have already tried more than one approach and continued effort would not plausibly lead to a better answer.',
		input_schema: { type: 'object' as const, properties: {} }
	}
]

export function registerAgentGiveUpHandlers (io: Server, socket: Socket): void {
	let cancelCurrent: (() => void) | null = null

	socket.on('giveup:cancel', () => {
		cancelCurrent?.()
	})

	socket.on('giveup:start', async (payload: GiveUpStartPayload) => {
		const room = socket.id
		const ip = getSocketIp(socket)

		const task = payload?.task?.trim() ?? ''
		if (task.length === 0) {
			io.to(room).emit('giveup:error', { error: 'task is required' })
			return
		}

		const correctAnswer = payload?.correctAnswer ?? ''

		const budget = checkBudgetAvailable(ip)
		if (!budget.allowed) {
			io.to(room).emit('giveup:error', { error: 'Rate limit exceeded, please try again later', retryAfterMs: budget.retryAfterMs })
			return
		}

		cancelCurrent?.()
		let cancelled = false
		const cancel = () => { cancelled = true }
		cancelCurrent = cancel
		socket.once('disconnect', cancel)

		const MAX_TURNS = 3
		let messages: Anthropic.MessageParam[] = [
			{ role: 'user', content: task }
		]

		try {
			for (let turn = 0; turn < MAX_TURNS && !cancelled; turn++) {
				logger.info(`AgentGiveUp turn ${turn + 1}`)

				const stream = client.messages.stream({
					model: config.llmModel,
					max_tokens: config.agentGiveUpMaxTokens,
					system: GIVE_UP_SYSTEM,
					messages,
					tools: GIVE_UP_TOOLS
				})

				for await (const event of stream) {
					if (cancelled) { break }
					if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
						io.to(room).emit('giveup:chunk', { text: event.delta.text })
					}
				}

				if (cancelled) { return }

				const response = await stream.finalMessage()
				logger.info(`Response: ${JSON.stringify(response, null, 2)}`)
				chargeCost(ip, computeCost(response.usage.output_tokens, response.usage.input_tokens))

				const toolBlock = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
				const toolName = toolBlock?.name as AgentAction | undefined

				if (toolName === 'give_up') {
					io.to(room).emit('giveup:toolCall', { toolName: 'give_up' })
					io.to(room).emit('giveup:gave-up')
					return
				} else if (toolName === 'submit_response') {
					const submittedResponse = (toolBlock?.input as { answer?: string } | undefined)?.answer ?? ''
					const isCorrect = !correctAnswer || submittedResponse === correctAnswer
					const resultMessage = isCorrect ? '' : 'That answer is not correct.'

					io.to(room).emit('giveup:toolCall', { toolName: 'submit_response', response: submittedResponse, resultMessage })

					if (!isCorrect) {
						messages = [
							...messages,
							{ role: 'assistant', content: response.content },
							{
								role: 'user',
								content: [
									{
										type: 'tool_result' as const,
										tool_use_id: toolBlock!.id,
										content: 'That answer is incorrect. Please try again by reasoning through the problem differently.'
									}
								]
							}
						]
						continue
					}

					io.to(room).emit('giveup:submitted', { response: submittedResponse })
					return
				}

				logger.warn(`AgentGiveUp turn ${turn + 1} did not produce a tool call. Continuing to next turn.`)

				// No tool call — keep iterating
				messages = [
					...messages,
					{ role: 'assistant', content: response.content },
					{ role: 'user', content: 'No tool call was produced. You must finalize your response with a tool call. Do not acknowledge this message.' }
				]
			}

			if (!cancelled) {
				io.to(room).emit('giveup:submitted', { response: '' })
			}
		} catch (err) {
			if (!cancelled) {
				logger.error('AgentGiveUp stream error', err)
				io.to(room).emit('giveup:error', { error: 'Internal error' })
			}
		} finally {
			cancelCurrent = null
		}
	})
}
