import { type NextFunction, type Request, type Response } from 'express'
import mongoose from 'mongoose'

import UserModel from '../models/User.js'
import emailService from '../utils/emailService.js'

import { loginUserLocal } from './authController.js'

export async function register (req: Request, res: Response, next: NextFunction): Promise<void> {
	const body: Record<string, unknown> = {
		email: req.body.email,
		password: req.body.password,
		confirmPassword: req.body.confirmPassword
	}

	if (body.password !== body.confirmPassword) {
		res.status(400).json({
			auth: false,
			error: 'Passwords do not match'
		})
		return
	}

	const existingUser = await UserModel.findOne({ email: body.email as string }).exec()

	if (existingUser === null) {
		const newUser = await UserModel.create({
			email: body.email as string,
			password: body.password as string
		})
		await emailService.sendConfirmationEmail(newUser.email, newUser.confirmationCode as string)
	}

	loginUserLocal(req, res, next)
}

export async function getUser (req: Request, res: Response): Promise<void> {
	const user = req.user
	const paramUser = await UserModel.findById(req.params.id).exec()

	if (paramUser === null) {
		res.status(404).json({ error: 'User not found' })
		return
	}

	const mappedUser = {
		_id: paramUser.id,
		username: paramUser.username,
		email: paramUser.id === user?.id ? paramUser.email : null,
		expirationDate: paramUser.id === user?.id ? paramUser.expirationDate : null,
		confirmed: paramUser.id === user?.id ? paramUser.confirmed : null,
		createdAt: paramUser.createdAt,
		updatedAt: paramUser.updatedAt
	}

	res.status(200).json(mappedUser)
}

export async function updateUser (req: Request, res: Response, next: NextFunction): Promise<void> {
	const user = req.user

	if (user === undefined) {
		res.status(401).json({ error: 'Unauthorized' })
		return
	}

	const session = await mongoose.startSession()
	session.startTransaction()

	try {
		const paramUser = await UserModel.findById(req.params.id, null, { session })

		if (paramUser === null) {
			res.status(404).json({ error: 'User not found' })
			return
		}

		if (user.id !== paramUser.id) {
			res.status(403).json({ error: 'Forbidden' })
			return
		}

		if (req.body.password !== undefined && req.body.password !== req.body.confirmPassword) {
			res.status(400).json({ error: 'Passwords do not match' })
			return
		}

		if (req.body.username !== undefined) { paramUser.username = req.body.username }
		if (req.body.email !== undefined) { paramUser.email = req.body.email }
		if (req.body.password !== undefined) { paramUser.password = req.body.password }

		await paramUser.validate()
		await paramUser.save({ session })
		await session.commitTransaction()

		const mappedUser = {
			_id: paramUser.id,
			username: paramUser.username,
			email: paramUser.email,
			expirationDate: paramUser.expirationDate,
			confirmed: paramUser.confirmed,
			createdAt: paramUser.createdAt,
			updatedAt: paramUser.updatedAt
		}

		res.status(200).json(mappedUser)
	} catch (error) {
		await session.abortTransaction()
		if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) {
			res.status(400).json({ error: error.message })
			return
		}
		next(error)
	} finally {
		session.endSession()
	}
}
