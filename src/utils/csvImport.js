const { parse } = require("csv-parse/sync");

const normalizeHeader = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const normalizeText = (value) => String(value ?? "").trim();

const parseBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = normalizeText(value).toLowerCase();

  if (["true", "yes", "1", "y"].includes(normalized)) {
    return true;
  }

  if (["false", "no", "0", "n"].includes(normalized)) {
    return false;
  }

  return fallback;
};

const parseNumber = (value, fallback = 0) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return fallback;
  }

  const number = Number(normalized.replace(/,/g, ""));

  return Number.isFinite(number) ? number : fallback;
};

const parseCsvBuffer = (buffer) => {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    const error = new Error("CSV file is required");

    error.statusCode = 400;

    throw error;
  }

  const content = buffer.toString("utf-8").replace(/^\uFEFF/, "");

  if (!content.trim()) {
    const error = new Error("CSV file is empty");

    error.statusCode = 400;

    throw error;
  }

  let records;

  try {
    records = parse(content, {
      columns: (headers) => headers.map(normalizeHeader),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    });
  } catch (parseError) {
    const error = new Error("Invalid CSV file format");

    error.statusCode = 400;

    error.cause = parseError;

    throw error;
  }

  if (!records.length) {
    const error = new Error("CSV file has no data rows");

    error.statusCode = 400;

    throw error;
  }

  return records;
};

const validateRequiredHeaders = (records, requiredHeaders = []) => {
  const headers = Object.keys(records[0] || {});

  const missingHeaders = requiredHeaders.filter(
    (header) => !headers.includes(normalizeHeader(header)),
  );

  if (missingHeaders.length) {
    const error = new Error(
      `Missing required CSV columns: ${missingHeaders.join(", ")}`,
    );

    error.statusCode = 400;

    throw error;
  }
};

const runCsvImport = async ({
  buffer,
  requiredHeaders = [],
  maxRows = 500,
  mapRow,
  processRow,
}) => {
  const records = parseCsvBuffer(buffer);

  validateRequiredHeaders(records, requiredHeaders);

  if (records.length > maxRows) {
    const error = new Error(
      `CSV import supports a maximum of ${maxRows} rows per upload`,
    );

    error.statusCode = 400;

    throw error;
  }

  const created = [];

  const errors = [];

  for (let index = 0; index < records.length; index += 1) {
    const rowNumber = index + 2;

    try {
      const mappedRow = mapRow
        ? mapRow(records[index], rowNumber)
        : records[index];

      const result = await processRow(mappedRow, rowNumber);

      created.push(result);
    } catch (rowError) {
      errors.push({
        row: rowNumber,
        message: rowError.message || "Unable to import this row",
      });
    }
  }

  return {
    totalRows: records.length,
    successCount: created.length,
    failureCount: errors.length,
    created,
    errors,
  };
};

module.exports = {
  normalizeHeader,
  normalizeText,
  parseBoolean,
  parseNumber,
  parseCsvBuffer,
  validateRequiredHeaders,
  runCsvImport,
};
