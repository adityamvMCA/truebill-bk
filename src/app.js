const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const authRoutes = require("./routes/authRoutes");
const tenantRoutes = require("./routes/tenantRoutes");
// const customerRoutes = require("./routes/customerRoutes");
const customerRoutes = require("./modules/customers/customer.routes");
const ledgerRoutes = require("./routes/ledgerRoutes");
const errorHandler = require("./middleware/errorHandler");
const appVersion = require("./config/appVersion");
const notificationRoutes = require("./routes/notificationRoutes");
const deviceTokenRoutes = require("./routes/deviceTokenRoutes");
const notificationPreferenceRoutes = require("./routes/notificationPreferenceRoutes");
const menuRoutes = require("./routes/menuRoutes");
const appUpdateRoutes = require("./routes/appUpdateRoutes");
const accountingRoutes = require("./modules/accounting/accounting.routes");
const productRoutes = require("./modules/products/product.routes");
const stockMovementRoutes = require("./modules/stock-movements/stockMovement.routes");
const supplierRoutes = require("./modules/suppliers/supplier.routes");
const ledgerGroupRoutes = require("./modules/accounting/ledger-groups/ledgerGroup.routes");
const purchaseBillRoutes = require("./modules/purchase-bills/purchaseBill.routes");
const supplierPaymentRoutes = require("./modules/supplier-payments/supplierPayment.routes");
const salesInvoiceRoutes = require("./modules/sales-invoices/salesInvoice.routes");
const customerReceiptRoutes = require("./modules/customer-receipts/customerReceipt.routes");
const bankRoutes = require("./modules/banks/bank.routes");
const outstandingRoutes = require("./modules/outstanding/outstanding.routes");
const salesQuotationRoutes = require("./modules/sales-quotations/salesQuotation.routes");
const salesOrderRoutes = require("./modules/sales-orders/salesOrder.routes");
const deliveryNoteRoutes = require("./modules/delivery-notes/deliveryNote.routes");
const salesReturnRoutes = require("./modules/sales-returns/salesReturn.routes");
const taxConfigurationRoutes = require("./modules/accounting/taxconfiguration/taxConfiguration.routes");
const gstSummaryRoutes = require("./modules/accounting/gstsummary/gstSummary.routes");
const gstrReportsRoutes = require("./modules/accounting/gstrReports/gstrReports.routes");
const bankReconciliationRoutes = require("./modules/accounting/bankreconciliation/bankReconciliation.routes");
const trialBalanceRoutes = require("./modules/accounting/journals/trialBalance/trialBalance.routes");
const outcustsupRoutes = require("./modules/accounting/oustanding/outstanding.routes");
const purchaseRequisitionRoutes = require("./modules/purchase-requisitions/purchaseRequisition.routes");
const purchaseRfqRoutes = require("./modules/purchase-rfqs/purchaseRfq.routes");
const supplierQuotationRoutes = require("./modules/supplier-quotations/supplierQuotation.routes");
const quotationComparisonRoutes = require("./modules/quotation-comparison/quotationComparison.routes");
const purchaseOrderRoutes = require("./modules/purchase-orders/purchaseOrder.routes");
const goodsReceiptRoutes = require("./modules/goods-receipts/goodsReceipt.routes");
const purchaseReturnRoutes = require("./modules/purchase-returns/purchaseReturn.routes");
const productCategoryRoutes = require("./modules/Inventory/product-categories/productCategory.routes");
const productUnitRoutes = require("./modules/Inventory/product-units/productUnit.routes");
const productBrandRoutes = require("./modules/Inventory/product-brands/productBrand.routes");
const taxRateRoutes = require("./modules/tax-rates/taxRate.routes");
const stockAdjustmentRoutes = require("./modules/Inventory/stock-adjustments/stockAdjustment.routes");
const stockAlertRoutes = require("./modules/Inventory/stock-alerts/stockAlert.routes");
const stockValuationRoutes = require("./modules/Inventory/stock-valuation/stockValuation.routes");
const warehouseRoutes = require("./modules/Inventory/warehouses/warehouse.routes");
const warehouseStockRoutes = require("./modules/Inventory/warehouse-stock/warehouseStock.routes");
const stockTransferRoutes = require("./modules/Inventory/stock-transfers/stockTransfer.routes");
const expenseRoutes = require("./modules/accounting/expenses/expense.routes");
const app = express();
const hsnSacCodeRoutes = require("./modules/Inventory/hsn-sac-codes/hsnSacCode.routes");

