const getItems = (i) => i.items || i.lineItems || i.products || i.lines || [];

const nameOf = (x) =>
  x.productName || x.name || x.description || "";

const qtyOf = (x) =>
  Number(x.quantity ?? x.qty ?? 0);

const rateOf = (x) =>
  Number(
    x.unitRatePaise ??
    x.ratePaise ??
    x.unitPricePaise ??
    x.pricePaise ??
    0
  );

const amtOf = (x) =>
  Number(
    x.totalAmountPaise ??
    x.amountPaise ??
    x.totalPaise ??
    x.lineTotalPaise ??
    x.grossAmountPaise ??
    qtyOf(x) * rateOf(x)
  );