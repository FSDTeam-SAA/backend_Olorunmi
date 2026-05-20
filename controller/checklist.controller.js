import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { Checklist } from "../model/checklist.model.js";
import { User } from "../model/user.model.js";
import { Report } from "../model/report.model.js";
import { sendPushNotification } from "../utils/sendPushNotification.js";

const toRadians = (value) => (value * Math.PI) / 180;

const calculateDistanceInMeters = (lat1, lon1, lat2, lon2) => {
  const earthRadius = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
};

const getWorkDate = () => new Date().toISOString().slice(0, 10);
const parsePagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.max(Number(query.limit) || 8, 1);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

export const trackChecklist = catchAsync(async (req, res) => {
  const { latitude, longitude, option } = req.body;

  if (
    latitude === undefined ||
    longitude === undefined ||
    !option
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "latitude, longitude and option are required",
    );
  }

  const lat = Number(latitude);
  const lng = Number(longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid latitude/longitude");
  }

  const user = await User.findById(req.user._id).select("location defaultRadius");
  if (
    !user?.location ||
    user.location.latitude === undefined ||
    user.location.longitude === undefined
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "User base location is not configured",
    );
  }

  const radius = Number(user.defaultRadius || 100);
  const distance = calculateDistanceInMeters(
    lat,
    lng,
    user.location.latitude,
    user.location.longitude,
  );

  const activeChecklist = await Checklist.findOne({
    user: req.user._id,
    status: "checked_in",
  }).sort({ checkInAt: -1 });

  if (activeChecklist) {
    if (distance > radius) {
      const now = new Date();
      activeChecklist.status = "checked_out";
      activeChecklist.checkOutAt = now;
      activeChecklist.checkOutType = "auto";
      activeChecklist.checkOutLocation = { latitude: lat, longitude: lng };
      activeChecklist.autoCheckoutTrigger = {
        latitude: lat,
        longitude: lng,
        recordedAt: now,
      };
      activeChecklist.alertStatus = "pending";
      activeChecklist.alertSentAt = null;
      await activeChecklist.save();

      const user = await User.findOne({role: "admin"})

      sendPushNotification(
        [user._id],
        "Auto Checkout Alert",
        `${req.user.name} have been automatically checked out because ${req.user.name} moved outside the allowed radius.`,
      );

      return sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Auto checkout completed because user moved outside radius",
        data: {
          action: "auto_checked_out",
          distance,
          radius,
          checklist: activeChecklist,
        },
      });
    }

    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "User is still checked in and inside radius",
      data: {
        action: "already_checked_in",
        distance,
        radius,
        checklist: activeChecklist,
      },
    });
  }

  if (distance > radius) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Cannot check in because user is outside allowed radius",
    );
  }

  const workDate = getWorkDate();
  const alreadyCheckedForDate = await Checklist.findOne({
    user: req.user._id,
    workDate,
  });
  if (alreadyCheckedForDate) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "User already checked in for this date",
    );
  }

  const checklist = await Checklist.create({
    user: req.user._id,
    option,
    workDate,
    checkInLocation: { latitude: lat, longitude: lng },
  });

  return sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Checklist check-in completed",
    data: {
      action: "checked_in",
      distance,
      radius,
      checklist,
    },
  });
});

export const manualCheckoutChecklist = catchAsync(async (req, res) => {
  const { latitude, longitude } = req.body;
  const lat = latitude !== undefined ? Number(latitude) : undefined;
  const lng = longitude !== undefined ? Number(longitude) : undefined;

  if (
    (latitude !== undefined && Number.isNaN(lat)) ||
    (longitude !== undefined && Number.isNaN(lng))
  ) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid latitude/longitude");
  }

  const activeChecklist = await Checklist.findOne({
    user: req.user._id,
    status: "checked_in",
  }).sort({ checkInAt: -1 });

  if (!activeChecklist) {
    throw new AppError(httpStatus.BAD_REQUEST, "No active check-in found");
  }

  activeChecklist.status = "checked_out";
  activeChecklist.checkOutAt = new Date();
  activeChecklist.checkOutType = "manual";
  activeChecklist.alertStatus = "pending";
  activeChecklist.alertSentAt = null;
  if (lat !== undefined && lng !== undefined) {
    activeChecklist.checkOutLocation = { latitude: lat, longitude: lng };
  }

  await activeChecklist.save();

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Manual checkout completed",
    data: activeChecklist,
  });
});

export const getMyChecklists = catchAsync(async (req, res) => {
  const checklists = await Checklist.find({ user: req.user._id }).sort({
    createdAt: -1,
  });

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Checklist history fetched successfully",
    data: checklists,
  });
});

export const getAdminAlerts = catchAsync(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const searchTerm = req.query.search?.trim();

  const userFilter = {};
  if (searchTerm) {
    userFilter.$or = [
      { name: { $regex: searchTerm, $options: "i" } },
      { userId: { $regex: searchTerm, $options: "i" } },
    ];
  }

  const users = await User.find(userFilter).select("_id");
  const userIds = users.map((item) => item._id);

  const checklistFilter = {
    status: "checked_out",
    checkOutType: "auto",
  };

  if (searchTerm) {
    checklistFilter.user = { $in: userIds };
  }

  const [alerts, total] = await Promise.all([
    Checklist.find(checklistFilter)
      .populate("user", "name userId")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Checklist.countDocuments(checklistFilter),
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Alerts fetched successfully",
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

export const sendAlertForChecklist = catchAsync(async (req, res) => {
  const { id } = req.params;

  const checklist = await Checklist.findById(id).populate("user", "name userId");
  if (!checklist) {
    throw new AppError(httpStatus.NOT_FOUND, "Checklist not found");
  }

  checklist.alertStatus = "sent";
  checklist.alertSentAt = new Date();
  await checklist.save();

  await Report.create({
    user: checklist.user._id,
    reportName: "Location Alert",
    reportDescription:
      "Admin sent an alert for going out of the assigned location zone.",
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Alert sent successfully",
    data: checklist,
  });
});

export const deleteAlertForChecklist = catchAsync(async (req, res) => {
  const { id } = req.params;

  const checklist = await Checklist.findById(id);
  if (!checklist) {
    throw new AppError(httpStatus.NOT_FOUND, "Checklist not found");
  }

  await checklist.deleteOne();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Alert deleted successfully",
    data: null,
  });
});
