const mongoose = require("mongoose");
const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");
const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeText = (value) => String(value ?? "").trim();
const normalizeCode = (value) => normalizeText(value).toUpperCase();

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getTransporterModel = (tenant) => {
  const connection = getReadyTenantConnection(tenant);
  const models = getTenantAccountingModels(connection);
  return models.Transporter;
};

const createTransporter = async ({
  tenant,
  userId,
  payload,
}) => {
  const Transporter = getTransporterModel(tenant);
  const tenantId = tenant._id;

  const transporterId = normalizeCode(payload.transporterId);
  const transporterName = normalizeText(payload.transporterName);

  // Check if identical transporterId already exists for this tenant
  const existing = await Transporter.findOne({
    tenantId,
    transporterId,
    isDeleted: false,
  });

  if (existing) {
    // Update existing details if requested or return it
    existing.transporterName = transporterName;
    if (payload.transportMode) existing.transportMode = payload.transportMode;
    if (payload.vehicleNumber != null)
      existing.vehicleNumber = normalizeCode(payload.vehicleNumber);
    if (payload.vehicleType) existing.vehicleType = payload.vehicleType;
    if (payload.phone != null) existing.phone = normalizeText(payload.phone);
    if (payload.email != null) existing.email = normalizeText(payload.email).toLowerCase();
    if (payload.address != null) existing.address = normalizeText(payload.address);
    if (payload.city != null) existing.city = normalizeText(payload.city);
    if (payload.state != null) existing.state = normalizeText(payload.state);
    if (payload.pincode != null) existing.pincode = normalizeText(payload.pincode);
    if (payload.distanceKm != null) existing.distanceKm = Number(payload.distanceKm) || 0;
    if (payload.status) existing.status = payload.status;
    if (payload.notes != null) existing.notes = normalizeText(payload.notes);
    existing.updatedBy = userId;
    await existing.save();
    return existing.toObject();
  }

  const transporter = await Transporter.create({
    tenantId,
    transporterId,
    transporterName,
    transportMode: payload.transportMode || "ROAD",
    vehicleNumber: normalizeCode(payload.vehicleNumber || ""),
    vehicleType: payload.vehicleType || "REGULAR",
    phone: normalizeText(payload.phone || ""),
    email: normalizeText(payload.email || "").toLowerCase(),
    address: normalizeText(payload.address || ""),
    city: normalizeText(payload.city || ""),
    state: normalizeText(payload.state || ""),
    pincode: normalizeText(payload.pincode || ""),
    distanceKm: Number(payload.distanceKm) || 0,
    status: payload.status || "ACTIVE",
    notes: normalizeText(payload.notes || ""),
    createdBy: userId,
    updatedBy: userId,
  });

  return transporter.toObject();
};

const getTransporters = async ({
  tenant,
  search = "",
  status,
  transportMode,
  page = 1,
  limit = 50,
}) => {
  const Transporter = getTransporterModel(tenant);
  const tenantId = tenant._id;

  const currentPage = Math.max(Math.floor(Number(page) || 1), 1);
  const pageLimit = Math.min(
    Math.max(Math.floor(Number(limit) || 50), 1),
    100,
  );

  const filter = {
    tenantId,
    isDeleted: false,
  };

  if (status) {
    filter.status = status;
  }

  if (transportMode) {
    filter.transportMode = transportMode;
  }

  const text = normalizeText(search);
  if (text) {
    const regex = {
      $regex: escapeRegex(text),
      $options: "i",
    };
    filter.$or = [
      { transporterName: regex },
      { transporterId: regex },
      { vehicleNumber: regex },
      { city: regex },
      { phone: regex },
    ];
  }

  const [data, total] = await Promise.all([
    Transporter.find(filter)
      .sort({ transporterName: 1 })
      .skip((currentPage - 1) * pageLimit)
      .limit(pageLimit)
      .lean(),
    Transporter.countDocuments(filter),
  ]);

  return {
    data,
    pagination: {
      total,
      page: currentPage,
      limit: pageLimit,
      totalPages: Math.ceil(total / pageLimit) || 1,
    },
  };
};

const getTransporterById = async ({ tenant, id }) => {
  const Transporter = getTransporterModel(tenant);
  const transporter = await Transporter.findOne({
    tenantId: tenant._id,
    _id: id,
    isDeleted: false,
  }).lean();

  if (!transporter) {
    throw createError("Transporter not found", 404);
  }

  return transporter;
};

const updateTransporter = async ({
  tenant,
  userId,
  id,
  payload,
}) => {
  const Transporter = getTransporterModel(tenant);

  const transporter = await Transporter.findOne({
    tenantId: tenant._id,
    _id: id,
    isDeleted: false,
  });

  if (!transporter) {
    throw createError("Transporter not found", 404);
  }

  if (payload.transporterName != null) {
    transporter.transporterName = normalizeText(payload.transporterName);
  }
  if (payload.transporterId != null) {
    transporter.transporterId = normalizeCode(payload.transporterId);
  }
  if (payload.transportMode != null) {
    transporter.transportMode = payload.transportMode;
  }
  if (payload.vehicleNumber != null) {
    transporter.vehicleNumber = normalizeCode(payload.vehicleNumber);
  }
  if (payload.vehicleType != null) {
    transporter.vehicleType = payload.vehicleType;
  }
  if (payload.phone != null) {
    transporter.phone = normalizeText(payload.phone);
  }
  if (payload.email != null) {
    transporter.email = normalizeText(payload.email).toLowerCase();
  }
  if (payload.address != null) {
    transporter.address = normalizeText(payload.address);
  }
  if (payload.city != null) {
    transporter.city = normalizeText(payload.city);
  }
  if (payload.state != null) {
    transporter.state = normalizeText(payload.state);
  }
  if (payload.pincode != null) {
    transporter.pincode = normalizeText(payload.pincode);
  }
  if (payload.distanceKm != null) {
    transporter.distanceKm = Number(payload.distanceKm) || 0;
  }
  if (payload.status != null) {
    transporter.status = payload.status;
  }
  if (payload.notes != null) {
    transporter.notes = normalizeText(payload.notes);
  }

  transporter.updatedBy = userId;
  await transporter.save();

  return transporter.toObject();
};

const deleteTransporter = async ({ tenant, userId, id }) => {
  const Transporter = getTransporterModel(tenant);

  const transporter = await Transporter.findOne({
    tenantId: tenant._id,
    _id: id,
    isDeleted: false,
  });

  if (!transporter) {
    throw createError("Transporter not found", 404);
  }

  transporter.isDeleted = true;
  transporter.updatedBy = userId;
  await transporter.save();

  return { success: true, message: "Transporter removed successfully" };
};

module.exports = {
  createTransporter,
  getTransporters,
  getTransporterById,
  updateTransporter,
  deleteTransporter,
};
