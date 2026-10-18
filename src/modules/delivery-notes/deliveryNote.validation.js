const Joi = require("joi");

const DELIVERY_NOTE_STATUSES = [
  "CREATED",
  "DISPATCHED",
  "DELIVERED",
  "CANCELLED",
];

/* ==========================================
   SHARED FIELDS
   ========================================== */

const objectId = Joi.string()
  .trim()
  .pattern(/^[a-fA-F0-9]{24}$/)
  .messages({
    "string.pattern.base": "{{#label}} must be a valid ObjectId",
  });

const optionalText = (maxLength) =>
  Joi.string().trim().max(maxLength).allow("", null);
const dateOnly = Joi.string()
  .trim()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .custom((value, helpers) => {
    // Keep date-only input as a date-only string.
    // Do not use .isoDate(), which can normalize it
    // into a full timestamp when convert is enabled.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return helpers.error("string.pattern.base");
    }

    const date = new Date(`${value}T00:00:00.000Z`);

    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      return helpers.message({
        custom: "{{#label}} must be a valid calendar date in YYYY-MM-DD format",
      });
    }

    return value;
  }, "calendar date validation")
  .messages({
    "string.pattern.base": "{{#label}} must use YYYY-MM-DD format",
  });

const optionalDate = dateOnly.allow("", null);
const version = Joi.number()
  .integer()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .strict()
  .messages({
    "any.required": "Document version is required",
    "number.base": "Document version must be a number",
    "number.integer": "Document version must be an integer",
    "number.min": "Document version cannot be negative",
  });

const quantity = Joi.number()
  .min(0.001)
  .max(1000000)
  .precision(3)
  .strict()
  .required()
  .messages({
    "any.required": "Item quantity is required",
    "number.base": "Item quantity must be a number",
    "number.min": "Item quantity must be at least 0.001",
    "number.max": "Item quantity cannot exceed 1,000,000",
    "number.precision": "Item quantity must have at most three decimal places",
  });

/* ==========================================
   ITEM INPUT

   Product/customer snapshots, inventory flags,
   stock movements, users, and statuses are
   resolved by the backend—not accepted here.
   ========================================== */

const itemSchema = Joi.object({
  lineId: objectId,

  salesOrderLineId: objectId,

  productId: objectId.required(),

  quantity,

  specification: optionalText(1000),

  notes: optionalText(500),
}).unknown(false);

const itemsSchema = Joi.array()
  .items(itemSchema)
  .min(1)
  .max(200)
  .unique(
    (first, second) =>
      String(first.productId).toLowerCase() ===
      String(second.productId).toLowerCase(),
  )
  .messages({
    "array.min": "A delivery note requires at least one item",
    "array.max": "A delivery note cannot contain more than 200 items",
    "array.unique": "A product can appear only once in a delivery note",
  });

/* ==========================================
   EDITABLE DOCUMENT FIELDS

   No defaults on optional editable fields:
   omission must remain distinct from clearing.
   ========================================== */

const editableFields = {
  deliveryDate: dateOnly,

  expectedDeliveryDate: optionalDate,

  contactPerson: optionalText(150),

  contactPhone: optionalText(30),

  billingAddress: optionalText(2000),

  // Omission allows backend Customer/order fallback.
  // An explicitly supplied address must be non-empty.
  shippingAddress: Joi.string().trim().min(1).max(2000),

  customerReference: optionalText(100),

  transporterName: optionalText(200),

  vehicleNumber: Joi.string().trim().uppercase().max(30).allow("", null),

  trackingNumber: optionalText(100),

  transportDocumentNumber: optionalText(100),

  transportDocumentDate: optionalDate,

  eWayBillNumber: optionalText(50),

  items: itemsSchema,

  notes: optionalText(1000),

  termsAndConditions: optionalText(5000),
};

/* ==========================================
   CROSS-FIELD HELPERS
   ========================================== */

