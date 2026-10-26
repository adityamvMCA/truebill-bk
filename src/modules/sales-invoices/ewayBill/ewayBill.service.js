const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../../tenancy/tenantConnectionManager");

const rules = require("./ewayBill.rules");

const DETAIL_FIELDS = [
  "distanceKm",
  "transportMode",
  "vehicleType",
  "vehicleNumber",
  "transporterId",
  "transporterName",
  "transportDocNumber",
  "transportDocDate",
  "fromPlace",
  "fromPincode",
  "fromStateCode",
  "toPlace",
  "toPincode",
  "toStateCode",
];

const CLOCK_SKEW_MS = 5 * 60 * 1000;

/* ==========================================
   HELPERS
   ========================================== */

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;

  return error;
};

const normalizeText = (value) => String(value ?? "").trim();

const optionalText = (value) => normalizeText(value) || null;

const normalizeCode = (value) => normalizeText(value).toUpperCase();

const validateObjectId = (value, fieldName) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createError(`${fieldName} must be a valid ObjectId`);
  }

  return value;
};

const dateOnly = (value) => {
  if (value === undefined || value === null || value === "") return null;

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw createError("Transport document date is invalid");
  }

  return date;
};

const requireDate = (value, label) => {
  const date = new Date(value);

  if (value === undefined || value === null || Number.isNaN(date.getTime())) {
    throw createError(`${label} is invalid`);
  }

  return date;
};

const assertVersion = (document, version) => {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw createError("A valid invoice version is required");
  }

  if (document.__v !== version) {
    throw createError("The invoice changed. Refresh before continuing.", 409);
  }
};

const translateError = (error) => {
  if (error?.code === 11000) {
    return createError(
      "This e-way bill number is already recorded against another invoice.",
      409,
    );
  }

  if (error?.name === "VersionError") {
    return createError("The invoice changed. Refresh before continuing.", 409);
  }

  return error;
};

const resolveContext = ({ tenant, ...args }) => {
  const tenantId = tenant?._id ?? tenant?.id;

  validateObjectId(tenantId, "tenantId");

  const connection = getReadyTenantConnection(tenant);
  const models = getTenantAccountingModels(connection);

  for (const name of ["SalesInvoice", "AuditLog"]) {
    if (!models[name] || models[name].db !== connection) {
      throw createError(
        `Tenant model ${name} is unavailable or uses the wrong connection`,
        500,
      );
    }
  }

  /*
   * Fail loudly if the SalesInvoice model was not patched. Without these
   * paths Mongoose (strict mode) silently drops every e-way bill write.
   */
  const ewbPath = models.SalesInvoice.schema.path("ewayBill");

  if (
    !ewbPath ||
    !ewbPath.schema ||
    !ewbPath.schema.path("history") ||
    !models.SalesInvoice.schema.path("ewayBillRequired")
  ) {
    throw createError(
      "The SalesInvoice model is missing the ewayBill / ewayBillRequired fields. Add them to the model (see ewayBill.schema.js) and restart the server.",
      500,
    );
  }

  return { ...args, tenant, tenantId, connection, models };
};

const runTransaction = async (args, operation) => {
  const context = resolveContext(args);

  validateObjectId(context.userId, "userId");

  const session = await context.connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      result = await operation({ ...context, session });
    });

    return result;
  } catch (error) {
    throw translateError(error);
  } finally {
    await session.endSession();
  }
};

/*
 * THE ONE ADAPTER POINT.
 * Map your tenant / company profile to the supplier details printed
 * on the e-way bill. Adjust the property names to match your tenant
 * document.
 */
const resolveSupplier = (tenant) => {
  const profile = tenant.companyProfile || tenant.company || tenant;

  return {
    gstin: normalizeCode(profile.gstin ?? profile.gstNo ?? profile.gstNumber),

    name: normalizeText(
      profile.legalName ?? profile.companyName ?? profile.name,
    ),

    address: [
      profile.addressLine1 ?? profile.address,
      profile.addressLine2,
      profile.city,
    ]
      .filter(Boolean)
      .join(", "),

    pincode: normalizeText(
      profile.pincode ?? profile.pinCode ?? profile.postalCode,
    ),

    stateCode: normalizeText(profile.stateCode),
  };
};

