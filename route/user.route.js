import express from "express";
import {
  getProfile,
  updateProfile,
  changePassword,
  deleteOwnAccount,
  createUserByAdmin,
} from "../controller/user.controller.js";
import { isAdmin, protect } from "../middleware/auth.middleware.js";
import upload from "../middleware/multer.middleware.js";

const router = express.Router();

router.get("/profile", protect, getProfile);
router.patch(
  "/update-profile",
  protect,
  upload.single("avatar"),
  updateProfile
);
router.post("/change-password", protect, changePassword);
router.delete("/delete-account", protect, deleteOwnAccount);
router.post(
  "/create",
  protect,
  isAdmin,
  upload.single("profilePhoto"),
  createUserByAdmin
);

export default router;
