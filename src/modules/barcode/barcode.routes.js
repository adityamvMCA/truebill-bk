const express = require("express");
const c = require("./barcode.controller");
const v = require("./barcode.validation");
const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");

const router = express.Router();
router.use(verifyToken, resolveTenant);

const view = requirePermission("product.view");
const write = requirePermission("product.update");

router.get("/lookup/:barcode", view, c.lookup);
router.get("/catalog", view, c.catalog);
router.get("/product/:productId", view, c.byProduct);
router.post("/labels", view, v.validateLabels, c.labels);
router.post("/", write, v.validateRegister, c.register);
router.post("/internal/:productId", write, v.validateInternal, c.generateInternal);
router.patch("/:id/deactivate", write, c.deactivate);

router.get("/unknown", view, c.unknownList);
router.post("/unknown", view, c.unknownCreate);

router.post("/sessions", view, v.validateSession, c.createSession);
router.post("/sessions/:id/token", view, c.refreshJoinToken);
router.get("/sessions/:id/items", view, c.sessionItems);
router.post("/sessions/:id/sync", view, v.validateSync, c.syncScans);
router.delete("/sessions/:id", view, c.closeSession);

module.exports = router;