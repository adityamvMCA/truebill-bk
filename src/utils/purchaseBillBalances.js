const createError = (message) => {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
};

const safePaise = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createError(`${label} must be non-negative safe integer paise`);
  }

  return value;
};

const derivePurchaseBillBalances = ({
  totalAmountPaise,
  paidAmountPaise,
  returnedAmountPaise = 0,
}) => {
  safePaise(totalAmountPaise, "Bill total");
  safePaise(paidAmountPaise, "Paid amount");
  safePaise(returnedAmountPaise, "Returned amount");

  if (returnedAmountPaise > totalAmountPaise) {
    throw createError("Returned amount cannot exceed the original bill total");
  }

  const net =
    BigInt(totalAmountPaise) -
    BigInt(paidAmountPaise) -
    BigInt(returnedAmountPaise);

  const outstandingAmountPaise = net > 0n ? Number(net) : 0;

  const supplierCreditAmountPaise = net < 0n ? Number(-net) : 0;

  safePaise(outstandingAmountPaise, "Outstanding amount");
  safePaise(supplierCreditAmountPaise, "Supplier credit");

  const paymentStatus =
    outstandingAmountPaise === 0
      ? returnedAmountPaise > 0
        ? "SETTLED"
        : "PAID"
      : paidAmountPaise > 0
        ? "PARTIALLY_PAID"
        : "UNPAID";

  return {
    outstandingAmountPaise,
    supplierCreditAmountPaise,
    paymentStatus,
  };
};

const assertPurchaseBillBalances = (bill) => {
  const derived = derivePurchaseBillBalances({
    totalAmountPaise: bill.totalAmountPaise,
    paidAmountPaise: bill.paidAmountPaise,
    returnedAmountPaise: bill.returnedAmountPaise ?? 0,
  });

  if (
    bill.outstandingAmountPaise !== derived.outstandingAmountPaise ||
    (bill.supplierCreditAmountPaise ?? 0) !== derived.supplierCreditAmountPaise
  ) {
    throw createError(
      `Bill ${bill.billNumber} has inconsistent payment/return balances`,
    );
  }

  return derived;
};

module.exports = {
  derivePurchaseBillBalances,
  assertPurchaseBillBalances,
};
