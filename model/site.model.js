import mongoose from "mongoose";

const siteLocationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    latitude: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
    longitude: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },
  },
  { timestamps: true }
);

const siteSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    locations: {
      type: [siteLocationSchema],
      default: [],
    },
  },
  { timestamps: true }
);

export const Site = mongoose.model("Site", siteSchema);
