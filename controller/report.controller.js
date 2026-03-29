import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { Report } from "../model/report.model.js";

export const createReport = catchAsync(async (req, res) => {
  const { reportName, reportDescription } = req.body;

  if (!reportName || !reportDescription) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "reportName and reportDescription are required",
    );
  }

  const report = await Report.create({
    user: req.user._id,
    reportName,
    reportDescription,
  });

  return sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Report created successfully",
    data: report,
  });
});

export const getMyReports = catchAsync(async (req, res) => {
  const reports = await Report.find({ user: req.user._id }).sort({
    createdAt: -1,
  });

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reports fetched successfully",
    data: reports,
  });
});

export const getAllReports = catchAsync(async (req, res) => {
  const reports = await Report.find({})
    .populate("user", "name userId email")
    .sort({ createdAt: -1 });

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "All reports fetched successfully",
    data: reports,
  });
});
