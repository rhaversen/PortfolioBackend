import logger from './logger.js'

const envSecrets = [
	// Database
	'DB_NAME',
	'DB_USER',
	'DB_PASSWORD',
	'DB_HOST',
	// Session
	'SESSION_SECRET',
	// Email SMTP
	'SMTP_SERVER',
	'SMTP_LOGIN',
	'SMTP_KEY',
	// LLM
	'ANTHROPIC_API_KEY',
	// Spotify
	'SPOTIFY_CLIENT_ID',
	'SPOTIFY_CLIENT_SECRET',
	'SPOTIFY_TOKEN_ENCRYPTION_KEY',
	// Last.fm
	'LASTFM_API_KEY'
]

const envSecretsDev = [
	'SESSION_SECRET',
	'ANTHROPIC_API_KEY',
	'SPOTIFY_CLIENT_ID',
	'SPOTIFY_CLIENT_SECRET',
	'SPOTIFY_TOKEN_ENCRYPTION_KEY',
	'LASTFM_API_KEY'
]

const envSecretsTest = [
	'SESSION_SECRET',
	'ANTHROPIC_API_KEY',
	'SPOTIFY_CLIENT_ID',
	'SPOTIFY_CLIENT_SECRET',
	'SPOTIFY_TOKEN_ENCRYPTION_KEY',
	'LASTFM_API_KEY'
]

const missingSecrets: string[] = []
if (process.env.NODE_ENV === 'development') {
	envSecretsDev.forEach((secret) => {
		if (process.env[secret] === undefined || process.env[secret] === '') {
			missingSecrets.push(secret)
		}
	})
} else if (process.env.NODE_ENV === 'test') {
	envSecretsTest.forEach((secret) => {
		if (process.env[secret] === undefined || process.env[secret] === '') {
			missingSecrets.push(secret)
		}
	})
} else if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
	envSecrets.forEach((secret) => {
		if (process.env[secret] === undefined || process.env[secret] === '') {
			missingSecrets.push(secret)
		}
	})
}

if (missingSecrets.length > 0) {
	const errorMessage = `Missing environment secrets: ${missingSecrets.join(', ')}`
	logger.error('Exiting due to missing environment secrets', { missingSecrets })
	throw new Error(errorMessage)
}

logger.info('All environment secrets are set')

export {}