app.set("trust proxy", 1);

app.use(helmet());

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((x) => x.trim())
  : [];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }

      if (
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin) ||
        origin === "capacitor://localhost" ||
        origin === "http://localhost" ||
        origin === "https://localhost"
      ) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "2mb" }));

app.use(
  express.urlencoded({
    extended: true,
    limit: "2mb",
  }),
);

if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);

app.get("/api/health", (req, res) =>
  res.json({
    success: true,
    message: "TrustIQ ERP API is running",
    time: new Date().toISOString(),
  }),
);

app.get("/api/app-version", (req, res) => {
  res.json({
    success: true,
    data: appVersion.android,
  });
});

app.use("/api/auth", authRoutes);

app.use("/api/tenants", tenantRoutes);

app.use("/api/customers", customerRoutes);
app.use("/api/device-tokens", deviceTokenRoutes);
app.use("/api/ledgers", ledgerRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/notification-preferences", notificationPreferenceRoutes);
app.use("/api/menus", menuRoutes);
app.use("/api/app-update", appUpdateRoutes);
app.use("/api/accounting", accountingRoutes);
app.use("/api/products", productRoutes);
app.use("/api/stock-movements", stockMovementRoutes);
app.use("/api/products", productRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/purchase-bills", purchaseBillRoutes);
// app.use("/api/accounting/ledger-groups", ledgerGroupRoutes);
app.use("/api/accounting/ledger-groups", ledgerGroupRoutes);
app.use("/api/supplier-payments", supplierPaymentRoutes);
app.use("/api/sales-invoices", salesInvoiceRoutes);
app.use("/api/customer-receipts", customerReceiptRoutes);
app.use("/api/customer-receipts", customerReceiptRoutes);
app.use("/api/banks", bankRoutes);
app.use("/api/outstanding", outstandingRoutes);
app.use("/api/sales-quotations", salesQuotationRoutes);
app.use("/api/sales-orders", salesOrderRoutes);
app.use("/api/delivery-notes", deliveryNoteRoutes);
app.use("/api/sales-returns", salesReturnRoutes);
app.use("/api/tax-configuration", taxConfigurationRoutes);
app.use("/api/gst-summary", gstSummaryRoutes);
app.use("/api/gstr-reports", gstrReportsRoutes);
app.use("/api/bank-reconciliation", bankReconciliationRoutes);
app.use("/api/accounting/reports", trialBalanceRoutes);
app.use("/api/accounting/outstanding", outcustsupRoutes);
app.use("/api/purchase-requisitions", purchaseRequisitionRoutes);
app.use("/api/purchase-rfqs", purchaseRfqRoutes);
app.use("/api/supplier-quotations", supplierQuotationRoutes);
app.use("/api/quotation-comparison", quotationComparisonRoutes);
app.use("/api/purchase-orders", purchaseOrderRoutes);
app.use("/api/goods-receipts", goodsReceiptRoutes);
app.use("/api/purchase-returns", purchaseReturnRoutes);
app.use("/api/product-categories", productCategoryRoutes);
app.use("/api/product-units", productUnitRoutes);
app.use("/api/product-brands", productBrandRoutes);
app.use("/api/hsn-sac-codes", hsnSacCodeRoutes);
app.use("/api/tax-rates", taxRateRoutes);
app.use("/api/stock-adjustments", stockAdjustmentRoutes);
app.use("/api/stock-alerts", stockAlertRoutes);
app.use("/api/stock-valuation", stockValuationRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/warehouse-stock", warehouseStockRoutes);
app.use("/api/stock-transfers", stockTransferRoutes);
app.use("/api/expenses", expenseRoutes);
app.use(express.json({ limit: "5mb" }));
app.use((req, res) =>
  res.status(404).json({
    success: false,
    message: "API route not found",
  }),
);

app.use(errorHandler);

module.exports = app;
