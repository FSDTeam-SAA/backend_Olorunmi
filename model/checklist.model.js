import mongoose from "mongoose";

const checklistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    option: {
      type: String,
      required: true,
      trim: true,
    },
    workDate: {
      type: String,
      required: true,
      index: true,
    },
    timezone: {
      type: String,
      trim: true,
    },
    localDateTime: {
      type: String,
      trim: true,
    },
    localTime: {
      type: String,
      trim: true,
    },
    checkInAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    checkInLocation: {
      latitude: { type: Number },
      longitude: { type: Number},
    },
    checkOutAt: {
      type: Date,
      default: null,
    },
    checkOutLocation: {
      latitude: { type: Number },
      longitude: { type: Number },
    },
    checkOutType: {
      type: String,
      enum: ["manual", "auto", null],
      default: null,
    },
    autoCheckoutTrigger: {
      latitude: { type: Number },
      longitude: { type: Number },
      recordedAt: { type: Date },
    },
    missedResponseFor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Checklist",
    },
    status: {
      type: String,
      enum: ["checked_in", "checked_out","checked_in_missed","user_outside_radius", "re_checked_in","checked_in_not_ok"],
      default: "checked_in",
      index: true,
    },
    alertStatus: {
      type: String,
      enum: ["pending", "sent"],
      default: "pending",
      index: true,
    },
    alertSentAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

checklistSchema.index(
  { missedResponseFor: 1 },
  {
    unique: true,
    partialFilterExpression: { missedResponseFor: { $type: "objectId" } },
  },
);

export const Checklist = mongoose.model("Checklist", checklistSchema);
