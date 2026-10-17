const requirePlatformRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!roles.includes(req.user.platformRole)) {
      return res.status(403).json({
        success: false,
        message: "Platform access denied",
      });
    }

    next();
  };

module.exports = requirePlatformRole;
