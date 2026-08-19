import express from "express";
import {
  createSite,
  createSiteLocation,
  deleteSite,
  deleteSiteLocation,
  getSiteById,
  getSiteLocations,
  getSites,
  updateSite,
  updateSiteLocation,
} from "../controller/site.controller.js";
import { isAdmin, protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/", protect, getSites);
router.get("/:id", protect, getSiteById);
router.post("/", protect, isAdmin, createSite);
router.patch("/:id", protect, isAdmin, updateSite);
router.delete("/:id", protect, isAdmin, deleteSite);

router.get("/:id/locations", protect, getSiteLocations);
router.post("/:id/locations", protect, isAdmin, createSiteLocation);
router.patch("/:id/locations/:locationId", protect, isAdmin, updateSiteLocation);
router.delete("/:id/locations/:locationId", protect, isAdmin, deleteSiteLocation);

export default router;
