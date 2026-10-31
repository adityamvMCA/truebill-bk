
const { createError } = require("./masterCore");

const MAX_ROWS = 5000;
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const ALLOWED_HEADERS = ["name", "description", "status"];

const parseCsv = (buffer) => {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw createError("Upload a non-empty CSV file in the file field");
  }

  if (buffer.length > MAX_FILE_SIZE) {
    throw createError("CSV file must not exceed 2 MB");
  }

  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");

  if (text.includes("\0")) {
    throw createError("Invalid CSV file");
  }

  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let closed = false;

  const finishField = () => {
    row.push(field);
    field = "";
    closed = false;
  };

  const finishRow = () => {
    finishField();

    if (row.some((value) => value.trim() !== "")) {
      rows.push(row);
    }

    row = [];

    if (rows.length > MAX_ROWS + 1) {
      throw createError("A maximum of 5000 CSV records is supported");
    }
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        field += char;
      }

      continue;
    }

    if (char === ",") {
      finishField();
      continue;
    }

    if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }

      finishRow();
      continue;
    }

    if (char === '"') {
      if (field !== "" || closed) {
        throw createError("Malformed CSV quoting");
      }

      quoted = true;
      continue;
    }

    if (closed) {
      if (char === " " || char === "\t") {
        continue;
      }

      throw createError("Unexpected text after a quoted CSV field");
    }

    field += char;
  }

  if (quoted) {
    throw createError("Unterminated quoted CSV field");
  }

  if (field !== "" || row.length || closed) {
    finishRow();
  }

  if (rows.length < 2) {
    throw createError("CSV must include headers and at least one data record");
  }

  const headers = rows.shift().map((value) => value.trim().toLowerCase());

  if (
    !headers.includes("name") ||
    new Set(headers).size !== headers.length ||
    headers.some((key) => !ALLOWED_HEADERS.includes(key))
  ) {
    throw createError(
      "CSV headers must be name, description and status; only name is required",
    );
  }

  return rows.map((values, index) => {
    if (values.length !== headers.length) {
      throw createError(
        `CSV record ${index + 2} has an incorrect number of fields`,
      );
    }

    return {
      row: index + 2,
      value: Object.fromEntries(
        headers.map((key, fieldIndex) => [
          key,
          values[fieldIndex].trim(),
        ]),
      ),
    };
  });
};

const normalizeRows = (input) => {
  if (!Array.isArray(input) || input.length === 0) {
    throw createError("Rows array is required and must not be empty");
  }

  if (input.length > MAX_ROWS) {
    throw createError("A maximum of 5000 records is supported");
  }

  return input.map((value, index) => {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      throw createError(`Invalid data at row ${index + 1}`);
    }

    const normalized = {};

    for (const [key, item] of Object.entries(value)) {
      const header = String(key).trim().toLowerCase();

      if (!ALLOWED_HEADERS.includes(header)) {
        throw createError(
          `Unsupported field "${key}" at row ${index + 1}`,
        );
      }

      normalized[header] =
        item === null || item === undefined
          ? ""
          : String(item).trim();
    }

    return {
      row: index + 1,
      value: normalized,
    };
  });
};

module.exports = (service, schema) => async (args) => {
  const rows = Array.isArray(args.rows)
    ? normalizeRows(args.rows)
    : parseCsv(args.buffer);

  let createdCount = 0;
  let failedCount = 0;

  const errors = [];

  for (const row of rows) {
    const input = {
      ...row.value,
      status: String(row.value.status || "ACTIVE")
        .trim()
        .toUpperCase(),
    };

    const { error, value } = schema.validate(input, {
      abortEarly: false,
      convert: true,
    });

    if (error) {
      failedCount += 1;

      errors.push({
        row: row.row,
        message: error.details
          .map((detail) => detail.message)
          .join(", "),
      });

      continue;
    }

    try {
      await service.create({
        ...args,
        payload: value,
      });

      createdCount += 1;
    } catch (requestError) {
      const status = requestError.statusCode;

      if (!status || status >= 500) {
        return {
          createdCount,
          failedCount,
          totalCount: rows.length,
          unprocessedCount:
            rows.length - createdCount - failedCount,
          requiresVerification: true,
          message:
            "Import stopped after an unconfirmed error. Check the list before retrying; the current row may have committed.",
          errors: [
            ...errors,
            {
              row: row.row,
              message: requestError.message,
            },
          ],
        };
      }

      failedCount += 1;

      errors.push({
        row: row.row,
        message: requestError.message,
      });
    }
  }

  return {
    createdCount,
    failedCount,
    totalCount: rows.length,
    unprocessedCount: 0,
    requiresVerification: false,
    errors,
  };
};
