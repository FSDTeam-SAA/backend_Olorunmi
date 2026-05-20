import mongoose, { Schema } from "mongoose";

const fcmSchema = new Schema({
  fcmToken: { type: String},
  user : { type: Schema.Types.ObjectId, ref: 'User'},
},{
  timestamps: true
});

export const FCM = mongoose.model("fcm", fcmSchema);