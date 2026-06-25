const required = ['ANTHROPIC_API_KEY'] as const

for (const key of required) {
	if (process.env[key] === undefined || process.env[key] === '') {
		throw new Error(`Missing required environment variable: ${key}`)
	}
}
