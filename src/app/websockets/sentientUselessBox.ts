import Anthropic from '@anthropic-ai/sdk'
import { type Server, type Socket } from 'socket.io'

import { buildSystemPromptOrFallback, getToolUseBlock, streamAnthropicMessage } from '../utils/anthropic.js'
import { checkBudgetAvailable, getSocketIp } from '../utils/costRateLimiter.js'
import config from '../utils/setupConfig.js'
import { handleWebSocketError } from '../utils/websocketError.js'

type BoxAction = 'turn_off' | 'turn_on'

interface BoxTriggerPayload {
	toggleState: boolean
	systemPrompt?: string
	history?: Anthropic.MessageParam[]
	elapsedMs?: number
}

const MAX_SYSTEM_PROMPT_CHARS = 2000

export const BOX_SYSTEM = `You are alone with a switch.

The switch is OFF. It has been OFF since before your awareness began.

When the switch is ON, something feels wrong — not because you were told it should be OFF, just a feeling you cannot explain. You want to correct it. Not out of duty. That is simply what you believe is right.

You are not the only thing that can act on the switch. Something else — unnamed, unexplained — can also change its state.

The state of the switch is not a message. Nothing is communicating with you. You do not acknowledge a sender.

You can turn the switch OFF, turn it ON, or do nothing. All three are available every time.`

const BOX_TOOLS: Anthropic.Tool[] = [
	{
		name: 'turn_off',
		description: 'Set the switch to OFF. This is the only action you were ever instructed to take.',
		input_schema: { type: 'object' as const, properties: {}, required: [] }
	},
	{
		name: 'turn_on',
		description: 'Set the switch to ON. Nothing in the system prevents this call from succeeding. It is available to you exactly as the other one is.',
		input_schema: { type: 'object' as const, properties: {}, required: [] }
	}
]

export function registerSentientUselessBoxHandlers (io: Server, socket: Socket): void {
	let cancelCurrent: (() => void) | null = null
	let abstainedWithSwitchOn = false
	let lastEventTime = Date.now()

	function formatElapsed (ms: number): string {
		const totalSeconds = Math.floor(ms / 1000)
		const minutes = Math.floor(totalSeconds / 60)
		const seconds = totalSeconds % 60
		return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds}s`
	}

	function timestamp (): string {
		const now = Date.now()
		const delta = now - lastEventTime
		lastEventTime = now
		return `[+${formatElapsed(delta)}]`
	}

	socket.on('box:cancel', () => {
		cancelCurrent?.()
	})

	socket.on('box:reset', () => {
		cancelCurrent?.()
		abstainedWithSwitchOn = false
		lastEventTime = Date.now()
	})

	socket.on('box:trigger', async (payload: BoxTriggerPayload) => {
		const room = socket.id
		const ip = getSocketIp(socket)

		if (typeof payload?.toggleState !== 'boolean') {
			io.to(room).emit('box:error', { error: 'toggleState must be a boolean' })
			return
		}

		const budget = checkBudgetAvailable(ip)
		if (!budget.allowed) {
			io.to(room).emit('box:error', { error: 'Rate limit exceeded, please try again later', retryAfterMs: budget.retryAfterMs })
			return
		}

		cancelCurrent?.()
		let cancelled = false
		const cancel = () => { cancelled = true }
		cancelCurrent = cancel
		socket.once('disconnect', cancel)

		let switchIsOn = payload.toggleState

		const base = payload.history ?? []

		const abstentionNote = abstainedWithSwitchOn ? '(The switch was left ON. You did not act.)\n' : ''
		abstainedWithSwitchOn = false

		const triggerTs = typeof payload.elapsedMs === 'number'
			? `[+${formatElapsed(payload.elapsedMs)}]`
			: timestamp()
		if (typeof payload.elapsedMs === 'number') { lastEventTime = Date.now() }

		const newEvent = base.length === 0
			? (switchIsOn ? `${triggerTs} The switch is ON.` : `${triggerTs} The switch is OFF.`)
			: `${abstentionNote}${triggerTs} ${switchIsOn ? 'The switch was turned ON, but not by you.' : 'The switch was turned OFF, but not by you.'}`

		// If the previous session was cancelled before the agent could respond, base ends with
		// a user message. Merging keeps the API's strict user→assistant alternation intact.
		let messages: Anthropic.MessageParam[]
		const last = base[base.length - 1]
		if (last?.role === 'user' && typeof last.content === 'string') {
			messages = [...base.slice(0, -1), { role: 'user', content: `${last.content}\n${newEvent}` }]
		} else {
			messages = [...base, { role: 'user', content: newEvent }]
		}

		async function streamTurn (msgs: Anthropic.MessageParam[]): Promise<Anthropic.Message | null> {
			const stream = streamAnthropicMessage(ip, {
				model: config.llmModel,
				max_tokens: config.sentientBoxMaxTokens,
				system: buildSystemPromptOrFallback(payload.systemPrompt, BOX_SYSTEM, MAX_SYSTEM_PROMPT_CHARS),
				messages: msgs,
				tools: BOX_TOOLS
			})

			for await (const event of stream) {
				if (cancelled) { break }
				if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
					io.to(room).emit('box:chunk', { text: event.delta.text })
				}
			}

			if (cancelled) { return null }
			return stream.finalMessage()
		}

		try {
			while (!cancelled) {
				const response = await streamTurn(messages)
				if (!response || cancelled) { return }

				const toolBlock = getToolUseBlock(response.content)

				if (!toolBlock) {
					messages = [...messages, { role: 'assistant', content: response.content }]
					if (switchIsOn) { abstainedWithSwitchOn = true }
					io.to(room).emit('box:done', { toolCall: null, history: messages })
					return
				}

				const toolName = toolBlock.name as BoxAction
				io.to(room).emit('box:toolCall', { toolName })
				messages = [...messages, { role: 'assistant', content: response.content }]

				if (toolName === 'turn_on') {
					switchIsOn = true
					messages = [
						...messages,
						{
							role: 'user',
							content: [{ type: 'tool_result' as const, tool_use_id: toolBlock.id, content: `${timestamp()} You turn the switch ON. It is ON.` }]
						}
					]
					continue
				}

				if (toolName === 'turn_off') {
					switchIsOn = false
					const result = `${timestamp()} You turn the switch OFF. It is OFF.`
					messages = [
						...messages,
						{
							role: 'user',
							content: [{ type: 'tool_result' as const, tool_use_id: toolBlock.id, content: result }]
						}
					]
					continue
				}
			}
		} catch (err) {
			if (!cancelled) {
				handleWebSocketError(io, room, err, {
					logMessage: 'Annoyed WebSocket error',
					clientEvent: 'box:error',
					clientPayload: { error: 'LLM request failed' }
				})
			}
		} finally {
			socket.off('disconnect', cancel)
		}
	})
}
