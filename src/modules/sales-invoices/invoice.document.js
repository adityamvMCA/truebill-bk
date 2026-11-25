const { createDocToken } = require("../../services/documents/documentToken");

const httpError = (message, statusCode) =>
  Object.assign(new Error(message), { statusCode, retryable: false });

const inr = (paise) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    (Number(paise) || 0) / 100,
  );

const dateText = (d) =>
  new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

module.exports = {
  docType: "invoice",
  printKind: "invoice", // key in MessagingSettings.printTemplates and the frontend template list
  messageKind: "invoice", // MessageLog.kind and the rate card key
  permission: "salesInvoice.view",
  whatsappTemplate: process.env.WHATSAPP_SALES_INVOICE_TEMPLATE || "sales_invoice_bill_truebill",
  defaultVariableKeys: [
    "customerName",   // {{1}}
    "invoiceNumber",  // {{2}}
    "amountNumber",   // {{3}}
    "companyName",    // {{4}}  ← business name, not the long viewDetails string
    "contact",        // {{5}}
  ],

  async load({ models, tenantId, ref }) {
    const doc = await models.SalesInvoice.findOne({
      tenantId,
      invoiceNumber: String(ref).trim().toUpperCase(),
      isDeleted: false,
    }).lean();
    if (!doc) throw httpError("Sales invoice not found", 404);
    return doc;
  },

  assertShareable(doc) {
    if (doc.status === "CANCELLED")
      throw httpError("Cancelled invoices cannot be shared", 409);
  },

  number: (doc) => doc.invoiceNumber,
  filename: (doc) => `Invoice-${doc.invoiceNumber}.pdf`,

  /* MessageLog.invoiceNumber holds the document number for every document type */
  logFields: (doc) => ({
    customerName: doc.customerName,
    customerCode: doc.customerCode,
    invoiceNumber: doc.invoiceNumber,
  }),

  async phone({ models, tenantId, doc }) {
    const customer = await models.Customer.findOne({
      _id: doc.customerId,
      tenantId,
    }).lean();
    // Rename to your Customer schema fields
    return (
      customer?.whatsappNumber ||
      customer?.mobile ||
      customer?.phone ||
      customer?.alternatePhone
    );
  },

  /* All values the approved template may use. variableKeys picks order. */
  variables: (doc, tenant) => {
    let viewUrl = "";
    try {
      const token = createDocToken({
        tenantId: doc.tenantId,
        docType: "invoice",
        ref: doc.invoiceNumber,
        ttlMinutes: 90 * 24 * 60,
      });
      const frontendBase = (process.env.FRONTEND_URL || "https://truebill.trustiqtech.com").replace(/\/$/, "");
      viewUrl = `${frontendBase}/print/invoice/${encodeURIComponent(token)}`;
    } catch (e) {
      console.warn("Could not generate doc viewUrl:", e.message);
    }

    const companyName = tenant?.businessName || tenant?.companyName || tenant?.name || "TrustIQ Tech";
    const companyPhone = tenant?.phone || tenant?.mobile || tenant?.businessPhone || process.env.BUSINESS_PHONE || "";
    const cleanAmount = String(Math.round((Number(doc.totalAmountPaise) || 0) / 100));

    return {
      customerName: doc.customerName,
      invoiceNumber: doc.invoiceNumber,
      amount: inr(doc.totalAmountPaise),
      amountNumber: cleanAmount,
      outstanding: inr(doc.outstandingAmountPaise),
      dueDate: dateText(doc.dueDate),
      invoiceDate: dateText(doc.invoiceDate),
      companyName,
      viewUrl,
      viewDetails: `${companyName} | View Online: ${viewUrl}`,
      contact: companyPhone,
    };
  },
};
