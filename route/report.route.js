import express from "express";
import {
  createReport,
  deleteReportEntry,
  deleteReportEntryByDate,
  getAllReports,
  getMyReports,
  updateReport,
  updateReportByDate,
} from "../controller/report.controller.js";
import { isAdmin, protect } from "../middleware/auth.middleware.js";
import upload from "../middleware/multer.middleware.js";

const router = express.Router();

router.post("/", protect, upload.array("images", 10), createReport);
router.patch(
  "/date/:reportDate",
  protect,
  upload.array("images", 10),
  updateReportByDate,
);
router.patch("/:id", protect, upload.array("images", 10), updateReport);
router.delete(
  "/date/:reportDate/entries/:entryId",
  protect,
  deleteReportEntryByDate,
);
router.delete("/:id/entries/:entryId", protect, deleteReportEntry);
router.get("/me", protect, getMyReports);
router.get("/", protect, isAdmin, getAllReports);

export default router;
