import mongoose from "mongoose";

const reportImageSchema = new mongoose.Schema(
  {
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    path: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    mimeType: {
      type: String,
      required: true,
      trim: true,
    },
    size: {
      type: Number,
      required: true,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
);

const reportEntrySchema = new mongoose.Schema(
  {
    time: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    systemEntryType: {
      type: String,
      enum: ["first_booked_in", "last_booked_off", null],
      default: null,
      index: true,
    },
    images: {
      type: [reportImageSchema],
      default: [],
    },
  },
  { timestamps: true },
);

const reportSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reportDate: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    day: {
      type: String,
      required: true,
      trim: true,
    },
    site: {
      type: String,
      trim: true,
      default: "",
    },
    onShift: {
      type: String,
      trim: true,
      default: "",
    },
    offShift: {
      type: String,
      trim: true,
      default: "",
    },
    security: {
      type: String,
      trim: true,
      default: "",
    },
    entries: {
      type: [reportEntrySchema],
      default: [],
    },
    reportName: {
      type: String,
      trim: true,
      select: false,
    },
    reportDescription: {
      type: String,
      trim: true,
      select: false,
    },
  },
  { timestamps: true },
);

reportSchema.index(
  { user: 1, reportDate: 1 },
  {
    unique: true,
    partialFilterExpression: { reportDate: { $type: "string" } },
  },
);

export const Report = mongoose.model("Report", reportSchema);
