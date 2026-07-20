import nodemailer, { type Transporter } from 'nodemailer'

import logger from './logger.js'
import config from './setupConfig.js'

const { NODE_ENV } = process.env as Record<string, string>

let transporter: Transporter | null = null

async function getTransporter (): Promise<Transporter> {
	if (transporter !== null) {
		return transporter
	}

	if (NODE_ENV === 'production' || NODE_ENV === 'staging') {
		const { SMTP_SERVER, SMTP_LOGIN, SMTP_KEY } = process.env as Record<string, string>
		transporter = nodemailer.createTransport({
			host: SMTP_SERVER,
			port: config.emailPort,
			secure: config.emailPort === 465,
			auth: {
				user: SMTP_LOGIN,
				pass: SMTP_KEY
			}
		})
	} else {
		const testAccount = await nodemailer.createTestAccount()
		transporter = nodemailer.createTransport({
			host: 'smtp.ethereal.email',
			port: 587,
			secure: false,
			auth: {
				user: testAccount.user,
				pass: testAccount.pass
			}
		})
		logger.info(`Ethereal email account created: ${testAccount.user}`)
	}

	return transporter
}

async function sendConfirmationEmail (toEmail: string, code: string): Promise<{ sent: boolean }> {
	try {
		const mailTransporter = await getTransporter()
		const confirmationUrl = `${config.emailFrontendBaseUrl}/confirm/${code}`

		const info = await mailTransporter.sendMail({
			from: config.emailFrom,
			to: toEmail,
			subject: 'Confirm your Portfolio account',
			text: `Welcome to Portfolio!\n\nPlease confirm your email by visiting the following link:\n${confirmationUrl}\n\nThis link expires in 24 hours.`,
			html: `<h2>Welcome to Portfolio!</h2><p>Please confirm your email by clicking the link below:</p><p><a href="${confirmationUrl}">${confirmationUrl}</a></p><p style="color:#6b7280">This link expires in 24 hours.</p>`
		})

		if (NODE_ENV !== 'production' && NODE_ENV !== 'staging') {
			const previewUrl = nodemailer.getTestMessageUrl(info)
			logger.info(`Confirmation email sent to ${toEmail}. Preview: ${previewUrl}`)
		} else {
			logger.info(`Confirmation email sent to ${toEmail}`)
		}

		return { sent: true }
	} catch (error) {
		logger.error(`Failed to send confirmation email to ${toEmail}`, { error })
		return { sent: false }
	}
}

async function sendPasswordResetEmail (toEmail: string, code: string): Promise<{ sent: boolean }> {
	try {
		const mailTransporter = await getTransporter()
		const resetUrl = `${config.emailFrontendBaseUrl}/reset-password?code=${code}`

		const info = await mailTransporter.sendMail({
			from: config.emailFrom,
			to: toEmail,
			subject: 'Reset your Portfolio password',
			text: `A password reset was requested for your Portfolio account.\n\nReset your password by visiting the following link:\n${resetUrl}\n\nThis link expires in 24 hours. If you did not request a reset, you can safely ignore this email.`,
			html: `<h2>Reset your password</h2><p>A password reset was requested for your Portfolio account.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p style="color:#6b7280">This link expires in 24 hours. If you did not request a reset, you can safely ignore this email.</p>`
		})

		if (NODE_ENV !== 'production' && NODE_ENV !== 'staging') {
			const previewUrl = nodemailer.getTestMessageUrl(info)
			logger.info(`Password reset email sent to ${toEmail}. Preview: ${previewUrl}`)
		} else {
			logger.info(`Password reset email sent to ${toEmail}`)
		}

		return { sent: true }
	} catch (error) {
		logger.error(`Failed to send password reset email to ${toEmail}`, { error })
		return { sent: false }
	}
}

async function sendDeletionEmail (toEmail: string, code: string): Promise<{ sent: boolean }> {
	try {
		const mailTransporter = await getTransporter()
		const deletionUrl = `${config.emailFrontendBaseUrl}/delete-account/${code}`

		const info = await mailTransporter.sendMail({
			from: config.emailFrom,
			to: toEmail,
			subject: 'Confirm deletion of your Portfolio account',
			text: `A request was made to delete your Portfolio account.

To confirm deletion, visit the following link:
${deletionUrl}

This link expires in 1 hour. If you did not request this, you can safely ignore this email and your account will not be deleted.`,
			html: `<h2>Account deletion request</h2><p>A request was made to delete your Portfolio account.</p><p><a href="${deletionUrl}">${deletionUrl}</a></p><p style="color:#6b7280">This link expires in 1 hour. If you did not request this, you can safely ignore this email and your account will not be deleted.</p>`
		})

		if (NODE_ENV !== 'production' && NODE_ENV !== 'staging') {
			const previewUrl = nodemailer.getTestMessageUrl(info)
			logger.info(`Deletion email sent to ${toEmail}. Preview: ${previewUrl}`)
		} else {
			logger.info(`Deletion email sent to ${toEmail}`)
		}

		return { sent: true }
	} catch (error) {
		logger.error(`Failed to send deletion email to ${toEmail}`, { error })
		return { sent: false }
	}
}

export default {
	sendConfirmationEmail,
	sendPasswordResetEmail,
	sendDeletionEmail
}
