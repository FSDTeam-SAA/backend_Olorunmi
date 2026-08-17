import mongoose from "mongoose";

const sosSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    location: {
      latitude: { type: Number },
      longitude: { type: Number },
    },
    status: {
      type: String,
      enum: ["pending", "acknowledged"],
      default: "pending",
      index: true,
    },
    triggeredAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    acknowledgedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    acknowledgedAt: {
      type: Date,
      default: null,
    },
    workDate: {
      type: String,
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
  },
  { timestamps: true },
);

// A user can only ever hold one pending SOS alert at a time.
sosSchema.index(
  { user: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending" },
  },
);

export const Sos = mongoose.model("Sos", sosSchema);
