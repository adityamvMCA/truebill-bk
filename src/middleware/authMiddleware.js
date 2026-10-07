const jwt = require("jsonwebtoken");
const User = require("../models/User");
const verifyToken = async (req, res, next) => {
  try {
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer "))
      return res
        .status(401)
        .json({ success: false, message: "Authentication token required" });
    const decoded = jwt.verify(h.split(" ")[1], process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select("+password");
    if (!user)
      return res
        .status(401)
        .json({ success: false, message: "User not found" });
    if (!user.isActive)
      return res
        .status(403)
        .json({ success: false, message: "User account is inactive" });
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
  } catch (e) {
    return res
      .status(401)
      .json({
        success: false,
        message:
          e.name === "TokenExpiredError"
            ? "Token expired"
            : "Invalid authentication token",
      });
  }
};
module.exports = verifyToken;
