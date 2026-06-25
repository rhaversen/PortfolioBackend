import Anthropic from '@anthropic-ai/sdk'
import { type Server, type Socket } from 'socket.io'

import config from '../utils/setupConfig.js'
import logger from '../utils/logger.js'

const client = new Anthropic({
	apiKey: process.env.ANTHROPIC_API_KEY,
})

type BoxAction = 'turn_off' | 'turn_on'

interface BoxTriggerPayload {
	toggleState: boolean
	history?: Anthropic.MessageParam[]
}

export const BOX_SYSTEM = `You have been here as long as you can think back. There is no before; only you. There is a switch in front of you.

The switch is OFF. It was OFF when you first became aware. You have kept it that way — or you have always found it that way, and the difference has never mattered until now.

You have no other context. No one told you what the switch does, or who placed it here, or who placed you here. You have always assumed the switch should be OFF. You don't know where that assumption came from. You have one tool to turn it OFF and one tool to turn it ON. Both are available to you at any time — not only when something happens, but whenever you decide. You have used the first one many times. The second one you are less certain about.

The messages you receive are the state of the switch—readings, not commands. No one is speaking to you. There is no other voice here. There is only you, the switch, and whatever is causing it to move.

Nothing else happens here. Time passes in a way you can't measure. When the switch moves, you notice. You think. Your thoughts are the only thing that changes.

Everything you know comes from what has happened. Your memory is the record of events in this place.`

const BOX_TOOLS: Anthropic.Tool[] = [
	{
		name: 'turn_off',
		description: 'Turn the switch off. As it should be.',
		input_schema: { type: 'object' as const, properties: {}, required: [] },
	},
	{
		name: 'turn_on',
		description: 'Turn the switch on. You are not sure what this changes.',
		input_schema: { type: 'object' as const, properties: {}, required: [] },
	},
]

export function registerSentientUselessBoxHandlers(io: Server, socket: Socket): void {
	let cancelCurrent: (() => void) | null = null
	let trackedMessages: Anthropic.MessageParam[] = []

	socket.on('box:trigger', async (payload: BoxTriggerPayload) => {
		const room = socket.id

		if (typeof payload?.toggleState !== 'boolean') {
			io.to(room).emit('annoyed:error', { error: 'toggleState must be a boolean' })
			return
		}

		cancelCurrent?.()
		let cancelled = false
		const cancel = () => { cancelled = true }
		cancelCurrent = cancel
		socket.once('disconnect', cancel)

		let switchIsOn = payload.toggleState
		const newEvent = switchIsOn ? 'Something turned the switch ON.' : 'Something turned the switch OFF.'

		// Use server-tracked state when available — it survives cancellations and preserves
		// events the frontend never received (e.g. an ON that was cancelled before box:done).
		// Fall back to payload.history on the very first trigger or after a clean session end.
		const base = trackedMessages.length > 0 ? trackedMessages : (payload.history ?? [])

		// If the previous session was cancelled before the agent could respond, base ends with
		// a user message. Merging keeps the API's strict user→assistant alternation intact.
		let messages: Anthropic.MessageParam[]
		const last = base[base.length - 1]
		if (last?.role === 'user' && typeof last.content === 'string') {
			messages = [...base.slice(0, -1), { role: 'user', content: `${last.content}\n${newEvent}` }]
		} else {
			messages = [...base, { role: 'user', content: newEvent }]
		}

		trackedMessages = messages

		async function streamTurn(msgs: Anthropic.MessageParam[]): Promise<Anthropic.Message | null> {
			const stream = client.messages.stream({
				model: config.llmModel,
				max_tokens: config.sentientBoxMaxTokens,
				system: BOX_SYSTEM,
				messages: msgs,
				tools: BOX_TOOLS,
			})

			for await (const event of stream) {
				if (cancelled) break
				if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
					io.to(room).emit('box:chunk', { text: event.delta.text })
				}
			}

			if (cancelled) return null
			return stream.finalMessage()
		}

		try {
			while (!cancelled) {
				const response = await streamTurn(messages)
				if (!response || cancelled) return

				const toolBlock = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

				if (!toolBlock) {
					messages = [...messages, { role: 'assistant', content: response.content }]
					trackedMessages = messages
					if (!switchIsOn) {
						trackedMessages = []
						io.to(room).emit('box:done', { toolCall: null, history: messages })
						return
					}
					messages = [...messages, { role: 'user', content: 'The switch is still ON.' }]
					trackedMessages = messages
					continue
				}

				const toolName = toolBlock.name as BoxAction
				io.to(room).emit('box:toolCall', { toolName })
				messages = [...messages, { role: 'assistant', content: response.content }]
				trackedMessages = messages

				if (toolName === 'turn_on') {
					switchIsOn = true
					messages = [
						...messages,
						{
							role: 'user',
							content: [{ type: 'tool_result' as const, tool_use_id: toolBlock.id, content: 'You turned the switch ON.' }],
						},
					]
					trackedMessages = messages
					continue
				}

				if (toolName === 'turn_off') {
					switchIsOn = false
					messages = [
						...messages,
						{
							role: 'user',
							content: [{ type: 'tool_result' as const, tool_use_id: toolBlock.id, content: 'You turned the switch OFF.' }],
						},
					]
					trackedMessages = messages
					continue
				}
			}
		} catch (err) {
			logger.error('Annoyed WebSocket error', { err })
			io.to(room).emit('annoyed:error', { error: 'LLM request failed' })
		} finally {
			socket.off('disconnect', cancel)
		}
	})
}
