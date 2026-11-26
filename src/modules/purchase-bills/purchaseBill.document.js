const httpError = (message, statusCode) =>
  Object.assign(new Error(message), { statusCode, retryable: false });

module.exports = {
  docType: "purchaseBill",
  printKind: "purchaseBill",
  messageKind: "purchaseBill",
  permission: "purchaseBill.view",
  whatsappTemplate: process.env.WHATSAPP_PURCHASE_BILL_TEMPLATE || "purchase_bill_truebill",
  defaultVariableKeys: [
    "customerName",   // {{1}} Supplier name mapped to customerName variable
    "invoiceNumber",  // {{2}} Bill number mapped to invoiceNumber variable
    "amountNumber",   // {{3}}
    "companyName",    // {{4}}
    "contact",        // {{5}}
  ],

  async load({ models, tenantId, ref }) {
    const billNumber = String(ref).trim();
    const query = {
      tenantId,
      $or: [
        { billNumber: billNumber },
        { billNumber: billNumber.toUpperCase() },
        { supplierInvoiceNumber: billNumber },
      ],
      isDeleted: { $ne: true },
    };

    const doc = await models.PurchaseBill.findOne(query).lean();
    if (!doc) throw httpError("Purchase bill not found", 404);
    return doc;
  },

  assertShareable(doc) {
    if (doc.status === "CANCELLED") {
      throw httpError("Cancelled purchase bills cannot be shared", 409);
    }
  },

  number: (doc) => doc.billNumber,
  filename: (doc) => `Bill-${doc.billNumber}.pdf`,
};
