import httpStatus from "http-status";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { Report } from "../model/report.model.js";
import {
  getCurrentUtcTime,
  getRequestDateContext,
  getRequestDateSource,
  getUserDateInfo,
} from "../utils/dateTime.js";

const reportUploadDir = path.join(process.cwd(), "public", "report-images");

const parsePagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.max(Number(query.limit) || 8, 1);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const getDateInfo = (value, source = {}) => getUserDateInfo(value, source);

const getCurrentTime = () => getCurrentUtcTime();

const parseJsonArray = (value, fieldName) => {
  if (Array.isArray(value)) {
    return value;
  }

  try {
    const parsedValue = JSON.parse(value);
    if (!Array.isArray(parsedValue)) {
      throw new Error("Expected array");
    }
    return parsedValue;
  } catch {
    throw new AppError(httpStatus.BAD_REQUEST, `${fieldName} must be an array`);
  }
};

const getBodyValue = (body, fields) => {
  for (const field of fields) {
    if (body[field] !== undefined) {
      return body[field];
    }
  }
  return undefined;
};

const buildHeaderUpdate = (body) => {
  const fieldMap = [
    ["site", ["site"]],
    ["onShift", ["onShift", "on_shift"]],
    ["offShift", ["offShift", "off_shift"]],
    ["security", ["security"]],
  ];

  return fieldMap.reduce((acc, [targetField, sourceFields]) => {
    const value = getBodyValue(body, sourceFields);
    if (value !== undefined) {
      acc[targetField] = value;
    }
    return acc;
  }, {});
};

const saveReportImages = async (files = []) => {
  if (!files.length) {
    return [];
  }

  await fs.mkdir(reportUploadDir, { recursive: true });

  return Promise.all(
    files.map(async (file) => {
      if (!file.mimetype?.startsWith("image/")) {
        throw new AppError(httpStatus.BAD_REQUEST, "Only image files are allowed");
      }

      const extension = path.extname(file.originalname || "");
      const baseName =
        path
          .basename(file.originalname || "report-image", extension)
          .replace(/[^a-zA-Z0-9_-]/g, "-")
          .replace(/-+/g, "-")
          .slice(0, 50) || "report-image";
      const fileName = `${Date.now()}-${randomUUID()}-${baseName}${extension}`;
      const filePath = path.join(reportUploadDir, fileName);
      const publicPath = path.posix.join("public", "report-images", fileName);

      await fs.writeFile(filePath, file.buffer);

      return {
        fileName,
        path: publicPath,
        url: `/${publicPath}`,
        mimeType: file.mimetype,
        size: file.size,
      };
    }),
  );
};

const buildEntries = (body, uploadedImages, defaultTime = getCurrentTime()) => {
  let entries = [];

  if (body.entries !== undefined) {
    entries = parseJsonArray(body.entries, "entries").map((entry) => ({
      time: entry.time || defaultTime,
      description: entry.description,
      images: [],
    }));
  } else {
    const description = body.description || body.reportDescription;
    if (description) {
      entries = [
        {
          time: body.time || defaultTime,
          description,
          images: [],
        },
      ];
    }
  }

  if (!entries.length) {
    if (uploadedImages.length) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "description is required when uploading report images",
      );
    }
    return [];
  }

  entries.forEach((entry) => {
    if (!entry.description) {
      throw new AppError(httpStatus.BAD_REQUEST, "Each entry needs description");
    }
  });

  const imageEntryIndex = Math.min(
    Math.max(Number(body.imageEntryIndex) || 0, 0),
    entries.length - 1,
  );

  entries[imageEntryIndex].images = uploadedImages;

  return entries;
};

const parseOptionalJsonArray = (value, fieldName) => {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  return parseJsonArray(value, fieldName);
};

const normalizeImageToken = (value) => String(value).replace(/^\/+/, "");

const getImageRemoveTokens = (body) =>
  parseOptionalJsonArray(
    body.removeImages || body.removeImagePaths || body.imagesToRemove,
    "removeImages",
  )
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      return item?._id || item?.id || item?.fileName || item?.path || item?.url;
    })
    .filter(Boolean)
    .map(normalizeImageToken);

