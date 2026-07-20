import 'mongoose'

declare module 'mongoose' {
	interface Document {
		id: any
	}
}
