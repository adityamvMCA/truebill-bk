// const express = require("express");

// const verifyToken = require("../../../middleware/authMiddleware");
// const resolveTenant = require("../../../middleware/tenantMiddleware");
// const requirePermission = require("../../../middleware/permissionMiddleware");

// const controller = require("./gstrReports.controller");

// const router = express.Router();

// router.use(verifyToken, resolveTenant);

// router.get(
//   "/gstr1",
//   requirePermission("gst.gstrReports"),
//   controller.getGstr1,
// );

// router.get(
//   "/gstr3b",
//   requirePermission("gst.gstrReports"),
//   controller.getGstr3b,
// );

// module.exports = router;


const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePermission = require("../../../middleware/permissionMiddleware");

const controller = require("./gstrReports.controller");

const router = express.Router();

router.use(verifyToken, resolveTenant);

const viewGuard = requirePermission("gst.gstrReports");
const exportGuard = requirePermission("gst.gstrReports.export");

// Full exports (CSV rows or portal JSON) need the extra export permission.
// Create "gst.gstrReports.export" and grant it to the roles that should export,
// otherwise exports will be rejected.
const guardExport = (req, res, next) =>
  req.query.exportAll === "true" || req.query.format === "json"
    ? exportGuard(req, res, next)
    : next();

router.get("/gstr1", viewGuard, guardExport, controller.getGstr1);

router.get("/gstr3b", viewGuard, controller.getGstr3b);

module.exports = router;