const validateDateOrder = (value, helpers) => {
  if (
    value.deliveryDate &&
    value.expectedDeliveryDate &&
    value.expectedDeliveryDate < value.deliveryDate
  ) {
    return helpers.message({
      custom: "Expected delivery date cannot be before delivery note date",
    });
  }

  return value;
};

const validateItemReferences = (value, helpers) => {
  const linked = Boolean(value.sourceSalesOrderId);

  const lineIds = new Set();
  const orderLineIds = new Set();

  for (const item of value.items || []) {
    if (item.lineId) {
      const key = item.lineId.toLowerCase();

      if (lineIds.has(key)) {
        return helpers.message({
          custom: "Each delivery note item must have a unique lineId",
        });
      }

      lineIds.add(key);
    }

    if (linked && !item.salesOrderLineId) {
      return helpers.message({
        custom: "Each linked item requires a salesOrderLineId",
      });
    }

    if (!linked && item.salesOrderLineId) {
      return helpers.message({
        custom:
          "Standalone delivery note items cannot reference Sales Order lines",
      });
    }

    if (item.salesOrderLineId) {
      const key = item.salesOrderLineId.toLowerCase();

      if (orderLineIds.has(key)) {
        return helpers.message({
          custom: "A Sales Order line can appear only once in a delivery note",
        });
      }

      orderLineIds.add(key);
    }
  }

  return value;
};

/* ==========================================
   CREATE

   Initial status is always CREATED.
   No SAVE_AND_DISPATCH action is accepted.
   ========================================== */

const createDeliveryNoteSchema = Joi.object({
  ...editableFields,

  customerId: objectId.required(),

  sourceSalesOrderId: objectId,

  deliveryDate: dateOnly.required(),

  items: itemsSchema.required(),
})
  .unknown(false)
  .custom(validateDateOrder)
  .custom(validateItemReferences);

/* ==========================================
   UPDATE CREATED NOTE

   Customer and source order remain unchanged.
   Service must merge fields with the stored
   document and validate the combined result.
   ========================================== */

const EDITABLE_KEYS = Object.keys(editableFields);

