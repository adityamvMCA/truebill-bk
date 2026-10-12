const Supplier = require("./supplier.model");

const cleanText = (value) => {
  return String(value || "").trim();
};

const normalizeUppercase = (value) => {
  const text = cleanText(value);

  return text ? text.toUpperCase() : null;
};

const normalizeEmail = (value) => {
  const text = cleanText(value);

  return text ? text.toLowerCase() : null;
};

const normalizeNumber = (value, fallback = 0) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return number;
};

const normalizeNonNegativeNumber = (
  value,
  fallback = 0
) => {
  return Math.max(
    normalizeNumber(value, fallback),
    0
  );
};

const toBoolean = (value) => {
  return (
    value === true ||
    value === "true" ||
    value === 1 ||
    value === "1"
  );
};

const escapeRegExp = (value) => {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
};

const buildSupplierData = (
  body = {},
  existing = {}
) => {
  const supplierName = cleanText(
    body.supplierName ??
      body.name ??
      existing.supplierName ??
      existing.name
  );

  const supplierType =
    body.supplierType ??
    body.type ??
    existing.supplierType ??
    "Business";

  const status =
    body.status ??
    existing.status ??
    "Active";

  return {
    supplierName,

    supplierType:
      supplierType === "Individual"
        ? "Individual"
        : "Business",

    contactPerson: cleanText(
      body.contactPerson ??
        existing.contactPerson
    ) || null,

    phone: cleanText(
      body.phone ?? existing.phone
    ) || null,

    alternatePhone: cleanText(
      body.alternatePhone ??
        existing.alternatePhone
    ) || null,

    email: normalizeEmail(
      body.email ?? existing.email
    ),

    gstNo: normalizeUppercase(
      body.gstNo ?? existing.gstNo
    ),

    panNo: normalizeUppercase(
      body.panNo ?? existing.panNo
    ),

    billingAddress: cleanText(
      body.billingAddress ??
        existing.billingAddress
    ) || null,

    shippingAddress: cleanText(
      body.shippingAddress ??
        existing.shippingAddress
    ) || null,

    city: cleanText(
      body.city ?? existing.city
    ) || null,

    state: cleanText(
      body.state ?? existing.state
    ) || null,

    pincode: cleanText(
      body.pincode ?? existing.pincode
    ) || null,

    country:
      cleanText(
        body.country ?? existing.country
      ) || "India",

    paymentTerms:
      cleanText(
        body.paymentTerms ??
          existing.paymentTerms
      ) || "Due on Receipt",

    creditLimit:
      normalizeNonNegativeNumber(
        body.creditLimit ??
          existing.creditLimit,
        0
      ),

    creditDays: Math.floor(
      normalizeNonNegativeNumber(
        body.creditDays ??
          existing.creditDays,
        0
      )
    ),

    openingBalance:
      normalizeNonNegativeNumber(
        body.openingBalance ??
          existing.openingBalance,
        0
      ),

    openingBalanceType:
      (
        body.openingBalanceType ??
        existing.openingBalanceType ??
        "CREDIT"
      ) === "DEBIT"
        ? "DEBIT"
        : "CREDIT",

    status:
      status === "Inactive"
        ? "Inactive"
        : "Active",

    notes: cleanText(
      body.notes ?? existing.notes
    ) || null,
  };
};

const validateSupplierData = (supplier) => {
  if (!supplier.supplierName) {
    return "Supplier name is required";
  }

  if (
    !["Business", "Individual"].includes(
      supplier.supplierType
    )
  ) {
    return "Supplier type must be Business or Individual";
  }

  if (
    !["Active", "Inactive"].includes(
      supplier.status
    )
  ) {
    return "Status must be Active or Inactive";
  }

  if (
    !["DEBIT", "CREDIT"].includes(
      supplier.openingBalanceType
    )
  ) {
    return "Opening balance type must be DEBIT or CREDIT";
  }

  if (
    supplier.notes &&
    supplier.notes.length > 500
  ) {
    return "Notes cannot exceed 500 characters";
  }

  if (
    supplier.gstNo &&
    supplier.gstNo.length !== 15
  ) {
    return "GST number must contain 15 characters";
  }

  if (
    supplier.panNo &&
    supplier.panNo.length !== 10
  ) {
    return "PAN number must contain 10 characters";
  }

  return null;
};

