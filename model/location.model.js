import mongoose from "mongoose";

// Flat, top-level patrol locations. There is no Site wrapper any more: every
// entry here is directly selectable in the dashboard's day-schedule dropdowns.
// Names are unique because saved user schedule rows reference a location by
// name (`weeklyLocations.<day>.locationName`), not by id.
const locationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
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

export const Location = mongoose.model("Location", locationSchema);
