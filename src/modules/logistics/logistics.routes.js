const express = require("express");
const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const verifyDriverToken = require("./driverAuth.middleware");
const c = require("./logistics.controller");

const router = express.Router();

// ------------------------------------------
// 1. PUBLIC ROUTES (No auth required)
// ------------------------------------------
router.post("/driver-auth/login", c.driverLogin);
router.get("/public/track/:token", c.getPublicTracking);

// ------------------------------------------
// 2. DRIVER MOBILE ROUTES (Driver token required)
// ------------------------------------------
router.get("/driver/active-trip", verifyDriverToken, c.getDriverActiveTrip);
router.get("/driver/trips", verifyDriverToken, c.getDriverTrips);
router.post("/driver/trips/:id/start", verifyDriverToken, c.driverStartTrip);
router.post("/driver/trips/:id/location", verifyDriverToken, c.driverPostLocation);
router.post("/driver/trips/:id/complete", verifyDriverToken, c.driverCompleteTrip);

// ------------------------------------------
// 3. ADMIN FLEET & DISPATCH ROUTES (ERP Tenant User required)
// ------------------------------------------
router.get("/drivers", verifyToken, resolveTenant, c.listDrivers);
router.post("/drivers", verifyToken, resolveTenant, c.createDriver);
router.put("/drivers/:id", verifyToken, resolveTenant, c.updateDriver);
router.delete("/drivers/:id", verifyToken, resolveTenant, c.deleteDriver);

router.get("/trips", verifyToken, resolveTenant, c.listTrips);
router.post("/trips", verifyToken, resolveTenant, c.createTrip);
router.get("/trips/:id", verifyToken, resolveTenant, c.getTripById);
router.get("/fleet/stats", verifyToken, resolveTenant, c.getFleetStats);

module.exports = router;
