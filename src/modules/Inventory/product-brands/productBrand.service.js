const service = require("../shared/createMasterService")("brand");

module.exports = {
  createBrand: service.create,
  getBrand: service.get,
  listBrands: service.list,
  updateBrand: service.update,
  seedDefaults: service.seedDefaults,
  bulkUpdateStatus: service.bulkUpdateStatus,
};