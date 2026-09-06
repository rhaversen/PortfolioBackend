import { type Document, model, Schema, type Types } from 'mongoose'

export interface ISpotifyAccount extends Document {
	userId: Types.ObjectId
	spotifyUserId: string
	accessToken: string
	refreshToken: string
	expiresAt: Date
	scopes: string
	connectedAt: Date
	createdAt: Date
	updatedAt: Date
}

const spotifyAccountSchema = new Schema<ISpotifyAccount>({
	userId: {
		type: Schema.Types.ObjectId,
		ref: 'User',
		required: true,
		unique: true,
		index: true
	},
	spotifyUserId: {
		type: Schema.Types.String,
		required: true
	},
	accessToken: {
		type: Schema.Types.String,
		required: true
	},
	refreshToken: {
		type: Schema.Types.String,
		required: true
	},
	expiresAt: {
		type: Schema.Types.Date,
		required: true
	},
	scopes: {
		type: Schema.Types.String,
		required: true
	},
	connectedAt: {
		type: Schema.Types.Date,
		default: Date.now
	}
}, {
	timestamps: true
})

const SpotifyAccountModel = model<ISpotifyAccount>('SpotifyAccount', spotifyAccountSchema)

export default SpotifyAccountModel
