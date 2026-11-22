"use strict";

const Tenant = require("../../models/Tenant");
const User = require("../../models/User");
const EmailNotificationLog = require("../../models/EmailNotificationLog");
const emailNotificationService = require("./emailNotificationService");

/**
 * TrustIQ Automated Subscription & Trial Lifecycle Email Service
 * Evaluates tenant trial & subscription end dates and automatically delivers:
 *  - TRIAL_EXPIRING_SOON (7 days / 3 days / 1 day before expiration)
 *  - TRIAL_EXPIRED (when trial expires)
 *  - SUBSCRIPTION_RENEWAL_REMINDER (7 days / 3 days / 1 day before renewal)
 *  - SUBSCRIPTION_EXPIRED (when subscription period lapses)
 */

async function processSubscriptionLifecycleEmails() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const summary = {
    timestamp: now.toISOString(),
    evaluatedTenants: 0,
    trialExpiringSoonDispatched: 0,
    trialExpiredDispatched: 0,
    renewalReminderDispatched: 0,
    subscriptionExpiredDispatched: 0,
    skippedAlreadySentToday: 0,
    errors: [],
  };

  try {
    const tenants = await Tenant.find({
      status: { $in: ["trial", "active"] },
      subscriptionEnd: { $ne: null },
    }).lean();

    summary.evaluatedTenants = tenants.length;

    for (const tenant of tenants) {
      try {
        const subEnd = new Date(tenant.subscriptionEnd);
        if (isNaN(subEnd.getTime())) continue;

        // Days remaining until expiration (ceiling)
        const diffMs = subEnd.getTime() - now.getTime();
        const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        // Resolve admin user or fallback to tenant email
        const adminUser = await User.findOne({
          tenantId: tenant._id,
          role: "admin",
          isActive: true,
        }).lean();

        const recipientEmail = adminUser?.email || tenant.email;
        if (!recipientEmail) continue;

        const recipientName = adminUser?.name || tenant.businessName || "Administrator";
        const companyName = tenant.businessName || "Your Organization";
        const planName = tenant.subscriptionPlan || "Standard Plan";
        const dateFormatted = subEnd.toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });

        const appUrl = process.env.APP_URL || "https://app.trustiq.in";

        // Check idempotency: avoid sending the same notice on the same day
        const wasSentToday = async (templateType) => {
          const count = await EmailNotificationLog.countDocuments({
            to: recipientEmail.trim().toLowerCase(),
            templateType,
            status: "SENT",
            sentAt: { $gte: todayStart },
          });
          return count > 0;
        };

        // --- CASE 1: TRIAL STATUS ---
        if (tenant.status === "trial") {
          if (daysLeft === 7 || daysLeft === 3 || daysLeft === 1) {
            const alreadySent = await wasSentToday("TRIAL_EXPIRING_SOON");
            if (!alreadySent) {
              await emailNotificationService.sendTrialExpiringSoon(recipientEmail, {
                userName: recipientName,
                daysLeft,
                planName,
                expiryDate: dateFormatted,
                upgradeUrl: `${appUrl}/billing/upgrade`,
              });
              summary.trialExpiringSoonDispatched++;
            } else {
              summary.skippedAlreadySentToday++;
            }
          } else if (daysLeft <= 0) {
            const alreadySent = await wasSentToday("TRIAL_EXPIRED");
            if (!alreadySent) {
              await emailNotificationService.sendTrialExpired(recipientEmail, {
                userName: recipientName,
                planName,
                expiredOn: dateFormatted,
                renewUrl: `${appUrl}/billing/renew`,
              });
              summary.trialExpiredDispatched++;
            } else {
              summary.skippedAlreadySentToday++;
            }
          }
        }

        // --- CASE 2: ACTIVE SUBSCRIPTION STATUS ---
        if (tenant.status === "active") {
          if (daysLeft === 7 || daysLeft === 3 || daysLeft === 1) {
            const alreadySent = await wasSentToday("SUBSCRIPTION_RENEWAL_REMINDER");
            if (!alreadySent) {
              await emailNotificationService.sendSubscriptionRenewalReminder(recipientEmail, {
                userName: recipientName,
                planName,
                renewalDate: dateFormatted,
                renewalAmount: "Standard Renewal",
                manageUrl: `${appUrl}/billing`,
              });
              summary.renewalReminderDispatched++;
            } else {
              summary.skippedAlreadySentToday++;
            }
          } else if (daysLeft <= 0) {
            const alreadySent = await wasSentToday("SUBSCRIPTION_EXPIRED");
            if (!alreadySent) {
              await emailNotificationService.sendSubscriptionExpired(recipientEmail, {
                userName: recipientName,
                planName,
                expiredOn: dateFormatted,
                renewUrl: `${appUrl}/billing/renew`,
              });
              summary.subscriptionExpiredDispatched++;
            } else {
              summary.skippedAlreadySentToday++;
            }
          }
        }
      } catch (tenantErr) {
        summary.errors.push({
          tenantId: tenant._id,
          error: tenantErr.message,
        });
      }
    }
  } catch (err) {
    console.error("[SubscriptionEmailScheduler] Lifecycle check error:", err);
    summary.errors.push({ error: err.message });
  }

  return summary;
}

let schedulerTimer = null;

function startSubscriptionEmailScheduler(intervalHours = 12) {
  if (schedulerTimer) return;

  const ms = Math.max(1, intervalHours) * 60 * 60 * 1000;
  console.log(`[SubscriptionEmailScheduler] Initialized. Active interval: ${intervalHours}h.`);

  // First check 15 seconds after server boots
  setTimeout(() => {
    processSubscriptionLifecycleEmails()
      .then((res) => {
        console.log("[SubscriptionEmailScheduler] Boot check complete:", res);
      })
      .catch((err) => {
        console.error("[SubscriptionEmailScheduler] Boot check error:", err.message);
      });
  }, 15000);

  // Regular periodic interval
  schedulerTimer = setInterval(() => {
    processSubscriptionLifecycleEmails()
      .then((res) => {
        console.log("[SubscriptionEmailScheduler] Scheduled check complete:", res);
      })
      .catch((err) => {
        console.error("[SubscriptionEmailScheduler] Scheduled check error:", err.message);
      });
  }, ms);
}

module.exports = {
  processSubscriptionLifecycleEmails,
  startSubscriptionEmailScheduler,
};
