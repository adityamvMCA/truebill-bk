/**
 * Sales Order – WhatsApp document definition.
 *
 * Re-uses the same approved template as sales invoices:
 *   sales_invoice_bill_truebill
 *
 * Template body (reference from Meta):
 *   Hi {{1}},
 *   Details of your Sale Invoice from {{2}}:
 *   Invoice Amount: ₹{{3}}
 *   Thank you for doing business with us,
 *   {{4}}
 *   Contact: {{5}}
 *   Thank you.
 *
 * Variable mapping for Sales Orders:
 *   {{1}} customerName   – buyer's name
 *   {{2}} orderNumber    – e.g. SO001
 *   {{3}} amountNumber   – total order value (no ₹ symbol, template adds it)
 *   {{4}} companyName    – logged-in tenant's business name
 *   {{5}} contact        – logged-in tenant's registered phone number
 */

const { createDocToken } = require('../../services/documents/documentToken');

const httpError = (message, statusCode) =>
  Object.assign(new Error(message), { statusCode, retryable: false });

const inr = (paise) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
    (Number(paise) || 0) / 100,
  );

module.exports = {
  docType:            'salesOrder',
  printKind:          'salesOrder',
  messageKind:        'message',   // uses the "message" rate key in MessagingSettings
  permission:         'salesOrder.view',

  /* Re-use the same approved WhatsApp template as invoices */
  whatsappTemplate:   'sales_invoice_bill_truebill',

  /*
   * Variable keys must match the order of {{1}}, {{2}}, ... in the template.
   * They are looked up from the object returned by variables() below.
   */
  defaultVariableKeys: [
    'customerName',   // {{1}}
    'orderNumber',    // {{2}}  → shows as "Sale Invoice from SO001"
    'amountNumber',   // {{3}}
    'companyName',    // {{4}}
    'contact',        // {{5}}  ← tenant's phone number
  ],

  /* ------------------------------------------------------------------ */

  async load({ models, tenantId, ref }) {
    const doc = await models.SalesOrder.findOne({
      tenantId,
      orderNumber: String(ref).trim().toUpperCase(),
      isDeleted: false,
    }).lean();
    if (!doc) throw httpError('Sales order not found', 404);
    return doc;
  },

  assertShareable(doc) {
    if (doc.status === 'CANCELLED')
      throw httpError('Cancelled orders cannot be shared', 409);
  },

  number:   (doc) => doc.orderNumber,
  filename: (doc) => `SalesOrder-${doc.orderNumber}.pdf`,

  /* MessageLog fields – reuses invoiceNumber field as the document ref */
  logFields: (doc) => ({
    customerName:  doc.customerName,
    customerCode:  doc.customerCode,
    invoiceNumber: doc.orderNumber,
  }),

  /* Recipient phone: customer's WhatsApp / mobile number */
  async phone({ models, tenantId, doc }) {
    const customer = await models.Customer.findOne({
      _id: doc.customerId,
      tenantId,
    }).lean();
    return (
      customer?.whatsappNumber ||
      customer?.mobile ||
      customer?.phone ||
      customer?.alternatePhone
    );
  },

  /**
   * Builds the variable map for the template.
   * `tenant` is the full tenant document from req.tenant (set by tenantMiddleware).
   * Fields available: businessName, companyName, name, phone, mobile, email, ...
   */
  variables(doc, tenant) {
    /* ---- view link (optional – not in this template but kept for future) ---- */
    let viewUrl = '';
    try {
      const token = createDocToken({
        tenantId: doc.tenantId,
        docType:  'salesOrder',
        ref:      doc.orderNumber,
        ttlMinutes: 90 * 24 * 60,
      });
      const base = (process.env.FRONTEND_URL || 'https://truebill.trustiqtech.com').replace(/\/$/, '');
      viewUrl = `${base}/track/${token}`;
    } catch {
      /* non-fatal */
    }

    /* ---- tenant (business owner) details ---- */
    const companyName =
      tenant?.businessName ||
      tenant?.companyName  ||
      tenant?.name         ||
      'TrustIQ Tech';

    /*
     * Contact is the TENANT's registered phone number, not the customer's.
     * Falls back to env or a safe default so the template variable is never blank.
     */
    const contact =
      tenant?.phone        ||
      tenant?.mobile       ||
      tenant?.businessPhone||
      process.env.BUSINESS_PHONE ||
      '';

    /* ---- amount formatted without ₹ symbol (template adds it via {{3}}) ---- */
    const amountNumber = String(Math.round((Number(doc.totalAmountPaise) || 0) / 100));

    return {
      customerName:  doc.customerName || 'Customer',
      orderNumber:   doc.orderNumber  || '',
      amountNumber,
      companyName,
      contact,
      /* extras available but not used by defaultVariableKeys */
      amount:   inr(doc.totalAmountPaise),
      viewUrl,
      viewDetails: viewUrl,
    };
  },
};
