const express = require("express");
const verifyToken = require("../middleware/authMiddleware");
const resolveTenant = require("../middleware/tenantMiddleware");
const billingController = require("../controllers/billingController");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get("/plans", billingController.getPlans);
router.post("/create-order", billingController.createOrder);
router.post("/verify-payment", billingController.verifyPayment);
router.post("/activate-trial", billingController.activateTrial);

module.exports = router;