const updateDeliveryNoteSchema = Joi.object({
  ...editableFields,

  version: version.required(),
})
  .unknown(false)
  .custom((value, helpers) => {
    const hasChange = EDITABLE_KEYS.some((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    );

    if (!hasChange) {
      return helpers.message({
        custom: "Provide at least one editable field",
      });
    }

    const lineIds = new Set();
    const orderLineIds = new Set();

    for (const item of value.items || []) {
      if (item.lineId) {
        const key = item.lineId.toLowerCase();

        if (lineIds.has(key)) {
          return helpers.message({
            custom: "Each delivery note item must have a unique lineId",
          });
        }

        lineIds.add(key);
      }

      if (item.salesOrderLineId) {
        const key = item.salesOrderLineId.toLowerCase();

        if (orderLineIds.has(key)) {
          return helpers.message({
            custom:
              "A Sales Order line can appear only once in a delivery note",
          });
        }

        orderLineIds.add(key);
      }
    }

    return value;
  })
  .custom(validateDateOrder);

/* ==========================================
   CREATE FROM SALES ORDER

   Body contains only document/transport
   overrides and selected order lines.
   Customer and products come from the order.
   ========================================== */

const orderSelectionItemSchema = Joi.object({
  salesOrderLineId: objectId.required(),

  quantity,

  notes: optionalText(500),
}).unknown(false);

const fromSalesOrderSchema = Joi.object({
  deliveryDate: dateOnly.required(),

  expectedDeliveryDate: optionalDate,

  contactPerson: optionalText(150),

  contactPhone: optionalText(30),

  billingAddress: optionalText(2000),

  shippingAddress: Joi.string().trim().min(1).max(2000),

  customerReference: optionalText(100),

  transporterName: optionalText(200),

  vehicleNumber: Joi.string().trim().uppercase().max(30).allow("", null),

  trackingNumber: optionalText(100),

  transportDocumentNumber: optionalText(100),

  transportDocumentDate: optionalDate,

  eWayBillNumber: optionalText(50),

  // Explicit selection prevents unintentionally
  // copying every order line into a shipment.
  items: Joi.array()
    .items(orderSelectionItemSchema)
    .min(1)
    .max(200)
    .unique(
      (first, second) =>
        first.salesOrderLineId.toLowerCase() ===
        second.salesOrderLineId.toLowerCase(),
    )
    .required()
    .messages({
      "array.unique": "A Sales Order line can be selected only once",
    }),

  notes: optionalText(1000),

  termsAndConditions: optionalText(5000),
})
  .unknown(false)
  .custom(validateDateOrder);

/* ==========================================
   WORKFLOW REQUEST BODIES
   ========================================== */

const dispatchDeliveryNoteSchema = Joi.object({
  version: version.required(),

  dispatchRemarks: optionalText(1000),
}).unknown(false);

const deliverDeliveryNoteSchema = Joi.object({
  version: version.required(),

  receivedByName: Joi.string().trim().min(1).max(150).required(),

  receivedByPhone: optionalText(30),

  deliveryRemarks: optionalText(1000),
}).unknown(false);

const cancelDeliveryNoteSchema = Joi.object({
  version: version.required(),

  cancellationReason: Joi.string().trim().min(1).max(1000).required(),
}).unknown(false);

const deleteDeliveryNoteSchema = Joi.object({
  version: version.required(),
}).unknown(false);

/* ==========================================
   ROUTE PARAMS

   Version never belongs in URL params.
   ========================================== */

const deliveryNoteParamsSchema = Joi.object({
  deliveryNoteNumber: Joi.string().trim().uppercase().max(100).required(),
}).unknown(false);

const salesOrderParamsSchema = Joi.object({
  orderNumber: Joi.string().trim().uppercase().max(100).required(),
}).unknown(false);

/* ==========================================
   LIST QUERY
   ========================================== */

const listDeliveryNotesSchema = Joi.object({
  search: Joi.string().trim().max(100).allow("").default(""),

  status: Joi.string().valid(...DELIVERY_NOTE_STATUSES),

  customerId: objectId,

  sourceSalesOrderId: objectId,

  fromDate: dateOnly,

  toDate: dateOnly,

  page: Joi.number().integer().min(1).default(1),

  limit: Joi.number().integer().min(1).max(100).default(20),
})
  .unknown(false)
  .custom((value, helpers) => {
    if (value.fromDate && value.toDate && value.toDate < value.fromDate) {
      return helpers.message({
        custom: "End date cannot be before start date",
      });
    }

    return value;
  });

/* ==========================================
   VALIDATION MIDDLEWARE
   ========================================== */

const validate = (schema, source = "body") => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source] ?? {}, {
      abortEarly: false,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map((detail) => detail.message),
      });
    }

    if (source === "body") {
      req.validatedBody = value;
    } else if (source === "query") {
      req.validatedQuery = value;
    } else {
      req.validatedParams = value;
    }

    return next();
  };
};

module.exports = {
  validateCreateDeliveryNote: validate(createDeliveryNoteSchema),

  validateUpdateDeliveryNote: validate(updateDeliveryNoteSchema),

  validateCreateDeliveryNoteFromOrder: validate(fromSalesOrderSchema),

  validateDispatchDeliveryNote: validate(dispatchDeliveryNoteSchema),

  validateDeliverDeliveryNote: validate(deliverDeliveryNoteSchema),

  validateCancelDeliveryNote: validate(cancelDeliveryNoteSchema),

  validateDeleteDeliveryNote: validate(deleteDeliveryNoteSchema),

  validateDeliveryNoteParams: validate(deliveryNoteParamsSchema, "params"),

  validateSalesOrderParams: validate(salesOrderParamsSchema, "params"),

  validateListDeliveryNotes: validate(listDeliveryNotesSchema, "query"),
};