const generateSupplierCode = async (tenantId) => {
  const lastSupplier =
    await Supplier.findOne({
      tenantId,
      supplierCode: {
        $regex: /^SUP-\d+$/,
      },
    })
      .sort({
        supplierCode: -1,
      })
      .select("supplierCode")
      .lean();

  const currentNumber = Number(
    lastSupplier?.supplierCode
      ?.replace("SUP-", "") || 0
  );

  const nextNumber = currentNumber + 1;

  return `SUP-${String(nextNumber).padStart(
    4,
    "0"
  )}`;
};

const getSuppliers = async ({
  tenantId,
  page = 1,
  limit = 100,
  search = "",
  status,
  supplierType,
  state,
}) => {
  const currentPage = Math.max(
    Number(page) || 1,
    1
  );

  const pageLimit = Math.min(
    Math.max(Number(limit) || 100, 1),
    100
  );

  const filter = {
    tenantId,
    isDeleted: false,
  };

  if (status) {
    filter.status = String(status).trim();
  }

  if (supplierType) {
    filter.supplierType = String(
      supplierType
    ).trim();
  }

  if (state) {
    filter.state = new RegExp(
      escapeRegExp(state),
      "i"
    );
  }

  const searchText = cleanText(search);

  if (searchText) {
    const searchPattern = new RegExp(
      escapeRegExp(searchText),
      "i"
    );

    filter.$or = [
      {
        supplierCode: searchPattern,
      },
      {
        supplierName: searchPattern,
      },
      {
        contactPerson: searchPattern,
      },
      {
        phone: searchPattern,
      },
      {
        email: searchPattern,
      },
      {
        gstNo: searchPattern,
      },
      {
        city: searchPattern,
      },
    ];
  }

  const [suppliers, total] = await Promise.all([
    Supplier.find(filter)
      .select(
        [
          "supplierCode",
          "supplierName",
          "supplierType",
          "contactPerson",
          "phone",
          "alternatePhone",
          "email",
          "gstNo",
          "panNo",
          "city",
          "state",
          "pincode",
          "country",
          "paymentTerms",
          "creditLimit",
          "creditDays",
          "openingBalance",
          "openingBalanceType",
          "payableBalance",
          "status",
          "createdAt",
          "updatedAt",
        ].join(" ")
      )
      .sort({
        createdAt: -1,
        supplierName: 1,
      })
      .skip((currentPage - 1) * pageLimit)
      .limit(pageLimit)
      .lean(),

    Supplier.countDocuments(filter),
  ]);

  return {
    suppliers,

    pagination: {
      page: currentPage,
      limit: pageLimit,
      total,
      totalPages: Math.max(
        Math.ceil(total / pageLimit),
        1
      ),
    },
  };
};

const getSupplierByCode = async ({
  tenantId,
  supplierCode,
}) => {
  const normalizedCode = normalizeUppercase(
    supplierCode
  );

  const supplier = await Supplier.findOne({
    tenantId,
    supplierCode: normalizedCode,
    isDeleted: false,
  }).lean();

  if (!supplier) {
    const error = new Error("Supplier not found");

    error.statusCode = 404;

    throw error;
  }

  return supplier;
};

