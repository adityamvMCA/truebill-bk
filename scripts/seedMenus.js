require("dotenv").config();

const mongoose = require("mongoose");
const Menu = require("../src/models/Menu");

const MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017/truebill";

const APP_CODE = "truebill";

const ROLES = {
  ADMIN: ["admin"],
  MANAGEMENT: ["admin", "manager"],
  ACCOUNTING: ["admin", "manager", "accountant"],
  SALES: ["admin", "manager", "sales"],
  PURCHASE: ["admin", "manager", "purchase"],
  INVENTORY: ["admin", "manager", "inventory"],
  PURCHASE_PARENT: ["admin", "manager", "purchase", "inventory"],
  ALL: ["admin", "manager", "sales", "purchase", "inventory", "viewer"],
};

const normalize = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const child = (id, label, icon, path, feature, roles) => ({
  id,
  label,
  icon,
  path,
  feature,
  roles,
});

const menus = [
  {
    group: "Main",
    groupOrder: 1,
    label: "Dashboard",
    icon: "LayoutDashboard",
    path: "/dashboard",
    feature: "dashboard",
    roles: ROLES.ALL,
    order: 1,
    children: [],
  },

  {
    group: "Sales",
    groupOrder: 2,
    label: "Sales",
    icon: "ShoppingCart",
    path: "/sales",
    feature: "sales",
    roles: ROLES.SALES,
    order: 1,
    children: [
      child(
        "sales-quotations",
        "Quotations",
        "FileText",
        "/sales/quotations",
        "sales.quotations",
        ROLES.SALES,
      ),
      child(
        "sales-orders",
        "Sales Orders",
        "ClipboardList",
        "/sales/orders",
        "sales.orders",
        ROLES.SALES,
      ),
      child(
        "sales-delivery",
        "Delivery Notes",
        "Truck",
        "/sales/delivery",
        "sales.delivery",
        ROLES.SALES,
      ),
      child(
        "sales-invoices",
        "Sales Invoices",
        "ReceiptText",
        "/sales/invoices",
        "sales.invoices",
        ROLES.SALES,
      ),
      child(
        "sales-returns",
        "Sales Returns",
        "Undo2",
        "/sales/returns",
        "salesReturn.view",
        ROLES.SALES,
      ),
      child(
        "customer-receipts",
        "Customer Receipts",
        "Receipt",
        "/sales/customer-receipts",
        "sales.customerReceipts",
        ROLES.SALES,
      ),
    ],
  },

  {
    group: "Purchase",
    groupOrder: 3,
    label: "Purchase",
    icon: "ShoppingBag",
    path: "/purchase",
    feature: "purchase",
    roles: ROLES.PURCHASE_PARENT,
    order: 1,
    children: [
      child(
        "purchase-requisitions",
        "Purchase Requisitions",
        "ClipboardPen",
        "/purchase/requisitions",
        "purchase.requisitions",
        ROLES.PURCHASE,
      ),
      child(
        "purchase-rfq",
        "RFQ",
        "FileSearch",
        "/purchase/rfq",
        "purchase.rfq",
        ROLES.PURCHASE,
      ),
      child(
        "purchase-quotations",
        "Supplier Quotations",
        "FileText",
        "/purchase/supplier-quotations",
        "purchase.quotations",
        ROLES.PURCHASE,
      ),
      child(
        "purchase-quotation-comparison",
        "Quotation Comparison",
        "Scale",
        "/purchase/quotation-comparison",
        "purchase.quotations",
        ROLES.PURCHASE,
      ),
      child(
        "purchase-orders",
        "Purchase Orders",
        "ClipboardList",
        "/purchase/orders",
        "purchase.orders",
        ROLES.PURCHASE,
      ),
      child(
        "purchase-grn",
        "Goods Receipt",
        "PackageCheck",
        "/purchase/grn",
        "goodsReceipt.view",
        ROLES.PURCHASE_RECEIVING,
      ),
      child(
        "purchase-invoices",
        "Purchase Bills",
        "ReceiptText",
        "/purchase/invoices",
        "purchase.invoices",
        ROLES.PURCHASE,
      ),
      child(
        "purchase-returns",
        "Purchase Returns",
        "Undo2",
        "/purchase/returns",
        "purchaseReturn.view",
        ROLES.PURCHASE,
      ),
      child(
        "supplier-payments",
        "Supplier Payments",
        "Wallet",
        "/purchase/supplier-payments",
        "purchase.supplierPayments",
        ROLES.PURCHASE,
      ),
    ],
  },

  {
    group: "Inventory",
    groupOrder: 4,
    label: "Inventory",
    icon: "Boxes",
    path: "/inventory",
    feature: "inventory",
    roles: ROLES.INVENTORY,
    order: 1,
    children: [
      child(
        "inventory-products",
        "Products",
        "Package",
        "/inventory/products",
        "inventory.products",
        ROLES.INVENTORY,
      ),
      child(
        "inventory-categories",
        "Categories",
        "Tags",
        "/inventory/categories",
        "inventory.categories",
        ROLES.INVENTORY,
      ),
      child(
        "inventory-units",
        "Units",
        "Ruler",
        "/inventory/units",
        "inventory.units",
        ROLES.INVENTORY,
      ),
      child(
        "inventory-brands",
        "Brands",
        "Tag",
        "/brand-list",
        "inventory.brands",
        ROLES.INVENTORY,
      ),
      child(
        "inventory-hsn",
        "HSN / SAC Codes",
        "Hash",
        "/hsn-sac-codes",
        "inventory.hsn",
        ROLES.INVENTORY,
      ),
      child(
        "inventory-tax-rates",
        "Tax Rates",
        "Percent",
        "/tax-rates",
        "inventory.taxRates",
        ROLES.INVENTORY,
      ),
      child(
        "inventory-warehouses",
        "Warehouses",
        "Building2",
        "/inventory/warehouses",
        "inventory.warehouses",
        ROLES.INVENTORY,
      ),
      child(
        "inventory-stock-movements",
        "Stock Movements",
        "ArrowLeftRight",
        "/stock-movements",
        "inventory.stock",
        ROLES.INVENTORY,
      ),
      child(
        "inventory-transfer",
        "Stock Transfer",
        "ArrowLeftRight",
        "/inventory/stock-transfer",
        "inventory.transfers",
        ROLES.INVENTORY,
      ),
      child(
        "inventory-adjustment",
        "Stock Adjustment",
        "SlidersHorizontal",
        "/inventory/stock-adjustment",
        "inventory.adjustments",
        ROLES.INVENTORY,
      ),
      child(
        "inventory-valuation",
        "Stock Valuation",
        "IndianRupee",
        "/inventory/stock-valuation",
        "inventory.reports",
        ROLES.INVENTORY,
      ),
    ],
  },

  {
    group: "Parties",
    groupOrder: 5,
    label: "Customers",
    icon: "Users",
    path: "/customers",
    feature: "sales.customers",
    roles: ROLES.SALES,
    order: 1,
    children: [
      child(
        "customers-list",
        "All Customers",
        "Users",
        "/customers/list",
        "sales.customers",
        ROLES.SALES,
      ),
      child(
        "customers-outstanding",
        "Outstanding",
        "IndianRupee",
        "/customers/outstanding",
        "customerOutstanding.view",
        ROLES.MANAGEMENT,
      ),
    ],
  },

  {
    group: "Parties",
    groupOrder: 5,
    label: "Suppliers",
    icon: "Truck",
    path: "/suppliers",
    feature: "purchase.vendors",
    roles: ROLES.PURCHASE,
    order: 2,
    children: [
      child(
        "suppliers-list",
        "All Suppliers",
        "Truck",
        "/suppliers/list",
        "purchase.vendors",
        ROLES.PURCHASE,
      ),
      child(
        "suppliers-outstanding",
        "Outstanding",
        "IndianRupee",
        "/suppliers/outstanding",
        "supplierOutstanding.view",
        ROLES.MANAGEMENT,
      ),
    ],
  },

  {
    group: "Accounting",
    groupOrder: 6,
    label: "Accounting",
    icon: "BookOpen",
    path: "/accounting",
    feature: "accounting",
    roles: ROLES.ACCOUNTING,
    order: 1,
    children: [
      child(
        "accounting-journal",
        "Journal Vouchers",
        "BookOpen",
        "/accounting/journal",
        "accounting.journalEntries",
        ROLES.ACCOUNTING,
      ),
      child(
        "accounting-ledger",
        "Ledgers",
        "BookText",
        "/accounting/ledger",
        "accounting.ledgers",
        ROLES.ACCOUNTING,
      ),
      child(
        "accounting-daybook",
        "Day Book",
        "CalendarDays",
        "/accounting/daybook",
        "accounting.journalEntries",
        ROLES.ACCOUNTING,
      ),
      child(
        "accounting-trial-balance",
        "Trial Balance",
        "Scale",
        "/accounting/trial-balance",
        "accounting.trialBalance",
        ROLES.ACCOUNTING,
      ),
      child(
        "accounting-balance-sheet",
        "Balance Sheet",
        "FileText",
        "/accounting/balance-sheet",
        "accounting.reports",
        ROLES.ACCOUNTING,
      ),
      child(
        "accounting-customer-ledger",
        "Customer Ledger",
        "Users",
        "/accounting/customer-ledger",
        "accounting.ledgers",
        ROLES.ACCOUNTING,
      ),
      child(
        "accounting-supplier-ledger",
        "Supplier Ledger",
        "Truck",
        "/accounting/supplier-ledger",
        "accounting.ledgers",
        ROLES.ACCOUNTING,
      ),
      child(
        "accounting-receivables",
        "Receivables",
        "ArrowDownCircle",
        "/accounting/receivables",
        "accounting.receivables",
        ROLES.ACCOUNTING,
      ),
      child(
        "accounting-payables",
        "Payables",
        "ArrowUpCircle",
        "/accounting/payables",
        "accounting.payables",
        ROLES.ACCOUNTING,
      ),
      child(
        "accounting-cash-book",
        "Cash Book",
        "Wallet",
        "/accounting/cash-book",
        "accounting.cashBook",
        ROLES.ACCOUNTING,
      ),
      child(
        "accounting-petty-cash",
        "Petty Cash",
        "Coins",
        "/accounting/petty-cash",
        "accounting.pettyCash",
        ROLES.ACCOUNTING,
      ),
      child(
        "accounting-notes",
        "Notes",
        "StickyNote",
        "/accounting/notes",
        "accounting.notes",
        ROLES.ACCOUNTING,
      ),
      child(
        "accounting-tds-register",
        "TDS Register",
        "FileCheck",
        "/accounting/tds",
        "accounting.tds",
        ROLES.ACCOUNTING,
      ),
      child(
        "accounting-tds-deduct",
        "TDS Deduct",
        "Scissors",
        "/accounting/tds/deduct",
        "accounting.tds",
        ROLES.ACCOUNTING,
      ),
      child(
        "accounting-tds-natures",
        "TDS Natures",
        "ListTree",
        "/accounting/tds/natures",
        "accounting.tds",
        ROLES.ACCOUNTING,
      ),
    ],
  },

  {
    group: "Bank & Payments",
    groupOrder: 7,
    label: "Bank & Payments",
    icon: "Landmark",
    path: "/payments",
    feature: "bank",
    roles: ROLES.ACCOUNTING,
    order: 1,
    children: [
      child(
        "bank-accounts",
        "Bank Accounts",
        "Building2",
        "/accounting/banks",
        "bank.accounts",
        ROLES.ACCOUNTING,
      ),
      child(
        "bank-reconciliation",
        "Bank Reconciliation",
        "Landmark",
        "/accounting/bank-reconciliation",
        "bank.reconciliation",
        ROLES.ACCOUNTING,
      ),
      child(
        "bank-ledger",
        "Bank Ledger",
        "BookText",
        "/accounting/bank-ledger",
        "bank.ledger",
        ROLES.ACCOUNTING,
      ),
    ],
  },

  {
    group: "Expenses",
    groupOrder: 8,
    label: "Expenses",
    icon: "Wallet",
    path: "/expenses",
    feature: "expenses",
    roles: ROLES.ACCOUNTING,
    order: 1,
    children: [
      child(
        "expenses-list",
        "All Expenses",
        "ReceiptText",
        "/expenses/list",
        "expenses.list",
        ROLES.ACCOUNTING,
      ),
    ],
  },

  {
    group: "GST & Tax",
    groupOrder: 9,
    label: "GST & Tax",
    icon: "ReceiptIndianRupee",
    path: "/gst-tax",
    feature: "gst",
    roles: ROLES.ACCOUNTING,
    order: 1,
    children: [
      child(
        "gst-summary",
        "GST Summary",
        "ReceiptIndianRupee",
        "/gst-tax/summary",
        "gst.summary",
        ROLES.ACCOUNTING,
      ),
      child(
        "gst-reports",
        "GSTR Reports",
        "BarChart3",
        "/gst-tax/reports",
        "gst.gstrReports",
        ROLES.ACCOUNTING,
      ),
      child(
        "gst-configuration",
        "Tax Configuration",
        "Settings2",
        "/gst-tax/configuration",
        "gst.taxConfiguration",
        ROLES.ADMIN,
      ),
    ],
  },

  {
    group: "Reports",
    groupOrder: 13,
    label: "Reports",
    icon: "BarChart3",
    path: "/reports",
    feature: "reports",
    roles: ROLES.ALL,
    order: 1,
    children: [
      child(
        "reports-sales",
        "Sales Reports",
        "BarChart3",
        "/reports/sales",
        "reports.sales",
        ROLES.SALES,
      ),
      child(
        "reports-purchase",
        "Purchase Reports",
        "ShoppingBag",
        "/reports/purchase",
        "reports.purchase",
        ROLES.PURCHASE,
      ),
      child(
        "reports-outstanding",
        "Outstanding Reports",
        "IndianRupee",
        "/reports/outstanding",
        "reports.accounting",
        ROLES.MANAGEMENT,
      ),
    ],
  },

  {
    group: "Settings",
    groupOrder: 14,
    label: "Settings",
    icon: "Settings",
    path: "/settings",
    feature: "settings",
    roles: ROLES.ADMIN,
    order: 1,
    children: [
      child(
        "settings-company",
        "Company Settings",
        "Building2",
        "/settings/company",
        "settings.company",
        ROLES.ADMIN,
      ),
      child(
        "settings-users",
        "Users",
        "Users",
        "/settings/users",
        "settings.users",
        ROLES.ADMIN,
      ),
      child(
        "settings-roles",
        "Roles & Permissions",
        "UsersRound",
        "/settings/roles",
        "settings.roles",
        ROLES.ADMIN,
      ),
      child(
        "settings-appearance",
        "Appearance",
        "Settings2",
        "/settings/appearance",
        "settings.appearance",
        ROLES.ADMIN,
      ),
      child(
        "settings-notifications",
        "Notifications",
        "Bell",
        "/settings/notifications",
        "settings.notifications",
        ROLES.ADMIN,
      ),
      child(
        "settings-tally",
        "Tally Gateway",
        "Plug",
        "/tally",
        "settings.appearance",
        ROLES.ADMIN,
      ),
    ],
  },
];

