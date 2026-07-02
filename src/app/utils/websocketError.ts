import Anthropic from '@anthropic-ai/sdk'
import { type Server } from 'socket.io'

import logger from './logger.js'

export interface WebSocketErrorContext {
	logMessage: string
	clientEvent: string
	clientPayload: Record<string, unknown>
}

export interface WebSocketErrorDetails {
	message: string
	status?: number
	errorBody?: unknown
	stack?: string
}

export interface WebSocketErrorLogger {
	error: (message: string, details: WebSocketErrorDetails) => void
}

export function getWebSocketErrorDetails (err: unknown): WebSocketErrorDetails {
	const isApiError = err instanceof Anthropic.APIError
	return {
		message: err instanceof Error ? err.message : String(err),
		status: isApiError ? err.status : undefined,
		errorBody: isApiError ? err.error : undefined,
		stack: err instanceof Error ? err.stack : undefined
	}
}

export function handleWebSocketError (io: Server, room: string, err: unknown, context: WebSocketErrorContext, log: WebSocketErrorLogger = logger): void {
	log.error(context.logMessage, getWebSocketErrorDetails(err))
	io.to(room).emit(context.clientEvent, context.clientPayload)
}