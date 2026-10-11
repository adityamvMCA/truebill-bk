// const Notification = require("../models/Notification");
// const NotificationPreference = require("../models/NotificationPreference");

// const preferenceMap = {
//   LOW_STOCK: "lowStock",
//   SALES_ORDER: "salesOrder",
//   PURCHASE_ORDER: "purchaseOrder",
//   PAYMENT_RECEIVED: "paymentReceived",
//   PAYMENT_OVERDUE: "paymentOverdue",
//   APPROVAL_REQUIRED: "approvalRequired",
//   NEW_CUSTOMER: "newCustomer",
//   SYSTEM: "system",
//   APP_UPDATE: "appUpdate",
// };

// const create = async ({
//   tenantId,
//   userId,
//   type,
//   title,
//   message,
//   icon = "bell",
//   priority = "NORMAL",
//   route = null,
//   data = {},
// }) => {
//   if (!tenantId) {
//     throw new Error("tenantId is required");
//   }

//   if (!userId) {
//     throw new Error("userId is required");
//   }

//   const preferenceField = preferenceMap[type];

//   if (preferenceField) {
//     const preferences = await NotificationPreference.findOne({
//       tenantId,
//       userId,
//     }).lean();

//     if (preferences && preferences[preferenceField] === false) {
//       return null;
//     }

//     if (preferences && preferences.pushEnabled === false) {
//       return null;
//     }
//   }

//   return Notification.create({
//     tenantId,
//     userId,
//     type,
//     title,
//     message,
//     icon,
//     priority,
//     route,
//     data,
//   });
// };

// const createMany = async (notifications) => {
//   if (!Array.isArray(notifications) || notifications.length === 0) {
//     return [];
//   }

//   const results = [];

//   for (const notification of notifications) {
//     const created = await create(notification);

//     if (created) {
//       results.push(created);
//     }
//   }

//   return results;
// };
// const sendAppUpdateNotification = async ({
//   tenantId,
//   userId,
//   latestVersion,
//   minimumVersion,
//   updateRequired,
//   downloadUrl,
// }) => {
//   const title = updateRequired ? "Update required" : "New app update available";

//   const message = updateRequired
//     ? `TrueBill version ${latestVersion} is required. Please update to continue.`
//     : `TrueBill version ${latestVersion} is now available. Update for the latest improvements.`;

//   return create({
//     tenantId,
//     userId,
//     type: "APP_UPDATE",
//     title,
//     message,
//     icon: "smartphone",
//     priority: updateRequired ? "HIGH" : "NORMAL",
//     route: "/app-update",
//     data: {
//       latestVersion,
//       minimumVersion,
//       updateRequired,
//       downloadUrl,
//     },
//   });
// };
// module.exports = {
//   create,
//   createMany,
//   sendAppUpdateNotification,
// };


const Notification = require("../models/Notification");
const NotificationPreference = require("../models/NotificationPreference");

const preferenceMap = {
  LOW_STOCK: "lowStock",
  SALES_ORDER: "salesOrder",
  PURCHASE_ORDER: "purchaseOrder",
  PAYMENT_RECEIVED: "paymentReceived",
  PAYMENT_OVERDUE: "paymentOverdue",
  APPROVAL_REQUIRED: "approvalRequired",
  NEW_CUSTOMER: "newCustomer",
  SYSTEM: "system",
  APP_UPDATE: "appUpdate",
};

const create = async ({
  tenantId,
  userId,
  type,
  title,
  message,
  icon = "bell",
  priority = "NORMAL",
  route = null,
  data = {},
}) => {
  if (!tenantId) {
    throw new Error("tenantId is required");
  }

  if (!userId) {
    throw new Error("userId is required");
  }

  if (!type) {
    throw new Error("Notification type is required");
  }

  if (!title) {
    throw new Error("Notification title is required");
  }

  if (!message) {
    throw new Error("Notification message is required");
  }

  const preferenceField = preferenceMap[type];

  if (preferenceField) {
    const preferences =
      await NotificationPreference.findOne({
        tenantId,
        userId,
      }).lean();

    if (
      preferences &&
      preferences[preferenceField] === false
    ) {
      return null;
    }

    if (
      preferences &&
      preferences.pushEnabled === false
    ) {
      return null;
    }
  }

  return Notification.create({
    tenantId,
    userId,
    type,
    title,
    message,
    icon,
    priority,
    route,
    data,
  });
};

const createMany = async (notifications) => {
  if (
    !Array.isArray(notifications) ||
    notifications.length === 0
  ) {
    return [];
  }

  const results = [];

  for (const notification of notifications) {
    const created = await create(notification);

    if (created) {
      results.push(created);
    }
  }

  return results;
};

const sendAppUpdateNotification = async ({
  tenantId,
  userId,
  latestVersion,
  minimumVersion,
  updateRequired,
  downloadUrl,
}) => {
  const requiredUpdate =
    updateRequired === true ||
    updateRequired === "true";

  const title = requiredUpdate
    ? "Update required"
    : "New app update available";

  const message = requiredUpdate
    ? `TrueBill version ${latestVersion} is required. Please update to continue.`
    : `TrueBill version ${latestVersion} is now available. Update for the latest improvements.`;

  const payload = {
    tenantId,
    userId,
    type: "APP_UPDATE",
    title,
    message,
    icon: "smartphone",
    priority: requiredUpdate
      ? "CRITICAL"
      : "NORMAL",
    route: "/app-update",
    data: {
      platform: "android",
      latestVersion,
      minimumVersion,
      updateRequired: requiredUpdate,
      downloadUrl,
    },
  };

  if (requiredUpdate) {
    return Notification.create(payload);
  }

  return create(payload);
};

module.exports = {
  create,
  createMany,
  sendAppUpdateNotification,
};