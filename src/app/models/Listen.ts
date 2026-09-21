import { type Document, model, Schema, type Types } from 'mongoose'

export interface IListen extends Document {
	userId: Types.ObjectId
	songId: Types.ObjectId
	playedAt: Date
	createdAt: Date
	updatedAt: Date
}

const listenSchema = new Schema<IListen>({
	userId: {
		type: Schema.Types.ObjectId,
		ref: 'User',
		required: true
	},
	songId: {
		type: Schema.Types.ObjectId,
		ref: 'Song',
		required: true
	},
	playedAt: {
		type: Schema.Types.Date,
		required: true
	}
}, {
	timestamps: true
})

listenSchema.index({ userId: 1, playedAt: -1 })
listenSchema.index({ userId: 1, songId: 1, playedAt: 1 }, { unique: true })

const ListenModel = model<IListen>('Listen', listenSchema)

export default ListenModel
