import express from "express";
import {
  getMyChecklists,
  manualCheckoutChecklist,
  trackChecklist,
} from "../controller/checklist.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/track", protect, trackChecklist);
router.post("/checkout", protect, manualCheckoutChecklist);
router.get("/me", protect, getMyChecklists);

export default router;
