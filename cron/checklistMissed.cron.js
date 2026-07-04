import { Checklist } from "../model/checklist.model.js";
import { User } from "../model/user.model.js";
import { sendPushNotification } from "../utils/sendPushNotification.js";

const RESPONSE_INTERVAL_MS = 97 * 60 * 1000;
const CRON_INTERVAL_MS = Number(process.env.CHECKLIST_MISSED_CRON_MS) ||  30*1000;

const getDueMissedTimes = (fromDate, now) => {
  const dueTimes = [];
  let nextDueAt = new Date(fromDate.getTime() + RESPONSE_INTERVAL_MS);

  while (nextDueAt <= now) {
    dueTimes.push(nextDueAt);
    nextDueAt = new Date(nextDueAt.getTime() + RESPONSE_INTERVAL_MS);
  }

  return dueTimes;
};

const getLatestKnownLocation = (checklist) => {
  const location = typeof checklist.checkOutLocation?.latitude === "number"
    ? checklist.checkOutLocation
    : checklist.checkInLocation;

  if (
    typeof location?.latitude === "number" &&
    typeof location?.longitude === "number"
  ) {
    return {
      latitude: location.latitude,
      longitude: location.longitude,
    };
  }

  return undefined;
};

export const markMissedChecklists = async (now = new Date()) => {
  const cutoff = new Date(now.getTime() - RESPONSE_INTERVAL_MS);

  const activeCheckIns = await Checklist.find({
    status: { $in: ["checked_in", "re_checked_in", "checked_in_not_ok"] },
    createdAt: { $lte: cutoff },
  })
    .populate("user", "name")
    .sort({ createdAt: -1 });

  console.log(`Found ${activeCheckIns.length} active check-ins that may have missed response.`);

  const admins = await User.find({ role: "admin" }).select("_id");
  const adminIds = admins.map((admin) => admin._id);

  let createdCount = 0;
  const processedUsers = new Set();

  for (const activeCheckIn of activeCheckIns) {
    if (!activeCheckIn.user?._id) {
      continue;
    }

    const userId = activeCheckIn.user._id.toString();
    if (processedUsers.has(userId)) {
      continue;
    }
    processedUsers.add(userId);

    const workDate = activeCheckIn.workDate;

    const checkoutAfterCheckIn = await Checklist.findOne({
      user: activeCheckIn.user._id,
      workDate,
      status: "checked_out",
      createdAt: { $gt: activeCheckIn.createdAt },
    });

    if (checkoutAfterCheckIn) {
      continue;
    }

    const latestProgressChecklist = await Checklist.findOne({
      user: activeCheckIn.user._id,
      workDate,
      status: { $in: ["checked_in", "re_checked_in", "checked_in_not_ok"] },
      createdAt: { $gte: activeCheckIn.createdAt },
    }).sort({ createdAt: -1 });

    if (!latestProgressChecklist || latestProgressChecklist.createdAt > cutoff) {
      continue;
    }

    const dueMissedTimes = getDueMissedTimes(latestProgressChecklist.createdAt, now);
    if (!dueMissedTimes.length) {
      continue;
    }

    const checkOutLocation = getLatestKnownLocation(latestProgressChecklist);
    const missedChecklistPayloads = dueMissedTimes.map((dueAt) => ({
      user: activeCheckIn.user._id,
      status: "checked_in_missed",
      workDate,
      option: "checked_in_missed",
      checkInAt: dueAt,
      ...(checkOutLocation ? { checkOutLocation } : {}),
      alertStatus: "pending",
      alertSentAt: null,
      createdAt: dueAt,
      updatedAt: dueAt,
    }));

    const missedChecklists = await Checklist.insertMany(missedChecklistPayloads, {
      timestamps: false,
    });

    createdCount += missedChecklists.length;

    if (adminIds.length) {
      await sendPushNotification(
        adminIds,
        "Check In Missed Alert",
        `${activeCheckIn.user.name || "A user"} missed ${missedChecklists.length} check-in prompt(s).`,
      );
    }

    console.log(
      `Created ${missedChecklists.length} missed checklist record(s) for user ${activeCheckIn.user._id}`,
    );
  }

  return createdCount;
};

export const startChecklistMissedCron = () => {
  let isRunning = false;

  const run = async () => {
    if (isRunning) {
      return;
    }

    isRunning = true;
    try {
      console.log("Running checklist missed cron...");
      const createdCount = await markMissedChecklists();
      if (createdCount) {
        console.log(`Checklist missed cron created ${createdCount} record(s).`);
      }
    } catch (error) {
      console.error("Checklist missed cron failed:", error);
    } finally {
      isRunning = false;
    }
  };

  run();
  return setInterval(run, CRON_INTERVAL_MS);
};
