import httpStatus from "http-status";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { Report } from "../model/report.model.js";
import { User } from "../model/user.model.js";
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

const getTimezoneFromSource = (source = {}) =>
  source.timeZone || source.timezone || source.tz;

const systemEntryTypes = new Set(["first_booked_in", "last_booked_off"]);

const normalizeSystemDescription = (value = "") =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "");

const systemTypeFromDescription = (description) => {
  switch (normalizeSystemDescription(description)) {
    case "checked in":
    case "checked in again":
    case "check-in":
    case "checked_in":
    case "booked-in":
    case "booked in":
    case "first booked in":
      return "first_booked_in";
    case "checked out":
    case "check-out":
    case "checked_out":
    case "manual checkout":
    case "booked-off":
    case "booked off":
    case "end shift":
      return "last_booked_off";
    default:
      return null;
  }
};

const incomingSystemEntryType = (entry) => {
  const systemEntryType = entry?.systemEntryType?.toString();
  return systemEntryTypes.has(systemEntryType) ? systemEntryType : null;
};

const existingSystemEntryType = (entry) => {
  const systemEntryType = entry?.systemEntryType?.toString();
  if (systemEntryTypes.has(systemEntryType)) {
    return systemEntryType;
  }
  return systemTypeFromDescription(entry?.description);
};

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

const hasText = (value) => String(value ?? "").trim().length > 0;

const plainReport = (report) =>
  report?.toObject ? report.toObject({ virtuals: true }) : { ...report };

const buildUserReportHeader = (user = {}) => {
  const header = {};
  const fieldMap = {
    site: user.site,
    onShift: user.onShift,
    offShift: user.offShift,
    security: user.name || user.username || user.userId,
  };

  Object.entries(fieldMap).forEach(([field, value]) => {
    const text = value?.toString().trim();
    if (text) header[field] = text;
  });

  return header;
};

const buildCreateHeader = (body, user) => {
  const userHeader = buildUserReportHeader(user);
  const bodyHeader = buildHeaderUpdate(body);
  const header = { ...userHeader };

  Object.entries(bodyHeader).forEach(([field, value]) => {
    if (hasText(value)) {
      header[field] = value;
    }
  });

  return header;
};

const fillMissingReportHeader = (report, user) => {
  const userHeader = buildUserReportHeader(user);
  let changed = false;

  Object.entries(userHeader).forEach(([field, value]) => {
    if (!hasText(report[field]) && hasText(value)) {
      report[field] = value;
      changed = true;
    }
  });

  return changed;
};

const serializeReportWithUserHeader = (report, user) => {
  if (!report) return report;
  const response = plainReport(report);
  const userHeader = buildUserReportHeader(user);

  console.log(`[REPORT] user site=${userHeader.site || ""}`);
  console.log(`[REPORT] user onShift=${userHeader.onShift || ""}`);
  console.log(`[REPORT] user offShift=${userHeader.offShift || ""}`);

  Object.entries(userHeader).forEach(([field, value]) => {
    if (!hasText(response[field]) && hasText(value)) {
      response[field] = value;
    }
  });

  console.log(
    `[REPORT] final response site=${response.site || ""}`,
  );
  console.log(`[REPORT] final response onShift=${response.onShift || ""}`);
  console.log(`[REPORT] final response offShift=${response.offShift || ""}`);
  return response;
};