const isSameImage = (image, removeTokens) => {
  const values = [
    image._id?.toString(),
    image.fileName,
    image.path,
    image.url,
  ]
    .filter(Boolean)
    .map(normalizeImageToken);

  return values.some((value) => removeTokens.includes(value));
};

const deleteLocalReportImages = async (images = []) => {
  const uploadRoot = path.resolve(reportUploadDir);

  await Promise.all(
    images.map(async (image) => {
      const imagePath = image.path || image.url;
      if (!imagePath) {
        return;
      }

      const relativePath = String(imagePath).replace(/^\/+/, "");
      const absolutePath = path.resolve(process.cwd(), relativePath);

      if (
        absolutePath !== uploadRoot &&
        !absolutePath.startsWith(`${uploadRoot}${path.sep}`)
      ) {
        return;
      }

      try {
        await fs.unlink(absolutePath);
      } catch {
        // The database update should not fail if the local file was already gone.
      }
    }),
  );
};

const getReportForUpdateById = async (req) => {
  const filter = { _id: req.params.id };
  if (req.user.role !== "admin") {
    filter.user = req.user._id;
  }

  return Report.findOne(filter);
};

const getReportForUpdateByDate = async (req) => {
  const { reportDate } = getDateInfo(
    req.params.reportDate,
    getRequestDateSource(req),
  );
  const user =
    req.user.role === "admin" && req.query.user ? req.query.user : req.user._id;

  return Report.findOne({ user, reportDate });
};

const updateReportDocument = async (req, report) => {
  if (!report) {
    throw new AppError(httpStatus.NOT_FOUND, "Report not found");
  }

  const header = buildHeaderUpdate(req.body);
  const removeTokens = getImageRemoveTokens(req.body);
  const entryId = req.body.entryId;
  const targetEntry = entryId ? report.entries.id(entryId) : null;
  const willAppendEntries =
    req.body.entries !== undefined ||
    req.body.description ||
    req.body.reportDescription;

  if (entryId && !targetEntry) {
    throw new AppError(httpStatus.NOT_FOUND, "Report entry not found");
  }

  if (!entryId && req.files?.length && !willAppendEntries) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "entryId or description is required when uploading report images",
    );
  }

  let changed = false;

  Object.entries(header).forEach(([field, value]) => {
    report[field] = value;
    changed = true;
  });

  if (req.body.day !== undefined) {
    report.day = req.body.day;
    changed = true;
  }

  const entryUpdates = parseOptionalJsonArray(
    req.body.entryUpdates || req.body.updateEntries,
    "entryUpdates",
  );

  entryUpdates.forEach((entryUpdate) => {
    const entry = report.entries.id(
      entryUpdate._id || entryUpdate.id || entryUpdate.entryId,
    );
    if (!entry) {
      throw new AppError(httpStatus.NOT_FOUND, "Report entry not found");
    }

    if (entryUpdate.time !== undefined) {
      entry.time = entryUpdate.time;
      changed = true;
    }
    if (entryUpdate.description !== undefined) {
      entry.description = entryUpdate.description;
      changed = true;
    }
  });

  if (targetEntry) {
    if (req.body.time !== undefined) {
      targetEntry.time = req.body.time;
      changed = true;
    }

    const description = req.body.description || req.body.reportDescription;
    if (description !== undefined) {
      targetEntry.description = description;
      changed = true;
    }
  }

  const removedImages = [];
  if (removeTokens.length) {
    report.entries.forEach((entry) => {
      if (entryId && entry._id.toString() !== entryId) {
        return;
      }

      entry.images = entry.images.filter((image) => {
        if (!isSameImage(image, removeTokens)) {
          return true;
        }
        removedImages.push(image);
        return false;
      });
    });
    changed = removedImages.length > 0 || changed;
  }

  let newEntries = [];
  if (!targetEntry && willAppendEntries) {
    newEntries = buildEntries(req.body, [], getRequestDateContext(req).time);
  }

  const uploadedImages = await saveReportImages(req.files);
  if (targetEntry && uploadedImages.length) {
    targetEntry.images.push(...uploadedImages);
    changed = true;
  }

  if (newEntries.length) {
    if (uploadedImages.length) {
      const imageEntryIndex = Math.min(
        Math.max(Number(req.body.imageEntryIndex) || 0, 0),
        newEntries.length - 1,
      );
      newEntries[imageEntryIndex].images = uploadedImages;
    }

    report.entries.push(...newEntries);
    changed = true;
  }

  if (!changed) {
    throw new AppError(httpStatus.BAD_REQUEST, "No report update data provided");
  }

  await report.save();
  await deleteLocalReportImages(removedImages);

  return report;
};

