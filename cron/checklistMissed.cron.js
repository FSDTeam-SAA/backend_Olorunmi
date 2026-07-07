import { Checklist } from "../model/checklist.model.js";
import { User } from "../model/user.model.js";
import { addDailyReportEntries } from "../controller/report.controller.js";
import { sendPushNotification } from "../utils/sendPushNotification.js";

const RESPONSE_INTERVAL_MS = 97 * 60 * 1000;
const CRON_INTERVAL_MS = Number(process.env.CHECKLIST_MISSED_CRON_MS) ||  30*1000;

const pad = (value, length = 2) => String(value).padStart(length, "0");

const parseShortOffset = (value = "") => {
  const normalizedValue = value.replace("UTC", "GMT");
  if (normalizedValue === "GMT") {
    return "+00:00";
  }

  const match = normalizedValue.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) {
    return undefined;
  }

  return `${match[1]}${pad(match[2])}:${pad(match[3] || 0)}`;
};

const getLocalDateTimeFields = (date, timezone) => {
  if (!timezone) return {};

  try {
    const dateTimeParts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      hourCycle: "h23",
      timeZoneName: "shortOffset",
    }).formatToParts(date);
    const displayTimeParts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(date);
    const dateTimeValues = Object.fromEntries(
      dateTimeParts.map((part) => [part.type, part.value]),
    );
    const displayTimeValues = Object.fromEntries(
      displayTimeParts.map((part) => [part.type, part.value]),
    );
    const offset = parseShortOffset(dateTimeValues.timeZoneName);

    return {
      localDateTime: [
        `${dateTimeValues.year}-${dateTimeValues.month}-${dateTimeValues.day}`,
        "T",
        `${dateTimeValues.hour}:${dateTimeValues.minute}:${dateTimeValues.second}`,
        `.${pad(date.getUTCMilliseconds(), 3)}`,
        offset || "",
      ].join(""),
      localTime: `${displayTimeValues.hour}:${displayTimeValues.minute} ${displayTimeValues.dayPeriod}`,
    };
  } catch {
    return {};
  }
};

const getChecklistLocalFields = (checklist, eventAt) => {
  const fields = {};
  if (checklist.timezone) fields.timezone = checklist.timezone;
  Object.assign(fields, getLocalDateTimeFields(eventAt, checklist.timezone));
  return fields;
};

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
  const localFields = getChecklistLocalFields(activeCheckIn, dueAt);
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
        ...localFields,
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
  return { checklist, created };
};

export const markMissedChecklists = async (now = new Date()) => {
  const cutoff = new Date(now.getTime() - RESPONSE_INTERVAL_MS);

  const activeCheckIns = await Checklist.find({
    status: { $in: ["checked_in", "re_checked_in", "checked_in_not_ok"] },
    createdAt: { $lte: cutoff },
  })
    .populate("user", "name")
    .sort({ createdAt: -1 });

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
    }).sort({ createdAt: -1 });

    if (
      !latestProgressChecklist ||
      latestProgressChecklist._id.toString() !== activeCheckIn._id.toString()
    ) {
      continue;
    }

    const dueAt = new Date(
      activeCheckIn.createdAt.getTime() + RESPONSE_INTERVAL_MS,
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
