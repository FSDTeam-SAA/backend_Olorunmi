import { FCM } from "../model/fcm.model.js";
import catchAsync from "../utils/catchAsync.js";


export const createFCM = catchAsync( async (req, res) => {
    const { fcmToken, user } = req.body;
    const existingFCM = await FCM.findOne({ user, fcmToken });
    if (existingFCM) {
      return res.status(200).json({
        success: true,
        message: "FCM token already exists",
        data: existingFCM,
      });
    }
    const fcm = new FCM({ fcmToken, user });
    await fcm.save();
    res.status(201).json({
      success: true,
      message: "FCM token created successfully",
      data: fcm,
    });

  })