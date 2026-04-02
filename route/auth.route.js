import express from "express";
import {
  changePassword,
  forgetPassword,
  login,
  logout,
  refreshToken,
  register,
  resetPassword,
  verifyEmail,
  verifyOTP,
} from "../controller/auth.controller.js";
import { isAdmin, protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/register", protect, isAdmin, register);
router.post("/login", login);
router.post("/verify", verifyEmail);
router.post("/forget", forgetPassword);
router.post("/forgot-password", forgetPassword);
router.post("/verify-otp", verifyOTP);
router.post("/reset-password", resetPassword);
router.post("/change-password", protect, changePassword);
router.post("/refresh-token", refreshToken);
router.post("/logout", protect, logout);

export default router;
