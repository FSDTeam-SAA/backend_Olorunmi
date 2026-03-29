import mongoose from "mongoose";

const reportSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reportName: {
      type: String,
      required: true,
      trim: true,
    },
    reportDescription: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true },
);

export const Report = mongoose.model("Report", reportSchema);
