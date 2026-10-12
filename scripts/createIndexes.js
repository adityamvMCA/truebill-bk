// scripts/createIndexes.js
const Tenant = require("../models/Tenant");
const User = require("../models/User");

const createIndexes = async () => {
  await Tenant.syncIndexes();
  await User.syncIndexes();

  console.log("Tenant and User indexes synced");
};

module.exports = createIndexes;