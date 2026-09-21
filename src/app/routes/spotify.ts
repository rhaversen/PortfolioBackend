import { Router } from 'express'

import {
	disconnect,
	getAuthUrl,
	getStatus,
	handleCallback
} from '../controllers/spotifyController.js'
import { ensureAuthenticated } from '../middleware/auth.js'

const router = Router()

router.get('/auth', ensureAuthenticated, getAuthUrl)
router.get('/callback', handleCallback)
router.get('/status', ensureAuthenticated, getStatus)
router.post('/disconnect', ensureAuthenticated, disconnect)

export default router