const resolveReportUser = async (report, fallbackUser) => {
  const reportUser = report?.user;
  const fallbackId = fallbackUser?._id?.toString();
  const reportUserId =
    reportUser?._id?.toString?.() || reportUser?.toString?.() || "";

  if (
    reportUser &&
    typeof reportUser === "object" &&
    (hasText(reportUser.site) ||
      hasText(reportUser.onShift) ||
      hasText(reportUser.offShift))
  ) {
    return reportUser;
  }

  if (fallbackId && reportUserId && fallbackId === reportUserId) {
    return fallbackUser;
  }

  if (!reportUserId) return fallbackUser;

  return User.findById(reportUserId).select(
    "name username userId site onShift offShift",
  );
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
      systemEntryType: incomingSystemEntryType(entry),
      images: [],
    }));
  } else {
    const description = body.description || body.reportDescription;
    if (description) {
      entries = [
        {
          time: body.time || defaultTime,
          description,
          systemEntryType: incomingSystemEntryType(body),
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

const systemReportEntriesOnly = (entries = []) =>
  entries.filter((entry) => incomingSystemEntryType(entry));

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

const getEntryImageMap = (body) =>
  parseOptionalJsonArray(body.entryImageMap, "entryImageMap");

const getImageIdentityTokens = (image) =>
  [
    image?._id?.toString(),
    image?.id?.toString(),
    image?.fileName,
    image?.path,
    image?.url,
  ]
    .filter(Boolean)
    .map(normalizeImageToken);

const isSameImage = (image, removeTokens) => {
  const values = getImageIdentityTokens(image);

  return values.some((value) => removeTokens.includes(value));
};

const syncEntryImages = (entry, images = []) => {
  const keepTokens = images.flatMap(getImageIdentityTokens);
  const removedImages = [];

  entry.images = entry.images.filter((image) => {
    const imageTokens = getImageIdentityTokens(image);
    if (imageTokens.some((token) => keepTokens.includes(token))) {
      return true;
    }
    removedImages.push(image);
    return false;
  });

  return removedImages;
};

const applyMappedUploadedImages = ({
  report,
  newEntries,
  uploadedImages,
  entryImageMap,
}) => {
  let changed = false;

  uploadedImages.forEach((image, index) => {
    const imageMap = entryImageMap[index];
    if (!imageMap) return;

    const target = imageMap.target?.toString();
    const entryId =
      imageMap.entryId?.toString() ||
      imageMap._id?.toString() ||
      imageMap.id?.toString();
    const entryIndex = Number(imageMap.entryIndex);

    if (target === "entryUpdates" || entryId) {
      if (!report) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          "entryImageMap target is invalid",
        );
      }
      const entry = entryId ? report.entries.id(entryId) : null;
      if (!entry) {
        throw new AppError(httpStatus.NOT_FOUND, "Report entry not found");
      }
      entry.images.push(image);
      changed = true;
      return;
    }

    if (Number.isInteger(entryIndex) && newEntries[entryIndex]) {
      newEntries[entryIndex].images.push(image);
      changed = true;
    }
  });

  return changed;
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
  const entryImageMap = getEntryImageMap(req.body);
  const entryId = req.body.entryId;
  const targetEntry = entryId ? report.entries.id(entryId) : null;
  const willAppendEntries =
    req.body.entries !== undefined ||
    req.body.description ||
    req.body.reportDescription;
  const willUpdateEntries =
    req.body.entryUpdates !== undefined || req.body.updateEntries !== undefined;

  if (entryId && !targetEntry) {
    throw new AppError(httpStatus.NOT_FOUND, "Report entry not found");
  }

  if (
    !entryId &&
    req.files?.length &&
    !willAppendEntries &&
    !willUpdateEntries &&
    !entryImageMap.length
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "entryId or description is required when uploading report images",
    );
  }

  let changed = false;
  const removedImages = [];

  Object.entries(header).forEach(([field, value]) => {
    report[field] = value;
    changed = true;
  });

  const reportUser = await resolveReportUser(report, req.user);
  changed = fillMissingReportHeader(report, reportUser) || changed;

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
    if (Array.isArray(entryUpdate.images)) {
      const removed = syncEntryImages(entry, entryUpdate.images);
      removedImages.push(...removed);
      changed = removed.length > 0 || changed;
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
  if (entryImageMap.length && uploadedImages.length) {
    changed =
      applyMappedUploadedImages({
        report,
        newEntries,
        uploadedImages,
        entryImageMap,
      }) || changed;
  } else if (targetEntry && uploadedImages.length) {
    targetEntry.images.push(...uploadedImages);
    changed = true;
  }

  if (newEntries.length) {
    if (uploadedImages.length && !entryImageMap.length) {
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
  const reportEntries = systemReportEntriesOnly(entries);
  if (!reportEntries.length && !Object.keys(header).length) {
    return Report.findOne({
      user,
      reportDate: getDateInfo(date, source).reportDate,
    });
  }

  const dateInfo = getDateInfo(date, source);
  const reportDate = dateInfo.reportDate;
  const reportDay = day || dateInfo.day;
  const timezone = getTimezoneFromSource(source);
  const normalizedEntries = reportEntries.map((entry) => ({
    ...entry,
    time: entry.time || defaultTime || getCurrentTime(),
    images: entry.images || [],
  }));

  const report = await Report.findOneAndUpdate(
    { user, reportDate },
    {
      $setOnInsert: { user, reportDate },
      $set: {
        day: reportDay,
        ...(timezone ? { timezone } : {}),
        ...header,
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  );

  let changed = false;
  normalizedEntries.forEach((entry) => {
    const systemEntryType = incomingSystemEntryType(entry);

    if (systemEntryType === "first_booked_in") {
      const hasBookedIn = report.entries.some(
        (item) => existingSystemEntryType(item) === "first_booked_in",
      );
      if (!hasBookedIn) {
        report.entries.push({ ...entry, systemEntryType });
        changed = true;
      }
      return;
    }

    if (systemEntryType === "last_booked_off") {
      const previousLength = report.entries.length;
      report.entries = report.entries.filter(
        (item) => existingSystemEntryType(item) !== "last_booked_off",
      );
      if (report.entries.length !== previousLength) {
        changed = true;
      }
      report.entries.push({ ...entry, systemEntryType });
      changed = true;
      return;
    }

    report.entries.push(entry);
    changed = true;
  });

  if (changed) {
    await report.save();
  }

  return report;
};

export const updateReport = catchAsync(async (req, res) => {
  const report = await getReportForUpdateById(req);
  const updatedReport = await updateReportDocument(req, report);
  const responseUser = await resolveReportUser(updatedReport, req.user);
  const responseReport = serializeReportWithUserHeader(
    updatedReport,
    responseUser,
  );

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Report updated successfully",
    data: responseReport,
  });
});

export const updateReportByDate = catchAsync(async (req, res) => {
  const report = await getReportForUpdateByDate(req);
  const updatedReport = await updateReportDocument(req, report);
  const responseUser = await resolveReportUser(updatedReport, req.user);
  const responseReport = serializeReportWithUserHeader(
    updatedReport,
    responseUser,
  );

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Report updated successfully",
    data: responseReport,
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
  const entryImageMap = getEntryImageMap(req.body);
  const entries = buildEntries(
    req.body,
    entryImageMap.length ? [] : uploadedImages,
    dateContext.time,
  );
  if (entryImageMap.length && uploadedImages.length) {
    applyMappedUploadedImages({
      report: null,
      newEntries: entries,
      uploadedImages,
      entryImageMap,
    });
  }
  const header = buildCreateHeader(req.body, req.user);

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
  const responseReport = serializeReportWithUserHeader(report, req.user);

  return sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Report created successfully",
    data: responseReport,
  });
});

export const getMyReports = catchAsync(async (req, res) => {
  const filter = { user: req.user._id };
  if (req.query.date || req.query.reportDate) {
    filter.reportDate = req.query.date || req.query.reportDate;
  }

  const reports = await Report.find(filter).sort({ reportDate: -1 });
  const responseReports = reports.map((report) =>
    serializeReportWithUserHeader(report, req.user),
  );

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reports fetched successfully",
    data: responseReports,
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
      .populate("user", "name userId email site onShift offShift")
      .sort({ reportDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Report.countDocuments(filter),
  ]);
  const responseReports = reports.map((report) =>
    serializeReportWithUserHeader(report, report.user),
  );

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "All reports fetched successfully",
    data: {
      reports: responseReports,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    },
  });
});

export const getReportImage = catchAsync(async (req, res) => {
  const fileName = path.basename(req.params.fileName || "");
  if (!fileName) {
    throw new AppError(httpStatus.BAD_REQUEST, "Image file name is required");
  }

  const imagePath = path.join(reportUploadDir, fileName);

  try {
    await fs.access(imagePath);
  } catch {
    throw new AppError(httpStatus.NOT_FOUND, "Report image not found");
  }

  return res.sendFile(imagePath);
});
