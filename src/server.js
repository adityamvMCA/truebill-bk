require("dotenv").config();

const app = require("./app");

const connectDB = require("./config/db");

const {
  initializeFirebaseAdminSafe,
} = require("./config/firebaseAdmin");

const {
  startSubscriptionEmailScheduler,
} = require("./services/email/subscriptionEmailScheduler");

const {
  startDailyEveningStatsScheduler,
} = require("./services/dailyEveningStatsScheduler");

const PORT = process.env.PORT || 5001;

(async () => {
  try {
    await connectDB();

    initializeFirebaseAdminSafe();

    startSubscriptionEmailScheduler(12);

    startDailyEveningStatsScheduler();

    app.listen(PORT, () => {
      console.log(
        `TrustIQ ERP API running on port ${PORT}`,
      );
    });
  } catch (error) {
    console.error(
      "Server startup failed:",
      error.message,
    );

    process.exit(1);
  }
})();