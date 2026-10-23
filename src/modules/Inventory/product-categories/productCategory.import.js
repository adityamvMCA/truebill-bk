const service = require("../shared/createMasterService")("category");
const { createProductCategorySchema } = require("./productCategory.validation");
module.exports = {
  importProductCategories: require("../shared/masterCsv")(service, createProductCategorySchema),
};