export const addDailyReportEntries = async ({
  user,
  date,
  day,
  header = {},
  entries = [],
  source = {},
  defaultTime,
}) => {
  const dateInfo = getDateInfo(date, source);
  const reportDate = dateInfo.reportDate;
  const reportDay = day || dateInfo.day;
  const normalizedEntries = entries.map((entry) => ({
    ...entry,
    time: entry.time || defaultTime || getCurrentTime(),
    images: entry.images || [],
  }));

  const update = {
    $setOnInsert: {
      user,
      reportDate,
    },
    $set: {
      day: reportDay,
      ...header,
    },
  };

  if (normalizedEntries.length) {
    update.$push = {
      entries: {
        $each: normalizedEntries,
      },
    };
  }

  return Report.findOneAndUpdate({ user, reportDate }, update, {
    new: true,
    upsert: true,
    runValidators: true,
    setDefaultsOnInsert: true,
  });
};

export const updateReport = catchAsync(async (req, res) => {
  const report = await getReportForUpdateById(req);
  const updatedReport = await updateReportDocument(req, report);

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Report updated successfully",
    data: updatedReport,
  });
});

export const updateReportByDate = catchAsync(async (req, res) => {
  const report = await getReportForUpdateByDate(req);
  const updatedReport = await updateReportDocument(req, report);

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Report updated successfully",
    data: updatedReport,
  });
});

const deleteReportEntryDocument = async (report, entryId) => {
  if (!report) {
    throw new AppError(httpStatus.NOT_FOUND, "Report not found");
  }

  const entry = report.entries.id(entryId);
  if (!entry) {
    throw new AppError(httpStatus.NOT_FOUND, "Report entry not found");
  }

  const removedImages = [...entry.images];
  entry.deleteOne();

  await report.save();
  await deleteLocalReportImages(removedImages);

  return report;
};

export const deleteReportEntry = catchAsync(async (req, res) => {
  const report = await getReportForUpdateById(req);
  const updatedReport = await deleteReportEntryDocument(
    report,
    req.params.entryId,
  );

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Report row deleted successfully",
    data: updatedReport,
  });
});

export const deleteReportEntryByDate = catchAsync(async (req, res) => {
  const report = await getReportForUpdateByDate(req);
  const updatedReport = await deleteReportEntryDocument(
    report,
    req.params.entryId,
  );

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Report row deleted successfully",
    data: updatedReport,
  });
});

export const createReport = catchAsync(async (req, res) => {
  const uploadedImages = await saveReportImages(req.files);
  const dateContext = getRequestDateContext(req);
  const entries = buildEntries(req.body, uploadedImages, dateContext.time);
  const header = buildHeaderUpdate(req.body);

  if (!entries.length && !Object.keys(header).length) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "At least one report entry or header field is required",
    );
  }

  const report = await addDailyReportEntries({
    user: req.user._id,
    date: req.body.reportDate || req.body.date,
    day: req.body.day,
    header,
    entries,
    source: dateContext.source,
    defaultTime: dateContext.time,
  });

  return sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Report created successfully",
    data: report,
  });
});

export const getMyReports = catchAsync(async (req, res) => {
  const filter = { user: req.user._id };
  if (req.query.date || req.query.reportDate) {
    filter.reportDate = req.query.date || req.query.reportDate;
  }

  const reports = await Report.find(filter).sort({ reportDate: -1 });

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
  if (req.query.date || req.query.reportDate) {
    filter.reportDate = req.query.date || req.query.reportDate;
  }

  const [reports, total] = await Promise.all([
    Report.find(filter)
      .populate("user", "name userId email")
      .sort({ reportDate: -1, createdAt: -1 })
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
