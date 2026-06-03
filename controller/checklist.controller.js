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
const workDate = getWorkDate();
  const activeChecklist = await Checklist.findOne({
    user: req.user._id,
    workDate,
    status: { $in: ["checked_in", "checked_in_missed" ,"user_outside_radius"] },
  }).sort({ checkInAt: -1 });



  if (activeChecklist) {
      const lastCheckInTime = new Date(
    activeChecklist.createdAt,
  ).getTime();

  const currentTime = Date.now();

  const difference = currentTime - lastCheckInTime;

  console.log("Time since last check-in (ms):", difference);

  const NINETY_MINUTES = 90 * 60 * 1000;

  if (difference < NINETY_MINUTES) {
    const remainingMinutes = Math.ceil(
      (NINETY_MINUTES - difference) / (1000 * 60),
    );

    throw new AppError(
      httpStatus.BAD_REQUEST,
      `You can check in again after ${remainingMinutes} minutes`,
    );
  }


    if (distance > radius && option != "no") {
      const now = new Date();
      const check = await Checklist.create({
        user: req.user._id,
        status : "checked_out",
      checkOutAt : now,
      workDate,
      checkOutType : "auto",
      checkOutLocation : { latitude: lat, longitude: lng },
      autoCheckoutTrigger : {
        latitude: lat,
        longitude: lng,
        recordedAt: now,
      },
      alertStatus : "pending",
      alertSentAt : null,

      })

      // const user = await User.findOne({role: "admin"})

      // sendPushNotification(
      //   [user._id],
      //   "Auto Checkout Alert",
      //   `${req.user.name} have been automatically checked out because ${req.user.name} moved outside the allowed radius.`,
      // );

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
          checklist: check,
        },
      });
    }
    if(option === "no" ){
      console.log("User did not respond to check-in prompt and is outside radius, marking as check-in missed.", option);

         const now = new Date();
      const check = await Checklist.create({
        user: req.user._id,
        status : distance > radius ?"user_outside_radius": "checked_in_missed",
      // checkOutAt = now;
      workDate,
      // checkOutType = "auto";
      checkOutLocation : { latitude: lat, longitude: lng },
      option :  distance > radius ?"user_outside_radius": "checked_in_missed",
      // autoCheckoutTrigger = {
      //   latitude: lat,
      //   longitude: lng,
      //   recordedAt: now,
      // };
      alertStatus : "pending",
      alertSentAt : null,

      })

      const user = await User.findOne({role: "admin"})

      sendPushNotification(
        [user._id],
        "Check In Missed Alert",
        `${req.user.name} have been automatically checked out because ${req.user.name} moved outside the allowed radius.`,
      );

      return sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "check in missed because user didnt response",
        data: {
          action: "Check-in missed",
          distance,
          radius,
          checklist: check,
        },
      });

    }

    // return sendResponse(res, {
    //   statusCode: httpStatus.OK,
    //   success: true,
    //   message: "User is still checked in and inside radius",
    //   data: {
    //     action: "already_checked_in",
    //     distance,
    //     radius,
    //     checklist: activeChecklist,
    //   },
    // });


    // if (lastChecklist) {

}

  if (distance > radius) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Cannot check in because user is outside allowed radius",
    );
  }

  // const workDate = getWorkDate();
  // const alreadyCheckedForDate = await Checklist.findOne({
  //   user: req.user._id,
  //   workDate,
  // });
  // if (alreadyCheckedForDate) {
  //   throw new AppError(
  //     httpStatus.BAD_REQUEST,
  //     "User already checked in for this date",
  //   );
  // }


  

// Last checklist find
// const lastChecklist = await Checklist.findOne({
//   user: req.user._id,
//   workDate
// }).sort({ createdAt: -1 });

// 90 minutes validation


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

  const workDate = getWorkDate();

  const activeChecklist = await Checklist.findOne({
    user: req.user._id,
    status: "checked_in",
    workDate
  }).sort({ checkInAt: -1 });

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
        status : "checked_out",
        option : "manual checkout",
        checkOutAt : new Date(),
        workDate,
        checkOutType : "manual",
        checkOutLocation : { latitude: lat, longitude: lng },

      })

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Manual checkout completed",
    data: activeChecklist,
  });
});

export const getMyChecklists = catchAsync(async (req, res) => {
  const { date,user } = req.query;

  let filter = {};
  if(req.user.role === "admin" && user){
    filter.user = user;
  }else{
    filter.user = req.user._id;
  }


if (date) {
  filter.workDate = date;
}
console.log("Filter for fetching checklists:", filter);

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
      checkOutType: "auto", // 👈 checked_out হলে auto must
    },
    {
      status: { $in: ["checked_in_missed", "user_outside_radius"] },
    },
  ],
};

  if (searchTerm) {
    checklistFilter.user = { $in: userIds };
  }

const result = await Checklist.aggregate([
  {
    $match: checklistFilter,
  },
  {
    $sort: { createdAt: -1 },
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
    {
    $lookup: {
      from: "users", // collection name (must match MongoDB collection)
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
