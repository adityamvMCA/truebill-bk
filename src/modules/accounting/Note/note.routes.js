const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePermission = require("../../../middleware/permissionMiddleware");

const { createNote, listNotes, getNote } = require("./note.controller");
const { validateCreateNote } = require("./note.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

// Reusing ledger.* permissions; swap for note.* if you add them.
router.get("/", requirePermission("ledger.view"), listNotes);
router.get("/:id", requirePermission("ledger.view"), getNote);
router.post(
  "/",
  requirePermission("ledger.create"),
  validateCreateNote,
  createNote,
);

module.exports = router;
