import httpStatus from "http-status";
import { User } from "../model/user.model.js";
import { uploadOnCloudinary } from "../utils/commonMethod.js";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";
import { Checklist } from "../model/checklist.model.js";
import { Report } from "../model/report.model.js";

const parsePagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.max(Number(query.limit) || 8, 1);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const parseCoordinate = (value, fieldName, min, max) => {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `${fieldName} must be a valid number`,
    );
  }

  if (parsedValue < min || parsedValue > max) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `${fieldName} must be between ${min} and ${max}`,
    );
  }

  return parsedValue;
};

const parseRadius = (value) => {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "defaultRadius must be a positive number",
    );
  }

  return parsedValue;
};

const normalizeOptionalString = (value) => String(value ?? "").trim();

const daysOfWeek = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const parseJsonField = (value, fieldName) => {
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    throw new AppError(httpStatus.BAD_REQUEST, `${fieldName} must be valid JSON`);
  }
};

const getDayLocationValue = (source, day, index) => {
  if (Array.isArray(source)) return source[index];

  return (
    source?.[day] ??
    source?.[day.charAt(0).toUpperCase() + day.slice(1)] ??
    source?.[day.toUpperCase()]
  );
};

const parseWeeklyLocations = (value) => {
  if (value === undefined || value === null || value === "") return undefined;

  const source = parseJsonField(value, "weeklyLocations");
  if (typeof source !== "object") {
    throw new AppError(httpStatus.BAD_REQUEST, "weeklyLocations must be an object");
  }

  return daysOfWeek.reduce((weeklyLocations, day, index) => {
    const dayLocation = getDayLocationValue(source, day, index);
    if (!dayLocation) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `weeklyLocations.${day} is required`,
      );
    }

    weeklyLocations[day] = {
      day: String(dayLocation.day ?? day).trim() || day,
      latitude: parseCoordinate(
        dayLocation.latitude ?? dayLocation.lat,
        `weeklyLocations.${day}.latitude`,
        -90,
        90,
      ),
      longitude: parseCoordinate(
        dayLocation.longitude ?? dayLocation.lng,
        `weeklyLocations.${day}.longitude`,
        -180,
        180,
      ),
    };

    return weeklyLocations;
  }, {});
};

const createWeeklyLocationsFromPoint = (latitude, longitude) =>
  daysOfWeek.reduce((weeklyLocations, day) => {
    weeklyLocations[day] = { day, latitude, longitude };
    return weeklyLocations;
  }, {});

// Get user profile
export const getProfile = catchAsync(async (req, res) => {
  const user = await User.findById(req.user._id).select(
    "-password -refreshToken -verificationInfo -password_reset_token",
  );
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Profile fetched successfully",
    data: user,
  });
});

// Update profile
export const updateProfile = catchAsync(async (req, res) => {
  const { name, phone, bio, gender, dob, age, address } = req.body;

  const userId = req.user._id;

  // Find user
  const user = await User.findById(userId).select(
    "-password -refreshToken -verificationInfo -password_reset_token",
  );
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  // Update only provided fields
  if (name !== undefined) user.name = name;
  if (phone !== undefined) user.phone = phone;
  if (bio !== undefined) user.bio = bio;
  if (gender !== undefined) user.gender = gender;
  if (dob !== undefined) user.dob = dob;
  if (age !== undefined) user.age = age;
  if (address !== undefined) user.address = address;

  if (req.file) {
    const result = await uploadOnCloudinary(req.file.buffer);
    if (!user.avatar) {
      user.avatar = { public_id: "", url: "" };
    }
    user.avatar.public_id = result.public_id;
    user.avatar.url = result.secure_url;
  }

  await user.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Profile updated successfully",
    data: user,
  });
});

// Change user password
export const changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const user = await User.findById(req.user._id).select("+password");
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  if (newPassword !== confirmPassword) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "New password and confirm password do not match",
    );
  }

  if (!(await User.isPasswordMatched(currentPassword, user.password))) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      "Current password is incorrect",
    );
  }

  user.password = newPassword;
  user.textPassword = newPassword;
  await user.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password changed successfully",
    data: user,
  });
});

export const deleteOwnAccount = catchAsync(async (req, res) => {
  const userId = req.user._id;

  const user = await User.findByIdAndDelete(userId);
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Account and all associated data deleted successfully",
    data: null,
  });
});

