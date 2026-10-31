const service = require("./hsnSacCode.service");

const { importHsnSacCodes } = require("./hsnSacCode.import");

const getContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
  code: req.validatedParams?.code,
  payload: req.validatedBody,
});

// CSV parser
const parseCsv = (csv) => {
  const rows = [];
  let row = [];
  let value = "";
  let insideQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    const next = csv[i + 1];

    if (char === '"') {
      if (insideQuotes && next === '"') {
        value += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      row.push(value);
      value = "";
    } else if (
      (char === "\n" || char === "\r") &&
      !insideQuotes
    ) {
      if (char === "\r" && next === "\n") {
        i++;
      }

      row.push(value);

      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row);
      }

      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value);

  if (row.some((cell) => cell.trim() !== "")) {
    rows.push(row);
  }

  if (rows.length < 2) {
    throw new Error(
      "CSV must contain headers and at least one data row."
    );
  }

  const headers = rows[0].map((header) =>
    String(header)
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
  );

  return rows.slice(1).map((cells) => {
    const result = {};

    headers.forEach((header, index) => {
      result[header] = cells[index] ?? "";
    });

    return result;
  });
};

const createHsnSacCode = async (req, res, next) => {
  try {
    const data = await service.createHsnSacCode(getContext(req));

    return res.status(201).json({
      success: true,
      message: "HSN/SAC code created successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const listHsnSacCodes = async (req, res, next) => {
  try {
    const result = await service.listHsnSacCodes({
      ...req.validatedQuery,
      tenant: req.tenant,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    return next(error);
  }
};

const getHsnSacCode = async (req, res, next) => {
  try {
    const data = await service.getHsnSacCode(getContext(req));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const updateHsnSacCode = async (req, res, next) => {
  try {
    const data = await service.updateHsnSacCode(getContext(req));

    return res.status(200).json({
      success: true,
      message: "HSN/SAC code updated successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

// Import HSN/SAC CSV
const importCodes = (req, res, next) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({
        success: false,
        message: "CSV file is required.",
      });
    }

    const csv = req.file.buffer.toString("utf8");

    req.body = req.body || {};
    req.body.rows = parseCsv(csv);

    // Pass the Express request, response and next
    // to the shared bulk import middleware.
    return importHsnSacCodes(req, res, next);
  } catch (error) {
    return res.status(400).json({
      success: false,
      message:
        error.message || "Unable to process HSN/SAC CSV file.",
    });
  }
};

const bulkUpdateStatus = async (req, res, next) => {
  try {
    const result = await service.bulkUpdateHsnSacCodeStatus({
      tenant: req.tenant,
      userId: req.user.userId,
      ipAddress: req.ip,
      payload: req.validatedBody,
    });

    return res.status(200).json({
      success: true,
      message: "HSN/SAC statuses updated successfully",
      data: result,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createHsnSacCode,
  listHsnSacCodes,
  getHsnSacCode,
  updateHsnSacCode,
  importCodes,
  bulkUpdateStatus,
};