const loadInvoice = async (context, invoiceNumber, allowedStatuses) => {
  const invoice = await context.models.SalesInvoice.findOne({
    tenantId: context.tenantId,
    invoiceNumber: normalizeCode(invoiceNumber),
    isDeleted: false,
  }).session(context.session);

  if (!invoice) {
    throw createError("Sales invoice not found", 404);
  }

  if (!allowedStatuses.includes(invoice.status)) {
    throw createError(
      `This action is not available for ${invoice.status.toLowerCase()} invoices`,
      409,
    );
  }

  if (!rules.goodsTotals(invoice).hasGoods) {
    throw createError(
      "E-way bills apply only to invoices that contain goods",
      409,
    );
  }

  if (!invoice.ewayBill) {
    invoice.set("ewayBill", {});
  }

  if (!Array.isArray(invoice.ewayBill.history)) {
    invoice.set("ewayBill.history", []);
  }

  return invoice;
};

const snapshot = (invoice) => ({
  ewayBill: invoice.ewayBill?.toObject
    ? invoice.ewayBill.toObject()
    : invoice.ewayBill,
});

const record = (invoice, type, userId, data = null) => {
  const entry = {
    type,
    at: new Date(),
    by: userId,
    data,
  };

  if (!invoice.ewayBill.history) {
    invoice.set("ewayBill.history", [entry]);
    return;
  }

  invoice.ewayBill.history.push(entry);
};

const audit = async (context, invoice, action, oldData) => {
  await context.models.AuditLog.create(
    [
      {
        tenantId: context.tenantId,
        userId: context.userId,
        action,
        module: "SALES_INVOICE",
        documentId: invoice._id,
        oldData,
        newData: snapshot(invoice),
        ipAddress: context.ipAddress,
      },
    ],
    { session: context.session, ordered: true },
  );
};

const requireGenerated = (invoice) => {
  if (invoice.ewayBill.status !== "GENERATED") {
    throw createError("This invoice has no active e-way bill", 409);
  }
};

const requireRemarks = (reason, remarks) => {
  if (reason === "OTHERS" && !optionalText(remarks)) {
    throw createError("Remarks are required when the reason is Others");
  }
};

/* ==========================================
   SAVE TRANSPORT DETAILS
   ========================================== */

const saveDetails = async (args) =>
  runTransaction(args, async (context) => {
    const payload = args.payload || {};

    const invoice = await loadInvoice(context, args.invoiceNumber, [
      "CREATED",
      "POSTED",
    ]);

    assertVersion(invoice, payload.version);

    if (invoice.ewayBill.status === "GENERATED") {
      throw createError(
        "An e-way bill is active. Use Update Vehicle, Extend Validity or Cancel instead.",
        409,
      );
    }

    const oldData = snapshot(invoice);

    for (const field of DETAIL_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(payload, field)) continue;

      let value = payload[field];

      if (field === "transportDocDate") {
        value = dateOnly(value);
      } else if (typeof value === "string" || value == null) {
        value = optionalText(value);

        if (value && ["vehicleNumber", "transporterId"].includes(field)) {
          value = value.toUpperCase();
        }
      }

      invoice.set(`ewayBill.${field}`, value);
    }

    record(invoice, "DETAILS_SAVED", context.userId);

    invoice.updatedBy = context.userId;

    await invoice.save({ session: context.session });

    await audit(context, invoice, "EWB_DETAILS", oldData);

    return invoice.toObject();
  });

/* ==========================================
   EXPORT PORTAL JSON
   ========================================== */

