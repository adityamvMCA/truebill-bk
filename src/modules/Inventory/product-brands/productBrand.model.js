const createSchema = require("../shared/masterSchema");
module.exports = createSchema({
  modelName: "ProductBrand",
  codeField: "brandCode",
  legacyCode: true,
});
