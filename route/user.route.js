import express from "express";
import {
  createUserByAdmin,
  getProfile,
  getUserDetailsForAdmin,
  getUsersForAdmin,
  updateProfile,
  changePassword,
  deleteOwnAccount,
  updateUserByAdmin,
  deleteUserByAdmin,
} from "../controller/user.controller.js";
import { isAdmin, protect } from "../middleware/auth.middleware.js";
import upload from "../middleware/multer.middleware.js";
import { createFCM } from "../controller/fcm.controller.js";

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
router.get("/admin/list", protect, isAdmin, getUsersForAdmin);
router.get("/admin/list/:id", protect, isAdmin, getUserDetailsForAdmin);
router.patch(
  "/admin/list/:id",
  protect,
  isAdmin,
  upload.single("profilePhoto"),
  updateUserByAdmin
);
router.delete("/admin/list/:id", protect, isAdmin, deleteUserByAdmin);

router.post("/update-fcm-token", protect,
  createFCM
);

export default router;
