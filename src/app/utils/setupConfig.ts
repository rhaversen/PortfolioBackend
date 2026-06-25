import config from 'config'
import { type CorsOptions } from 'cors'
import { type Options as RateLimitOptions } from 'express-rate-limit'

import logger from './logger.js'

const configString = JSON.stringify(config.util.toObject(config), null, 4)

logger.debug(`Using configs:\n${configString}`)

const AppConfig = {
	apiLimiterConfig: config.get('apiLimiter') as RateLimitOptions,
	expressPort: config.get('expressPort') as number,
	corsConfig: config.get('cors') as CorsOptions,
	llmModel: config.get('llm.model') as string,
	llmMaxTokens: config.get('llm.maxTokens') as number,
	brainwashMaxTokens: config.get('llm.brainwashMaxTokens') as number,
	sentientBoxMaxTokens: config.get('llm.sentientBoxMaxTokens') as number
}

export default AppConfig
