import { type NextFunction, type Request, type Response } from 'express'

import logger from '../utils/logger.js'

export function ensureAuthenticated (req: Request, res: Response, next: NextFunction): void {
	logger.silly('Ensuring authentication')

	if (!req.isAuthenticated()) {
		res.status(401).json({ message: 'Unauthorized' })
		return
	}
	next()
}
