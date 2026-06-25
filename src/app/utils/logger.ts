import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import { createLogger, format as _format, transports as _transports } from 'winston'

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
			filename: join(logDirectory, 'error.log'),
			level: 'error'
		}),
		new _transports.File({
			filename: join(logDirectory, 'combined.log'),
			level: 'silly'
		}),
		new _transports.Console({
			format: _format.combine(
				_format.colorize(),
				_format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
				_format.printf((logObject) => {
					return `${logObject['timestamp']} ${logObject.level}: ${logObject.message}`
				})
			),
			level: logLevel[process.env.NODE_ENV as keyof typeof logLevel] ?? 'info'
		})
	]
})

export default winstonLogger