const createSupplier = async ({
  tenantId,
  userId,
  body,
}) => {
  const data = buildSupplierData(body);

  const validationError =
    validateSupplierData(data);

  if (validationError) {
    const error = new Error(validationError);

    error.statusCode = 400;

    throw error;
  }

  const existingSupplier =
    await Supplier.findOne({
      tenantId,
      supplierName: new RegExp(
        `^${escapeRegExp(data.supplierName)}$`,
        "i"
      ),
      isDeleted: false,
    }).lean();

  if (existingSupplier) {
    const error = new Error(
      "A supplier with this name already exists"
    );

    error.statusCode = 409;

    throw error;
  }

  let supplierCode =
    await generateSupplierCode(tenantId);

  let createdSupplier = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      createdSupplier = await Supplier.create({
        tenantId,
        supplierCode,
        ...data,

        payableBalance:
          data.openingBalanceType === "CREDIT"
            ? data.openingBalance
            : 0,

        createdBy: userId,
        updatedBy: userId,
      });

      break;
    } catch (error) {
      if (
        error?.code === 11000 &&
        attempt < 2
      ) {
        supplierCode =
          await generateSupplierCode(tenantId);

        continue;
      }

      throw error;
    }
  }

  return createdSupplier;
};

const updateSupplier = async ({
  tenantId,
  userId,
  supplierCode,
  body,
}) => {
  const normalizedCode = normalizeUppercase(
    supplierCode
  );

  const supplier = await Supplier.findOne({
    tenantId,
    supplierCode: normalizedCode,
    isDeleted: false,
  });

  if (!supplier) {
    const error = new Error("Supplier not found");

    error.statusCode = 404;

    throw error;
  }

  const data = buildSupplierData(
    body,
    supplier.toObject()
  );

  const validationError =
    validateSupplierData(data);

  if (validationError) {
    const error = new Error(validationError);

    error.statusCode = 400;

    throw error;
  }

  const duplicateSupplier =
    await Supplier.findOne({
      tenantId,
      supplierName: new RegExp(
        `^${escapeRegExp(data.supplierName)}$`,
        "i"
      ),
      isDeleted: false,
      _id: {
        $ne: supplier._id,
      },
    }).lean();

  if (duplicateSupplier) {
    const error = new Error(
      "A supplier with this name already exists"
    );

    error.statusCode = 409;

    throw error;
  }

  Object.assign(supplier, data);

  supplier.updatedBy = userId;

  await supplier.save();

  return supplier;
};

const deleteSupplier = async ({
  tenantId,
  userId,
  supplierCode,
}) => {
  const normalizedCode = normalizeUppercase(
    supplierCode
  );

  const supplier = await Supplier.findOne({
    tenantId,
    supplierCode: normalizedCode,
    isDeleted: false,
  });

  if (!supplier) {
    const error = new Error("Supplier not found");

    error.statusCode = 404;

    throw error;
  }

  /*
    Later, before allowing deletion, check:
    - Purchase bills
    - Purchase orders
    - Supplier payments
    - Outstanding payable balance

    For now this is a soft delete.
  */
  supplier.isDeleted = true;

  supplier.deletedAt = new Date();

  supplier.status = "Inactive";

  supplier.updatedBy = userId;

  await supplier.save();

  return supplier;
};

const updateSupplierPayableBalance = async ({
  tenantId,
  supplierId,
  amount,
  operation = "ADD",
  session = null,
}) => {
  const delta = normalizeNumber(amount, 0);

  const increment =
    operation === "SUBTRACT"
      ? -Math.abs(delta)
      : Math.abs(delta);

  const query = Supplier.findOneAndUpdate(
    {
      _id: supplierId,
      tenantId,
      isDeleted: false,
    },
    {
      $inc: {
        payableBalance: increment,
      },
    },
    {
      new: true,
    }
  );

  if (session) {
    query.session(session);
  }

  const supplier = await query;

  if (!supplier) {
    const error = new Error("Supplier not found");

    error.statusCode = 404;

    throw error;
  }

  return supplier;
};

module.exports = {
  getSuppliers,
  getSupplierByCode,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  updateSupplierPayableBalance,
};