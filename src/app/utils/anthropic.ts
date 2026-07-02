import Anthropic from '@anthropic-ai/sdk'

import { chargeCost, computeCost } from './costRateLimiter.js'

const anthropicClient = new Anthropic({
	apiKey: process.env.ANTHROPIC_API_KEY
})

const HARD_MAX_SYSTEM_PROMPT_CHARS = 2000
const HARD_MAX_MESSAGE_CHARS = 8000
const HARD_MAX_MESSAGES = 100

type MessageCreateParams = Anthropic.MessageCreateParamsNonStreaming
type MessageStreamParams = Anthropic.MessageStreamParams
type MessageParam = Anthropic.MessageParam
type ContentBlockParam = Anthropic.ContentBlockParam
type TextBlockParam = Anthropic.TextBlockParam
type MidConversationSystemBlockParam = Anthropic.MidConversationSystemBlockParam
type ToolResultBlockParam = Anthropic.ToolResultBlockParam
type SystemParam = NonNullable<MessageCreateParams['system']>
type AnthropicStreamLike = {
	[Symbol.asyncIterator]: ReturnType<ReturnType<typeof anthropicClient.messages.stream>[typeof Symbol.asyncIterator]>
	finalMessage: () => Promise<Anthropic.Message>
}

interface AnthropicClientLike {
	messages: {
		create: (params: MessageCreateParams) => Promise<Anthropic.Message>
		stream: (params: MessageStreamParams) => AnthropicStreamLike
	}
}

interface Usage {
	input_tokens: number
	output_tokens: number
}

function chargeAnthropicUsage (ip: string, usage: Usage): void {
	chargeCost(ip, computeCost(usage.output_tokens, usage.input_tokens))
}

export interface AnthropicWrappers {
	createAnthropicMessage: (ip: string, params: MessageCreateParams) => Promise<Anthropic.Message>
	streamAnthropicMessage: (ip: string, params: MessageStreamParams) => AnthropicStreamLike
}

function truncateToHardLimit (text: string, hardLimit: number): string {
	return truncateText(text, Math.min(text.length, hardLimit))
}

function sanitizeTextBlockParam (block: TextBlockParam, hardLimit: number): TextBlockParam {
	return {
		...block,
		text: truncateToHardLimit(block.text, hardLimit)
	}
}

function sanitizeMidConversationSystemBlockParam (block: MidConversationSystemBlockParam): MidConversationSystemBlockParam {
	return {
		...block,
		content: block.content.map((textBlock) => sanitizeTextBlockParam(textBlock, HARD_MAX_SYSTEM_PROMPT_CHARS))
	}
}

function sanitizeToolResultBlockParam (block: ToolResultBlockParam): ToolResultBlockParam {
	if (typeof block.content === 'string') {
		return {
			...block,
			content: truncateToHardLimit(block.content, HARD_MAX_MESSAGE_CHARS)
		}
	}

	return block
}

function sanitizeContentBlockParam (block: ContentBlockParam): ContentBlockParam {
	switch (block.type) {
		case 'text':
			return sanitizeTextBlockParam(block, HARD_MAX_MESSAGE_CHARS)
		case 'tool_result':
			return sanitizeToolResultBlockParam(block)
		case 'mid_conv_system':
			return sanitizeMidConversationSystemBlockParam(block)
		default:
			return block
	}
}

function sanitizeMessageParam (message: MessageParam): MessageParam {
	if (typeof message.content === 'string') {
		return {
			...message,
			content: truncateToHardLimit(message.content, HARD_MAX_MESSAGE_CHARS)
		}
	}

	return {
		...message,
		content: message.content.map((block) => sanitizeContentBlockParam(block))
	}
}

function sanitizeSystemParam (system: SystemParam | undefined): SystemParam | undefined {
	if (system === undefined) {
		return undefined
	}

	if (typeof system === 'string') {
		return truncateToHardLimit(system, HARD_MAX_SYSTEM_PROMPT_CHARS)
	}

	return system.map((block) => sanitizeTextBlockParam(block, HARD_MAX_SYSTEM_PROMPT_CHARS))
}

function sanitizeAnthropicRequest<T extends { system?: SystemParam | undefined; messages?: MessageParam[] }> (params: T): T {
	return {
		...params,
		system: sanitizeSystemParam(params.system),
		messages: (params.messages ?? []).slice(-HARD_MAX_MESSAGES).map((message) => sanitizeMessageParam(message))
	}
}

export function createAnthropicWrappers (client: AnthropicClientLike = anthropicClient, chargeUsage: (ip: string, usage: Usage) => void = chargeAnthropicUsage): AnthropicWrappers {
	return {
		async createAnthropicMessage (ip: string, params: MessageCreateParams): Promise<Anthropic.Message> {
			const response = await client.messages.create(sanitizeAnthropicRequest(params))
			chargeUsage(ip, response.usage)
			return response
		},
		streamAnthropicMessage (ip: string, params: MessageStreamParams): AnthropicStreamLike {
			const stream = client.messages.stream(sanitizeAnthropicRequest(params))
			return {
				[Symbol.asyncIterator]: stream[Symbol.asyncIterator].bind(stream),
				async finalMessage (): Promise<Anthropic.Message> {
					const response = await stream.finalMessage()
					chargeUsage(ip, response.usage)
					return response
				}
			}
		}
	}
}

const defaultAnthropicWrappers = createAnthropicWrappers()

export const createAnthropicMessage = defaultAnthropicWrappers.createAnthropicMessage

export const streamAnthropicMessage = defaultAnthropicWrappers.streamAnthropicMessage

export function truncateText (text: string, maxChars: number): string {
	return text.slice(0, Math.max(0, maxChars))
}

export function truncateTail (text: string, maxChars: number): string {
	if (maxChars <= 0) {
		return ''
	}
	return text.slice(-maxChars)
}

export function clampMaxTokens (requestedTokens: number, maxTokens: number, fallbackTokens: number = maxTokens): number {
	const numericRequested = Number.isFinite(requestedTokens) ? requestedTokens : fallbackTokens
	return Math.min(Math.max(Math.trunc(numericRequested), 1), maxTokens)
}

export function buildSystemPromptOrFallback (systemPrompt: string | undefined, fallback: string, maxChars: number): string {
	if (typeof systemPrompt === 'string' && systemPrompt !== '') {
		return truncateText(systemPrompt, maxChars)
	}
	return fallback
}

export function buildSystemPromptWithSuffix (systemPrompt: string | undefined, suffix: string, maxChars: number): string {
	if (typeof systemPrompt === 'string' && systemPrompt !== '') {
		return `${truncateText(systemPrompt, maxChars)}${suffix}`
	}
	return suffix
}

export function getTextBlock (content: Anthropic.Message['content']): Anthropic.TextBlock | undefined {
	return content.find((block): block is Anthropic.TextBlock => block.type === 'text')
}

export function getTextContent (content: Anthropic.Message['content']): string {
	return getTextBlock(content)?.text ?? ''
}

export function getToolUseBlock (content: Anthropic.Message['content']): Anthropic.ToolUseBlock | undefined {
	return content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
}

export { sanitizeAnthropicRequest }