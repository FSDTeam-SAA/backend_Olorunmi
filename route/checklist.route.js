import express from "express";
import {
  deleteAlertForChecklist,
  getAdminAlerts,
  getMyChecklists,
  manualCheckoutChecklist,
  sendAlertForChecklist,
  trackChecklist,
} from "../controller/checklist.controller.js";
import { isAdmin, protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/track", protect, trackChecklist);
router.post("/checkout", protect, manualCheckoutChecklist);
router.get("/me", protect, getMyChecklists);
router.get("/admin/alerts", protect, isAdmin, getAdminAlerts);
router.post("/admin/alerts/:id/send", protect, isAdmin, sendAlertForChecklist);
router.delete("/admin/alerts/:id", protect, isAdmin, deleteAlertForChecklist);

export default router;
