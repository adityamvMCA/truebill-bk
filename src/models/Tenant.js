// const mongoose = require("mongoose");

// const schema = new mongoose.Schema(
//   {
//     clientCode: {
//       type: String,
//       required: true,
//       unique: true,
//       index: true,
//     },

//     businessName: {
//       type: String,
//       required: true,
//       trim: true,
//       maxlength: 200,
//     },

//     businessType: {
//       type: String,
//       default: "Trader",
//       trim: true,
//     },

//     email: {
//       type: String,
//       lowercase: true,
//       trim: true,
//       unique: true,
//       sparse: true,
//     },

//     phone: {
//       type: String,
//       trim: true,
//     },

//     gstNo: {
//       type: String,
//       uppercase: true,
//       trim: true,
//     },

//     panNo: {
//       type: String,
//       uppercase: true,
//       trim: true,
//     },

//     address: {
//       type: String,
//       trim: true,
//     },

//     city: {
//       type: String,
//       trim: true,
//     },

//     state: {
//       type: String,
//       trim: true,
//     },

//     pincode: {
//       type: String,
//       trim: true,
//     },

//     status: {
//       type: String,
//       enum: ["trial", "active", "suspended", "expired", "cancelled"],
//       default: "trial",
//       index: true,
//     },

//     subscriptionPlan: {
//       type: String,
//       default: "trial",
//     },

//     subscriptionStart: {
//       type: Date,
//       default: Date.now,
//     },

//     subscriptionEnd: {
//       type: Date,
//       default: null,
//     },

//     features: {
//       type: [String],
//       default: [],
//     },

//     limits: {
//       type: Map,
//       of: mongoose.Schema.Types.Mixed,
//       default: {},
//     },
//     subdomain: {
//       type: String,
//       trim: true,
//       lowercase: true,
//       maxlength: 63,

//       validate: {
//         validator(value) {
//           if (value === undefined || value === null) {
//             return true;
//           }

//           const reserved = new Set([
//             "www",
//             "api",
//             "login",
//             "admin",
//             "app",
//             "support",
//             "mail",
//             "status",
//             "dev",
//             "staging",
//           ]);

//           return (
//             /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value) &&
//             !reserved.has(value)
//           );
//         },

//         message: "Invalid or reserved tenant subdomain",
//       },
//     },

//     databaseKey: {
//       type: String,
//       trim: true,
//       lowercase: true,
//       maxlength: 40,
//       immutable: true,

//       validate: {
//         validator(value) {
//           if (value === undefined || value === null) {
//             return true;
//           }

//           return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(value);
//         },

//         message:
//           "Database key must contain lowercase letters, numbers, and single underscores between words",
//       },
//     },

//     databaseName: {
//       type: String,
//       trim: true,
//       maxlength: 63,
//       immutable: true,

//       validate: {
//         validator(value) {
//           if (value === undefined || value === null) {
//             return true;
//           }

//           return (
//             value.length <= 63 &&
//             /^trustiq_tenant_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(value)
//           );
//         },

//         message: "Invalid tenant database name",
//       },
//     },

//     storageMode: {
//       type: String,
//       enum: ["LEGACY", "DEDICATED"],
//       default: "LEGACY",
//     },

//     provisioningStatus: {
//       type: String,

//       enum: ["LEGACY", "PENDING", "PROVISIONING", "READY", "FAILED"],

//       default: "LEGACY",
//     },

//     databaseSchemaVersion: {
//       type: Number,
//       min: 0,
//       default: 0,
//     },

//     provisionedAt: {
//       type: Date,
//       default: null,
//     },

//     createdBy: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//       default: null,
//     },

//     isActive: {
//       type: Boolean,
//       default: true,
//       index: true,
//     },
//   },
//   {
//     timestamps: true,
//   },
// );

// schema.index({
//   status: 1,
//   subscriptionEnd: 1,
// });

// schema.index(
//   {
//     subdomain: 1,
//   },
//   {
//     unique: true,

//     partialFilterExpression: {
//       subdomain: {
//         $type: "string",
//       },
//     },
//   },
// );

// schema.index(
//   {
//     databaseKey: 1,
//   },
//   {
//     unique: true,

//     partialFilterExpression: {
//       databaseKey: {
//         $type: "string",
//       },
//     },
//   },
// );

// module.exports = mongoose.model("Tenant", schema);

const mongoose = require("mongoose");

const RESERVED_SUBDOMAINS = new Set([
  "www",
  "api",
  "login",
  "admin",
  "app",
  "support",
  "mail",
  "status",
  "dev",
  "staging",
  "localhost",
]);

const DATABASE_KEY_REGEX = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

const SUBDOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const schema = new mongoose.Schema(
  {
    clientCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    businessName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    businessType: {
      type: String,
      default: "Trader",
      trim: true,
    },

    email: {
      type: String,
      lowercase: true,
      trim: true,
      unique: true,
      sparse: true,
    },

    phone: {
      type: String,
      trim: true,
    },

    gstNo: {
      type: String,
      uppercase: true,
      trim: true,
    },

    panNo: {
      type: String,
      uppercase: true,
      trim: true,
    },

    address: {
      type: String,
      trim: true,
    },

    city: {
      type: String,
      trim: true,
    },

    state: {
      type: String,
      trim: true,
    },

    pincode: {
      type: String,
      trim: true,
    },

    status: {
      type: String,

      enum: ["trial", "active", "suspended", "expired", "cancelled"],

      default: "trial",
      index: true,
    },

    subscriptionPlan: {
      type: String,
      default: "trial",
    },

    subscriptionStart: {
      type: Date,
      default: Date.now,
    },

    subscriptionEnd: {
      type: Date,
      default: null,
    },

    features: {
      type: [String],
      default: [],
    },

    limits: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },

    /*
      Web address identifier, for example:
      adi.trustiqtech.com

      Optional for existing tenants.
    */
    subdomain: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 63,

      validate: {
        validator(value) {
          if (value === undefined) {
            return true;
          }

          return (
            typeof value === "string" &&
            SUBDOMAIN_REGEX.test(value) &&
            !RESERVED_SUBDOMAINS.has(value)
          );
        },

        message: "Invalid or reserved tenant subdomain",
      },
    },

    /*
      Permanent readable database key:
      adi_traders

      This is separate from businessName.
    */
    databaseKey: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 40,
      immutable: true,

      validate: {
        validator(value) {
          if (value === undefined) {
            return true;
          }

          return (
            typeof value === "string" &&
            value.length >= 1 &&
            DATABASE_KEY_REGEX.test(value)
          );
        },

        message:
          "Database key must use lowercase letters, numbers, and single underscores between words",
      },
    },

    /*
      Generated by the server:
      trustiq_tenant_adi_traders
    */
    databaseName: {
      type: String,
      trim: true,
      maxlength: 63,
      immutable: true,

      validate: {
        validator(value) {
          if (value === undefined) {
            return true;
          }

          return (
            typeof value === "string" &&
            value.length <= 63 &&
            /^trustiq_tenant_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(value)
          );
        },

        message: "Invalid tenant database name",
      },
    },

    /*
      LEGACY:
      Existing business models/default database.

      DEDICATED:
      Intended dedicated tenant database.
      Do not enable until its business flows
      have been converted and verified.
    */
    storageMode: {
      type: String,
      enum: ["LEGACY", "DEDICATED"],
      default: "LEGACY",
    },

    provisioningStatus: {
      type: String,

      enum: ["LEGACY", "PENDING", "PROVISIONING", "READY", "FAILED"],

      default: "LEGACY",
    },

    databaseSchemaVersion: {
      type: Number,
      default: 0,
      min: 0,

      validate: {
        validator: Number.isSafeInteger,
        message: "Database schema version must be a non-negative safe integer",
      },
    },

    provisionedAt: {
      type: Date,
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },

  {
    timestamps: true,
  },
);

schema.index({
  status: 1,
  subscriptionEnd: 1,
});

schema.index(
  {
    subdomain: 1,
  },
  {
    unique: true,

    partialFilterExpression: {
      subdomain: {
        $type: "string",
      },
    },
  },
);

schema.index(
  {
    databaseKey: 1,
  },
  {
    unique: true,

    partialFilterExpression: {
      databaseKey: {
        $type: "string",
      },
    },
  },
);

schema.index(
  {
    databaseName: 1,
  },
  {
    unique: true,

    partialFilterExpression: {
      databaseName: {
        $type: "string",
      },
    },
  },
);

/*
  Document-level consistency checks.

  Future provisioning code must load and save
  the document, or perform equivalent explicit
  validation before query-based updates.
*/
schema.pre("validate", function () {
  const hasDatabaseKey =
    typeof this.databaseKey === "string" && this.databaseKey.length > 0;

  const hasDatabaseName =
    typeof this.databaseName === "string" && this.databaseName.length > 0;

  if (hasDatabaseKey !== hasDatabaseName) {
    this.invalidate(
      "databaseName",
      "databaseKey and databaseName must be provided together",
    );
  }

  if (
    hasDatabaseKey &&
    hasDatabaseName &&
    this.databaseName !== `trustiq_tenant_${this.databaseKey}`
  ) {
    this.invalidate(
      "databaseName",
      "Database name does not match the database key",
    );
  }

  if (this.storageMode === "DEDICATED") {
    if (!hasDatabaseKey || !hasDatabaseName) {
      this.invalidate(
        "databaseName",
        "Dedicated storage requires a database mapping",
      );
    }

    if (this.provisioningStatus === "LEGACY") {
      this.invalidate(
        "provisioningStatus",
        "Dedicated storage cannot use LEGACY provisioning status",
      );
    }
  }

  if (this.storageMode === "LEGACY") {
    if (this.provisioningStatus !== "LEGACY") {
      this.invalidate(
        "provisioningStatus",
        "Legacy storage must use LEGACY provisioning status",
      );
    }
  }

  if (
    this.provisioningStatus === "READY" &&
    (!this.provisionedAt || this.databaseSchemaVersion < 1)
  ) {
    this.invalidate(
      "provisioningStatus",
      "READY requires a provisioning date and schema version",
    );
  }
});

module.exports = mongoose.models.Tenant || mongoose.model("Tenant", schema);
