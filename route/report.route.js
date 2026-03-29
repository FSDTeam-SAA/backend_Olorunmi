import express from "express";
import {
  createReport,
  getAllReports,
  getMyReports,
} from "../controller/report.controller.js";
import { isAdmin, protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/", protect, createReport);
router.get("/me", protect, getMyReports);
router.get("/", protect, isAdmin, getAllReports);

export default router;