const exportPortalJson = async (args) => {
  const context = resolveContext(args);

  const invoice = await context.models.SalesInvoice.findOne({
    tenantId: context.tenantId,
    invoiceNumber: normalizeCode(args.invoiceNumber),
    isDeleted: false,
  }).lean();

  if (!invoice) {
    throw createError("Sales invoice not found", 404);
  }

  if (invoice.ewayBill?.status === "GENERATED") {
    throw createError(
      "An e-way bill is already recorded for this invoice",
      409,
    );
  }

  const supplier = resolveSupplier(context.tenant);

  const problems = rules.validateForGeneration(invoice, supplier);

  if (problems.length) {
    const error = createError(problems.join(" "), 422);
    error.details = problems;

    throw error;
  }

  return {
    fileName: `EWB_${invoice.invoiceNumber.replace(/[^A-Z0-9-]/g, "_")}.json`,
    payload: rules.buildPortalPayload(invoice, supplier),
  };
};

/* ==========================================
   RECORD A PORTAL-GENERATED E-WAY BILL
   ========================================== */

const recordGenerated = async (args) =>
  runTransaction(args, async (context) => {
    const payload = args.payload || {};

    const invoice = await loadInvoice(context, args.invoiceNumber, ["POSTED"]);

    assertVersion(invoice, payload.version);

    const ewb = invoice.ewayBill;

    if (ewb.status === "GENERATED") {
      throw createError(
        "An e-way bill is already active. Cancel it before recording another.",
        409,
      );
    }

    if (!rules.EWB_NUMBER_REGEX.test(String(payload.ewbNumber ?? ""))) {
      throw createError("E-way bill number must be 12 digits");
    }

    const now = new Date();
    const ewbDate = requireDate(payload.ewbDate, "E-way bill date");

    if (ewbDate.getTime() > now.getTime() + CLOCK_SKEW_MS) {
      throw createError("E-way bill date cannot be in the future");
    }

    if (
      ewbDate.getTime() <
      new Date(invoice.invoiceDate).getTime() - rules.IST_OFFSET_MS
    ) {
      throw createError("E-way bill date cannot be before the invoice date");
    }

    let validUntil = payload.validUntil
      ? requireDate(payload.validUntil, "Valid-until date")
      : null;

    if (!validUntil) {
      if (!ewb.distanceKm) {
        throw createError(
          "Enter the valid-until time from the portal, or save the distance first.",
        );
      }

      validUntil = rules.computeValidUntil(
        ewbDate,
        ewb.distanceKm,
        ewb.vehicleType,
      );
    }

    if (validUntil <= ewbDate) {
      throw createError("Valid-until must be after the e-way bill date");
    }

    const oldData = snapshot(invoice);

    ewb.status = "GENERATED";
    ewb.source = "MANUAL";
    ewb.ewbNumber = payload.ewbNumber;
    ewb.ewbDate = ewbDate;
    ewb.validUntil = validUntil;

    ewb.cancelledAt = null;
    ewb.cancelledBy = null;
    ewb.cancelReason = null;
    ewb.cancelRemarks = null;

    record(invoice, "GENERATED", context.userId, {
      ewbNumber: payload.ewbNumber,
      validUntil,
    });

    invoice.updatedBy = context.userId;

    await invoice.save({ session: context.session });

    await audit(context, invoice, "EWB_GENERATED", oldData);

    return invoice.toObject();
  });

/* ==========================================
   UPDATE VEHICLE (PART B)
   ========================================== */

const updateVehicle = async (args) =>
  runTransaction(args, async (context) => {
    const payload = args.payload || {};

    const invoice = await loadInvoice(context, args.invoiceNumber, ["POSTED"]);

    assertVersion(invoice, payload.version);
    requireGenerated(invoice);

    const ewb = invoice.ewayBill;

    if (new Date(ewb.validUntil) <= new Date()) {
      throw createError(
        "This e-way bill has expired. Extend its validity first.",
        409,
      );
    }

    requireRemarks(payload.reason, payload.remarks);

    const newVehicle = normalizeCode(payload.vehicleNumber);

    if (!newVehicle) {
      throw createError("Vehicle number is required");
    }

    const oldData = snapshot(invoice);
    const previousVehicle = ewb.vehicleNumber;

    ewb.vehicleNumber = newVehicle;
    ewb.fromPlace = optionalText(payload.fromPlace) || ewb.fromPlace;
    ewb.fromStateCode =
      optionalText(payload.fromStateCode) || ewb.fromStateCode;

    if (payload.transportDocNumber !== undefined) {
      ewb.transportDocNumber = optionalText(payload.transportDocNumber);
    }

    if (payload.transportDocDate !== undefined) {
      ewb.transportDocDate = dateOnly(payload.transportDocDate);
    }

    record(invoice, "VEHICLE_UPDATED", context.userId, {
      from: previousVehicle,
      to: newVehicle,
      reason: payload.reason,
      remarks: optionalText(payload.remarks),
    });

    invoice.updatedBy = context.userId;

    await invoice.save({ session: context.session });

    await audit(context, invoice, "EWB_VEHICLE", oldData);

    return invoice.toObject();
  });

