import { Router } from 'express'

import {
	getAllUsers,
	getUser,
	register,
	updateUser
} from '../controllers/userController.js'
import { ensureAuthenticated } from '../middleware/auth.js'

const router = Router()

router.post('/', register)

router.get('/', getAllUsers)

router.get('/:id', getUser)

router.patch('/:id', ensureAuthenticated, updateUser)

export default router
