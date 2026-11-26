"use strict";

const Tenant = require("../models/Tenant");
const NotificationService = require("./notificationService");
const NOTIFICATION_MESSAGES = require("../config/notificationMessages");
const SalesInvoice = require("../modules/sales-invoices/salesInvoice.model");
const SalesOrder = require("../modules/sales-orders/salesOrder.model");
const Product = require("../modules/products/product.model");

/**
 * Helper to compute IST (UTC+5:30) date boundaries for today and yesterday.
 */
function getISTDateRanges() {
  const now = new Date();
  // IST offset in ms: +5.5 hours
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60 * 1000) + istOffset);

  // Today 00:00:00 to 23:59:59 IST
  const todayStart = new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate(), 0, 0, 0);
  const todayEnd = new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate(), 23, 59, 59, 999);

  // Yesterday
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayEnd = new Date(todayStart.getTime() - 1);

  // Convert back to UTC dates for MongoDB queries
  const toUtc = (d) => new Date(d.getTime() - istOffset - (now.getTimezoneOffset() * 60 * 1000));

  const dateKey = `${istNow.getFullYear()}-${String(istNow.getMonth() + 1).padStart(2, "0")}-${String(istNow.getDate()).padStart(2, "0")}`;

  return {
    todayStart: toUtc(todayStart),
    todayEnd: toUtc(todayEnd),
    yesterdayStart: toUtc(yesterdayStart),
    yesterdayEnd: toUtc(yesterdayEnd),
    dateKey,
    istHour: istNow.getHours(),
    istMinute: istNow.getMinutes(),
  };
}

/**
 * Format currency in Indian numbering format (e.g. 15,000)
 */
function formatInr(amount) {
  return Math.round(Number(amount) || 0).toLocaleString("en-IN");
}

/**
 * Process Low Stock Alerts for all or a specific tenant.
 */
async function processLowStockAlerts({ targetTenantId } = {}) {
  const tenantFilter = targetTenantId
    ? { _id: targetTenantId, status: { $in: ["active", "trial"] } }
    : { status: { $in: ["active", "trial"] } };

  const tenants = await Tenant.find(tenantFilter).select("_id businessName").lean();
  const results = [];

  for (const tenant of tenants) {
    try {
      // Find active trackInventory goods where stock <= reorderLevel or stock <= 5
      const lowStockItems = await Product.find({
        tenantId: tenant._id,
        type: "GOODS",
        trackInventory: true,
        status: "ACTIVE",
        isDeleted: { $ne: true },
        $or: [
          {
            $expr: { $lte: ["$currentStock", "$reorderLevel"] },
            reorderLevel: { $gt: 0 },
          },
          {
            currentStock: { $lte: 5 },
          },
        ],
      })
        .select("name productCode currentStock reorderLevel unit")
        .limit(10)
        .lean();

      if (!lowStockItems.length) {
        continue;
      }

      let title = NOTIFICATION_MESSAGES.LOW_STOCK.MULTIPLE.title;
      let message = "";

      if (lowStockItems.length === 1) {
        const item = lowStockItems[0];
        message = NOTIFICATION_MESSAGES.LOW_STOCK.SINGLE.getMessage({
          productName: item.name,
          currentStock: item.currentStock || 0,
          unit: item.unit || "units",
          reorderLevel: item.reorderLevel || 5,
        });
      } else {
        const sampleNames = lowStockItems
          .slice(0, 3)
          .map((p) => `${p.name} (${p.currentStock || 0} ${p.unit || "pcs"})`)
          .join(", ");

        message = NOTIFICATION_MESSAGES.LOW_STOCK.MULTIPLE.getMessage({
          count: lowStockItems.length,
          sampleNames,
        });
      }

      const notif = await NotificationService.createForTenant({
        tenantId: tenant._id,
        type: "LOW_STOCK",
        title,
        message,
        icon: "boxes",
        priority: "HIGH",
        route: "/products",
        data: {
          lowStockCount: lowStockItems.length,
          itemCodes: lowStockItems.map((p) => p.productCode),
        },
      });

      results.push({
        tenantId: tenant._id,
        lowStockCount: lowStockItems.length,
        notificationId: notif?.notifications?.[0]?._id,
      });
    } catch (err) {
      console.error(`[LowStock] Error checking tenant ${tenant._id}:`, err.message);
    }
  }

  return results;
}

/**
 * Process Daily Evening 6:00 PM Stats for all or a specific tenant.
 */
