"use strict";

/**
 * ============================================================================
 * TrueBill ERP - Centralized Notification Message Templates & Copy
 * ============================================================================
 * Manage all automated, scheduled, and triggered notification messages here.
 * Includes sales stats messages, low stock alerts, order updates, invoices, etc.
 */

const NOTIFICATION_MESSAGES = {
  // --------------------------------------------------------------------------
  // 1. EVENING 6:00 PM STATS & AUTOMATED MOTIVATION MESSAGES
  // --------------------------------------------------------------------------
  DAILY_STATS: {
    // When sales are down compared to yesterday
    DECREASED: {
      title: "Daily Sales Update 📊",
      icon: "trending-down",
      priority: "NORMAL",
      route: "/reports",
      getMessage: ({ todaySalesFormatted, orderCount, yesterdaySalesFormatted, differenceFormatted }) =>
        `Today's sales was ₹${todaySalesFormatted} (${orderCount} ${orderCount === 1 ? "order" : "orders"}). Your sales has decreased compared to yesterday (₹${yesterdaySalesFormatted}), but don't worry! Every business has fluctuations. Tomorrow is a brand new opportunity to bounce back stronger! 💪🚀`,
    },

    // When sales are up compared to yesterday
    INCREASED: {
      title: "Great Job! Sales Are Up 🚀📈",
      icon: "trending-up",
      priority: "NORMAL",
      route: "/reports",
      getMessage: ({ todaySalesFormatted, orderCount, yesterdaySalesFormatted, growthPercent }) =>
        `Outstanding performance today! Total sales reached ₹${todaySalesFormatted} across ${orderCount} orders${growthPercent ? ` (+${growthPercent}%)` : ""}. Keep up the tremendous momentum! 🌟`,
    },

    // When sales are steady or baseline
    STEADY: {
      title: "Evening Business Summary 📈",
      icon: "bar-chart",
      priority: "NORMAL",
      route: "/reports",
      getMessage: ({ todaySalesFormatted, orderCount }) =>
        `Here is your 6:00 PM evening business summary: ₹${todaySalesFormatted} in sales from ${orderCount} orders today. Great work today, let's keep growing! 💼✨`,
    },

    // When no sales occurred today
    NO_SALES: {
      title: "Evening Business Summary 📊",
      icon: "bar-chart",
      priority: "LOW",
      route: "/reports",
      getMessage: () =>
        `No sales recorded today so far. Don't worry! Review your pending quotes and follow up with customers to kickstart tomorrow's pipeline! 💪📋`,
    },
  },

  // --------------------------------------------------------------------------
  // 2. LOW STOCK & INVENTORY ALERTS
  // --------------------------------------------------------------------------
  LOW_STOCK: {
    // Multiple items low on stock
    MULTIPLE: {
      title: "Low Stock Alert ⚠️",
      icon: "boxes",
      priority: "HIGH",
      route: "/products",
      getMessage: ({ count, sampleNames }) =>
        `Attention: ${count} products are running below their reorder level (${sampleNames}). Restock now to prevent missed sales orders! 📦`,
    },

    // Single product low on stock
    SINGLE: {
      title: "Low Stock Alert ⚠️",
      icon: "boxes",
      priority: "HIGH",
      route: "/products",
      getMessage: ({ productName, currentStock, unit, reorderLevel }) =>
        `Low stock warning: ${productName} has only ${currentStock} ${unit || "units"} remaining (Reorder level: ${reorderLevel}). Order new stock soon!`,
    },
  },

  // --------------------------------------------------------------------------
  // 3. SALES ORDERS & INVOICES
  // --------------------------------------------------------------------------
  SALES_ORDER: {
    CREATED: {
      title: "New Sales Order 🛍️",
      icon: "shopping-cart",
      priority: "NORMAL",
      route: "/sales/orders",
      getMessage: ({ orderNo, customerName, totalFormatted }) =>
        `New Sales Order #${orderNo} received from ${customerName} for ₹${totalFormatted}.`,
    },
  },

  SALES_INVOICE: {
    POSTED: {
      title: "Sales Invoice Generated 📄",
      icon: "file-text",
      priority: "NORMAL",
      route: "/sales/invoices",
      getMessage: ({ invoiceNo, customerName, totalFormatted }) =>
        `Sales Invoice #${invoiceNo} for ${customerName} (₹${totalFormatted}) was generated successfully.`,
    },
  },

  // --------------------------------------------------------------------------
  // 4. PAYMENTS & COLLECTIONS
  // --------------------------------------------------------------------------
  PAYMENT_RECEIVED: {
    title: "Payment Received 💳",
    icon: "circle-dollar-sign",
    priority: "NORMAL",
    route: "/customer-receipts",
    getMessage: ({ customerName, amountFormatted }) =>
      `Payment of ₹${amountFormatted} received from ${customerName}.`,
  },

  PAYMENT_OVERDUE: {
    title: "Payment Overdue Notice ⏰",
    icon: "calendar-clock",
    priority: "HIGH",
    route: "/outstanding",
    getMessage: ({ customerName, amountFormatted, invoiceNo }) =>
      `Payment of ₹${amountFormatted} for Invoice #${invoiceNo} from ${customerName} is overdue. Consider sending a reminder.`,
  },

  // --------------------------------------------------------------------------
  // 5. SYSTEM & APP UPDATES
  // --------------------------------------------------------------------------
  APP_UPDATE: {
    title: "TrueBill App Update Available 🚀",
    icon: "smartphone",
    priority: "NORMAL",
    route: "/settings/appearance",
    getMessage: ({ versionName }) =>
      `A new version of TrueBill ${versionName ? `(${versionName})` : ""} is available with performance improvements and new features!`,
  },
};

module.exports = NOTIFICATION_MESSAGES;
