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
  whatsappTemplate: "invoice_pdf_notification",
  defaultVariableKeys: [
    "customerName",
    "invoiceNumber",
    "amount",
    "dueDate",
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
  variables: (doc, tenant) => ({
    customerName: doc.customerName,
    invoiceNumber: doc.invoiceNumber,
    amount: inr(doc.totalAmountPaise),
    outstanding: inr(doc.outstandingAmountPaise),
    dueDate: dateText(doc.dueDate),
    invoiceDate: dateText(doc.invoiceDate),
    companyName: tenant.companyName || tenant.name || "Our Company",
  }),
};
