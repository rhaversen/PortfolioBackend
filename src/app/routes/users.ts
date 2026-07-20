import { Router } from 'express'

import {
	getUser,
	register,
	updateUser
} from '../controllers/userController.js'
import { ensureAuthenticated } from '../middleware/auth.js'

const router = Router()

router.post('/', register)

router.get('/:id', ensureAuthenticated, getUser)

router.patch('/:id', ensureAuthenticated, updateUser)

export default router
