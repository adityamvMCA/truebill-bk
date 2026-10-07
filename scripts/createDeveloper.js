require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const connectDB = require("../src/config/db");
const User = require("../src/models/User");
const { getNextSequence } = require("../src/utils/sequenceGenerator");
(async () => {
  try {
    await connectDB();
    const name = process.env.DEVELOPER_NAME || "TrustIQ Developer",
      email = (
        process.env.DEVELOPER_EMAIL || "developer@trustiq.com"
      ).toLowerCase(),
      password = process.env.DEVELOPER_PASSWORD || "ChangeMe@123";
    if (await User.findOne({ email })) {
      console.log("Developer already exists:", email);
      process.exit(0);
    }
    const developerCode = await getNextSequence("DEV", "PLATFORM");
    const user = await User.create({
      name,
      email,
      password: await bcrypt.hash(password, 12),
      platformRole: "developer",
      role: "developer",
      developerCode,
      tenantId: null,
      clientCode: null,
    });
    console.log("Developer created:", {
      id: user._id.toString(),
      email,
      developerCode,
      password: "Use DEVELOPER_PASSWORD from .env",
    });
    await mongoose.connection.close();
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
