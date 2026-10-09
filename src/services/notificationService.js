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

  const preferenceField = preferenceMap[type];

  if (preferenceField) {
    const preferences = await NotificationPreference.findOne({
      tenantId,
      userId,
    }).lean();

    if (preferences && preferences[preferenceField] === false) {
      return null;
    }

    if (preferences && preferences.pushEnabled === false) {
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
  if (!Array.isArray(notifications) || notifications.length === 0) {
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

module.exports = {
  create,
  createMany,
};
