import jwt from "jsonwebtoken";
import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import { User } from "./../model/user.model.js";

export const protect = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) throw new AppError(httpStatus.NOT_FOUND, "Token not found");

  try {
    const decoded = await jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    // `verificationInfo` is select:false, so it is pulled in here explicitly.
    // Previously this was a second User.findById via User.isOTPVerified(),
    // which meant two round trips to the database for the same document on
    // every authenticated request.
    const user = await User.findById(decoded._id).select("+verificationInfo");

    if (!user || !user.verificationInfo?.verified) {
      throw new AppError(httpStatus.UNAUTHORIZED, "Unauthorized user");
    }

    // Keep req.user shaped exactly as before, so the extra field can never be
    // serialized into a response by downstream controllers.
    delete user._doc.verificationInfo;

    req.user = user;
    next();
  } catch (err) {
    throw new AppError(401, "Invalid token");
  }
};

export const isAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    throw new AppError(403, "Access denied. You are not an admin.");
  }
  next();
};

export const isDriver = (req, res, next) => {
  if (req.user?.role !== "driver") {
    throw new AppError(403, "Access denied. You are not an driver.");
  }
  next();
};
