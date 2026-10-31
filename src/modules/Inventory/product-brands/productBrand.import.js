const service = require("../shared/createMasterService")("brand");

const {
  createProductBrandSchema,
} = require("./productBrand.validation");

const createCsvImporter = require("../shared/masterCsv");

const importProductBrands = createCsvImporter(
  service,
  createProductBrandSchema,
);

module.exports = {
  importProductBrands,
};