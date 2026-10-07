const requirePlatformRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.platformRole))
      return res
        .status(403)
        .json({ success: false, message: "Platform access denied" });
    next();
  };
module.exports = requirePlatformRole;
