const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const Driver = require("./driver.model");
const Trip = require("./trip.model");

// Geocoding helper using OpenStreetMap Nominatim with progressive fallback
async function geocodeAddress(address) {
  if (!address || typeof address !== "string") return null;
  const clean = address.trim();
  const parts = clean.split(",").map((p) => p.trim()).filter(Boolean);
  const candidates = [
    clean,
    parts.slice(-3).join(", "),
    parts.slice(-2).join(", "),
    parts.slice(-1)[0],
  ];

  for (const q of candidates) {
    if (!q || q.length < 3) continue;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`;
      const res = await fetch(url, {
        headers: { "User-Agent": "TrustIQ-ERP/1.0" },
      });
      const data = await res.json();
      if (Array.isArray(data) && data[0]?.lat && data[0]?.lon) {
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
        };
      }
    } catch (err) {
      // Continue to next fallback query
    }
  }
  return null;
}

// Helper to generate driver JWT
function generateDriverToken(driver) {
  return jwt.sign(
    {
      driverId: driver._id,
      tenantId: driver.tenantId,
      name: driver.name,
      phone: driver.phone,
      role: "driver",
    },
    process.env.JWT_SECRET || "trustiq_secret_key_2026",
    { expiresIn: "30d" }
  );
}

// ==========================================
// DRIVER AUTH & MOBILE ENDPOINTS
// ==========================================

exports.driverLogin = async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide phone number and password",
      });
    }

    const cleanPhone = phone.trim();
    const driver = await Driver.findOne({
      phone: cleanPhone,
      isDeleted: false,
    }).select("+password");

    if (!driver) {
      return res.status(401).json({
        success: false,
        message: "Invalid phone number or driver account not found",
      });
    }

    if (driver.status === "INACTIVE") {
      return res.status(403).json({
        success: false,
        message: "This driver account has been deactivated. Please contact your company administrator.",
      });
    }

    const isMatch = await driver.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid password",
      });
    }

    const token = generateDriverToken(driver);
    const driverObj = driver.toObject();
    delete driverObj.password;

    res.json({
      success: true,
      message: "Driver logged in successfully",
      data: {
        token,
        driver: driverObj,
      },
    });
  } catch (error) {
    console.error("driverLogin error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getDriverActiveTrip = async (req, res) => {
  try {
    const driverId = req.driver?.driverId;
    if (!driverId) {
      return res.status(401).json({ success: false, message: "Unauthorized driver" });
    }

    // Find active trip (STARTED or SCHEDULED or PAUSED)
    let trip = await Trip.findOne({
      driverId,
      status: { $in: ["STARTED", "SCHEDULED", "PAUSED"] },
      isDeleted: false,
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: trip || null,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getDriverTrips = async (req, res) => {
  try {
    const driverId = req.driver?.driverId;
    const { status, limit = 20 } = req.query;

    const query = { driverId, isDeleted: false };
    if (status) query.status = status;

    const trips = await Trip.find(query)
      .sort({ createdAt: -1 })
      .limit(Number(limit));

    res.json({
      success: true,
      data: trips,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.driverStartTrip = async (req, res) => {
  try {
    const driverId = req.driver?.driverId;
    const { id } = req.params;
    const { lat, lng, destinationLat, destinationLng } = req.body;

    const trip = await Trip.findOne({ _id: id, driverId, isDeleted: false });
    if (!trip) {
      return res.status(404).json({ success: false, message: "Trip not found" });
    }

    trip.status = "STARTED";
    trip.startedAt = new Date();

    // If destination coords provided or missing, resolve them so map shows the destination
    if (destinationLat && destinationLng) {
      trip.destination = trip.destination || {};
      trip.destination.lat = Number(destinationLat);
      trip.destination.lng = Number(destinationLng);
    } else if ((!trip.destination?.lat || !trip.destination?.lng) && trip.destination?.address) {
      const geo = await geocodeAddress(trip.destination.address);
      if (geo) {
        trip.destination.lat = geo.lat;
        trip.destination.lng = geo.lng;
      }
    }

    if (lat && lng) {
      const loc = {
        lat: Number(lat),
        lng: Number(lng),
        speed: 0,
        heading: 0,
        accuracy: 10,
        updatedAt: new Date(),
      };
      trip.currentLocation = loc;
      trip.path.push({
        lat: loc.lat,
        lng: loc.lng,
        speed: 0,
        heading: 0,
        timestamp: new Date(),
      });
    }

    await trip.save();

    // Update driver status
    await Driver.findByIdAndUpdate(driverId, {
      status: "ON_TRIP",
      assignedTripId: trip._id,
      ...(lat && lng ? { currentLocation: trip.currentLocation } : {}),
    });

    // Notify sockets
    const io = req.app.get("io");
    if (io) {
      io.of("/logistics")
        .to(`trip_${trip._id}`)
        .emit("trip:status_update", { tripId: trip._id, status: "STARTED", trip });
      io.of("/logistics")
        .to(`trip_${trip._id}`)
        .emit("trip:status_change", { tripId: trip._id, status: "STARTED", trip });

      if (trip.trackingToken) {
        io.of("/logistics")
          .to(`token_${trip.trackingToken}`)
          .emit("trip:status_update", { tripId: trip._id, status: "STARTED", trip });
      }

      if (trip.tenantId) {
        io.of("/logistics")
          .to(`tenant_${trip.tenantId}`)
          .emit("fleet:status_update", { tripId: trip._id, status: "STARTED", trip });
        io.of("/logistics")
          .to(`tenant_${trip.tenantId}`)
          .emit("trip:status_change", { tripId: trip._id, status: "STARTED", trip });
      }
    }

    res.json({
      success: true,
      message: "Trip started successfully. Live tracking is active.",
      data: trip,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.driverPostLocation = async (req, res) => {
  try {
    const driverId = req.driver?.driverId;
    const { id } = req.params;
    const { lat, lng, speed, heading, accuracy } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({ success: false, message: "Latitude and longitude required" });
    }

    const locationData = {
      lat: Number(lat),
      lng: Number(lng),
      speed: Number(speed || 0),
      heading: Number(heading || 0),
      accuracy: Number(accuracy || 0),
      updatedAt: new Date(),
    };

    const trip = await Trip.findOne({ _id: id, driverId, isDeleted: false });
    if (trip) {
      trip.currentLocation = locationData;
      trip.path.push({
        lat: locationData.lat,
        lng: locationData.lng,
        speed: locationData.speed,
        heading: locationData.heading,
        timestamp: new Date(),
      });
      if (trip.path.length > 1500) trip.path = trip.path.slice(-1500);
      await trip.save();

      // Emit socket event
      const io = req.app.get("io");
      if (io) {
        io.of("/logistics")
          .to(`trip_${trip._id}`)
          .emit("trip:location_update", { tripId: trip._id, location: locationData });

        if (trip.trackingToken) {
          io.of("/logistics")
            .to(`token_${trip.trackingToken}`)
            .emit("trip:location_update", { tripId: trip._id, location: locationData });
        }

        if (trip.tenantId) {
          io.of("/logistics")
            .to(`tenant_${trip.tenantId}`)
            .emit("fleet:driver_update", {
              driverId,
              tripId: trip._id,
              location: locationData,
              distanceCoveredKm: trip.distanceCoveredKm,
            });
        }
      }
    }

    await Driver.findByIdAndUpdate(driverId, { currentLocation: locationData });

    res.json({ success: true, message: "Location updated" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.driverCompleteTrip = async (req, res) => {
  try {
    const driverId = req.driver?.driverId;
    const { id } = req.params;
    const { signedBy, notes, signatureImage } = req.body;

    const trip = await Trip.findOne({ _id: id, driverId, isDeleted: false });
    if (!trip) {
      return res.status(404).json({ success: false, message: "Trip not found" });
    }

    trip.status = "COMPLETED";
    trip.completedAt = new Date();
    trip.receiverProof = {
      signedBy: signedBy || trip.customerName,
      notes: notes || "Delivered",
      signatureImage: signatureImage || "",
      deliveredAt: new Date(),
    };

    await trip.save();

    await Driver.findByIdAndUpdate(driverId, {
      status: "AVAILABLE",
      assignedTripId: null,
    });

    const io = req.app.get("io");
    if (io) {
      io.of("/logistics")
        .to(`trip_${trip._id}`)
        .emit("trip:status_update", { tripId: trip._id, status: "COMPLETED", trip });

      if (trip.trackingToken) {
        io.of("/logistics")
          .to(`token_${trip.trackingToken}`)
          .emit("trip:status_update", { tripId: trip._id, status: "COMPLETED", trip });
      }

      if (trip.tenantId) {
        io.of("/logistics")
          .to(`tenant_${trip.tenantId}`)
          .emit("fleet:status_update", { tripId: trip._id, status: "COMPLETED", trip });
      }
    }

    res.json({
      success: true,
      message: "Trip completed and delivery confirmed!",
      data: trip,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// ADMIN FLEET & DISPATCH ENDPOINTS
// ==========================================

exports.listDrivers = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { status, search } = req.query;

    const query = { tenantId, isDeleted: false };
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { vehicleNumber: { $regex: search, $options: "i" } },
      ];
    }

    const drivers = await Driver.find(query).sort({ createdAt: -1 });
    res.json({ success: true, data: drivers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createDriver = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { name, phone, email, password, vehicleNumber, vehicleType, licenseNumber } = req.body;

    if (!name || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: "Driver name, phone number, and login password are required",
      });
    }

    const cleanPhone = phone.trim();
    const existing = await Driver.findOne({ tenantId, phone: cleanPhone, isDeleted: false });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "A driver with this phone number already exists in your company",
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const count = await Driver.countDocuments({ tenantId });
    const driverCode = `DRV-${String(count + 1).padStart(3, "0")}`;

    const driver = await Driver.create({
      tenantId,
      driverCode,
      name: name.trim(),
      phone: cleanPhone,
      email: email ? email.trim() : "",
      password: hashedPassword,
      vehicleNumber: vehicleNumber ? vehicleNumber.trim().toUpperCase() : "",
      vehicleType: vehicleType || "VAN",
      licenseNumber: licenseNumber ? licenseNumber.trim().toUpperCase() : "",
      status: "AVAILABLE",
      createdBy: req.user?._id || req.user?.userId,
    });

    const driverObj = driver.toObject();
    delete driverObj.password;

    res.status(201).json({
      success: true,
      message: "Driver created successfully",
      data: driverObj,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateDriver = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;
    const { name, phone, email, vehicleNumber, vehicleType, licenseNumber, status, password } = req.body;

    const driver = await Driver.findOne({ _id: id, tenantId, isDeleted: false });
    if (!driver) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }

    if (name) driver.name = name.trim();
    if (phone) driver.phone = phone.trim();
    if (email !== undefined) driver.email = email.trim();
    if (vehicleNumber !== undefined) driver.vehicleNumber = vehicleNumber.trim().toUpperCase();
    if (vehicleType) driver.vehicleType = vehicleType;
    if (licenseNumber !== undefined) driver.licenseNumber = licenseNumber.trim().toUpperCase();
    if (status) driver.status = status;

    if (password && password.trim().length >= 4) {
      const salt = await bcrypt.genSalt(10);
      driver.password = await bcrypt.hash(password.trim(), salt);
    }

    await driver.save();
    const driverObj = driver.toObject();
    delete driverObj.password;

    res.json({ success: true, message: "Driver updated", data: driverObj });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteDriver = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;

    const driver = await Driver.findOneAndUpdate(
      { _id: id, tenantId },
      { isDeleted: true, status: "INACTIVE" },
      { new: true }
    );

    if (!driver) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }

    res.json({ success: true, message: "Driver deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// TRIPS ADMIN ENDPOINTS
exports.listTrips = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { status, driverId, search, limit = 50 } = req.query;

    const query = { tenantId, isDeleted: false };
    if (status) query.status = status;
    if (driverId) query.driverId = driverId;
    if (search) {
      query.$or = [
        { tripNumber: { $regex: search, $options: "i" } },
        { customerName: { $regex: search, $options: "i" } },
        { driverName: { $regex: search, $options: "i" } },
        { "destination.address": { $regex: search, $options: "i" } },
      ];
    }

    const trips = await Trip.find(query)
      .sort({ createdAt: -1 })
      .limit(Number(limit));

    res.json({ success: true, data: trips });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createTrip = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const {
      driverId,
      customerName,
      customerPhone,
      destinationAddress,
      destinationLat,
      destinationLng,
      originAddress,
      originLat,
      originLng,
      deliveryNoteId,
      deliveryNoteNumber,
      invoiceId,
      invoiceNumber,
      notes,
    } = req.body;

    if (!driverId || !customerName || !destinationAddress) {
      return res.status(400).json({
        success: false,
        message: "Driver, customer name, and destination address are required",
      });
    }

    const driver = await Driver.findOne({ _id: driverId, tenantId, isDeleted: false });
    if (!driver) {
      return res.status(404).json({ success: false, message: "Selected driver not found" });
    }

    const count = await Trip.countDocuments({ tenantId });
    const tripNumber = `TRIP-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
    const trackingToken = crypto.randomBytes(16).toString("hex");

    // Geocode destination if coordinates not provided
    let finalDestLat = destinationLat ? Number(destinationLat) : null;
    let finalDestLng = destinationLng ? Number(destinationLng) : null;
    if ((!finalDestLat || !finalDestLng) && destinationAddress) {
      const geo = await geocodeAddress(destinationAddress);
      if (geo) {
        finalDestLat = geo.lat;
        finalDestLng = geo.lng;
      }
    }

    const trip = await Trip.create({
      tenantId,
      tripNumber,
      driverId: driver._id,
      driverName: driver.name,
      driverPhone: driver.phone,
      vehicleNumber: driver.vehicleNumber,
      vehicleType: driver.vehicleType,
      deliveryNoteId: deliveryNoteId || null,
      deliveryNoteNumber: deliveryNoteNumber || "",
      invoiceId: invoiceId || null,
      invoiceNumber: invoiceNumber || "",
      customerName: customerName.trim(),
      customerPhone: customerPhone ? customerPhone.trim() : "",
      origin: {
        address: originAddress || "Warehouse",
        lat: originLat ? Number(originLat) : null,
        lng: originLng ? Number(originLng) : null,
      },
      destination: {
        address: destinationAddress.trim(),
        lat: finalDestLat,
        lng: finalDestLng,
      },
      status: "SCHEDULED",
      trackingToken,
      notes: notes || "",
      createdBy: req.user?._id || req.user?.userId,
    });

    driver.assignedTripId = trip._id;
    await driver.save();

    res.status(201).json({
      success: true,
      message: "Logistics delivery trip scheduled successfully",
      data: trip,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getTripById = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;

    const trip = await Trip.findOne({ _id: id, tenantId, isDeleted: false });
    if (!trip) {
      return res.status(404).json({ success: false, message: "Trip not found" });
    }

    res.json({ success: true, data: trip });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getFleetStats = async (req, res) => {
  try {
    const tenantId = req.tenantId;

    const [totalDrivers, onTripDrivers, activeTrips, completedToday] = await Promise.all([
      Driver.countDocuments({ tenantId, isDeleted: false }),
      Driver.countDocuments({ tenantId, status: "ON_TRIP", isDeleted: false }),
      Trip.countDocuments({ tenantId, status: "STARTED", isDeleted: false }),
      Trip.countDocuments({
        tenantId,
        status: "COMPLETED",
        completedAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        isDeleted: false,
      }),
    ]);

    res.json({
      success: true,
      data: {
        totalDrivers,
        onTripDrivers,
        activeTrips,
        completedToday,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// PUBLIC RECEIVER TRACKING (NO AUTH NEEDED)
// ==========================================
exports.getPublicTracking = async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).json({ success: false, message: "Tracking token required" });
    }

    const trip = await Trip.findOne({
      trackingToken: token,
      isDeleted: false,
    }).select("-createdBy -isDeleted -tenantId");

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: "Invalid or expired tracking link",
      });
    }

    res.json({
      success: true,
      data: trip,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
