const crypto = require("crypto");

const requireInternalNotificationSecret = (
  req,
  res,
  next,
) => {
  const receivedSecret = req.get(
    "x-internal-notification-secret",
  );

  const expectedSecret =
    process.env.INTERNAL_NOTIFICATION_SECRET;

  if (!expectedSecret) {
    return res.status(500).json({
      success: false,
      message:
        "INTERNAL_NOTIFICATION_SECRET is not configured",
    });
  }

  if (!receivedSecret) {
    return res.status(401).json({
      success: false,
      message:
        "Internal notification secret is required",
    });
  }

  const receivedBuffer = Buffer.from(receivedSecret);
  const expectedBuffer = Buffer.from(expectedSecret);

  const isValid =
    receivedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(
      receivedBuffer,
      expectedBuffer,
    );

  if (!isValid) {
    return res.status(401).json({
      success: false,
      message:
        "Invalid internal notification secret",
    });
  }

  next();
};

module.exports = requireInternalNotificationSecret;