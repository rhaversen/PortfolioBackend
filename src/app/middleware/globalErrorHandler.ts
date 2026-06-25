import { type NextFunction, type Request, type Response } from 'express'

import logger from '../utils/logger.js'

export default (function (err: Error, req: Request, res: Response, next: NextFunction): void {
	if (err.stack !== null && err.stack !== undefined && err.stack !== '') {
		logger.error('Unhandled error', { error: err, stack: err.stack })
	} else {
		logger.error('Unhandled error', { error: err })
	}

	res.status(500).json({ error: 'An unexpected error occurred, please try again later' })
	next()
})
