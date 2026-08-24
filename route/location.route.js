import express from "express";
import {
  createLocation,
  deleteLocation,
  getLocationById,
  getLocations,
  updateLocation,
} from "../controller/location.controller.js";
import { isAdmin, protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/", protect, getLocations);
router.get("/:id", protect, getLocationById);
router.post("/", protect, isAdmin, createLocation);
router.patch("/:id", protect, isAdmin, updateLocation);
router.delete("/:id", protect, isAdmin, deleteLocation);

export default router;
