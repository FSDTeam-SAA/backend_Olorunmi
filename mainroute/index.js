import express from "express";

import authRoute from "../route/auth.route.js";
import userRoute from "../route/user.route.js";
import subscriptionRoute from "../route/subscription.route.js";
import checklistRoute from "../route/checklist.route.js";
import reportRoute from "../route/report.route.js";
import sosRoute from "../route/sos.route.js";
import siteRoute from "../route/site.route.js";

const router = express.Router();

router.use("/auth", authRoute);
router.use("/user", userRoute);
router.use("/subscription", subscriptionRoute);
router.use("/checklist", checklistRoute);
router.use("/report", reportRoute);
router.use("/sos", sosRoute);
router.use("/site", siteRoute);

export default router;
