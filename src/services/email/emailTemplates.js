"use strict";

/**
 * TrustIQ ERP - Unified Responsive Light Corporate Email Template Engine
 * Very light color palette, clean subtle borders, soft badges, zero GIFs.
 */

const THEMES = {
  primary: {
    primaryColor: "#2563eb",
    accentLight: "#eff6ff",
    borderTop: "#3b82f6",
    badgeBg: "#eff6ff",
    badgeColor: "#1d4ed8",
    badgeBorder: "#bfdbfe",
    buttonBg: "#2563eb",
  },
  success: {
    primaryColor: "#059669",
    accentLight: "#f0fdf4",
    borderTop: "#10b981",
    badgeBg: "#f0fdf4",
    badgeColor: "#047857",
    badgeBorder: "#bbf7d0",
    buttonBg: "#059669",
  },
  warning: {
    primaryColor: "#d97706",
    accentLight: "#fffbeb",
    borderTop: "#f59e0b",
    badgeBg: "#fffbeb",
    badgeColor: "#b45309",
    badgeBorder: "#fde68a",
    buttonBg: "#d97706",
  },
  danger: {
    primaryColor: "#dc2626",
    accentLight: "#fef2f2",
    borderTop: "#ef4444",
    badgeBg: "#fef2f2",
    badgeColor: "#b91c1c",
    badgeBorder: "#fecaca",
    buttonBg: "#dc2626",
  },
};