async function processDailyEveningStats({ targetTenantId } = {}) {
  const { todayStart, todayEnd, yesterdayStart, yesterdayEnd, dateKey } = getISTDateRanges();

  const tenantFilter = targetTenantId
    ? { _id: targetTenantId, status: { $in: ["active", "trial"] } }
    : { status: { $in: ["active", "trial"] } };

  const tenants = await Tenant.find(tenantFilter).select("_id businessName").lean();
  const summary = {
    date: dateKey,
    processedTenants: 0,
    dispatchedNotifications: 0,
    details: [],
  };

  for (const tenant of tenants) {
    try {
      summary.processedTenants += 1;

      // 1. Fetch Today's Invoices and Orders
      const [todayInvoices, yesterdayInvoices, todayOrders] = await Promise.all([
        SalesInvoice.find({
          tenantId: tenant._id,
          invoiceDate: { $gte: todayStart, $lte: todayEnd },
          isDeleted: { $ne: true },
          status: { $ne: "CANCELLED" },
        })
          .select("totalAmountPaise")
          .lean(),

        SalesInvoice.find({
          tenantId: tenant._id,
          invoiceDate: { $gte: yesterdayStart, $lte: yesterdayEnd },
          isDeleted: { $ne: true },
          status: { $ne: "CANCELLED" },
        })
          .select("totalAmountPaise")
          .lean(),

        SalesOrder.find({
          tenantId: tenant._id,
          orderDate: { $gte: todayStart, $lte: todayEnd },
          isDeleted: { $ne: true },
          status: { $ne: "CANCELLED" },
        })
          .select("totalAmountPaise")
          .lean(),
      ]);

      // Calculate totals in Rupees
      const todayInvoicePaise = todayInvoices.reduce((sum, inv) => sum + (Number(inv.totalAmountPaise) || 0), 0);
      const yesterdayInvoicePaise = yesterdayInvoices.reduce((sum, inv) => sum + (Number(inv.totalAmountPaise) || 0), 0);
      const todayOrderPaise = todayOrders.reduce((sum, ord) => sum + (Number(ord.totalAmountPaise) || 0), 0);

      const todaySales = Math.round((todayInvoicePaise || todayOrderPaise) / 100);
      const yesterdaySales = Math.round(yesterdayInvoicePaise / 100);
      const orderCount = todayInvoices.length || todayOrders.length;

      const todaySalesFormatted = formatInr(todaySales);
      const yesterdaySalesFormatted = formatInr(yesterdaySales);

      let config;
      let title;
      let message;

      if (todaySales > 0 && yesterdaySales > 0 && todaySales < yesterdaySales) {
        // Sales decreased compared to yesterday - send motivational message
        config = NOTIFICATION_MESSAGES.DAILY_STATS.DECREASED;
        title = config.title;
        message = config.getMessage({
          todaySalesFormatted,
          orderCount,
          yesterdaySalesFormatted,
          differenceFormatted: formatInr(yesterdaySales - todaySales),
        });
      } else if (todaySales > 0 && todaySales >= yesterdaySales) {
        // Sales increased or steady growth
        config = NOTIFICATION_MESSAGES.DAILY_STATS.INCREASED;
        title = config.title;
        const growthPercent = yesterdaySales > 0
          ? Math.round(((todaySales - yesterdaySales) / yesterdaySales) * 100)
          : null;
        message = config.getMessage({
          todaySalesFormatted,
          orderCount,
          yesterdaySalesFormatted,
          growthPercent,
        });
      } else if (todaySales > 0) {
        // Sales occurred with no baseline
        config = NOTIFICATION_MESSAGES.DAILY_STATS.STEADY;
        title = config.title;
        message = config.getMessage({
          todaySalesFormatted,
          orderCount,
        });
      } else {
        // No sales recorded today
        config = NOTIFICATION_MESSAGES.DAILY_STATS.NO_SALES;
        title = config.title;
        message = config.getMessage();
      }

      const notif = await NotificationService.createForTenant({
        tenantId: tenant._id,
        type: "DAILY_STATS",
        title,
        message,
        icon: config.icon,
        priority: config.priority,
        route: config.route,
        data: {
          todaySales,
          yesterdaySales,
          orderCount,
          date: dateKey,
        },
      });

      summary.dispatchedNotifications += 1;
      summary.details.push({
        tenantId: tenant._id,
        businessName: tenant.businessName,
        todaySales,
        yesterdaySales,
        orderCount,
        title,
      });
    } catch (err) {
      console.error(`[DailyEveningStats] Error for tenant ${tenant._id}:`, err.message);
    }
  }

  // Also trigger low stock alerts alongside evening summary
  try {
    await processLowStockAlerts({ targetTenantId });
  } catch (err) {
    console.error("[DailyEveningStats] Low stock sub-check error:", err.message);
  }

  return summary;
}

let dailyStatsInterval = null;
let lastTriggeredDateKey = null;

/**
 * Initializes the recurring timer checking for 6:00 PM (18:00) IST daily.
 */
function startDailyEveningStatsScheduler() {
  if (dailyStatsInterval) return;

  console.log("[DailyEveningStatsScheduler] Initialized. Monitoring for daily 6:00 PM (18:00) IST schedule.");

  // Check every 30 seconds
  dailyStatsInterval = setInterval(async () => {
    try {
      const { istHour, istMinute, dateKey } = getISTDateRanges();

      // Trigger at 18:00 (6:00 PM) IST once per day
      if (istHour === 18 && istMinute === 0 && lastTriggeredDateKey !== dateKey) {
        lastTriggeredDateKey = dateKey;
        console.log(`[DailyEveningStatsScheduler] 6:00 PM IST triggered! Processing stats for ${dateKey}...`);
        const result = await processDailyEveningStats();
        console.log("[DailyEveningStatsScheduler] Completed 6:00 PM evening stats broadcast:", result);
      }
    } catch (err) {
      console.error("[DailyEveningStatsScheduler] Interval check error:", err.message);
    }
  }, 30000);
}

module.exports = {
  processDailyEveningStats,
  processLowStockAlerts,
  startDailyEveningStatsScheduler,
};
