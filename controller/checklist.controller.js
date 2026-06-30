import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { Checklist } from "../model/checklist.model.js";
import { User } from "../model/user.model.js";
import { addDailyReportEntries } from "./report.controller.js";
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
const RECHECK_INTERVAL_MS = 90 * 60 * 1000;
const MISSED_RESPONSE_GRACE_MS = 5 * 60 * 1000;
const MISSED_RESPONSE_DUE_MS = RECHECK_INTERVAL_MS + MISSED_RESPONSE_GRACE_MS;
const parsePagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.max(Number(query.limit) || 8, 1);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const notOkOptions = new Set(["no", "no_ok"]);
const missedOptions = new Set(["checked_in_missed", "missed"]);
const activeChecklistStatuses = [
  "checked_in",
  "re_checked_in",
  "checked_in_not_ok",
  "checked_in_missed",
  "user_outside_radius",
];

const notifyAdmins = async (title, message) => {
  const admins = await User.find({ role: "admin" }).select("_id");
  const adminIds = admins.map((admin) => admin._id);
  if (!adminIds.length) return;
  await sendPushNotification(adminIds, title, message);
};

const createOutsideRadiusRecord = async ({
  userId,
  userName,
  workDate,
  lat,
  lng,
  distance,
  radius,
}) => {
  const now = new Date();
  const checklist = await Checklist.create({
    user: userId,
    status: "user_outside_radius",
    checkOutAt: now,
    option: "outside radius",
    workDate,
    checkOutLocation: { latitude: lat, longitude: lng },
    autoCheckoutTrigger: {
      latitude: lat,
      longitude: lng,
      recordedAt: now,
    },
    alertStatus: "pending",
    alertSentAt: null,
  });

  await notifyAdmins(
    "Auto Checkout Alert",
    `${userName} have been automatically checked out because ${userName} moved outside the allowed radius.`,
  );

  return {
    action: "auto_checked_out",
    distance,
    radius,
    checklist,
  };
};

const createMissedRecord = async ({
  userId,
  userName,
  workDate,
  lat,
  lng,
  sourceChecklist,
}) => {
  const missedResponseFor = sourceChecklist?._id;
  if (!missedResponseFor) {
    return Checklist.findOne({
      user: userId,
      workDate,
      status: "checked_in_missed",
    }).sort({ createdAt: -1 });
  }

  const result = await Checklist.findOneAndUpdate(
    { missedResponseFor },
    {
      $setOnInsert: {
        user: userId,
        status: "checked_in_missed",
        workDate,
        checkOutLocation: { latitude: lat, longitude: lng },
        option: "checked_in_missed",
        missedResponseFor,
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
  if (result.lastErrorObject?.updatedExisting) {
    return checklist;
  }

  await notifyAdmins(
    "Check In Missed Alert",
    `${userName} missed the check-in prompt.`,
  );
  await addDailyReportEntries({
    user: userId,
    date: workDate,
    entries: [
      {
        description: "User missed the check-in prompt.",
      },
    ],
  });

  return checklist;
};

const createNotOkRecord = async ({ userId, userName, workDate, lat, lng }) => {
  const checklist = await Checklist.create({
    user: userId,
    status: "checked_in_not_ok",
    workDate,
    checkOutLocation: { latitude: lat, longitude: lng },
    option: "checked_in_not_ok",
    alertStatus: "pending",
    alertSentAt: null,
  });

  await notifyAdmins(
    "Check In Not OK Alert",
    `${userName} have been marked as not OK`,
  );
  await addDailyReportEntries({
    user: userId,
    date: workDate,
    entries: [
      {
        description: "Check-in marked as not OK due to user response.",
      },
    ],
  });

  return checklist;
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
  const normalizedOption = option.toString().trim().toLowerCase();

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
  const workDate = getWorkDate();
  const latestChecklist = await Checklist.findOne({
    user: req.user._id,
    workDate,
  }).sort({ createdAt: -1 });

  const activeChecklist =
    latestChecklist && latestChecklist.status !== "checked_out"
      ? latestChecklist
      : null;

  if (activeChecklist) {
    if (normalizedOption === "site_visit") {
      if (distance > radius) {
        const outsideRadiusData = await createOutsideRadiusRecord({
          userId: req.user._id,
          userName: req.user.name,
          workDate,
          lat,
          lng,
          distance,
          radius,
        });

        return sendResponse(res, {
          statusCode: httpStatus.OK,
          success: true,
          message: "Auto checkout completed because user moved outside radius",
          data: outsideRadiusData,
        });
      }

      return sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Tracking synced",
        data: {
          action: "tracking_synced",
          distance,
          radius,
          checklist: activeChecklist,
        },
      });
    }

    if (normalizedOption === "yes") {
      const checklist = await Checklist.create({
        user: req.user._id,
        option: normalizedOption,
        status: "re_checked_in",
        workDate,
        checkInLocation: { latitude: lat, longitude: lng },
      });

      return sendResponse(res, {
        statusCode: httpStatus.CREATED,
        success: true,
        message: "Checklist recheck completed",
        data: {
          action: "re_checked_in",
          distance,
          radius,
          checklist,
        },
      });
    }

    if (notOkOptions.has(normalizedOption)) {
      const checklist = await createNotOkRecord({
        userId: req.user._id,
        userName: req.user.name,
        workDate,
        lat,
        lng,
      });

      return sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Check-in marked as not OK due to user response.",
        data: {
          action: "Check-in not OK",
          distance,
          radius,
          checklist,
        },
      });
    }

    if (missedOptions.has(normalizedOption)) {
      if (activeChecklist.status === "checked_in_missed") {
        return sendResponse(res, {
          statusCode: httpStatus.OK,
          success: true,
          message: "Check-in missed because user did not respond",
          data: {
            action: "Check-in missed",
            distance,
            radius,
            checklist: activeChecklist,
          },
        });
      }
      const missedDueAt = new Date(
        activeChecklist.createdAt.getTime() + MISSED_RESPONSE_DUE_MS,
      );
      if (missedDueAt > new Date()) {
        return sendResponse(res, {
          statusCode: httpStatus.OK,
          success: true,
          message: "Missed response is not due",
          data: {
            action: "missed_not_due",
            distance,
            radius,
            checklist: activeChecklist,
          },
        });
      }

      const checklist = await createMissedRecord({
        userId: req.user._id,
        userName: req.user.name,
        workDate,
        lat,
        lng,
        sourceChecklist: activeChecklist,
      });

      return sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Check-in missed because user did not respond",
        data: {
          action: "Check-in missed",
          distance,
          radius,
          checklist,
        },
      });
    }

    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Tracking synced",
      data: {
        action: "tracking_synced",
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

  if (normalizedOption !== "site_visit") {
    throw new AppError(httpStatus.BAD_REQUEST, "No active check-in found");
  }

  const checklist = await Checklist.create({
    user: req.user._id,
    option: normalizedOption,
    status: "checked_in",
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

  const workDate = getWorkDate();

  const activeChecklist = await Checklist.findOne({
    user: req.user._id,
    status: { $in: activeChecklistStatuses },
    workDate,
  }).sort({ createdAt: -1 });

  if (!activeChecklist) {
    throw new AppError(httpStatus.BAD_REQUEST, "No active check-in found");
  }

  // activeChecklist.status = "checked_out";
  // activeChecklist.checkOutAt = new Date();
  // activeChecklist.checkOutType = "manual";
  // activeChecklist.alertStatus = "pending";
  // activeChecklist.alertSentAt = null;
  // if (lat !== undefined && lng !== undefined) {
  //   activeChecklist.checkOutLocation = { latitude: lat, longitude: lng };
  // }

  // await activeChecklist.save();

  const check = await Checklist.create({
    user: req.user._id,
    status: "checked_out",
    option: "manual checkout",
    checkOutAt: new Date(),
    workDate,
    checkOutType: "manual",
    checkOutLocation: { latitude: lat, longitude: lng },

  })

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Manual checkout completed",
    data: activeChecklist,
  });
});

