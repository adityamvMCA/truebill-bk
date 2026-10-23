const createSchema = require("../shared/masterSchema");
module.exports = createSchema({
  modelName: "ProductCategory",
  codeField: "categoryCode",
  legacyCode: false,
});
