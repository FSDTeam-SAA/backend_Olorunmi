import express from "express";
import {
  createReport,
  deleteReportEntry,
  deleteReportEntryByDate,
  getAllReports,
  getReportImage,
  getMyReports,
  updateReport,
  updateReportByDate,
} from "../controller/report.controller.js";
import { isAdmin, protect } from "../middleware/auth.middleware.js";
import { sendReportPdfEmail } from "../controller/reportEmail.controller.js";
import upload from "../middleware/multer.middleware.js";

const router = express.Router();


router.post(
  "/send-pdf",
  protect,
  upload.fields([
    { name: "pdf", maxCount: 1 },
    { name: "file", maxCount: 1 },
    { name: "reportPdf", maxCount: 1 },
  ]),
  sendReportPdfEmail,
);
router.get("/image/:fileName", getReportImage);
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