export const getMyChecklists = catchAsync(async (req, res) => {
  const { date, user } = req.query;

  let filter = {};
  if (req.user.role === "admin" && user) {
    filter.user = user;
  } else {
    filter.user = req.user._id;
  }


  if (date) {
    filter.workDate = date;
  }
  // console.log("Filter for fetching checklists:", filter);

  const checklists = await Checklist.find(filter).sort({
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
    $or: [
      {
        status: "checked_out",
        // checkOutType: "auto", // 👈 checked_out হলে auto must
      },
      {
        status: {
          $in: [
            "checked_in_missed",
            "user_outside_radius",
            "checked_in",
            "checked_in_not_ok",
          ],
        },
      },
    ],
  };

  if (searchTerm) {
    checklistFilter.user = { $in: userIds };
  }

  // const result = await Checklist.aggregate([
  //   {
  //     $match: checklistFilter,
  //   },
  //   {
  //     $sort: { createdAt: -1 },
  //   },
  //   {
  //     $group: {
  //       _id: {
  //         user: "$user",
  //         date: {
  //           $dateToString: {
  //             format: "%Y-%m-%d",
  //             date: "$createdAt",
  //           },
  //         },
  //       },
  //       checklist: { $first: "$$ROOT" },
  //     },
  //   },
  //   {
  //     $replaceRoot: {
  //       newRoot: "$checklist",
  //     },
  //   },
  //   {
  //     $lookup: {
  //       from: "users", // collection name (must match MongoDB collection)
  //       localField: "user",
  //       foreignField: "_id",
  //       as: "user",
  //     },
  //   },
  //   {
  //     $unwind: {
  //       path: "$user",
  //       preserveNullAndEmptyArrays: true,
  //     },
  //   },
  //   {
  //     $facet: {
  //       data: [
  //         { $skip: skip },
  //         { $limit: limit },
  //       ],
  //       total: [
  //         { $count: "count" },
  //       ],
  //     },
  //   },
  // ]);

  const result = await Checklist.aggregate([
  {
    $match: checklistFilter,
  },
  {
    $sort: { createdAt: -1 }, // latest document per user/day
  },
  {
    $group: {
      _id: {
        user: "$user",
        date: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$createdAt",
          },
        },
      },
      checklist: { $first: "$$ROOT" },
    },
  },
  {
    $replaceRoot: {
      newRoot: "$checklist",
    },
  },

  // Sort final grouped results
  {
    $sort: { createdAt: -1 },
  },

  {
    $lookup: {
      from: "users",
      localField: "user",
      foreignField: "_id",
      as: "user",
    },
  },
  {
    $unwind: {
      path: "$user",
      preserveNullAndEmptyArrays: true,
    },
  },
  {
    $facet: {
      data: [
        { $skip: skip },
        { $limit: limit },
      ],
      total: [
        { $count: "count" },
      ],
    },
  },
]);

  const alerts = result[0].data;
  const total = result[0].total[0]?.count || 0;

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

  // await addDailyReportEntries({
  //   user: checklist.user._id,
  //   date: checklist.workDate,
  //   entries: [
  //     {
  //       description:
  //         "Admin sent an alert for going out of the assigned location zone.",
  //     },
  //   ],
  // });

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
