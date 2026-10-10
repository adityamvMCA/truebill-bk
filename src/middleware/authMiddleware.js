const jwt = require("jsonwebtoken");
const User = require("../models/User");

const verifyToken = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication token required",
      });
    }

    const token = authorization.slice(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication token required",
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is missing from backend environment");

      return res.status(500).json({
        success: false,
        message: "Authentication configuration error",
      });
    }

    let decoded;

    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      console.error("JWT verification failed:", error.name, error.message);

      return res.status(401).json({
        success: false,
        message:
          error.name === "TokenExpiredError"
            ? "Token expired"
            : error.name === "JsonWebTokenError"
              ? "Invalid authentication token"
              : "Token verification failed",
      });
    }

    const userId = decoded.userId || decoded.id || decoded._id;

    if (!userId) {
      console.error("JWT payload does not contain a user identifier");

      return res.status(401).json({
        success: false,
        message: "Token payload is missing user identifier",
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "User account is inactive",
      });
    }

    req.user = {
      userId: user._id,
      name: user.name,
      email: user.email,
      username: user.username,
      platformRole: user.platformRole,
      role: user.role,
      tenantId: user.tenantId,
      clientCode: user.clientCode,
      developerCode: user.developerCode,
      permissions: user.permissions || [],
    };

    next();
  } catch (error) {
    console.error("Authentication middleware error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Authentication failed",
    });
  }
};

module.exports = verifyToken;