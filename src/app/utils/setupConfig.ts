import config from 'config'
import { type CorsOptions } from 'cors'
import { type CookieOptions } from 'express'
import { type Options as RateLimitOptions } from 'express-rate-limit'
import { type ConnectOptions } from 'mongoose'

import logger from './logger.js'

const configString = JSON.stringify(config.util.toObject(config), null, 4)

logger.debug(`Using configs:\n${configString}`)

const AppConfig = {
	costLimiterBurstWindowMs: config.get('costLimiter.burstWindowMs') as number,
	costLimiterBurstBudget: config.get('costLimiter.burstBudget') as number,
	costLimiterSustainedWindowMs: config.get('costLimiter.sustainedWindowMs') as number,
	costLimiterSustainedBudget: config.get('costLimiter.sustainedBudget') as number,
	burstLimiterConfig: config.get('burstLimiter') as RateLimitOptions,
	sustainedLimiterConfig: config.get('sustainedLimiter') as RateLimitOptions,
	expressPort: config.get('expressPort') as number,
	corsConfig: config.get('cors') as CorsOptions,
	mongooseOpts: config.get('mongoose.options') as ConnectOptions,
	maxRetryAttempts: config.get('mongoose.retrySettings.maxAttempts') as number,
	retryInterval: config.get('mongoose.retrySettings.interval') as number,
	retryWrites: config.get('mongoose.options.retryWrites') as string,
	w: config.get('mongoose.options.w') as string,
	appName: config.get('mongoose.options.appName') as string,
	bcryptSaltRounds: config.get('bcrypt.saltRounds') as number,
	cookieOptions: config.get('cookieOptions') as CookieOptions,
	sessionExpiry: config.get('session.expiry') as number,
	verificationExpiry: config.get('user.verificationExpiry') as number,
	passwordResetExpiry: config.get('user.passwordResetExpiry') as number,
	emailFrom: config.get('email.from') as string,
	emailFrontendBaseUrl: config.get('email.frontendBaseUrl') as string,
	llmModel: config.get('llm.model') as string,
	brainwashMaxTokens: config.get('llm.brainwashMaxTokens') as number,
	sentientBoxMaxTokens: config.get('llm.sentientBoxMaxTokens') as number,
	ghostWriterMaxTokens: config.get('llm.ghostWriterMaxTokens') as number,
	agentGiveUpMaxTokens: config.get('llm.agentGiveUpMaxTokens') as number,
	terminatorMaxTokens: config.get('llm.terminatorMaxTokens') as number,
	oneWordMaxTokens: config.get('llm.oneWordMaxTokens') as number,
	inputPricePerMillionTokens: config.get('llm.inputPricePerMillionTokens') as number,
	outputPricePerMillionTokens: config.get('llm.outputPricePerMillionTokens') as number
}

export default AppConfig
