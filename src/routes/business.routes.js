const express = require("express");
const verifyToken = require("../middleware/authMiddleware");
const resolveTenant = require("../middleware/tenantMiddleware");
const {
  getMyBusinesses,
  createMyBusiness,
  switchBusiness,
} = require("../controllers/businessController");

const router = express.Router();

router.use(verifyToken);

// List user's businesses
router.get("/my-businesses", getMyBusinesses);

// Create new business (with plan limit enforcement)
router.post("/", createMyBusiness);

// Switch active business
router.post("/switch", switchBusiness);

module.exports = router;