const buildChild = (entry, index, parentRoles) => ({
  id: entry.id,
  label: entry.label,
  icon: entry.icon || null,
  path: entry.path || null,
  feature: entry.feature ? normalize(entry.feature) : null,
  roles: [...(entry.roles || parentRoles)],
  order: entry.order ?? index + 1,
  isActive: entry.isActive !== false,
});

const validateMenus = () => {
  const parentKeys = new Set();
  const childIds = new Set();

  for (const menu of menus) {
    const parentKey = `${menu.group}:${menu.label}`;

    if (parentKeys.has(parentKey)) {
      throw new Error(`Duplicate parent menu: ${parentKey}`);
    }
    parentKeys.add(parentKey);

    if (!menu.path?.startsWith("/") || menu.path.includes(":")) {
      throw new Error(`Invalid parent navigation path: ${menu.label}`);
    }

    if (!Array.isArray(menu.roles) || menu.roles.length === 0) {
      throw new Error(`Missing roles for menu: ${menu.label}`);
    }

    for (const entry of menu.children || []) {
      if (!entry.id || childIds.has(entry.id)) {
        throw new Error(`Missing or duplicate child ID: ${entry.id}`);
      }
      childIds.add(entry.id);

      if (!entry.path?.startsWith("/") || entry.path.includes(":")) {
        throw new Error(`Invalid child navigation path: ${entry.label}`);
      }

      for (const role of entry.roles || menu.roles) {
        if (!menu.roles.includes(role)) {
          throw new Error(
            `Child "${entry.label}" allows "${role}" but parent "${menu.label}" does not`,
          );
        }
      }
    }
  }
};

