import { type Document, model, Schema, type Types } from 'mongoose'

export interface ISpotifyOAuthState extends Document {
	state: string
	userId: Types.ObjectId
	createdAt: Date
}

const spotifyOAuthStateSchema = new Schema<ISpotifyOAuthState>({
	state: {
		type: Schema.Types.String,
		required: true,
		unique: true,
		index: true
	},
	userId: {
		type: Schema.Types.ObjectId,
		ref: 'User',
		required: true
	},
	createdAt: {
		type: Schema.Types.Date,
		default: Date.now
	}
})

spotifyOAuthStateSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 })

const SpotifyOAuthStateModel = model<ISpotifyOAuthState>('SpotifyOAuthState', spotifyOAuthStateSchema)

export default SpotifyOAuthStateModel