export const createUserByAdmin = catchAsync(async (req, res) => {
  const {
    name,
    userId,
    password,
    latitude,
    longitude,
    weeklyLocations,
    defaultRadius,
    site,
    onShift,
    offShift,
  } =
    req.body;

  if (
    !name ||
    !userId ||
    !password
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "name, userId and password are required",
    );
  }

  const parsedWeeklyLocations = parseWeeklyLocations(weeklyLocations);
  const isLatitudeMissing =
    latitude === undefined ||
    latitude === null ||
    latitude === "";
  const isLongitudeMissing =
    longitude === undefined ||
    longitude === null ||
    longitude === "";

  if (!parsedWeeklyLocations && (isLatitudeMissing || isLongitudeMissing)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "latitude and longitude are required when weeklyLocations is not provided",
    );
  }

  const existingUser = await User.findOne({ userId });
  if (existingUser) {
    throw new AppError(httpStatus.BAD_REQUEST, "userId already exists");
  }

  const parsedLatitude =
    latitude !== undefined && latitude !== null && latitude !== ""
      ? parseCoordinate(latitude, "latitude", -90, 90)
      : parsedWeeklyLocations.sunday.latitude;
  const parsedLongitude =
    longitude !== undefined && longitude !== null && longitude !== ""
      ? parseCoordinate(longitude, "longitude", -180, 180)
      : parsedWeeklyLocations.sunday.longitude;

  const userData = {
    name,
    userId,
    password,
    textPassword: password,
    weeklyLocations:
      parsedWeeklyLocations ??
      createWeeklyLocationsFromPoint(parsedLatitude, parsedLongitude),
    site: normalizeOptionalString(site),
    onShift: normalizeOptionalString(onShift),
    offShift: normalizeOptionalString(offShift),
    defaultRadius:
      defaultRadius !== undefined ? parseRadius(defaultRadius) : 100,
    verificationInfo: { token: "", verified: true },
  };

  if (req.file) {
    const result = await uploadOnCloudinary(req.file.buffer);
    userData.avatar = {
      public_id: result.public_id,
      url: result.secure_url,
    };
  }

  const createdUser = await User.create(userData);
  const responseUser = await User.findById(createdUser._id).select(
    "-password -refreshToken -verificationInfo -password_reset_token",
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "User created by admin successfully",
    data: responseUser,
  });
});

export const getUsersForAdmin = catchAsync(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const searchTerm = req.query.search?.trim();

  const filter = { role: { $ne: "admin" } };

  if (searchTerm) {
    filter.$or = [
      { name: { $regex: searchTerm, $options: "i" } },
      { userId: { $regex: searchTerm, $options: "i" } },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .select(
        "-password -refreshToken -verificationInfo -password_reset_token -__v +textPassword",
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    User.countDocuments(filter),
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Users fetched successfully",
    data: {
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    },
  });
});

export const getUserDetailsForAdmin = catchAsync(async (req, res) => {
  const { id } = req.params;

  const user = await User.findById(id).select(
    "-password -refreshToken -verificationInfo -password_reset_token -__v +textPassword",
  );

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  const [checklists, reports] = await Promise.all([
    Checklist.find({ user: id }).sort({ createdAt: -1 }).limit(31),
    Report.find({ user: id }).sort({ createdAt: -1 }).limit(20),
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User details fetched successfully",
    data: {
      user,
      checklists,
      reports,
    },
  });
});

export const updateUserByAdmin = catchAsync(async (req, res) => {
  const { id } = req.params;
  const {
    name,
    userId,
    password,
    latitude,
    longitude,
    weeklyLocations,
    defaultRadius,
    site,
    onShift,
    offShift,
  } =
    req.body;

  const user = await User.findById(id);

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  if (userId && userId !== user.userId) {
    const existingUser = await User.findOne({ userId });
    if (existingUser) {
      throw new AppError(httpStatus.BAD_REQUEST, "userId already exists");
    }
    user.userId = userId;
  }

  if (name) user.name = name;
  if (password) {
    user.password = password;
    user.textPassword = password;
  }
  if (defaultRadius !== undefined) {
    user.defaultRadius = parseRadius(defaultRadius);
  }
  if (site !== undefined) user.site = normalizeOptionalString(site);
  if (onShift !== undefined) user.onShift = normalizeOptionalString(onShift);
  if (offShift !== undefined) user.offShift = normalizeOptionalString(offShift);

  const parsedWeeklyLocations = parseWeeklyLocations(weeklyLocations);
  if (parsedWeeklyLocations) {
    user.weeklyLocations = parsedWeeklyLocations;
  }

  const hasLatitude =
    latitude !== undefined && latitude !== null && latitude !== "";
  const hasLongitude =
    longitude !== undefined && longitude !== null && longitude !== "";

  if (hasLatitude !== hasLongitude) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "latitude and longitude must be provided together",
    );
  }

  if (hasLatitude && hasLongitude) {
    const parsedLatitude = parseCoordinate(latitude, "latitude", -90, 90);
    const parsedLongitude = parseCoordinate(longitude, "longitude", -180, 180);
    if (!parsedWeeklyLocations) {
      user.weeklyLocations = createWeeklyLocationsFromPoint(
        parsedLatitude,
        parsedLongitude,
      );
    }
  }

  if (req.file) {
    const result = await uploadOnCloudinary(req.file.buffer);
    if (!user.avatar) {
      user.avatar = { public_id: "", url: "" };
    }
    user.avatar.public_id = result.public_id;
    user.avatar.url = result.secure_url;
  }

  await user.save();

  const responseUser = await User.findById(id).select(
    "-password -refreshToken -verificationInfo -password_reset_token -__v",
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User updated successfully",
    data: responseUser,
  });
});

export const deleteUserByAdmin = catchAsync(async (req, res) => {
  const { id } = req.params;

  const user = await User.findById(id);

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  await Promise.all([
    Checklist.deleteMany({ user: id }),
    Report.deleteMany({ user: id }),
    User.findByIdAndDelete(id),
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User deleted successfully",
    data: null,
  });
});