const escapeHtml = (str) =>
  String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const renderBaseEmailLayout = ({
  preheader = "Important notification from TrustIQ ERP",
  badgeText = "Notification",
  theme = "primary",
  heading = "",
  subheading = "",
  greeting = "Hello,",
  bodyHtml = "",
  metadataRows = [],
  ctaText = "",
  ctaUrl = "",
  secondaryNote = "",
  helpBoxHtml = "",
}) => {
  const t = THEMES[theme] || THEMES.primary;

  const metadataHtml =
    metadataRows && metadataRows.length > 0
      ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <tbody>
          ${metadataRows
            .map(
              ([key, val], idx) => `
            <tr style="border-bottom: ${idx < metadataRows.length - 1 ? "1px solid #edf2f7" : "none"};">
              <td style="padding: 12px 16px; font-size: 13px; font-weight: 500; color: #64748b; width: 40%; vertical-align: middle;">${escapeHtml(key)}</td>
              <td style="padding: 12px 16px; font-size: 13px; font-weight: 600; color: #0f172a; vertical-align: middle;">${escapeHtml(val)}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    `
      : "";

  const ctaButtonHtml =
    ctaText && ctaUrl
      ? `
      <div style="margin: 28px 0 20px 0; text-align: center;">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(ctaUrl)}" style="height:44px;v-text-anchor:middle;width:220px;" arcsize="10%" stroke="f" fillcolor="${t.primaryColor}">
        <w:anchorlock/>
        <center style="color:#ffffff;font-family:sans-serif;font-size:14px;font-weight:bold;">${escapeHtml(ctaText)} &rarr;</center>
        </v:roundrect>
        <![endif]-->
        <a href="${escapeHtml(ctaUrl)}" style="display: inline-block; background-color: ${t.buttonBg}; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 6px; letter-spacing: 0.2px; mso-hide: all;">
          ${escapeHtml(ctaText)} &rarr;
        </a>
      </div>
    `
      : "";

  const helpBox = helpBoxHtml
    ? `
      <div style="margin-top: 24px; padding: 14px 16px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 3px solid ${t.borderTop}; border-radius: 6px; font-size: 13px; color: #475569; line-height: 1.55;">
        ${helpBoxHtml}
      </div>
    `
    : "";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(heading)}</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; color: #1e293b; -webkit-font-smoothing: antialiased; }
    table { border-collapse: collapse; }
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; margin: 0 !important; border-radius: 0 !important; }
      .email-header { padding: 24px 20px 16px 20px !important; }
      .email-body { padding: 24px 20px !important; }
      .header-title { font-size: 20px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 32px 0; background-color: #f8fafc;">
  <!-- PREHEADER -->
  <div style="display: none; max-height: 0px; overflow: hidden; mso-hide: all;">
    ${escapeHtml(preheader)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding: 0 12px;">
        <!-- CONTAINER -->
        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" style="width: 600px; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 10px; overflow: hidden; border: 1px solid #e2e8f0; border-top: 4px solid ${t.borderTop}; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);">
          
          <!-- BRAND HEADER -->
          <tr>
            <td class="email-header" style="background-color: #ffffff; padding: 28px 36px 18px 36px; border-bottom: 1px solid #f1f5f9;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="left">
                    <div style="font-size: 19px; font-weight: 800; color: #0f172a; letter-spacing: -0.4px;">
                      TrustIQ <span style="font-weight: 500; color: #64748b;">ERP</span>
                    </div>
                  </td>
                  <td align="right">
                    <span style="display: inline-block; background-color: ${t.badgeBg}; border: 1px solid ${t.badgeBorder}; color: ${t.badgeColor}; font-size: 11px; font-weight: 700; text-transform: uppercase; padding: 4px 12px; border-radius: 9999px; letter-spacing: 0.5px;">
                      ${escapeHtml(badgeText)}
                    </span>
                  </td>
                </tr>
              </table>

              <div style="margin-top: 18px;">
                <h1 class="header-title" style="margin: 0; color: #0f172a; font-size: 22px; font-weight: 700; line-height: 1.35; letter-spacing: -0.3px;">
                  ${escapeHtml(heading)}
                </h1>
                ${
                  subheading
                    ? `<p style="margin: 6px 0 0 0; color: #64748b; font-size: 14px; line-height: 1.5;">${escapeHtml(subheading)}</p>`
                    : ""
                }
              </div>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td class="email-body" style="padding: 28px 36px 28px 36px; background-color: #ffffff;">
              <p style="margin: 0 0 14px 0; font-size: 15px; font-weight: 600; color: #0f172a;">
                ${escapeHtml(greeting)}
              </p>

              <div style="font-size: 14px; line-height: 1.65; color: #334155;">
                ${bodyHtml}
              </div>

              ${metadataHtml}
              ${ctaButtonHtml}

              ${
                secondaryNote
                  ? `<p style="margin: 18px 0 0 0; font-size: 12px; color: #64748b; line-height: 1.5; text-align: center;">${secondaryNote}</p>`
                  : ""
              }
              ${helpBox}
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding: 22px 36px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0 0 6px 0; font-size: 12px; color: #64748b; font-weight: 600;">
                TrustIQ ERP &bull; Intelligent Financial Operations & Automated GST Compliance
              </p>
              <p style="margin: 0 0 10px 0; font-size: 11px; color: #94a3b8; line-height: 1.45;">
                You are receiving this official operational email regarding your TrustIQ organization account.
              </p>
              <div style="font-size: 11px; color: #94a3b8; font-weight: 500;">
                &copy; ${new Date().getFullYear()} TrustIQ Technologies Inc. All rights reserved.
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
};

/* =====================================================================
   ALL 22 EMAIL TEMPLATES - CLEAN LIGHT CORPORATE PALETTE
   ===================================================================== */

const TEMPLATES = {
  // 1. FREE_TRIAL_STARTED
  FREE_TRIAL_STARTED: {
    category: "Subscription & Billing",
    name: "Free Trial Started",
    description: "Sent immediately when an organization begins its free trial period.",
    sampleData: {
      userName: "Alex Johnson",
      companyName: "Acme Logistics Pvt Ltd",
      planName: "Enterprise Tier",
      trialDays: 14,
      expiresOn: "06 Dec 2026",
      loginUrl: "https://app.trustiq.in/login",
    },
    render: (data = {}) => {
      const {
        userName = "Valued Customer",
        companyName = "Your Business",
        planName = "Enterprise Trial",
        trialDays = 14,
        expiresOn = "14 days from today",
        loginUrl = "https://app.trustiq.in/login",
      } = data;

      const subject = `Welcome to TrustIQ ERP! Your ${trialDays}-Day Free Trial has started`;
      const html = renderBaseEmailLayout({
        preheader: `Your ${trialDays}-day full access trial for ${companyName} is now active.`,
        badgeText: "Trial Activated",
        theme: "success",
        heading: "Welcome to TrustIQ ERP!",
        subheading: `Your ${trialDays}-day full-featured trial is now ready for your team.`,
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>We are thrilled to welcome you and <strong>${escapeHtml(companyName)}</strong> to TrustIQ ERP. During your trial, you have complete access to all enterprise modules including Invoicing, Automated GST, Inventory tracking, E-Way Bill generation, and Accounting Ledgers.</p>
          <p>Get started right away by exploring your dashboard or importing your master data in just a few clicks.</p>
        `,
        metadataRows: [
          ["Organization", companyName],
          ["Plan", planName],
          ["Trial Duration", `${trialDays} Days`],
          ["Trial Validity Until", expiresOn],
        ],
        ctaText: "Launch TrustIQ Dashboard",
        ctaUrl: loginUrl,
        helpBoxHtml: `<strong>Need onboarding support?</strong> Our team can assist with master data import and chart of accounts mapping for free. Reply directly to this email to book a walkthrough.`,
      });
      return { subject, html };
    },
  },

  // 2. TRIAL_EXPIRING_SOON
  TRIAL_EXPIRING_SOON: {
    category: "Subscription & Billing",
    name: "Trial Expiring Soon",
    description: "Sent 7 days, 3 days, or 1 day before trial expiration.",
    sampleData: {
      userName: "Alex Johnson",
      daysLeft: 3,
      planName: "Enterprise Tier",
      expiryDate: "25 Nov 2026",
      upgradeUrl: "https://app.trustiq.in/billing/upgrade",
    },
    render: (data = {}) => {
      const {
        userName = "Customer",
        daysLeft = 3,
        planName = "Enterprise Tier",
        expiryDate = "in a few days",
        upgradeUrl = "https://app.trustiq.in/billing/upgrade",
      } = data;

      const subject = `Notice: Your TrustIQ ERP trial expires in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`;
      const html = renderBaseEmailLayout({
        preheader: `Only ${daysLeft} days remaining on your trial. Upgrade today to prevent disruption.`,
        badgeText: "Expiring Soon",
        theme: "warning",
        heading: `Your trial expires in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`,
        subheading: `Upgrade your plan before ${escapeHtml(expiryDate)} to keep your automated workflows active.`,
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>Your free trial of <strong>${escapeHtml(planName)}</strong> is concluding soon. Once expired, automated invoice generation, e-way bill export, and accounting sync will pause until a subscription is activated.</p>
          <p>All your invoices, ledger mappings, and business transactions are safe and ready for seamless continuation.</p>
        `,
        metadataRows: [
          ["Current Tier", planName],
          ["Time Remaining", `${daysLeft} ${daysLeft === 1 ? "Day" : "Days"}`],
          ["Expiration Date", expiryDate],
        ],
        ctaText: "Upgrade Plan & Keep Access",
        ctaUrl: upgradeUrl,
      });
      return { subject, html };
    },
  },

  // 3. TRIAL_EXPIRED
  TRIAL_EXPIRED: {
    category: "Subscription & Billing",
    name: "Trial Expired",
    description: "Sent immediately when the trial concludes without an active subscription.",
    sampleData: {
      userName: "Alex Johnson",
      planName: "Enterprise Tier",
      expiredOn: "22 Nov 2026",
      renewUrl: "https://app.trustiq.in/billing/renew",
    },
    render: (data = {}) => {
      const {
        userName = "Customer",
        planName = "Enterprise Plan",
        expiredOn = "Today",
        renewUrl = "https://app.trustiq.in/billing/renew",
      } = data;

      const subject = "Your TrustIQ ERP Free Trial has Expired";
      const html = renderBaseEmailLayout({
        preheader: "Your free trial has ended. Subscribe now to reactivate your workspace.",
        badgeText: "Trial Expired",
        theme: "danger",
        heading: "Your Free Trial has Ended",
        subheading: "Subscribe now to reactivate and continue managing your business without pause.",
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>Your trial period for <strong>${escapeHtml(planName)}</strong> ended on <strong>${escapeHtml(expiredOn)}</strong>.</p>
          <p>Your account data, customer masters, and posted vouchers are securely archived. To restore complete access and resume issuing GST invoices and receipts, please choose a subscription plan.</p>
        `,
        metadataRows: [
          ["Expired Plan", planName],
          ["Expiration Date", expiredOn],
          ["Data Retention", "Securely Preserved"],
        ],
        ctaText: "Reactivate Subscription",
        ctaUrl: renewUrl,
      });
      return { subject, html };
    },
  },

  // 4. SUBSCRIPTION_ACTIVATED
  SUBSCRIPTION_ACTIVATED: {
    category: "Subscription & Billing",
    name: "Subscription Activated",
    description: "Sent when a paid subscription is confirmed and activated.",
    sampleData: {
      userName: "Alex Johnson",
      planName: "Pro Annual Tier",
      billingCycle: "Annual (12 Months)",
      amount: "₹14,999",
      nextRenewal: "22 Nov 2027",
      manageUrl: "https://app.trustiq.in/billing",
    },
    render: (data = {}) => {
      const {
        userName = "Customer",
        planName = "Pro Plan",
        billingCycle = "Annual",
        amount = "₹14,999",
        nextRenewal = "Next Year",
        manageUrl = "https://app.trustiq.in/billing",
      } = data;

      const subject = `Subscription Confirmed: Welcome to TrustIQ ${planName}!`;
      const html = renderBaseEmailLayout({
        preheader: `Thank you for subscribing to ${planName}. Your workspace is active.`,
        badgeText: "Active Subscription",
        theme: "success",
        heading: "Subscription Activated!",
        subheading: `Your ${escapeHtml(planName)} is now fully provisioned and active.`,
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>Thank you for subscribing to TrustIQ ERP. Your payment has cleared and your workspace has been upgraded with all premium limits, multi-user seats, and priority support.</p>
        `,
        metadataRows: [
          ["Subscription Plan", planName],
          ["Billing Cycle", billingCycle],
          ["Amount Paid", amount],
          ["Next Renewal Date", nextRenewal],
        ],
        ctaText: "Go to Business Dashboard",
        ctaUrl: manageUrl,
      });
      return { subject, html };
    },
  },

  // 5. PAYMENT_SUCCESSFUL
  PAYMENT_SUCCESSFUL: {
    category: "Subscription & Billing",
    name: "Payment Successful",
    description: "Sent immediately upon receiving a successful transaction payment.",
    sampleData: {
      userName: "Alex Johnson",
      receiptNo: "REC-2026-9081",
      paymentMethod: "UPI / Net Banking",
      amountPaid: "₹4,999.00",
      transactionDate: "22 Nov 2026, 12:30 PM",
      downloadReceiptUrl: "https://app.trustiq.in/billing/receipt/REC-2026-9081",
    },
    render: (data = {}) => {
      const {
        userName = "Customer",
        receiptNo = "REC-AUTO",
        paymentMethod = "Online Payment",
        amountPaid = "₹0.00",
        transactionDate = new Date().toLocaleString(),
        downloadReceiptUrl = "https://app.trustiq.in/billing",
      } = data;

      const subject = `Payment Received: ${amountPaid} (Receipt #${receiptNo})`;
      const html = renderBaseEmailLayout({
        preheader: `Your payment of ${amountPaid} was processed successfully.`,
        badgeText: "Payment Cleared",
        theme: "success",
        heading: "Payment Received Successfully",
        subheading: `Receipt #${escapeHtml(receiptNo)} has been generated for your records.`,
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>We have successfully processed your payment. Your updated billing statement and tax invoice are available in your portal.</p>
        `,
        metadataRows: [
          ["Receipt Number", receiptNo],
          ["Payment Method", paymentMethod],
          ["Amount Paid", amountPaid],
          ["Transaction Date", transactionDate],
        ],
        ctaText: "Download Official Tax Receipt",
        ctaUrl: downloadReceiptUrl,
      });
      return { subject, html };
    },
  },

  // 6. PAYMENT_FAILED
  PAYMENT_FAILED: {
    category: "Subscription & Billing",
    name: "Payment Failed",
    description: "Sent when an automated card or recurring subscription charge fails.",
    sampleData: {
      userName: "Alex Johnson",
      amountDue: "₹4,999.00",
      failureReason: "Card declined by issuing bank (Insufficient funds)",
      nextRetryDate: "24 Nov 2026",
      retryUrl: "https://app.trustiq.in/billing/retry",
    },
    render: (data = {}) => {
      const {
        userName = "Customer",
        amountDue = "₹4,999.00",
        failureReason = "Transaction declined by payment gateway",
        nextRetryDate = "within 48 hours",
        retryUrl = "https://app.trustiq.in/billing",
      } = data;

      const subject = `Urgent: Payment failed for your TrustIQ ERP subscription (${amountDue})`;
      const html = renderBaseEmailLayout({
        preheader: `We were unable to process your payment of ${amountDue}. Please update your payment method.`,
        badgeText: "Payment Issue",
        theme: "danger",
        heading: "Payment Could Not Be Processed",
        subheading: "Please verify your payment details to prevent interruption of service.",
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>We attempted to charge your default payment method for your recurring subscription, but the issuing bank declined the transaction.</p>
          <p>To keep your automated billing and GST services running uninterrupted, please update your payment method or complete the payment manually.</p>
        `,
        metadataRows: [
          ["Amount Due", amountDue],
          ["Reason for Decline", failureReason],
          ["Next Automatic Retry", nextRetryDate],
        ],
        ctaText: "Update Payment Method & Retry",
        ctaUrl: retryUrl,
      });
      return { subject, html };
    },
  },

  // 7. INVOICE_GENERATED
  INVOICE_GENERATED: {
    category: "Subscription & Billing",
    name: "Invoice Generated",
    description: "Sent when a subscription GST invoice is created.",
    sampleData: {
      userName: "Alex Johnson",
      invoiceNumber: "INV-2026-089",
      billingPeriod: "Nov 2026 - Nov 2027",
      totalAmount: "₹17,698.82 (incl. 18% GST)",
      invoiceDate: "22 Nov 2026",
      viewInvoiceUrl: "https://app.trustiq.in/billing/invoices/INV-2026-089",
    },
    render: (data = {}) => {
      const {
        userName = "Customer",
        invoiceNumber = "INV-000",
        billingPeriod = "Current Cycle",
        totalAmount = "₹0.00",
        invoiceDate = "Today",
        viewInvoiceUrl = "https://app.trustiq.in/billing",
      } = data;

      const subject = `Tax Invoice #${invoiceNumber} for your TrustIQ Subscription`;
      const html = renderBaseEmailLayout({
        preheader: `Tax invoice ${invoiceNumber} is ready for download with GST details.`,
        badgeText: "Tax Invoice",
        theme: "primary",
        heading: "Tax Invoice Generated",
        subheading: `Invoice #${escapeHtml(invoiceNumber)} is now available in your portal.`,
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>Your subscription tax invoice is ready. It includes complete GST breakdown, HSN/SAC codes, and your organization's GSTIN for input tax credit (ITC) claims.</p>
        `,
        metadataRows: [
          ["Invoice Number", invoiceNumber],
          ["Invoice Date", invoiceDate],
          ["Billing Period", billingPeriod],
          ["Total Amount", totalAmount],
        ],
        ctaText: "View & Download PDF Invoice",
        ctaUrl: viewInvoiceUrl,
      });
      return { subject, html };
    },
  },

  // 8. SUBSCRIPTION_RENEWAL_REMINDER
  SUBSCRIPTION_RENEWAL_REMINDER: {
    category: "Subscription & Billing",
    name: "Subscription Renewal Reminder",
    description: "Sent 14 or 7 days prior to upcoming subscription auto-renewal.",
    sampleData: {
      userName: "Alex Johnson",
      planName: "Pro Tier (Annual)",
      renewalDate: "05 Dec 2026",
      renewalAmount: "₹14,999.00",
      manageUrl: "https://app.trustiq.in/billing",
    },
    render: (data = {}) => {
      const {
        userName = "Customer",
        planName = "Annual Plan",
        renewalDate = "Upcoming date",
        renewalAmount = "₹0.00",
        manageUrl = "https://app.trustiq.in/billing",
      } = data;

      const subject = `Upcoming Renewal Reminder: TrustIQ ${planName} on ${renewalDate}`;
      const html = renderBaseEmailLayout({
        preheader: `Your subscription will automatically renew on ${renewalDate}.`,
        badgeText: "Renewal Notice",
        theme: "warning",
        heading: "Upcoming Subscription Renewal",
        subheading: `Your plan will renew on ${escapeHtml(renewalDate)}.`,
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>This is a friendly reminder that your subscription to <strong>${escapeHtml(planName)}</strong> is scheduled to renew automatically on <strong>${escapeHtml(renewalDate)}</strong>.</p>
          <p>No action is needed if you wish to continue enjoying uninterrupted access. You can review your billing details or payment method at any time in your portal.</p>
        `,
        metadataRows: [
          ["Current Tier", planName],
          ["Scheduled Renewal Date", renewalDate],
          ["Renewal Amount", renewalAmount],
        ],
        ctaText: "Review Subscription Settings",
        ctaUrl: manageUrl,
      });
      return { subject, html };
    },
  },

  // 9. SUBSCRIPTION_CANCELLED
  SUBSCRIPTION_CANCELLED: {
    category: "Subscription & Billing",
    name: "Subscription Cancelled",
    description: "Sent when an administrator cancels automatic renewal or plan.",
    sampleData: {
      userName: "Alex Johnson",
      planName: "Enterprise Tier",
      activeUntil: "30 Nov 2026",
      reactivateUrl: "https://app.trustiq.in/billing/renew",
    },
    render: (data = {}) => {
      const {
        userName = "Customer",
        planName = "Enterprise Plan",
        activeUntil = "the end of your current cycle",
        reactivateUrl = "https://app.trustiq.in/billing",
      } = data;

      const subject = "Your TrustIQ ERP Subscription Has Been Cancelled";
      const html = renderBaseEmailLayout({
        preheader: "Your subscription cancellation confirmation and remaining access dates.",
        badgeText: "Cancelled",
        theme: "warning",
        heading: "Subscription Cancelled",
        subheading: `Your subscription will remain active until ${escapeHtml(activeUntil)}.`,
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>We received your request to cancel your subscription to <strong>${escapeHtml(planName)}</strong>.</p>
          <p>You will retain full access to all features until <strong>${escapeHtml(activeUntil)}</strong>. After this date, your plan will transition to read-only mode and you won't be charged again.</p>
          <p>If you changed your mind or cancelled by accident, you can reactivate anytime before your cycle ends.</p>
        `,
        metadataRows: [
          ["Cancelled Plan", planName],
          ["Access Active Until", activeUntil],
          ["Future Charges", "None / Stopped"],
        ],
        ctaText: "Reactivate Subscription",
        ctaUrl: reactivateUrl,
      });
      return { subject, html };
    },
  },

  // 10. SUBSCRIPTION_EXPIRED
  SUBSCRIPTION_EXPIRED: {
    category: "Subscription & Billing",
    name: "Subscription Expired",
    description: "Sent when subscription period has fully lapsed.",
    sampleData: {
      userName: "Alex Johnson",
      planName: "Pro Tier",
      expiredOn: "22 Nov 2026",
      renewUrl: "https://app.trustiq.in/billing/renew",
    },
    render: (data = {}) => {
      const {
        userName = "Customer",
        planName = "Pro Tier",
        expiredOn = "Today",
        renewUrl = "https://app.trustiq.in/billing/renew",
      } = data;

      const subject = "Subscription Expired: Reconnect TrustIQ ERP";
      const html = renderBaseEmailLayout({
        preheader: "Your subscription period has ended. Renew now to restore access.",
        badgeText: "Expired",
        theme: "danger",
        heading: "Subscription Has Expired",
        subheading: "Renew today to restore full operational access to your business records.",
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>Your subscription to <strong>${escapeHtml(planName)}</strong> has expired as of ${escapeHtml(expiredOn)}.</p>
          <p>To prevent delays in processing customer invoices, filing GSTR reports, or creating deliveries, please choose a plan to restore instant access.</p>
        `,
        metadataRows: [
          ["Lapsed Tier", planName],
          ["Expiration Date", expiredOn],
          ["Records Status", "Preserved and Encrypted"],
        ],
        ctaText: "Renew Subscription Now",
        ctaUrl: renewUrl,
      });
      return { subject, html };
    },
  },

  // 11. PLAN_UPGRADED
  PLAN_UPGRADED: {
    category: "Subscription & Billing",
    name: "Plan Upgraded",
    description: "Sent after a user upgrades to a higher subscription tier.",
    sampleData: {
      userName: "Alex Johnson",
      oldPlan: "Starter Tier",
      newPlan: "Enterprise Tier",
      effectiveDate: "22 Nov 2026",
      featuresUnlocked: "Unlimited invoices, automated E-Way bills, multi-branch, audit trail",
      dashboardUrl: "https://app.trustiq.in/dashboard",
    },
    render: (data = {}) => {
      const {
        userName = "Customer",
        oldPlan = "Standard Tier",
        newPlan = "Enterprise Tier",
        effectiveDate = "Immediate",
        featuresUnlocked = "Higher limits and enterprise modules",
        dashboardUrl = "https://app.trustiq.in/dashboard",
      } = data;

      const subject = `Congratulations on upgrading to TrustIQ ${newPlan}!`;
      const html = renderBaseEmailLayout({
        preheader: `You have successfully upgraded from ${oldPlan} to ${newPlan}.`,
        badgeText: "Plan Upgraded",
        theme: "success",
        heading: "Plan Upgraded Successfully!",
        subheading: `Welcome to ${escapeHtml(newPlan)}. Your new limits are active immediately.`,
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>Your account has been upgraded to <strong>${escapeHtml(newPlan)}</strong>. All advanced features, higher transaction limits, and expanded multi-user seats are ready for your team.</p>
        `,
        metadataRows: [
          ["Previous Plan", oldPlan],
          ["New Upgraded Plan", newPlan],
          ["Effective Date", effectiveDate],
          ["New Capabilities", featuresUnlocked],
        ],
        ctaText: "Explore Upgraded Dashboard",
        ctaUrl: dashboardUrl,
      });
      return { subject, html };
    },
  },

  // 12. PLAN_DOWNGRADED
  PLAN_DOWNGRADED: {
    category: "Subscription & Billing",
    name: "Plan Downgraded",
    description: "Sent when an administrator switches to a lower tier for the next cycle.",
    sampleData: {
      userName: "Alex Johnson",
      currentPlan: "Enterprise Tier",
      newPlan: "Standard Tier",
      effectiveFrom: "01 Dec 2026",
      billingUrl: "https://app.trustiq.in/billing",
    },
    render: (data = {}) => {
      const {
        userName = "Customer",
        currentPlan = "Enterprise Tier",
        newPlan = "Standard Tier",
        effectiveFrom = "Next Billing Cycle",
        billingUrl = "https://app.trustiq.in/billing",
      } = data;

      const subject = `Your TrustIQ Plan Downgrade Confirmation to ${newPlan}`;
      const html = renderBaseEmailLayout({
        preheader: `Your plan change to ${newPlan} is scheduled for ${effectiveFrom}.`,
        badgeText: "Plan Modified",
        theme: "warning",
        heading: "Plan Downgrade Scheduled",
        subheading: `Your change to ${escapeHtml(newPlan)} will take effect on ${escapeHtml(effectiveFrom)}.`,
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>We have processed your request to adjust your tier from <strong>${escapeHtml(currentPlan)}</strong> to <strong>${escapeHtml(newPlan)}</strong>.</p>
          <p>You can continue using your current tier features until <strong>${escapeHtml(effectiveFrom)}</strong>. On that date, your billing rate and limits will update automatically.</p>
        `,
        metadataRows: [
          ["Current Tier", currentPlan],
          ["New Tier", newPlan],
          ["Effective Date", effectiveFrom],
        ],
        ctaText: "Manage Billing Settings",
        ctaUrl: billingUrl,
      });
      return { subject, html };
    },
  },

  // 13. REFUND_PROCESSED
  REFUND_PROCESSED: {
    category: "Subscription & Billing",
    name: "Refund Processed",
    description: "Sent when a refund or credit has been issued to the customer.",
    sampleData: {
      userName: "Alex Johnson",
      refundAmount: "₹2,499.00",
      refundId: "REF-2026-4431",
      originalTransaction: "TXN-881203",
      creditDestination: "Original payment method (Bank/UPI)",
      eta: "3–5 business days",
    },
    render: (data = {}) => {
      const {
        userName = "Customer",
        refundAmount = "₹0.00",
        refundId = "REF-N/A",
        originalTransaction = "TXN-ORIGINAL",
        creditDestination = "Original Payment Method",
        eta = "3–5 business days",
      } = data;

      const subject = `Refund Confirmation: ${refundAmount} has been processed`;
      const html = renderBaseEmailLayout({
        preheader: `A refund of ${refundAmount} was processed (Ref #${refundId}).`,
        badgeText: "Refund Issued",
        theme: "success",
        heading: "Refund Processed",
        subheading: `Your refund of ${escapeHtml(refundAmount)} has been initiated.`,
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>We have processed a refund for your account. Depending on your bank or card issuer, the credit typically appears on your statement within 3 to 5 business days.</p>
        `,
        metadataRows: [
          ["Refund Amount", refundAmount],
          ["Refund Reference ID", refundId],
          ["Original Transaction", originalTransaction],
          ["Destination", creditDestination],
          ["Estimated Credit", eta],
        ],
      });
      return { subject, html };
    },
  },

  // 14. WELCOME_EMAIL
  WELCOME_EMAIL: {
    category: "Account & Security",
    name: "Welcome Email",
    description: "Sent to newly registered business users and administrators.",
    sampleData: {
      userName: "Alex Johnson",
      companyName: "Acme Logistics Pvt Ltd",
      email: "alex@acme.com",
      loginUrl: "https://app.trustiq.in/login",
    },
    render: (data = {}) => {
      const {
        userName = "Valued User",
        companyName = "Your Business",
        email = "",
        loginUrl = "https://app.trustiq.in/login",
      } = data;

      const subject = `Welcome to TrustIQ ERP, ${userName}!`;
      const html = renderBaseEmailLayout({
        preheader: `Your account for ${companyName} has been created successfully.`,
        badgeText: "Welcome",
        theme: "primary",
        heading: "Welcome to TrustIQ ERP",
        subheading: "Your intelligent, GST-ready financial operations platform.",
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>Thank you for joining TrustIQ ERP! We are dedicated to providing fast, reliable, and compliant accounting, invoicing, and logistics management for <strong>${escapeHtml(companyName)}</strong>.</p>
          <p>Here are a few quick steps to get you rolling:</p>
          <ul style="margin: 12px 0; padding-left: 20px;">
            <li>Set up your business GSTIN and bank ledger</li>
            <li>Create or import your customer list</li>
            <li>Issue your first GST invoice or E-Way Bill in seconds</li>
          </ul>
        `,
        metadataRows: [
          ["Registered Email", email || "Your email"],
          ["Organization", companyName],
          ["Account Role", "Organization User"],
        ],
        ctaText: "Sign In to Your Workspace",
        ctaUrl: loginUrl,
      });
      return { subject, html };
    },
  },

  // 15. EMAIL_VERIFICATION
  EMAIL_VERIFICATION: {
    category: "Account & Security",
    name: "Email Verification",
    description: "Sent after registration or email update to verify ownership.",
    sampleData: {
      userName: "Alex Johnson",
      verifyUrl: "https://app.trustiq.in/verify-email?token=abcdef123456",
      expiresIn: "24 hours",
    },
    render: (data = {}) => {
      const {
        userName = "User",
        verifyUrl = "https://app.trustiq.in/verify-email",
        expiresIn = "24 hours",
      } = data;

      const subject = "Please verify your email address - TrustIQ ERP";
      const html = renderBaseEmailLayout({
        preheader: "Verify your email address to secure your TrustIQ account.",
        badgeText: "Action Required",
        theme: "primary",
        heading: "Verify Your Email Address",
        subheading: "Confirm your email to complete registration and secure your workspace.",
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>Thank you for registering with TrustIQ. Please confirm your email address by clicking the button below. This link remains valid for <strong>${escapeHtml(expiresIn)}</strong>.</p>
        `,
        ctaText: "Verify Email Address",
        ctaUrl: verifyUrl,
        secondaryNote: `If the button doesn't work, copy and paste this link into your browser: <br><a href="${escapeHtml(verifyUrl)}" style="color: #2563eb; word-break: break-all;">${escapeHtml(verifyUrl)}</a>`,
      });
      return { subject, html };
    },
  },

  // 16. LOGIN_ALERT
  LOGIN_ALERT: {
    category: "Account & Security",
    name: "Login Alert",
    description: "Sent when an account login occurs from a new device, IP, or location.",
    sampleData: {
      userName: "Alex Johnson",
      device: "Chrome on macOS / Windows 11",
      ipAddress: "103.212.145.89",
      location: "Bengaluru, Karnataka, India",
      loginTime: "22 Nov 2026, 12:45 PM IST",
      secureAccountUrl: "https://app.trustiq.in/settings/security",
    },
    render: (data = {}) => {
      const {
        userName = "User",
        device = "Unknown Device",
        ipAddress = "Hidden",
        location = "Unknown Location",
        loginTime = new Date().toLocaleString(),
        secureAccountUrl = "https://app.trustiq.in/settings/security",
      } = data;

      const subject = `Security Alert: New sign-in to your TrustIQ account (${location})`;
      const html = renderBaseEmailLayout({
        preheader: `A new sign-in was detected from ${device} in ${location}.`,
        badgeText: "Security Notice",
        theme: "warning",
        heading: "New Sign-in Detected",
        subheading: "A recent login was recorded on your TrustIQ ERP account.",
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>We noticed a sign-in to your account from a browser or location we haven't seen recently. If this was you, you can safely disregard this email.</p>
        `,
        metadataRows: [
          ["Device & Browser", device],
          ["IP Address", ipAddress],
          ["Approximate Location", location],
          ["Time of Login", loginTime],
        ],
        ctaText: "Secure My Account",
        ctaUrl: secureAccountUrl,
        secondaryNote: "<strong>Didn't sign in?</strong> Someone may have unauthorized access to your password. Change your password immediately and terminate other active sessions.",
      });
      return { subject, html };
    },
  },

  // 17. PASSWORD_RESET
  PASSWORD_RESET: {
    category: "Account & Security",
    name: "Password Reset",
    description: "Sent when the user requests a password recovery link.",
    sampleData: {
      userName: "Alex Johnson",
      resetUrl: "https://app.trustiq.in/reset-password?token=98234-fedcba",
      expiresIn: "60 minutes",
    },
    render: (data = {}) => {
      const {
        userName = "User",
        resetUrl = "https://app.trustiq.in/reset-password",
        expiresIn = "60 minutes",
      } = data;

      const subject = "Reset your TrustIQ ERP Password";
      const html = renderBaseEmailLayout({
        preheader: "Reset password instructions for your TrustIQ account.",
        badgeText: "Password Request",
        theme: "primary",
        heading: "Reset Your Password",
        subheading: "Follow the link below to choose a new password.",
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>We received a request to reset the password for your TrustIQ ERP account. Click the button below to choose a new secure password. This link is valid for <strong>${escapeHtml(expiresIn)}</strong>.</p>
        `,
        ctaText: "Reset My Password",
        ctaUrl: resetUrl,
        secondaryNote: "If you did not request a password reset, please ignore this email or contact support if you suspect unauthorized activity.",
      });
      return { subject, html };
    },
  },

  // 18. PASSWORD_CHANGED
  PASSWORD_CHANGED: {
    category: "Account & Security",
    name: "Password Changed",
    description: "Sent immediately after a password has been updated.",
    sampleData: {
      userName: "Alex Johnson",
      changedAt: "22 Nov 2026, 12:45 PM IST",
      device: "Desktop Browser",
      supportUrl: "https://app.trustiq.in/support",
    },
    render: (data = {}) => {
      const {
        userName = "User",
        changedAt = new Date().toLocaleString(),
        device = "Web Application",
        supportUrl = "https://app.trustiq.in/support",
      } = data;

      const subject = "Your TrustIQ password has been changed";
      const html = renderBaseEmailLayout({
        preheader: "Your account password was updated successfully.",
        badgeText: "Security Update",
        theme: "success",
        heading: "Password Changed Successfully",
        subheading: "Your TrustIQ account password was updated recently.",
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>This email confirms that the password for your TrustIQ ERP account was successfully changed.</p>
        `,
        metadataRows: [
          ["Action", "Password Updated"],
          ["Timestamp", changedAt],
          ["Channel", device],
        ],
        ctaText: "Contact Support if Unrecognized",
        ctaUrl: supportUrl,
        secondaryNote: "If you did not make this change, please contact our emergency security desk immediately.",
      });
      return { subject, html };
    },
  },

  // 19. ACCOUNT_ACTIVATED
  ACCOUNT_ACTIVATED: {
    category: "Account & Security",
    name: "Account Activated",
    description: "Sent when an administrator approves or activates an account.",
    sampleData: {
      userName: "Alex Johnson",
      activatedBy: "Super Administrator",
      companyName: "Acme Logistics",
      loginUrl: "https://app.trustiq.in/login",
    },
    render: (data = {}) => {
      const {
        userName = "User",
        activatedBy = "Administrator",
        companyName = "Your Business",
        loginUrl = "https://app.trustiq.in/login",
      } = data;

      const subject = "Your TrustIQ Account Has Been Activated!";
      const html = renderBaseEmailLayout({
        preheader: "Your account has been verified and activated by your administrator.",
        badgeText: "Active",
        theme: "success",
        heading: "Account Activated",
        subheading: "Your access permissions have been enabled.",
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>Great news! Your TrustIQ ERP account for <strong>${escapeHtml(companyName)}</strong> has been activated by <strong>${escapeHtml(activatedBy)}</strong>.</p>
          <p>You can now sign in and access all assigned modules, ledgers, and transactions.</p>
        `,
        metadataRows: [
          ["Organization", companyName],
          ["Approved By", activatedBy],
          ["Account Status", "Active"],
        ],
        ctaText: "Sign In to Your Workspace",
        ctaUrl: loginUrl,
      });
      return { subject, html };
    },
  },

  // 20. ACCOUNT_SUSPENDED
  ACCOUNT_SUSPENDED: {
    category: "Account & Security",
    name: "Account Suspended",
    description: "Sent when an administrator or policy suspends access.",
    sampleData: {
      userName: "Alex Johnson",
      companyName: "Acme Logistics",
      reason: "Billing overdue or administrative compliance review",
      supportEmail: "compliance@trustiq.in",
    },
    render: (data = {}) => {
      const {
        userName = "User",
        companyName = "Your Business",
        reason = "Administrative policy / terms compliance",
        supportEmail = "support@trustiq.in",
      } = data;

      const subject = "Important Notice: Your TrustIQ Account Has Been Suspended";
      const html = renderBaseEmailLayout({
        preheader: "Your TrustIQ account has been suspended. Review details inside.",
        badgeText: "Suspended",
        theme: "danger",
        heading: "Account Suspended",
        subheading: "Access to this workspace has been temporarily paused.",
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>This message is to inform you that your user access for <strong>${escapeHtml(companyName)}</strong> has been temporarily suspended.</p>
          <p>During suspension, you cannot log in or record new financial vouchers. To resolve this suspension, please reach out to your organization administrator or our compliance desk.</p>
        `,
        metadataRows: [
          ["Organization", companyName],
          ["Reason", reason],
          ["Contact Support", supportEmail],
        ],
        ctaText: "Contact Support Team",
        ctaUrl: `mailto:${escapeHtml(supportEmail)}`,
      });
      return { subject, html };
    },
  },

  // 21. ACCOUNT_DELETED
  ACCOUNT_DELETED: {
    category: "Account & Security",
    name: "Account Deleted",
    description: "Sent when an account removal or closure request is completed.",
    sampleData: {
      userName: "Alex Johnson",
      companyName: "Acme Logistics",
      deletedOn: "22 Nov 2026",
    },
    render: (data = {}) => {
      const {
        userName = "User",
        companyName = "Your Business",
        deletedOn = new Date().toLocaleDateString(),
      } = data;

      const subject = "Account Closure Confirmation - TrustIQ ERP";
      const html = renderBaseEmailLayout({
        preheader: "Your TrustIQ account closure confirmation.",
        badgeText: "Account Closed",
        theme: "danger",
        heading: "Account Successfully Closed",
        subheading: "Your profile has been removed in accordance with your request.",
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>We are confirming that your TrustIQ ERP profile for <strong>${escapeHtml(companyName)}</strong> has been deleted as requested on <strong>${escapeHtml(deletedOn)}</strong>.</p>
          <p>We are sorry to see you go. If you ever require business accounting or GST management in the future, we would be delighted to welcome you back.</p>
        `,
        metadataRows: [
          ["Organization", companyName],
          ["Closure Date", deletedOn],
          ["Data Scrubbing", "Completed as per policy"],
        ],
      });
      return { subject, html };
    },
  },

  // 22. EMAIL_CHANGED
  EMAIL_CHANGED: {
    category: "Account & Security",
    name: "Email Changed",
    description: "Sent to the old (and new) address when registered email is changed.",
    sampleData: {
      userName: "Alex Johnson",
      oldEmail: "alex.old@acme.com",
      newEmail: "alex.new@acme.com",
      updatedAt: "22 Nov 2026, 12:45 PM IST",
      supportUrl: "https://app.trustiq.in/support",
    },
    render: (data = {}) => {
      const {
        userName = "User",
        oldEmail = "old@email.com",
        newEmail = "new@email.com",
        updatedAt = new Date().toLocaleString(),
        supportUrl = "https://app.trustiq.in/support",
      } = data;

      const subject = "Security Notification: Your TrustIQ account email was changed";
      const html = renderBaseEmailLayout({
        preheader: `Your account email address was changed to ${newEmail}.`,
        badgeText: "Email Updated",
        theme: "warning",
        heading: "Account Email Address Changed",
        subheading: "Your primary notification email was updated recently.",
        greeting: `Hello ${userName},`,
        bodyHtml: `
          <p>This is a security alert to confirm that the primary email address for your TrustIQ ERP account was updated.</p>
          <p>All future verification codes, password resets, and subscription tax receipts will be sent to your new address.</p>
        `,
        metadataRows: [
          ["Previous Email", oldEmail],
          ["New Email Address", newEmail],
          ["Update Timestamp", updatedAt],
        ],
        ctaText: "Revert or Report Unauthorized Change",
        ctaUrl: supportUrl,
      });
      return { subject, html };
    },
  },
};

module.exports = {
  renderBaseEmailLayout,
  TEMPLATES,
};
