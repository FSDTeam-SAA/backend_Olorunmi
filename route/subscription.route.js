import express from "express";
import {
  createSubscription,
  deleteSubscription,
  getSubscriptionById,
  getSubscriptions,
  updateSubscription,
} from "../controller/subscription.controller.js";
import { isAdmin, protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/", getSubscriptions);
router.get("/:id", getSubscriptionById);
router.post("/", protect, isAdmin, createSubscription);
router.patch("/:id", protect, isAdmin, updateSubscription);
router.delete("/:id", protect, isAdmin, deleteSubscription);

export default router;