import httpStatus from "http-status";
import AppError from "../errors/AppError.js";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const pad = (value) => String(value).padStart(2, "0");

const getFirstValue = (source, fields) => {
  for (const field of fields) {
    const value = source?.[field];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
};

const getRequestHeader = (req, names) => {
  for (const name of names) {
    const value = req.get?.(name);
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
};

export const getRequestDateSource = (req = {}) => ({
  ...req.query,
  ...req.body,
  timeZone:
    req.body?.timeZone ??
    req.body?.timezone ??
    req.body?.tz ??
    getRequestHeader(req, ["x-time-zone", "x-timezone", "x-tz"]),
  timezoneOffsetMinutes:
    req.body?.timezoneOffsetMinutes ??
    req.body?.timezoneOffset ??
    getRequestHeader(req, [
      "x-timezone-offset-minutes",
      "x-timezone-offset",
    ]),
  utcOffsetMinutes:
    req.body?.utcOffsetMinutes ??
    req.body?.utcOffset ??
    getRequestHeader(req, ["x-utc-offset-minutes", "x-utc-offset"]),
});

const parseDate = (value, fieldName = "date") => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(httpStatus.BAD_REQUEST, `Invalid ${fieldName}`);
  }
  return date;
};

const normalizeDateOnly = (value, fieldName = "date") => {
  const normalizedValue = String(value).trim();
  if (!DATE_ONLY_PATTERN.test(normalizedValue)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `${fieldName} must be in YYYY-MM-DD format`,
    );
  }

  const parsedDate = new Date(`${normalizedValue}T00:00:00.000Z`);
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== normalizedValue
  ) {
    throw new AppError(httpStatus.BAD_REQUEST, `Invalid ${fieldName}`);
  }

  return normalizedValue;
};

const formatDateInTimeZone = (date, timeZone) => {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);

    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );

    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid timeZone");
  }
};

const formatTimeInTimeZone = (date, timeZone) => {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);

    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );

    return `${values.hour}:${values.minute}`;
  } catch {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid timeZone");
  }
};

const parseOffsetString = (value) => {
  const match = String(value)
    .trim()
    .match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);

  if (!match) {
    return undefined;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || 0);

  if (hours > 23 || minutes > 59) {
    return undefined;
  }

  return sign * (hours * 60 + minutes);
};

const parseOffsetNumber = (value) => {
  if (typeof value === "number") {
    return Number.isNaN(value) ? undefined : value;
  }

  const numericValue = Number(value);
  return Number.isNaN(numericValue) ? undefined : numericValue;
};

const shiftDateByOffset = (date, source) => {
  const utcOffset = getFirstValue(source, ["utcOffsetMinutes", "utcOffset"]);
  if (utcOffset !== undefined) {
    const parsedOffset = parseOffsetString(utcOffset) ?? parseOffsetNumber(utcOffset);
    if (parsedOffset === undefined) {
      throw new AppError(httpStatus.BAD_REQUEST, "Invalid utcOffsetMinutes");
    }
    return new Date(date.getTime() + parsedOffset * 60 * 1000);
  }

  const timezoneOffset = getFirstValue(source, [
    "timezoneOffsetMinutes",
    "timezoneOffset",
    "tzOffsetMinutes",
  ]);
  if (timezoneOffset !== undefined) {
    const parsedStringOffset = parseOffsetString(timezoneOffset);
    if (parsedStringOffset !== undefined) {
      return new Date(date.getTime() + parsedStringOffset * 60 * 1000);
    }

    const parsedOffset = parseOffsetNumber(timezoneOffset);
    if (parsedOffset === undefined) {
      throw new AppError(httpStatus.BAD_REQUEST, "Invalid timezoneOffsetMinutes");
    }

    return new Date(date.getTime() - parsedOffset * 60 * 1000);
  }

  return date;
};

const formatDateForSource = (date, source = {}) => {
  const timeZone = getFirstValue(source, ["timeZone", "timezone", "tz"]);
  if (timeZone) {
    return formatDateInTimeZone(date, timeZone);
  }

  const shiftedDate = shiftDateByOffset(date, source);
  return shiftedDate.toISOString().slice(0, 10);
};

const formatTimeForSource = (date, source = {}) => {
  const timeZone = getFirstValue(source, ["timeZone", "timezone", "tz"]);
  if (timeZone) {
    return formatTimeInTimeZone(date, timeZone);
  }

  const shiftedDate = shiftDateByOffset(date, source);
  return `${pad(shiftedDate.getUTCHours())}:${pad(shiftedDate.getUTCMinutes())}`;
};

const getTimestampValue = (source) =>
  getFirstValue(source, [
    "timestamp",
    "clientTimestamp",
    "clientTime",
    "currentTime",
    "now",
  ]);

export const getClientNow = (source = {}, fallback = new Date()) => {
  const timestamp = getTimestampValue(source);
  if (timestamp === undefined) {
    return fallback;
  }

  if (typeof timestamp === "number" || /^\d+$/.test(String(timestamp))) {
    const numericTimestamp = Number(timestamp);
    return parseDate(
      numericTimestamp < 100000000000 ? numericTimestamp * 1000 : numericTimestamp,
      "timestamp",
    );
  }

  return parseDate(timestamp, "timestamp");
};

export const getDayForDate = (dateString) =>
  new Date(`${normalizeDateOnly(dateString)}T00:00:00.000Z`).toLocaleDateString(
    "en-US",
    {
      weekday: "long",
      timeZone: "UTC",
    },
  );

export const getUserDateInfo = (value, source = {}) => {
  if (value !== undefined && value !== null && value !== "") {
    if (DATE_ONLY_PATTERN.test(String(value).trim())) {
      const reportDate = normalizeDateOnly(value);
      return { reportDate, day: getDayForDate(reportDate) };
    }

    const date = parseDate(value);
    const reportDate = formatDateForSource(date, source);
    return { reportDate, day: getDayForDate(reportDate) };
  }

  const date = getClientNow(source);
  const reportDate = formatDateForSource(date, source);
  return { reportDate, day: getDayForDate(reportDate) };
};

export const getRequestDateContext = (req, fallback = new Date()) => {
  const source = getRequestDateSource(req);
  const now = getClientNow(source, fallback);
  const explicitDate = getFirstValue(source, [
    "workDate",
    "localDate",
    "clientDate",
    "date",
  ]);
  const workDate =
    explicitDate !== undefined
      ? getUserDateInfo(explicitDate, source).reportDate
      : formatDateForSource(now, source);

  return {
    now,
    source,
    workDate,
    day: getDayForDate(workDate),
    time: formatTimeForSource(now, source),
  };
};

export const getCurrentUtcTime = (date = new Date()) =>
  `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
