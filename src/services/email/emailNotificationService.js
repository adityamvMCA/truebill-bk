"use strict";

const { sendMail } = require("../mailer");
const { TEMPLATES } = require("./emailTemplates");
const EmailNotificationLog = require("../../models/EmailNotificationLog");

/**
 * TrustIQ Unified Email Notification Service
 * Reusable across all backend modules, lifecycle events, and developer console.
 */
class EmailNotificationService {
  /**
   * Return metadata list of all available templates.
   */
  listTemplates() {
    return Object.entries(TEMPLATES).map(([key, config]) => ({
      type: key,
      category: config.category,
      name: config.name,
      description: config.description,
      sampleData: config.sampleData,
    }));
  }

  /**
   * Preview a rendered template with provided or default sample data.
   */
  preview(type, customData = {}) {
    const template = TEMPLATES[type];
    if (!template) {
      throw new Error(`Unknown email template type: ${type}`);
    }

    const mergedData = {
      ...template.sampleData,
      ...customData,
    };

    const rendered = template.render(mergedData);
    return {
      type,
      subject: rendered.subject,
      html: rendered.html,
      data: mergedData,
    };
  }

  /**
   * Core send method for any template.
   * Logs execution status in MongoDB.
   */
  async send({
    type,
    to,
    data = {},
    attachments = [],
    triggeredBy = "SYSTEM_AUTOMATION",
  }) {
    if (!to || typeof to !== "string") {
      throw new Error("Recipient email address 'to' is required");
    }

    const template = TEMPLATES[type];
    if (!template) {
      throw new Error(`Email template type '${type}' not recognized.`);
    }

    const mergedData = {
      ...template.sampleData,
      ...data,
    };

    const { subject, html } = template.render(mergedData);

    let messageId = null;
    let errorMsg = null;
    let status = "SENT";

    try {
      messageId = await sendMail({
        to: to.trim().toLowerCase(),
        subject,
        html,
        attachments,
      });
      return {
        success: true,
        messageId,
        subject,
        to,
        type,
      };
    } catch (err) {
      status = "FAILED";
      errorMsg = err.message || "Failed to deliver email through SMTP transport";
      throw err;
    } finally {
      // Record in notification logs for auditing & developer inspection
      try {
        await EmailNotificationLog.create({
          to: to.trim().toLowerCase(),
          templateType: type,
          subject,
          status,
          messageId,
          error: errorMsg,
          data: mergedData,
          triggeredBy,
          sentAt: new Date(),
        });
      } catch (logErr) {
        console.error("Failed to write to EmailNotificationLog:", logErr.message);
      }
    }
  }

  /* -------------------------------------------------------------
     Direct LifeCycle Helper Methods
     ------------------------------------------------------------- */

  // Subscription Lifecycle
  async sendFreeTrialStarted(to, data) {
    return this.send({ type: "FREE_TRIAL_STARTED", to, data });
  }

  async sendTrialExpiringSoon(to, data) {
    return this.send({ type: "TRIAL_EXPIRING_SOON", to, data });
  }

  async sendTrialExpired(to, data) {
    return this.send({ type: "TRIAL_EXPIRED", to, data });
  }

  async sendSubscriptionActivated(to, data) {
    return this.send({ type: "SUBSCRIPTION_ACTIVATED", to, data });
  }

  async sendPaymentSuccessful(to, data) {
    return this.send({ type: "PAYMENT_SUCCESSFUL", to, data });
  }

  async sendPaymentFailed(to, data) {
    return this.send({ type: "PAYMENT_FAILED", to, data });
  }

  async sendInvoiceGenerated(to, data) {
    return this.send({ type: "INVOICE_GENERATED", to, data });
  }

  async sendSubscriptionRenewalReminder(to, data) {
    return this.send({ type: "SUBSCRIPTION_RENEWAL_REMINDER", to, data });
  }

  async sendSubscriptionCancelled(to, data) {
    return this.send({ type: "SUBSCRIPTION_CANCELLED", to, data });
  }

  async sendSubscriptionExpired(to, data) {
    return this.send({ type: "SUBSCRIPTION_EXPIRED", to, data });
  }

  async sendPlanUpgraded(to, data) {
    return this.send({ type: "PLAN_UPGRADED", to, data });
  }

  async sendPlanDowngraded(to, data) {
    return this.send({ type: "PLAN_DOWNGRADED", to, data });
  }

  async sendRefundProcessed(to, data) {
    return this.send({ type: "REFUND_PROCESSED", to, data });
  }

  // Account & User Security
  async sendWelcomeEmail(to, data) {
    return this.send({ type: "WELCOME_EMAIL", to, data });
  }

  async sendEmailVerification(to, data) {
    return this.send({ type: "EMAIL_VERIFICATION", to, data });
  }

  async sendLoginAlert(to, data) {
    return this.send({ type: "LOGIN_ALERT", to, data });
  }

  async sendPasswordReset(to, data) {
    return this.send({ type: "PASSWORD_RESET", to, data });
  }

  async sendPasswordChanged(to, data) {
    return this.send({ type: "PASSWORD_CHANGED", to, data });
  }

  async sendAccountActivated(to, data) {
    return this.send({ type: "ACCOUNT_ACTIVATED", to, data });
  }

  async sendAccountSuspended(to, data) {
    return this.send({ type: "ACCOUNT_SUSPENDED", to, data });
  }

  async sendAccountDeleted(to, data) {
    return this.send({ type: "ACCOUNT_DELETED", to, data });
  }

  async sendEmailChanged(to, data) {
    return this.send({ type: "EMAIL_CHANGED", to, data });
  }
}

const emailNotificationService = new EmailNotificationService();

module.exports = emailNotificationService;
