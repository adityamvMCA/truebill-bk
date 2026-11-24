const express = require("express");
const verifyToken = require("../middleware/authMiddleware");
const resolveTenant = require("../middleware/tenantMiddleware");
const {
  getBranches,
  createBranch,
  updateBranch,
  deleteBranch,
} = require("../controllers/branchController");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get("/", getBranches);
router.post("/", createBranch);
router.put("/:branchId", updateBranch);
router.delete("/:branchId", deleteBranch);

module.exports = router;
