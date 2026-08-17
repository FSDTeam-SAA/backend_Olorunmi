// import { FCM } from "../module/fcm/fcm.model.js";
import { FCM } from "../model/fcm.model.js";
import { User } from "../model/user.model.js";
import admin from "./firebase.js";
// import User from "../models/User";

// FCM only accepts string values inside the data payload.
const toStringDataPayload = (data) =>
  Object.entries(data).reduce((payload, [key, value]) => {
    if (value === undefined || value === null) return payload;
    payload[key] = String(value);
    return payload;
  }, {});

export const sendPushNotification = async (
  userIds,
  title,
  body,
  data
) => {
  try {
    // Get users with FCM tokens
    // const users = await User.find({
    //   _id: { $in: userIds },
    //   fcmToken: { $exists: true, $ne: null },
    // }).select("fcmToken");
    const users = await FCM.find({
      user: { $in: userIds },
      fcmToken: { $exists: true, $ne: null },
    }).select("fcmToken");
    console.log(users)

    console.log(`Found ${users} users with FCM tokens for notification.`);

    const tokens = users
      .map((u) => u.fcmToken)
      .filter((token) => typeof token === 'string' && token.length > 0);

    if (!tokens.length) return;

    const message = {
      notification: {
        title,
        body,
      },
      android: {
        priority: "high",
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
      tokens,
    };

    if (data && Object.keys(data).length) {
      message.data = toStringDataPayload(data);
    }

    const response = await admin.messaging().sendEachForMulticast(message);

    console.log("Push sent:", response.successCount);
  } catch (error) {
    console.error("FCM Error:", error);
  }
};

/**
 * Sends a push notification to every admin account.
 */
export const notifyAdmins = async (title, message, data) => {
  const admins = await User.find({ role: "admin" }).select("_id");
  const adminIds = admins.map((adminUser) => adminUser._id);
  if (!adminIds.length) return;
  await sendPushNotification(adminIds, title, message, data);
};