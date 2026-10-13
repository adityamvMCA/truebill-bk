require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const Tenant = require("../src/models/Tenant");
const User = require("../src/models/User");

const { getNextSequence } = require(
  "../src/utils/sequenceGenerator",
);

const { getRolePermissions } = require(
  "../src/utils/permissions",
);

const { PLANS } = require(
  "../src/config/subscriptionPlans",
);

const {
  seedDefaultLedgerGroups,
} = require(
  "../src/modules/accounting/seeds/seedDefaultLedgerGroups",
);

const {
  seedDefaultLedgers,
} = require(
  "../src/modules/accounting/seeds/seedDefaultLedgers",
);

const MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017/truebill";

const TEST_TENANTS = [
  {
    businessName: "Test Trader One",
    businessType: "Trader",
    email: "tenant1@test.com",
    phone: "9876543210",
    address: "Test Address 1",
    city: "Belagavi",
    state: "Karnataka",
    pincode: "590001",
    subscriptionPlan: "basic",
    adminName: "Test Admin One",
    adminEmail: "test1@gmail.com",
    adminPassword: "123456",
  },

  {
    businessName: "Test Trader Two",
    businessType: "Trader",
    email: "tenant2@test.com",
    phone: "9876543211",
    address: "Test Address 2",
    city: "Belagavi",
    state: "Karnataka",
    pincode: "590001",
    subscriptionPlan: "standard",
    adminName: "Test Admin Two",
    adminEmail: "test2@gmail.com",
    adminPassword: "123456",
  },

  {
    businessName: "Test Trader Three",
    businessType: "Trader",
    email: "tenant3@test.com",
    phone: "9876543212",
    address: "Test Address 3",
    city: "Belagavi",
    state: "Karnataka",
    pincode: "590001",
    subscriptionPlan: "premium",
    adminName: "Test Admin Three",
    adminEmail: "test3@gmail.com",
    adminPassword: "123456",
  },
];

const seedTestTenants = async () => {
  try {
    console.log("Connecting to MongoDB...");

    await mongoose.connect(MONGODB_URI);

    console.log("Connected to MongoDB\n");

    let createdTenants = 0;
    let skippedTenants = 0;

    for (const tenantData of TEST_TENANTS) {
      const {
        businessName,
        businessType,
        email,
        phone,
        address,
        city,
        state,
        pincode,
        subscriptionPlan,
        adminName,
        adminEmail,
        adminPassword,
      } = tenantData;

      const normalizedAdminEmail = adminEmail
        .toLowerCase()
        .trim();

      const existingUser = await User.findOne({
        email: normalizedAdminEmail,
      });

      if (existingUser) {
        console.log(
          `⚠ Skipped: ${businessName} — admin email already exists: ${normalizedAdminEmail}`,
        );

        skippedTenants += 1;

        continue;
      }

      const plan = PLANS[subscriptionPlan];

      if (!plan) {
        console.log(
          `⚠ Skipped: ${businessName} — invalid subscription plan: ${subscriptionPlan}`,
        );

        skippedTenants += 1;

        continue;
      }

      const startDate = new Date();

      const endDate = new Date(
        startDate.getTime() +
          plan.durationDays *
            24 *
            60 *
            60 *
            1000,
      );

      const clientCode =
        await getNextSequence(
          "TRD",
          "PLATFORM",
        );

      const hashedPassword =
        await bcrypt.hash(adminPassword, 12);

      const tenant = await Tenant.create({
        clientCode,
        businessName,
        businessType,
        email: email.toLowerCase().trim(),
        phone,
        address,
        city,
        state,
        pincode,
        subscriptionPlan,
        subscriptionStart: startDate,
        subscriptionEnd: endDate,
        features: [],
        status: "active",
      });

      /*
        Seed default Tally-style ledger groups
        for the newly created tenant.
      */
      await seedDefaultLedgerGroups({
        tenantId: tenant._id,
        userId: null,
      });

      /*
        Seed default system ledgers such as
        Cash, Sales, Purchase and GST ledgers.
      */
      await seedDefaultLedgers({
        tenantId: tenant._id,
        userId: null,
      });

      const admin = await User.create({
        name: adminName,
        email: normalizedAdminEmail,
        password: hashedPassword,
        platformRole: "tenant",
        role: "admin",
        tenantId: tenant._id,
        clientCode: tenant.clientCode,
        permissions: getRolePermissions(
          "admin",
        ),
      });

      createdTenants += 1;

      console.log(
        `✔ Created: ${businessName}`,
      );
      console.log(
        `   Tenant Code: ${tenant.clientCode}`,
      );
      console.log(
        `   Tenant ID: ${tenant._id}`,
      );
      console.log(
        `   Plan: ${subscriptionPlan}`,
      );
      console.log(`   Admin: ${admin.email}`);
      console.log(
        `   Password: ${adminPassword}`,
      );
      console.log(
        `   Expires: ${endDate.toISOString()}`,
      );
      console.log(
        `   Ledger groups: seeded`,
      );
      console.log(
        `   Default ledgers: seeded`,
      );
      console.log("");
    }

    console.log(
      "Test tenant seeding completed",
    );
    console.log(`Created: ${createdTenants}`);
    console.log(`Skipped: ${skippedTenants}`);

    await mongoose.connection.close();

    process.exit(0);
  } catch (error) {
    if (error.code === 11000) {
      const duplicateField = Object.keys(
        error.keyPattern || {},
      )[0];

      console.error(
        `Duplicate key error on: ${duplicateField}`,
      );
    } else {
      console.error(
        "Test tenant seeding failed:",
        error,
      );
    }

    await mongoose.connection.close();

    process.exit(1);
  }
};

seedTestTenants();

////node scripts/seedTestTenants.js