import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import { Site } from "../model/site.model.js";
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

const findSiteOrFail = async (id) => {
  const site = await Site.findById(id);

  if (!site) {
    throw new AppError(httpStatus.NOT_FOUND, "Site not found");
  }

  return site;
};

const findLocationOrFail = (site, locationId) => {
  const location = site.locations.id(locationId);

  if (!location) {
    throw new AppError(httpStatus.NOT_FOUND, "Location not found");
  }

  return location;
};

export const createSite = catchAsync(async (req, res) => {
  const { name, locations } = req.body;

  const trimmedName = name?.trim();
  if (!trimmedName) {
    throw new AppError(httpStatus.BAD_REQUEST, "Site name is required");
  }

  const existing = await Site.findOne({ name: trimmedName });
  if (existing) {
    throw new AppError(httpStatus.CONFLICT, "A site with this name already exists");
  }

  const site = await Site.create({
    name: trimmedName,
    locations: (Array.isArray(locations) ? locations : []).map((location) => ({
      name: location?.name?.trim(),
      latitude: parseCoordinate(location?.latitude, "Latitude", -90, 90),
      longitude: parseCoordinate(location?.longitude, "Longitude", -180, 180),
    })),
  });

  return sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Site created successfully",
    data: site,
  });
});

export const getSites = catchAsync(async (req, res) => {
  const searchTerm = req.query.search?.trim();

  const query = {};
  if (searchTerm) {
    query.name = { $regex: searchTerm, $options: "i" };
  }

  const sites = await Site.find(query).sort({ name: 1 });

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Sites retrieved successfully",
    data: sites,
  });
});

export const getSiteById = catchAsync(async (req, res) => {
  const site = await findSiteOrFail(req.params.id);

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Site retrieved successfully",
    data: site,
  });
});

export const updateSite = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  const site = await findSiteOrFail(id);

  const trimmedName = name?.trim();
  if (!trimmedName) {
    throw new AppError(httpStatus.BAD_REQUEST, "Site name is required");
  }

  const duplicate = await Site.findOne({ name: trimmedName, _id: { $ne: id } });
  if (duplicate) {
    throw new AppError(httpStatus.CONFLICT, "A site with this name already exists");
  }

  site.name = trimmedName;
  await site.save();

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Site updated successfully",
    data: site,
  });
});

export const deleteSite = catchAsync(async (req, res) => {
  const site = await Site.findByIdAndDelete(req.params.id);

  if (!site) {
    throw new AppError(httpStatus.NOT_FOUND, "Site not found");
  }

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Site deleted successfully",
    data: site,
  });
});

export const getSiteLocations = catchAsync(async (req, res) => {
  const site = await findSiteOrFail(req.params.id);

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Locations retrieved successfully",
    data: site.locations,
  });
});

export const createSiteLocation = catchAsync(async (req, res) => {
  const site = await findSiteOrFail(req.params.id);
  const { name, latitude, longitude } = req.body;

  const trimmedName = name?.trim();
  if (!trimmedName) {
    throw new AppError(httpStatus.BAD_REQUEST, "Location name is required");
  }

  site.locations.push({
    name: trimmedName,
    latitude: parseCoordinate(latitude, "Latitude", -90, 90),
    longitude: parseCoordinate(longitude, "Longitude", -180, 180),
  });

  await site.save();

  return sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Location added successfully",
    data: site,
  });
});

export const updateSiteLocation = catchAsync(async (req, res) => {
  const { id, locationId } = req.params;
  const { name, latitude, longitude } = req.body;

  const site = await findSiteOrFail(id);
  const location = findLocationOrFail(site, locationId);

  if (name !== undefined) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new AppError(httpStatus.BAD_REQUEST, "Location name is required");
    }
    location.name = trimmedName;
  }

  if (latitude !== undefined) {
    location.latitude = parseCoordinate(latitude, "Latitude", -90, 90);
  }

  if (longitude !== undefined) {
    location.longitude = parseCoordinate(longitude, "Longitude", -180, 180);
  }

  await site.save();

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Location updated successfully",
    data: site,
  });
});

export const deleteSiteLocation = catchAsync(async (req, res) => {
  const { id, locationId } = req.params;

  const site = await findSiteOrFail(id);
  findLocationOrFail(site, locationId).deleteOne();

  await site.save();

  return sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Location deleted successfully",
    data: site,
  });
});
