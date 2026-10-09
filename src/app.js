const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const authRoutes = require("./routes/authRoutes");
const tenantRoutes = require("./routes/tenantRoutes");
const customerRoutes = require("./routes/customerRoutes");
const ledgerRoutes = require("./routes/ledgerRoutes");
const errorHandler = require("./middleware/errorHandler");
const appVersion = require("./config/appVersion");
const notificationRoutes = require("./routes/notificationRoutes");
const deviceTokenRoutes = require("./routes/deviceTokenRoutes");
const notificationPreferenceRoutes = require("./routes/notificationPreferenceRoutes");
const app = express();

app.set("trust proxy", 1);

app.use(helmet());

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((x) => x.trim())
  : [];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }

      if (
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin) ||
        origin === "capacitor://localhost" ||
        origin === "http://localhost" ||
        origin === "https://localhost"
      ) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "2mb" }));

app.use(
  express.urlencoded({
    extended: true,
    limit: "2mb",
  }),
);

if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);

app.get("/api/health", (req, res) =>
  res.json({
    success: true,
    message: "TrustIQ ERP API is running",
    time: new Date().toISOString(),
  }),
);

app.get("/api/app-version", (req, res) => {
  res.json({
    success: true,
    data: appVersion.android,
  });
});

app.use("/api/auth", authRoutes);

app.use("/api/tenants", tenantRoutes);

app.use("/api/customers", customerRoutes);
app.use("/api/device-tokens", deviceTokenRoutes);
app.use("/api/ledgers", ledgerRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/notification-preferences", notificationPreferenceRoutes);
app.use((req, res) =>
  res.status(404).json({
    success: false,
    message: "API route not found",
  }),
);

app.use(errorHandler);

module.exports = app;
