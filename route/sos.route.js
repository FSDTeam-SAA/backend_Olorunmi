import express from "express";
import {
  acknowledgeSos,
  getMySosStatus,
  getSosAlerts,
  triggerSos,
} from "../controller/sos.controller.js";
import { isAdmin, protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/trigger", protect, triggerSos);
router.get("/status", protect, getMySosStatus);
router.get("/", protect, isAdmin, getSosAlerts);
router.post("/:id/acknowledge", protect, isAdmin, acknowledgeSos);

export default router;
