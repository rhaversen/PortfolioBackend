/* eslint-disable @typescript-eslint/no-explicit-any */
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import { Logtail } from '@logtail/node'
import { createLogger, format as _format, transports as _transports } from 'winston'

const { BETTERSTACK_LOG_TOKEN, BETTERSTACK_INGESTING_HOST } = process.env as Record<string, string>

const _filename = fileURLToPath(import.meta.url)
const _dirname = dirname(_filename)
const logDirectory = join(_dirname, (['production', 'staging'].includes(process.env.NODE_ENV ?? '') ? './logs/' : '../../logs/'))
const logLevel = {
	development: 'silly',
	production: 'info',
	staging: 'info',
	test: 'debug'
}

const winstonLogger = createLogger({
	levels: {
		error: 0,
		warn: 1,
		info: 2,
		http: 3,
		verbose: 4,
		debug: 5,
		silly: 6
	},
	format: _format.combine(
		_format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:SSS' }),
		_format.json()
	),
	defaultMeta: { service: 'portfolio-backend' },
	transports: [
		new _transports.File({
			filename: join(logDirectory, 'error.jsonl'),
			level: 'error'
		}),
		new _transports.File({
			filename: join(logDirectory, 'info.jsonl'),
			level: 'info'
		}),
		new _transports.File({
			filename: join(logDirectory, 'combined.jsonl'),
			level: 'silly'
		}),
		new _transports.Console({
			format: _format.combine(
				_format.colorize(),
				_format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
				_format.printf((logObject) => {
					const meta = Object.keys(logObject)
						.filter((k) => !['timestamp', 'level', 'message', 'service'].includes(k))
						.reduce((acc, k) => { acc[k] = logObject[k]; return acc }, {} as Record<string, any>)
					const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
					return `${logObject.timestamp} ${logObject.level}: ${logObject.message}${metaStr}`
				})
			),
			level: logLevel[process.env.NODE_ENV as keyof typeof logLevel] ?? 'info'
		})
	]
})

let betterStackLogger: Logtail | null = null

function sanitizeContext (context?: Record<string, any>): Record<string, any> | undefined {
	if (context === undefined) { return context }
	const sanitized = { ...context }
	if (sanitized.error instanceof Error) {
		const err = sanitized.error as Record<string, any>
		const extracted: Record<string, any> = {
			message: err.message,
			stack: err.stack,
			name: err.name
		}
		for (const key of ['code', 'cmd', 'args', 'signal', 'status', 'exitCode', 'stdout', 'stderr', 'path', 'syscall'] as const) {
			if (err[key] !== undefined && err[key] !== '') {
				extracted[key] = err[key]
			}
		}
		sanitized.error = extracted
	}
	return sanitized
}

const logToBetterStackNonBlocking = (
	level: 'error' | 'warn' | 'info' | 'debug',
	message: string,
	context?: Record<string, any>
): void => {
	if ((process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'staging') || (BETTERSTACK_LOG_TOKEN ?? '') === '') {
		return
	}

	if (betterStackLogger === null) {
		betterStackLogger = new Logtail(BETTERSTACK_LOG_TOKEN, {
			endpoint: BETTERSTACK_INGESTING_HOST !== undefined && BETTERSTACK_INGESTING_HOST !== ''
				? `https://${BETTERSTACK_INGESTING_HOST}`
				: undefined
		})
	}

	const sanitizedContext = sanitizeContext(context)

	betterStackLogger[level](message, sanitizedContext).catch((error) => {
		winstonLogger.error(`Error logging to BetterStack: ${error instanceof Error ? error.toString() : String(error)}`, { error })
	})
}

const logger = {
	error: (message: string, context?: Record<string, any>) => {
		const sanitized = sanitizeContext(context)
		winstonLogger.error(message, sanitized)
		logToBetterStackNonBlocking('error', message, sanitized)
	},
	warn: (message: string, context?: Record<string, any>) => {
		const sanitized = sanitizeContext(context)
		winstonLogger.warn(message, sanitized)
		logToBetterStackNonBlocking('warn', message, sanitized)
	},
	info: (message: string, context?: Record<string, any>) => {
		const sanitized = sanitizeContext(context)
		winstonLogger.info(message, sanitized)
		logToBetterStackNonBlocking('info', message, sanitized)
	},
	http: (message: string, context?: Record<string, any>) => {
		const sanitized = sanitizeContext(context)
		winstonLogger.http(message, sanitized)
		logToBetterStackNonBlocking('debug', message, sanitized)
	},
	verbose: (message: string, context?: Record<string, any>) => {
		const sanitized = sanitizeContext(context)
		winstonLogger.verbose(message, sanitized)
		logToBetterStackNonBlocking('debug', message, sanitized)
	},
	debug: (message: string, context?: Record<string, any>) => {
		const sanitized = sanitizeContext(context)
		winstonLogger.debug(message, sanitized)
		logToBetterStackNonBlocking('debug', message, sanitized)
	},
	silly: (message: string, context?: Record<string, any>) => {
		const sanitized = sanitizeContext(context)
		winstonLogger.silly(message, sanitized)
		logToBetterStackNonBlocking('debug', message, sanitized)
	}
}

export default logger
