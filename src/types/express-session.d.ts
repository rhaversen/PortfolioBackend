import 'express-session'

declare module 'express-session' {
	interface Session {
		passport?: {
			user?: string
		}
		type?: 'user'
		ipAddress?: string
		loginTime?: Date
		lastActivity?: Date
		userAgent?: string
	}
}
