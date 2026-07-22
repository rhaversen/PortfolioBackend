import { type NextFunction, type Request, type Response } from 'express'
import passport from 'passport'

import UserModel from '../models/User.js'
import { type IUser } from '../models/User.js'
import emailService from '../utils/emailService.js'
import logger from '../utils/logger.js'
import config from '../utils/setupConfig.js'

const {
	sessionExpiry
} = config

export async function loginUserLocal (req: Request, res: Response, next: NextFunction): Promise<void> {
	if (req.body.email === undefined || req.body.password === undefined) {
		res.status(400).json({
			auth: false,
			error: 'Email and password must be provided'
		})
		return
	}

	passport.authenticate('user-local', (err: Error, user: Express.User | boolean, info: { message: string }) => {
		if (err !== null && err !== undefined) {
			return res.status(500).json({
				auth: false,
				error: err.message
			})
		}

		if (user === null || user === undefined || user === false) {
			return res.status(401).json({
				auth: false,
				error: info.message
			})
		}

		const typedUser = user as IUser

		req.logIn(typedUser, loginErr => {
			if (loginErr !== null && loginErr !== undefined) {
				return res.status(500).json({
					auth: false,
					error: loginErr.message
				})
			}

			if (req.body.stayLoggedIn === true || req.body.stayLoggedIn === 'true') {
				req.session.cookie.maxAge = sessionExpiry
			}

			const loggedInUser = typedUser

			const userWithoutPassword = {
				_id: loggedInUser._id,
				username: loggedInUser.username,
				email: loggedInUser.email,
				confirmed: loggedInUser.confirmed,
				expirationDate: loggedInUser.expirationDate,
				createdAt: loggedInUser.createdAt,
				updatedAt: loggedInUser.updatedAt
			}

			res.status(200).json({
				auth: true,
				user: userWithoutPassword
			})
		})
	})(req, res, next)
}

export async function logoutLocal (req: Request, res: Response, next: NextFunction): Promise<void> {
	req.logout(function (err) {
		if (err !== null && err !== undefined) {
			next(err)
			return
		}

		req.session.destroy(function (sessionErr) {
			if (sessionErr !== null && sessionErr !== undefined) {
				next(sessionErr)
				return
			}
			res.clearCookie('connect.sid')
			res.status(200).json({ message: 'Logged out' })
		})
	})
}

export async function getMe (req: Request, res: Response): Promise<void> {
	const user = req.user

	if (user === undefined) {
		res.status(401).json({ error: 'Unauthorized' })
		return
	}

	const mappedUser = {
		_id: user.id,
		username: user.username,
		email: user.email,
		expirationDate: user.expirationDate,
		confirmed: user.confirmed,
		createdAt: user.createdAt,
		updatedAt: user.updatedAt
	}

	res.status(200).json(mappedUser)
}

export async function confirmEmail (req: Request, res: Response): Promise<void> {
	const { code } = req.params

	const user = await UserModel.findOne({ confirmationCode: code }).exec()

	if (user === null) {
		res.status(404).json({ error: 'Invalid or expired confirmation code' })
		return
	}

	if (user.confirmed) {
		res.status(200).json({ message: 'Email already confirmed', confirmed: true })
		return
	}

	if (user.expirationDate !== undefined && new Date() >= user.expirationDate) {
		res.status(400).json({ error: 'Confirmation code has expired' })
		return
	}

	user.confirmUser()
	await user.save()

	logger.info(`User ${user.email} confirmed their email`)
	res.status(200).json({ message: 'Email confirmed successfully', confirmed: true })
}

export async function requestConfirmation (req: Request, res: Response): Promise<void> {
	const { email } = req.body

	if (email === undefined) {
		res.status(400).json({ error: 'Email must be provided' })
		return
	}

	const user = await UserModel.findOne({ email: email.toLowerCase() }).exec()

	if (user !== null && !user.confirmed) {
		const newCode = await user.generateNewConfirmationCode()
		await user.save()
		await emailService.sendConfirmationEmail(user.email, newCode)
	}

	res.status(200).json({ message: 'If that email exists and is unconfirmed, a confirmation email has been sent.' })
}

export async function forgotPassword (req: Request, res: Response): Promise<void> {
	const { email } = req.body

	if (email === undefined) {
		res.status(400).json({ error: 'Email must be provided' })
		return
	}

	const user = await UserModel.findOne({ email: email.toLowerCase() }).exec()

	if (user !== null) {
		const newCode = await user.generateNewPasswordResetCode()
		await user.save()
		await emailService.sendPasswordResetEmail(user.email, newCode)
	}

	res.status(200).json({ message: 'If that email exists, a reset link has been sent.' })
}

export async function resetPassword (req: Request, res: Response): Promise<void> {
	const { passwordResetCode, newPassword, confirmPassword } = req.body

	if (passwordResetCode === undefined || newPassword === undefined || confirmPassword === undefined) {
		res.status(400).json({ error: 'Reset code, new password, and password confirmation must be provided' })
		return
	}

	if (newPassword !== confirmPassword) {
		res.status(400).json({ error: 'Passwords do not match' })
		return
	}

	const user = await UserModel.findOne({ passwordResetCode }).exec()

	if (user === null) {
		res.status(404).json({ error: 'Invalid or expired reset code' })
		return
	}

	await user.resetPassword(newPassword, passwordResetCode)
	await user.save()

	logger.info(`User ${user.email} reset their password`)
	res.status(200).json({ message: 'Password reset successfully' })
}

export async function requestDeletion (req: Request, res: Response): Promise<void> {
	const user = req.user

	if (user === undefined) {
		res.status(401).json({ error: 'Unauthorized' })
		return
	}

	const dbUser = await UserModel.findById(user.id).exec()
	if (dbUser === null) {
		res.status(404).json({ error: 'User not found' })
		return
	}

	const newCode = await dbUser.generateNewDeletionCode()
	await dbUser.save()

	await emailService.sendDeletionEmail(dbUser.email, newCode)
	logger.info(`User ${dbUser.email} requested account deletion`)
	res.status(200).json({ message: 'If your account exists, a deletion link has been sent.' })
}

export async function confirmDeletion (req: Request, res: Response): Promise<void> {
	const { code } = req.params

	const user = await UserModel.findOne({ deletionCode: code }).exec()

	if (user === null) {
		res.status(404).json({ error: 'Invalid or expired deletion code' })
		return
	}

	if (user.deletionExpirationDate !== undefined && new Date() >= user.deletionExpirationDate) {
		res.status(400).json({ error: 'Deletion code has expired' })
		return
	}

	logger.info(`User ${user.email} is deleting their account`)

	await req.logout(async function (logoutErr) {
		if (logoutErr !== null && logoutErr !== undefined) {
			logger.error('Error logging out during account deletion', { error: logoutErr })
		}

		await UserModel.findByIdAndDelete(user.id).exec()

		req.session.destroy(function (sessionErr) {
			if (sessionErr !== null && sessionErr !== undefined) {
				logger.error('Error destroying session during account deletion', { error: sessionErr })
			}
			res.clearCookie('connect.sid')
			res.status(200).json({ message: 'Account deleted successfully' })
		})
	})
}
