const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePermission = require("../../../middleware/permissionMiddleware");

const {
  getAuditTrail,
  getAuditDocuments,
  getAuditEntry,
} = require("./auditTrail.controller");

const router = express.Router();

router.use(verifyToken, resolveTenant);

// NOTE: "auditTrail.view" is a new permission. Add it to your roles,
// or swap in an existing admin-level permission.
router.get("/", requirePermission("auditTrail.view"), getAuditTrail);

// must stay above "/:id"
router.get("/documents", requirePermission("auditTrail.view"), getAuditDocuments);

router.get("/:id", requirePermission("auditTrail.view"), getAuditEntry);

module.exports = router;

/*
 * Mount it where your other routers are mounted, e.g.:
 *
 *   app.use("/api/audit-trail", require("./modules/audit-trail/auditTrail.routes"));
 */
