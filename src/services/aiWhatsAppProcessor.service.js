const {
  getCustomerOutstanding,
  getSupplierOutstanding,
  getLowStockItems,
  getProductStock,
  calculateCashflow,
} = require("./aiErpTools.service");
const { identifyTenantByPhone, authenticate, logout } = require("./whatsappAuth.service");
const { callGraph, normalizePhone } = require("./whatsapp.service");

// LLM settings from environment or fallback to FreeLLMAPI
const LLM_BASE_URL = process.env.LLM_BASE_URL || "https://llm.trustiqtech.com/v1";
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "auto";

/**
 * Sends a WhatsApp text message directly via Meta Graph API
 */
async function sendWhatsAppDirect(recipientPhone, text) {
  if (!recipientPhone || !text) return;
  try {
    const to = normalizePhone(recipientPhone);
    const phoneId = process.env.PHONE_NUMBER_ID;
    if (!phoneId) {
      console.warn("sendWhatsAppDirect: No PHONE_NUMBER_ID configured in .env");
      return;
    }

    const res = await callGraph(`${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: text },
      }),
    });
    console.log(`[WhatsApp Bot] Sent to ${to}:`, res?.messages?.[0]?.id || "ok");
    return res;
  } catch (err) {
    console.error(`[WhatsApp Bot] Send error to ${recipientPhone}:`, err.message, err.meta || "");
  }
}

/**
 * Main AI ERP Message Processor
 */
async function handleIncomingWhatsAppMessage({ phone, message, tenantId: overrideTenantId }) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  let replyText = "";

  console.log(`[WhatsApp Bot] Processing message from ${phone}: "${text}"`);

  // 1. Check if user is submitting LOGIN credentials manually
  const loginPrefixMatch = text.match(/^login[:\s]+(.+)/i);
  if (loginPrefixMatch) {
    const credsPart = loginPrefixMatch[1].trim();
    const parts = credsPart.split(/[\s\n]+/);
    const identifier = parts[0];
    const password = parts.slice(1).join(" ");

    const authResult = await authenticate(phone, identifier, password);
    replyText = authResult.message;
    if (phone) await sendWhatsAppDirect(phone, replyText);
    return { success: authResult.success, reply: replyText };
  }

  // 2. Check if user wants to LOG OUT
  if (lower === "logout" || lower === "log out") {
    replyText = await logout(phone);
    if (phone) await sendWhatsAppDirect(phone, replyText);
    return { success: true, reply: replyText };
  }

  // 3. AUTO-IDENTIFY TENANT BASED ON USER MOBILE NUMBER!
  const identity = await identifyTenantByPhone(phone);

  let tenantId = overrideTenantId || identity?.tenantId;
  let tenantName = identity?.tenantName || "TrueBill";
  let userName = identity?.userName || "";

  // 4. Intent Detection for Fast & Accurate DB Queries
  // (A) Low Stock / Inventory Alerts
  const isLowStock =
    lower.includes("low stock") ||
    lower.includes("stock alert") ||
    lower.includes("out of stock") ||
    lower.includes("reorder") ||
    lower.includes("items running low");

  // (B) Specific Product Stock Check
  const stockOfMatch = text.match(/(?:stock|quantity|qty|available)\s+(?:of|for)?\s+([a-zA-Z0-9\s]+)/i);

  // (C) Customer Outstanding
  const isCustomerOutstanding =
    lower.includes("customer outstanding") ||
    lower.includes("customer balance") ||
    lower.includes("who owes") ||
    lower.includes("pending payment from customer") ||
    lower.includes("receivable") ||
    lower.includes("outstanding amount for customer");

  const customerNameMatch = text.match(/(?:outstanding|balance|due)\s+(?:for|of|from)?\s+(?:customer\s+)?([a-zA-Z0-9\s]+)/i);

  // (D) Supplier Outstanding / Payables
  const isSupplierOutstanding =
    lower.includes("supplier outstanding") ||
    lower.includes("supplier balance") ||
    lower.includes("how much do we owe") ||
    lower.includes("payable") ||
    lower.includes("we owe to supplier");

  const supplierNameMatch = text.match(/(?:supplier\s+outstanding|owe to|pay to|supplier\s+due)\s+([a-zA-Z0-9\s]+)/i);

  // (E) Cashflow & Sales Queries
  const isCashflowQuery =
    lower.includes("cashflow") ||
    lower.includes("cash flow") ||
    (lower.includes("cash") && lower.includes("today")) ||
    (lower.includes("collection") && lower.includes("today")) ||
    lower.includes("sales today") ||
    lower.includes("today sales") ||
    lower.includes("daily summary") ||
    lower.includes("today summary");

  // If mobile is not linked and asking for private financial data
  if ((isLowStock || isCustomerOutstanding || isSupplierOutstanding || isCashflowQuery) && !tenantId) {
    replyText = [
      `👋 Hello!`,
      ``,
      `Your WhatsApp mobile number (*+${phone}*) is not yet linked to any TrueBill business account.`,
      ``,
      `To connect your account, please send:`,
      `*login: <username/email> <password>*`,
      ``,
      `_Example:_`,
      `login: admin@trustiq.com myPassword123`,
    ].join("\n");

    if (phone) await sendWhatsAppDirect(phone, replyText);
    return { success: false, authenticated: false, reply: replyText };
  }

  // ----------------------------------------------------
  // EXECUTE DIRECT DATABASE INTELLIGENCE
  // ----------------------------------------------------

  // 1. Low stock inquiry
  if (isLowStock && tenantId) {
    const stockData = await getLowStockItems({ tenantId });
    if (stockData.items.length === 0) {
      replyText = `🏢 *${tenantName}*\n✅ All products have healthy stock levels. No low stock alerts right now.`;
    } else {
      const list = stockData.items
        .map((i) => `• *${i.name}*: Current = *${i.stock} ${i.unit}* (Reorder Level: ${i.reorderLevel})`)
        .join("\n");
      replyText = `🏢 *${tenantName}*\n⚠️ *Low Stock Alert (${stockData.count} items):*\n\n${list}`;
    }
    if (phone) await sendWhatsAppDirect(phone, replyText);
    return { success: true, reply: replyText, data: stockData };
  }

  // 2. Specific product stock inquiry (e.g. "stock of Paracetamol" or "Paracetamol stock")
  if (stockOfMatch && !isLowStock && tenantId) {
    const prodName = stockOfMatch[1].trim();
    if (prodName.length >= 3 && !prodName.toLowerCase().includes("customer") && !prodName.toLowerCase().includes("cashflow")) {
      const prodResult = await getProductStock({ tenantId, productName: prodName });
      if (prodResult.found) {
        replyText = `🏢 *${tenantName}*\n${prodResult.summary}`;
        if (phone) await sendWhatsAppDirect(phone, replyText);
        return { success: true, reply: replyText, data: prodResult };
      }
    }
  }

  // 3. Customer Outstanding inquiry
  if ((isCustomerOutstanding || (customerNameMatch && !isSupplierOutstanding)) && tenantId) {
    const rawTargetName = customerNameMatch ? customerNameMatch[1].trim() : "";
    const cleanTargetName = rawTargetName.replace(/customer|any|today|total|amount|for|of/gi, "").trim();

    const customerData = await getCustomerOutstanding({
      tenantId,
      customerName: cleanTargetName.length >= 2 ? cleanTargetName : null,
    });

    if (cleanTargetName && customerData.found && customerData.customerName) {
      const invoiceDetails = customerData.unpaidInvoices
        .map((inv) => `   • Inv #${inv.invoiceNumber} (${inv.date}): ₹${inv.balanceRupees.toLocaleString("en-IN")}`)
        .join("\n");

      replyText = [
        `🏢 *${tenantName}*`,
        `👤 *Customer Outstanding: ${customerData.customerName}*`,
        ``,
        `💰 *Total Pending:* ₹${customerData.totalOutstanding.toLocaleString("en-IN")}`,
        `📄 *Unpaid Invoices:* ${customerData.unpaidInvoicesCount}`,
        invoiceDetails ? `\nRecent Invoices:\n${invoiceDetails}` : "",
      ].filter(Boolean).join("\n");
    } else {
      const topList = customerData.topCustomers
        .map((c) => `• *${c.customerName}*: ₹${c.amountRupees.toLocaleString("en-IN")} (${c.invoiceCount} invoices)`)
        .join("\n");

      replyText = [
        `🏢 *${tenantName}*`,
        `📊 *Customer Receivables Summary*`,
        ``,
        `💰 *Total Outstanding Receivables:* ₹${customerData.totalReceivable.toLocaleString("en-IN")}`,
        ``,
        `Top Outstanding Customers:`,
        topList || "• No pending customer receivables.",
      ].join("\n");
    }

    if (phone) await sendWhatsAppDirect(phone, replyText);
    return { success: true, reply: replyText, data: customerData };
  }

  // 4. Supplier Outstanding inquiry
  if ((isSupplierOutstanding || supplierNameMatch) && tenantId) {
    const rawSupplierName = supplierNameMatch ? supplierNameMatch[1].trim() : "";
    const cleanSupplierName = rawSupplierName.replace(/supplier|any|today|total|amount|for|of/gi, "").trim();

    const supplierData = await getSupplierOutstanding({
      tenantId,
      supplierName: cleanSupplierName.length >= 2 ? cleanSupplierName : null,
    });

    if (cleanSupplierName && supplierData.found && supplierData.supplierName) {
      replyText = [
        `🏢 *${tenantName}*`,
        `🏭 *Supplier Payable: ${supplierData.supplierName}*`,
        ``,
        `💰 *Total Amount We Owe:* ₹${supplierData.totalOutstanding.toLocaleString("en-IN")}`,
        `📄 *Unpaid Bills:* ${supplierData.unpaidBillsCount}`,
      ].join("\n");
    } else {
      const topList = supplierData.topSuppliers
        .map((s) => `• *${s.supplierName}*: ₹${s.amountRupees.toLocaleString("en-IN")} (${s.billCount} bills)`)
        .join("\n");

      replyText = [
        `🏢 *${tenantName}*`,
        `📊 *Supplier Payables Summary*`,
        ``,
        `💰 *Total Outstanding We Owe:* ₹${supplierData.totalPayable.toLocaleString("en-IN")}`,
        ``,
        `Top Suppliers to Pay:`,
        topList || "• No pending supplier payables.",
      ].join("\n");
    }

    if (phone) await sendWhatsAppDirect(phone, replyText);
    return { success: true, reply: replyText, data: supplierData };
  }

  // 5. Cashflow & Sales direct queries
  if (isCashflowQuery && tenantId) {
    const liveData = await calculateCashflow({ tenantId });
    replyText = `🏢 *${tenantName}*\n` + liveData.whatsappMessage;
    if (phone) await sendWhatsAppDirect(phone, replyText);
    return { success: true, reply: replyText, data: liveData };
  }

  // ----------------------------------------------------
  // 6. FOR ANY OTHER QUERY: USE SELF-DEPLOYED LLM
  // ----------------------------------------------------
  let businessSnapshot = "";
  if (tenantId) {
    try {
      const snap = await calculateCashflow({ tenantId });
      businessSnapshot = `Today's Business Snapshot for "${tenantName}":
- Inflow today: Rs. ${snap.inflow.total}
- Outflow today: Rs. ${snap.outflow.total}
- Net Cashflow: Rs. ${snap.netCashflow}
- Sales today: Rs. ${snap.sales.total} (${snap.sales.invoiceCount} invoices)`;
    } catch (e) {}
  }

  const systemPrompt = [
    `You are the official AI business assistant for TrustIQ / TrueBill on WhatsApp.`,
    userName ? `The user is "${userName}".` : "",
    tenantName ? `Their business/company name is "${tenantName}".` : "",
    businessSnapshot ? `\nLive Tenant Context:\n${businessSnapshot}` : "",
    `\nInstructions:`,
    `- Answer the user's question clearly, concisely, and professionally.`,
    `- Use WhatsApp markdown (bold *text*, bullet points, emojis).`,
    `- If the question relates to accounting, GST, business management, or TrueBill features, give helpful and accurate answers.`,
  ].filter(Boolean).join("\n");

  try {
    const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      replyText = "I received your message, but the AI gateway is temporarily busy. Please try again shortly.";
    } else {
      const data = await response.json();
      replyText =
        data.choices?.[0]?.message?.content ||
        "Received your message, but no response was generated.";
    }

    if (phone) await sendWhatsAppDirect(phone, replyText);
    return { success: true, reply: replyText };
  } catch (err) {
    console.error("[WhatsApp Bot] LLM error:", err.message);
    replyText = "Sorry, I encountered an issue processing your request.";
    if (phone) await sendWhatsAppDirect(phone, replyText);
    return { success: false, error: err.message };
  }
}

module.exports = {
  handleIncomingWhatsAppMessage,
  sendWhatsAppDirect,
};
