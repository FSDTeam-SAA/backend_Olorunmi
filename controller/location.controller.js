import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import { Location } from "../model/location.model.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";

const parseCoordinate = (value, field, min, max) => {
  const parsed = Number(value);

  if (value === undefined || value === null || value === "" || Number.isNaN(parsed)) {
    throw new AppError(httpStatus.BAD_REQUEST, `${field} must be a valid number`);
  }

  if (parsed < min || parsed > max) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `${field} must be between ${min} and ${max}`
    );
  }

  return parsed;
};

const findLocationOrFail = async (id) => {
  const location = await Location.findById(id);

  if (!location) {
    throw new AppError(httpStatus.NOT_FOUND, "Location not found");
  }

  return location;
};

const assertNameIsFree = async (name, excludeId) => {
  const query = { name };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  if (await Location.findOne(query)) {
    throw new AppError(
      httpStatus.CONFLICT,
      "A location with this name already exists"
    );
  }
};

export const createLocation = catchAsync(async (req, res) => {
  const { name, latitude, longitude } = req.body;

  const trimmedName = name?.trim();
  if (!trimmedName) {
    throw new AppError(httpStatus.BAD_REQUEST, "Location name is required");
  }

  await assertNameIsFree(trimmedName);

  const location = await Location.create({
    name: trimmedName,
    latitude: parseCoordinate(latitude, "Latitude", -90, 90),
    longitude: parseCoordinate(longitude, "Longitude", -180, 180),
  });

  return sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Location created successfully",
    data: location,
  });
});

export const getLocations = catchAsync(async (req, res) => {
  const searchTerm = req.query.search?.trim();

  const query = {};
  if (searchTerm) {
    query.name = { $regex: searchTerm, $options: "i" };
  }

  const locations = await Location.find(query).sort({ name: 1 });

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Locations retrieved successfully",
    data: locations,
  });
});

export const getLocationById = catchAsync(async (req, res) => {
  const location = await findLocationOrFail(req.params.id);

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Location retrieved successfully",
    data: location,
  });
});

export const updateLocation = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { name, latitude, longitude } = req.body;

  const location = await findLocationOrFail(id);

  if (name !== undefined) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new AppError(httpStatus.BAD_REQUEST, "Location name is required");
    }

    await assertNameIsFree(trimmedName, id);
    location.name = trimmedName;
  }

  if (latitude !== undefined) {
    location.latitude = parseCoordinate(latitude, "Latitude", -90, 90);
  }

  if (longitude !== undefined) {
    location.longitude = parseCoordinate(longitude, "Longitude", -180, 180);
  }

  await location.save();

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Location updated successfully",
    data: location,
  });
});

export const deleteLocation = catchAsync(async (req, res) => {
  const location = await Location.findByIdAndDelete(req.params.id);

  if (!location) {
    throw new AppError(httpStatus.NOT_FOUND, "Location not found");
  }

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Location deleted successfully",
    data: location,
  });
});
