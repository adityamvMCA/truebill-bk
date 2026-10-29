const service = require("../shared/createMasterService")("category");
module.exports = {
  createCategory: service.create,
  getCategory: service.get,
  listCategories: service.list,
  updateCategory: service.update,
  seedDefaults: service.seedDefaults,
  bulkUpdateStatus: service.bulkUpdateStatus,
};
