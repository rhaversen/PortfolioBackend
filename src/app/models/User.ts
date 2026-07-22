import { compare, hash } from 'bcrypt'
import { type Document, model, Schema } from 'mongoose'
import { nanoid } from 'nanoid'

import config from '../utils/setupConfig.js'

const {
	bcryptSaltRounds,
	verificationExpiry,
	passwordResetExpiry,
	deletionExpiry
} = config

export interface IUser extends Document {
	username?: string
	email: string
	password: string
	confirmed: boolean

	expirationDate?: Date
	passwordResetExpirationDate?: Date
	confirmationCode?: string
	passwordResetCode?: string
	deletionCode?: string
	deletionExpirationDate?: Date

	comparePassword: (password: string) => Promise<boolean>
	confirmUser: () => void
	resetPassword: (newPassword: string, passwordResetCode: string) => Promise<void>
	generateNewConfirmationCode: () => Promise<string>
	generateNewPasswordResetCode: () => Promise<string>
	generateNewDeletionCode: () => Promise<string>

	createdAt: Date
	updatedAt: Date
}

const userSchema = new Schema<IUser>({
	username: {
		type: Schema.Types.String,
		trim: true,
		default: '',
		maxlength: [50, 'Username must be at most 50 characters long']
	},
	email: {
		type: Schema.Types.String,
		required: true,
		unique: true,
		lowercase: true,
		trim: true,
		maxlength: [50, 'Email must be at most 50 characters long']
	},
	password: {
		type: Schema.Types.String,
		required: true,
		trim: true,
		minlength: [4, 'Password must be at least 4 characters long'],
		maxlength: [100, 'Password can be at most 100 characters long']
	},
	confirmed: {
		type: Schema.Types.Boolean,
		default: false
	},
	confirmationCode: {
		type: Schema.Types.String
	},
	expirationDate: {
		type: Schema.Types.Date
	},
	passwordResetCode: {
		type: Schema.Types.String
	},
	passwordResetExpirationDate: {
		type: Schema.Types.Date
	},
	deletionCode: {
		type: Schema.Types.String
	},
	deletionExpirationDate: {
		type: Schema.Types.Date
	}
}, {
	timestamps: true
})

userSchema.index({ expirationDate: 1 }, { expireAfterSeconds: 0 })

userSchema.methods.confirmUser = function () {
	this.confirmed = true
	this.expirationDate = undefined
	this.confirmationCode = undefined
}

type CodeFields = 'confirmationCode' | 'passwordResetCode' | 'deletionCode'

async function generateUniqueCodeForField (field: CodeFields): Promise<string> {
	let generatedCode: string
	let existingUser: IUser | null

	do {
		generatedCode = nanoid()
		existingUser = await UserModel.findOne({ [field]: generatedCode })
	} while ((existingUser !== null))

	return generatedCode
}

userSchema.methods.generateNewConfirmationCode = async function (): Promise<string> {
	const newConfirmationCode = await generateUniqueCodeForField('confirmationCode')
	this.confirmationCode = newConfirmationCode
	this.expirationDate = new Date(Date.now() + verificationExpiry)
	return newConfirmationCode
}

userSchema.methods.generateNewPasswordResetCode = async function (): Promise<string> {
	const newPasswordResetCode = await generateUniqueCodeForField('passwordResetCode')
	this.passwordResetCode = newPasswordResetCode
	this.passwordResetExpirationDate = new Date(Date.now() + passwordResetExpiry)
	return newPasswordResetCode
}

userSchema.methods.generateNewDeletionCode = async function (): Promise<string> {
	const newDeletionCode = await generateUniqueCodeForField('deletionCode')
	this.deletionCode = newDeletionCode
	this.deletionExpirationDate = new Date(Date.now() + deletionExpiry)
	return newDeletionCode
}

userSchema.methods.resetPassword = async function (newPassword: string, passwordResetCode: string): Promise<void> {
	const hasPasswordResetCode = this.passwordResetCode !== undefined
	const isPasswordResetCodeValid = this.passwordResetCode === passwordResetCode
	const isPasswordResetCodeExpired = new Date() >= this.passwordResetExpirationDate
	if (hasPasswordResetCode && isPasswordResetCodeValid && !isPasswordResetCodeExpired) {
		// Set plain password — the pre('save') hook will hash it
		this.password = newPassword
		this.passwordResetCode = undefined
		this.passwordResetExpirationDate = undefined
	}
}

userSchema.methods.comparePassword = async function (this: IUser, password: string): Promise<boolean> {
	const isPasswordCorrect = await compare(password, this.password)
	return isPasswordCorrect
}

userSchema.pre('save', async function () {
	if (this.isNew) {
		await this.generateNewConfirmationCode()
	}

	if (this.isModified('password')) {
		this.password = await hash(this.password, bcryptSaltRounds)
		this.passwordResetCode = undefined
	}
})

const UserModel = model<IUser>('User', userSchema)

export default UserModel