const seedMenus = async () => {
  try {
    validateMenus();

    await mongoose.connect(MONGODB_URI);

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let childCount = 0;

    for (const menu of menus) {
      const children = (menu.children || []).map((entry, index) =>
        buildChild(entry, index, menu.roles),
      );

      const filter = {
        appCode: APP_CODE,
        group: menu.group,
        label: menu.label,
      };

      const result = await Menu.updateOne(
        filter,
        {
          $set: {
            appCode: APP_CODE,
            group: menu.group,
            groupOrder: menu.groupOrder,
            label: menu.label,
            icon: menu.icon,
            path: menu.path,
            feature: normalize(menu.feature),
            roles: [...menu.roles],
            order: menu.order,
            children,
            isActive: true,
          },
        },
        {
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        },
      );

      if (result.upsertedCount > 0) created += 1;
      else if (result.modifiedCount > 0) updated += 1;
      else unchanged += 1;

      childCount += children.length;
    }

    console.log("Menu seeding completed");
    console.log(`Created: ${created}`);
    console.log(`Updated: ${updated}`);
    console.log(`Unchanged: ${unchanged}`);
    console.log(`Parent menus: ${menus.length}`);
    console.log(`Child menus: ${childCount}`);
  } catch (error) {
    console.error("Menu seeding failed:", error?.message || error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

seedMenus();
