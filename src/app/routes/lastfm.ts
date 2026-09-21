import { Router } from 'express'

import {
	connect,
	disconnect,
	getStatus
} from '../controllers/lastfmController.js'
import { ensureAuthenticated } from '../middleware/auth.js'

const router = Router()

router.post('/connect', ensureAuthenticated, connect)
router.get('/status', ensureAuthenticated, getStatus)
router.post('/disconnect', ensureAuthenticated, disconnect)

export default router
