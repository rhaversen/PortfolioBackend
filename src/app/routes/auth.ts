import { Router } from 'express'

import {
	confirmEmail,
	forgotPassword,
	getMe,
	loginUserLocal,
	logoutLocal,
	resendConfirmation,
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

router.post('/resend-confirmation', ensureAuthenticated, resendConfirmation)

router.post('/forgot-password', forgotPassword)

router.post('/reset-password', resetPassword)

export default router