/* ==========================================
   EXTEND VALIDITY

   Allowed from 8 hours before until 8 hours
   after the current expiry.
   ========================================== */

const extendValidity = async (args) =>
  runTransaction(args, async (context) => {
    const payload = args.payload || {};

    const invoice = await loadInvoice(context, args.invoiceNumber, ["POSTED"]);

    assertVersion(invoice, payload.version);
    requireGenerated(invoice);

    const ewb = invoice.ewayBill;
    const now = Date.now();
    const expiry = new Date(ewb.validUntil).getTime();

    if (
      now < expiry - rules.EXTEND_WINDOW_MS ||
      now > expiry + rules.EXTEND_WINDOW_MS
    ) {
      throw createError(
        "Validity can be extended only from 8 hours before to 8 hours after expiry.",
        409,
      );
    }

    requireRemarks(payload.reason, payload.remarks);

    const newValidUntil = requireDate(payload.newValidUntil, "New validity");

    if (newValidUntil.getTime() <= expiry) {
      throw createError("New validity must be later than the current validity");
    }

    const oldData = snapshot(invoice);

    ewb.validUntil = newValidUntil;

    record(invoice, "VALIDITY_EXTENDED", context.userId, {
      previousValidUntil: new Date(expiry),
      newValidUntil,
      reason: payload.reason,
      remarks: optionalText(payload.remarks),
      remainingDistanceKm: payload.remainingDistanceKm,
      currentPlace: optionalText(payload.currentPlace),
      currentStateCode: optionalText(payload.currentStateCode),
    });

    invoice.updatedBy = context.userId;

    await invoice.save({ session: context.session });

    await audit(context, invoice, "EWB_EXTENDED", oldData);

    return invoice.toObject();
  });

/* ==========================================
   CANCEL

   Only within 24 hours of generation.
   The portal also blocks cancellation once
   the receiver has accepted or goods have
   been verified in transit, so cancel there
   first, then record it here.
   ========================================== */

const cancelEwayBill = async (args) =>
  runTransaction(args, async (context) => {
    const payload = args.payload || {};

    const invoice = await loadInvoice(context, args.invoiceNumber, [
      "POSTED",
      "CANCELLED",
    ]);

    assertVersion(invoice, payload.version);
    requireGenerated(invoice);

    const ewb = invoice.ewayBill;

    if (Date.now() - new Date(ewb.ewbDate).getTime() > rules.CANCEL_WINDOW_MS) {
      throw createError(
        "An e-way bill can be cancelled only within 24 hours of generation.",
        409,
      );
    }

    requireRemarks(payload.reason, payload.remarks);

    const oldData = snapshot(invoice);

    ewb.status = "CANCELLED";
    ewb.cancelledAt = new Date();
    ewb.cancelledBy = context.userId;
    ewb.cancelReason = payload.reason;
    ewb.cancelRemarks = optionalText(payload.remarks);

    record(invoice, "CANCELLED", context.userId, {
      ewbNumber: ewb.ewbNumber,
      reason: payload.reason,
      remarks: optionalText(payload.remarks),
    });

    invoice.updatedBy = context.userId;

    await invoice.save({ session: context.session });

    await audit(context, invoice, "EWB_CANCELLED", oldData);

    return invoice.toObject();
  });

module.exports = {
  saveDetails,
  exportPortalJson,
  recordGenerated,
  updateVehicle,
  extendValidity,
  cancelEwayBill,
  resolveSupplier,
};