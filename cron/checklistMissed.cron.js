import { Checklist } from "../model/checklist.model.js";
import { User } from "../model/user.model.js";
import { addDailyReportEntries } from "../controller/report.controller.js";
import { sendPushNotification } from "../utils/sendPushNotification.js";

const RECHECK_INTERVAL_MS = 90 * 60 * 1000;
const MISSED_RESPONSE_GRACE_MS = 5 * 60 * 1000;
const MISSED_RESPONSE_DUE_MS = RECHECK_INTERVAL_MS + MISSED_RESPONSE_GRACE_MS;
const CRON_INTERVAL_MS =
  Number(process.env.CHECKLIST_MISSED_CRON_MS) || 30 * 1000;
const ACTIVE_RESPONSE_STATUSES = [
  "checked_in",
  "re_checked_in",
  "checked_in_not_ok",
];

const getWorkDate = (date = new Date()) => date.toISOString().slice(0, 10);

const getLatestKnownLocation = (checklist) => {
  const location =
    typeof checklist.checkOutLocation?.latitude === "number"
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

const notifyAdmins = async (title, message) => {
  const admins = await User.find({ role: "admin" }).select("_id");
  const adminIds = admins.map((admin) => admin._id);
  if (!adminIds.length) return;
  await sendPushNotification(adminIds, title, message);
};

const createMissedChecklist = async ({ activeCheckIn, dueAt, workDate }) => {
  const checkOutLocation = getLatestKnownLocation(activeCheckIn);
  const result = await Checklist.findOneAndUpdate(
    { missedResponseFor: activeCheckIn._id },
    {
      $setOnInsert: {
        user: activeCheckIn.user._id,
        status: "checked_in_missed",
        workDate,
        option: "checked_in_missed",
        checkInAt: dueAt,
        missedResponseFor: activeCheckIn._id,
        ...(checkOutLocation ? { checkOutLocation } : {}),
        alertStatus: "pending",
        alertSentAt: null,
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
      includeResultMetadata: true,
    },
  );

  const checklist = result.value;
  const created = result.lastErrorObject?.updatedExisting === false;
  if (result.lastErrorObject?.updatedExisting) {
    return { checklist, created: false };
  }

  await notifyAdmins(
    "Check In Missed Alert",
    `${activeCheckIn.user.name || "A user"} missed the check-in prompt.`,
  );
  await addDailyReportEntries({
    user: activeCheckIn.user._id,
    date: workDate,
    entries: [
      {
        description: "User missed the check-in prompt.",
      },
    ],
  });

  return { checklist, created };
};

export const markMissedChecklists = async (now = new Date()) => {
  const workDate = getWorkDate(now);
  const cutoff = new Date(now.getTime() - MISSED_RESPONSE_DUE_MS);

  const dueResponses = await Checklist.find({
    workDate,
    status: { $in: ACTIVE_RESPONSE_STATUSES },
    createdAt: { $lte: cutoff },
  })
    .populate("user", "name")
    .sort({ createdAt: -1 });

  let createdCount = 0;
  const processedUsers = new Set();

  for (const activeCheckIn of dueResponses) {
    if (!activeCheckIn.user?._id) {
      continue;
    }

    const userId = activeCheckIn.user._id.toString();
    if (processedUsers.has(userId)) {
      continue;
    }
    processedUsers.add(userId);

    const latestChecklist = await Checklist.findOne({
      user: activeCheckIn.user._id,
      workDate,
    }).sort({ createdAt: -1 });

    if (
      !latestChecklist ||
      latestChecklist._id.toString() !== activeCheckIn._id.toString()
    ) {
      continue;
    }

    const dueAt = new Date(
      activeCheckIn.createdAt.getTime() + MISSED_RESPONSE_DUE_MS,
    );
    if (dueAt > now) {
      continue;
    }

    const { created } = await createMissedChecklist({
      activeCheckIn,
      dueAt,
      workDate,
    });
    if (!created) {
      continue;
    }

    createdCount += 1;

    console.log(
      `Created one missed checklist record for user ${activeCheckIn.user._id}`,
    );
  }

  return createdCount;
};

export const startChecklistMissedCron = () => {
  if (process.env.DISABLE_CHECKLIST_MISSED_CRON === "true") {
    console.log("Checklist missed cron disabled by environment.");
    return null;
  }

  let isRunning = false;

  const run = async () => {
    if (isRunning) {
      return;
    }

    isRunning = true;
    try {
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
