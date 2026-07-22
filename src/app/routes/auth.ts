import { Router } from 'express'

import {
	confirmDeletion,
	confirmEmail,
	forgotPassword,
	getMe,
	loginUserLocal,
	logoutLocal,
	requestConfirmation,
	requestDeletion,
	resetPassword
} from '../controllers/authController.js'
import { ensureAuthenticated } from '../middleware/auth.js'

const router = Router()

router.post('/login-user-local', loginUserLocal)

router.post('/logout-local', logoutLocal)

router.get('/user', ensureAuthenticated, getMe)

router.get('/is-authenticated', ensureAuthenticated, (req, res) => {
	res.status(200).send(req.sessionID)
})

router.post('/confirm/:code', confirmEmail)

router.post('/request-confirmation', requestConfirmation)

router.post('/forgot-password', forgotPassword)

router.post('/reset-password', resetPassword)

router.post('/request-deletion', ensureAuthenticated, requestDeletion)

router.post('/confirm-deletion/:code', confirmDeletion)

export default router
