import httpStatus from "http-status";
import mongoose from "mongoose";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { Sos } from "../model/sos.model.js";
import { getRequestDateContext } from "../utils/dateTime.js";
import {
  notifyAdmins,
  sendPushNotification,
} from "../utils/sendPushNotification.js";
import { emitToAlerts } from "../utils/socket.js";

const USER_FIELDS = "name userId avatar site phone";

const parsePagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.max(Number(query.limit) || 8, 1);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const parseCoordinate = (value, fieldName) => {
  if (value === undefined || value === null || value === "") return undefined;

  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) {
    throw new AppError(httpStatus.BAD_REQUEST, `Invalid ${fieldName}`);
  }
  return numericValue;
};

const getLocationFromRequest = (body = {}) => {
  const latitude = parseCoordinate(
    body.latitude ?? body.lat ?? body.location?.latitude,
    "latitude",
  );
  const longitude = parseCoordinate(
    body.longitude ?? body.lng ?? body.location?.longitude,
    "longitude",
  );

  if (latitude === undefined || longitude === undefined) return undefined;
  return { latitude, longitude };
};

const getSosLocalFields = (dateContext) => {
  const fields = {};
  if (dateContext.timezone) fields.timezone = dateContext.timezone;
  if (dateContext.localDateTime) {
    fields.localDateTime = dateContext.localDateTime;
  }
  if (dateContext.localTime) fields.localTime = dateContext.localTime;
  return fields;
};

const formatLocationLabel = (location) => {
  if (
    typeof location?.latitude !== "number" ||
    typeof location?.longitude !== "number"
  ) {
    return "location unavailable";
  }
  return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
};

const buildSosNotificationPayload = (sos, user) => ({
  type: "sos",
  sosId: sos._id.toString(),
  userId: user._id.toString(),
  userName: user.name || user.username || user.userId || "A user",
  userCode: user.userId || "",
  latitude: sos.location?.latitude,
  longitude: sos.location?.longitude,
  triggeredAt: sos.triggeredAt?.toISOString(),
  localTime: sos.localTime || "",
  timezone: sos.timezone || "",
});

/**
 * POST /sos/trigger
 * Creates an SOS alert for the logged-in user. When the user already has an
 * unacknowledged alert, the existing one is returned instead of a duplicate.
 */
export const triggerSos = catchAsync(async (req, res) => {
  const user = req.user;

  const existingPending = await Sos.findOne({
    user: user._id,
    status: "pending",
  });

  if (existingPending) {
    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "SOS alert already sent — awaiting response",
      data: {
        sos: existingPending,
        alreadyPending: true,
      },
    });
  }

  const dateContext = getRequestDateContext(req);
  const location = getLocationFromRequest(req.body);

  let sos;
  try {
    sos = await Sos.create({
      user: user._id,
      location,
      status: "pending",
      triggeredAt: dateContext.now,
      workDate: dateContext.workDate,
      ...getSosLocalFields(dateContext),
    });
  } catch (error) {
    // The partial unique index rejects a second pending alert for the same
    // user, which can happen when two triggers race each other.
    if (error?.code === 11000) {
      const pending = await Sos.findOne({ user: user._id, status: "pending" });
      return sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "SOS alert already sent — awaiting response",
        data: { sos: pending, alreadyPending: true },
      });
    }
    throw error;
  }

  const notificationPayload = buildSosNotificationPayload(sos, user);
  const userLabel = notificationPayload.userName;
  const notificationBody = `${userLabel} triggered an SOS at ${
    sos.localTime || sos.triggeredAt.toISOString()
  } (${formatLocationLabel(sos.location)}).`;

  await notifyAdmins("SOS Emergency Alert", notificationBody, notificationPayload);

  emitToAlerts("sos:new", {
    ...notificationPayload,
    message: notificationBody,
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "SOS alert sent successfully",
    data: {
      sos,
      alreadyPending: false,
    },
  });
});

/**
 * GET /sos/status
 * Reports whether the logged-in user currently holds an unacknowledged SOS.
 */
export const getMySosStatus = catchAsync(async (req, res) => {
  const pendingSos = await Sos.findOne({
    user: req.user._id,
    status: "pending",
  });

  const latestSos = pendingSos
    ? null
    : await Sos.findOne({ user: req.user._id }).sort({ triggeredAt: -1 });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "SOS status fetched successfully",
    data: {
      hasPendingSos: Boolean(pendingSos),
      sos: pendingSos,
      lastSos: latestSos,
    },
  });
});

/**
 * GET /sos (admin)
 * Lists SOS alerts, newest first. Defaults to the pending ones.
 *
 * Query params:
 *  - status: "pending" | "acknowledged" | "all" (omitted => pending)
 *  - user / userId: restrict to one guard ("all" is treated as no filter)
 *  - page, limit
 */
export const getSosAlerts = catchAsync(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const requestedStatus = req.query.status?.toString().trim().toLowerCase();

  const filter = {};
  if (requestedStatus && requestedStatus !== "all") {
    if (!["pending", "acknowledged"].includes(requestedStatus)) {
      throw new AppError(httpStatus.BAD_REQUEST, "Invalid status filter");
    }
    filter.status = requestedStatus;
  } else if (!requestedStatus) {
    filter.status = "pending";
  }

  const requestedUser = (req.query.user ?? req.query.userId)
    ?.toString()
    .trim();
  if (requestedUser && requestedUser !== "all") {
    if (!mongoose.Types.ObjectId.isValid(requestedUser)) {
      throw new AppError(httpStatus.BAD_REQUEST, "Invalid user filter");
    }
    filter.user = requestedUser;
  }

  const [alerts, total] = await Promise.all([
    Sos.find(filter)
      .sort({ triggeredAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", USER_FIELDS)
      .populate("acknowledgedBy", "name userId"),
    Sos.countDocuments(filter),
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "SOS alerts fetched successfully",
    data: {
      alerts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    },
  });
});

/**
 * POST /sos/:id/acknowledge (admin)
 * Marks the alert as handled, which unlocks the user's SOS screen.
 */
export const acknowledgeSos = catchAsync(async (req, res) => {
  const { id } = req.params;

  const sos = await Sos.findById(id).populate("user", USER_FIELDS);
  if (!sos) {
    throw new AppError(httpStatus.NOT_FOUND, "SOS alert not found");
  }

  if (sos.status === "acknowledged") {
    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "SOS alert was already acknowledged",
      data: sos,
    });
  }

  const dateContext = getRequestDateContext(req);

  sos.status = "acknowledged";
  sos.acknowledgedBy = req.user._id;
  sos.acknowledgedAt = dateContext.now;
  await sos.save();
  await sos.populate("acknowledgedBy", "name userId");

  const acknowledgedPayload = {
    type: "sos_acknowledged",
    sosId: sos._id.toString(),
    userId: sos.user?._id?.toString() ?? "",
    acknowledgedBy: req.user.name || req.user.userId || "Admin",
    acknowledgedAt: sos.acknowledgedAt?.toISOString(),
  };

  // Tells the guard's app that help is aware, and unlocks a new SOS trigger.
  if (sos.user?._id) {
    await sendPushNotification(
      [sos.user._id],
      "SOS Acknowledged",
      // `${acknowledgedPayload.acknowledgedBy} has acknowledged your SOS alert.`,
      `Admin has acknowledged your SOS alert.`,
      acknowledgedPayload,
    );
  }

  emitToAlerts("sos:acknowledged", acknowledgedPayload);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "SOS alert acknowledged successfully",
    data: sos,
  });
});
