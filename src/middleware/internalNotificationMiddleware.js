const requireInternalNotificationSecret = (
  req,
  res,
  next,
) => {
  const receivedSecret = req.headers[
    "x-internal-notification-secret"
  ];

  const expectedSecret =
    process.env.INTERNAL_NOTIFICATION_SECRET;

  if (!expectedSecret) {
    return res.status(500).json({
      success: false,
      message:
        "Internal notification secret is not configured",
    });
  }

  if (
    !receivedSecret ||
    receivedSecret !== expectedSecret
  ) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized internal notification request",
    });
  }

  next();
};

module.exports = requireInternalNotificationSecret;