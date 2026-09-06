import { type Document, model, Schema } from 'mongoose'

export interface ISong extends Document {
	spotifyId: string
	name: string
	artists: string[]
	album: string
	albumImage: string | null
	durationMs: number
	spotifyUrl: string
	createdAt: Date
	updatedAt: Date
}

const songSchema = new Schema<ISong>({
	spotifyId: {
		type: Schema.Types.String,
		required: true,
		unique: true,
		index: true
	},
	name: {
		type: Schema.Types.String,
		required: true
	},
	artists: {
		type: [Schema.Types.String],
		default: []
	},
	album: {
		type: Schema.Types.String,
		default: ''
	},
	albumImage: {
		type: Schema.Types.String,
		default: null
	},
	durationMs: {
		type: Schema.Types.Number,
		required: true
	},
	spotifyUrl: {
		type: Schema.Types.String,
		required: true
	}
}, {
	timestamps: true
})

const SongModel = model<ISong>('Song', songSchema)

export default SongModel
