const { runCsvImport, normalizeText } = require("../../../utils/csvImport");
const categoryService = require("../shared/createMasterService")("category");

const normalizeStatus = (value) =>
  normalizeText(value || "ACTIVE").toUpperCase();

const importProductCategories = async ({
  tenant,
  userId,
  buffer,
  ipAddress,
}) => {
  if (!tenant?._id) {
    throw new Error("Tenant context is required");
  }

  if (!userId) {
    throw new Error("User context is required");
  }

  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error("CSV file is required");
  }

  return runCsvImport({
    buffer,
    requiredHeaders: ["name"],
    maxRows: 5000,

    mapRow: (row) => ({
      name: normalizeText(row.name),
      description: normalizeText(row.description),
      status: normalizeStatus(row.status),
    }),

    processRow: async (payload) =>
      categoryService.create({
        tenant,
        userId,
        payload,
        ipAddress,
      }),
  });
};

module.exports = { importProductCategories };