const validation = require("../shared/createMasterValidation")("category");
module.exports = {
  ...validation,
  createProductCategorySchema: validation.createSchema,
};
