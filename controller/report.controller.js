import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { Report } from "../model/report.model.js";

const parsePagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.max(Number(query.limit) || 8, 1);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

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
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.user) {
    filter.user = req.query.user;
  }

  const [reports, total] = await Promise.all([
    Report.find(filter)
      .populate("user", "name userId email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Report.countDocuments(filter),
  ]);

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "All reports fetched successfully",
    data: {
      reports,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    },
  });
});
