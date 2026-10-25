/**
 * One-off repair for purchase bills whose stored balances don't match
 * what assertPurchaseBillBalances() expects.
 *
 * Cause: tdsAmountPaise / tds were declared on itemSchema instead of
 * purchaseBillSchema, so Mongoose dropped them. Those bills were posted
 * with the FULL total credited to the supplier ledger and no TDS entry,
 * but outstandingAmountPaise was saved as (total - tds).
 *
 * This recomputes outstanding / supplier credit / payment status from the
 * values actually stored on the bill (total, tds if any, paid, returned).
 *
 * PLACE THIS FILE NEXT TO purchaseBill.service.js
 * (same folder, so the relative requires below resolve).
 *
 * Dry run by default. Pass apply: true to write changes.
 */
const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const {
  derivePurchaseBillBalances,
} = require("../../utils/purchaseBillBalances");

const buildReport = (bill) => {
  const tdsAmountPaise = bill.tdsAmountPaise ?? 0;

  const expected = derivePurchaseBillBalances({
    totalAmountPaise: bill.totalAmountPaise - tdsAmountPaise,
    paidAmountPaise: bill.paidAmountPaise,
    returnedAmountPaise: bill.returnedAmountPaise ?? 0,
  });

  const stored = {
    outstandingAmountPaise: bill.outstandingAmountPaise,
    supplierCreditAmountPaise: bill.supplierCreditAmountPaise ?? 0,
    paymentStatus: bill.paymentStatus,
  };

  const differs =
    stored.outstandingAmountPaise !== expected.outstandingAmountPaise ||
    stored.supplierCreditAmountPaise !== expected.supplierCreditAmountPaise ||
    stored.paymentStatus !== expected.paymentStatus;

  return {
    billNumber: bill.billNumber,
    totalAmountPaise: bill.totalAmountPaise,
    tdsAmountPaise,
    paidAmountPaise: bill.paidAmountPaise,
    returnedAmountPaise: bill.returnedAmountPaise ?? 0,
    stored,
    expected,
    differs,
    applied: false,
  };
};

const applyFix = async ({ bill, report, models, tenantId, userId, ipAddress }) => {
  const oldData = bill.toObject();

  bill.outstandingAmountPaise = report.expected.outstandingAmountPaise;
  bill.supplierCreditAmountPaise = report.expected.supplierCreditAmountPaise;
  bill.paymentStatus = report.expected.paymentStatus;

  if (userId) {
    bill.updatedBy = userId;
  }

  await bill.save();

  if (userId && models.AuditLog) {
    await models.AuditLog.create({
      tenantId,
      userId,
      action: "UPDATE",
      module: "PURCHASE_BILL",
      documentId: bill._id,
      oldData,
      newData: bill.toObject(),
      ipAddress,
    });
  }

  report.applied = true;
};

const repairBillBalances = async ({
  tenant,
  billNumber,
  apply = false,
  userId,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);
  const models = getTenantAccountingModels(connection);

  const bill = await models.PurchaseBill.findOne({
    tenantId: tenant._id,
    billNumber: String(billNumber).trim().toUpperCase(),
    isDeleted: false,
  });

  if (!bill) {
    throw new Error("Bill not found");
  }

  const report = buildReport(bill);

  if (apply && report.differs) {
    await applyFix({
      bill,
      report,
      models,
      tenantId: tenant._id,
      userId,
      ipAddress,
    });
  }

  return report;
};

// Scans every posted, non-deleted bill and reports (or fixes) mismatches.
const repairAllBillBalances = async ({
  tenant,
  apply = false,
  userId,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);
  const models = getTenantAccountingModels(connection);

  const bills = await models.PurchaseBill.find({
    tenantId: tenant._id,
    status: "POSTED",
    isDeleted: false,
  });

  const mismatched = [];
  const failed = [];

  for (const bill of bills) {
    try {
      const report = buildReport(bill);

      if (!report.differs) continue;

      if (apply) {
        await applyFix({
          bill,
          report,
          models,
          tenantId: tenant._id,
          userId,
          ipAddress,
        });
      }

      mismatched.push(report);
    } catch (error) {
      failed.push({ billNumber: bill.billNumber, error: error.message });
    }
  }

  return {
    scanned: bills.length,
    mismatchedCount: mismatched.length,
    mismatched,
    failed,
  };
};

module.exports = { repairBillBalances, repairAllBillBalances };