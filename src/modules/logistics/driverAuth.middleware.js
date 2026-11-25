const jwt = require("jsonwebtoken");

module.exports = function verifyDriverToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "No driver token provided, access denied",
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "trustiq_secret_key_2026"
    );

    if (decoded.role !== "driver" || !decoded.driverId) {
      return res.status(403).json({
        success: false,
        message: "Access restricted to drivers only",
      });
    }

    req.driver = decoded;
    req.tenantId = decoded.tenantId;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Driver session invalid or expired",
    });
  }
};
