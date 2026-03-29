import httpStatus from "http-status";
import { User } from "../model/user.model.js";
import { uploadOnCloudinary } from "../utils/commonMethod.js";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";

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
  const { name, gender, dob, age, address } = req.body;

  const userId = req.user._id;

  // Find user
  const user = await User.findById(userId).select(
    "-password -refreshToken -verificationInfo -password_reset_token",
  );
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  // Update only provided fields
  if (name) user.name = name;
  if (gender) user.gender = gender;
  if (dob) user.dob = dob;
  if (age) user.age = age;
  if (address) user.address = address;

  console.log(req.file);

  if (req.file) {
    const result = await uploadOnCloudinary(req.file.buffer);
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
  const { name, userId, password, latitude, longitude, defaultRadius } =
    req.body;

  if (!name || !userId || !password || latitude === undefined || longitude === undefined) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "name, userId, password, latitude and longitude are required",
    );
  }

  const existingUser = await User.findOne({ userId });
  if (existingUser) {
    throw new AppError(httpStatus.BAD_REQUEST, "userId already exists");
  }

  const userData = {
    name,
    userId,
    password,
    location: {
      latitude: Number(latitude),
      longitude: Number(longitude),
    },
    defaultRadius:
      defaultRadius !== undefined ? Number(defaultRadius) : 100,
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
