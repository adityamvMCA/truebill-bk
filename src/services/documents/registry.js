const registry = {
  invoice: require("../../modules/sales-invoices/invoice.document"),
  // delivery: require("../../modules/delivery-note/deliveryNote.document"),
};

const getDocumentType = (docType) => {
  const def = registry[docType];
  if (!def) {
    throw Object.assign(new Error("Unknown document type"), { statusCode: 404 });
  }
  return def;
};

module.exports = { getDocumentType };