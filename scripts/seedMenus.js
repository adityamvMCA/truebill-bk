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
  SALES: ["admin", "manager", "sales"],
  PURCHASE: ["admin", "manager", "purchase"],
  INVENTORY: ["admin", "manager", "inventory"],
  PURCHASE_PARENT: [
    "admin",
    "manager",
    "purchase",
    "inventory",
  ],
  PURCHASE_RECEIVING: [
    "admin",
    "manager",
    "purchase",
    "inventory",
  ],
  ALL: [
    "admin",
    "manager",
    "sales",
    "purchase",
    "inventory",
    "viewer",
  ],
};

const normalize = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const child = (
  id,
  label,
  icon,
  path,
  feature,
  roles,
) => ({
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
        "sales",
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
        "sales",
        ROLES.SALES,
      ),

      child(
        "customer-receipts",
        "Customer Receipts",
        "Receipt",
        "/sales/customer-receipts",
        "sales",
        ["admin", "sales"],
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
        "purchase",
        ROLES.PURCHASE_RECEIVING,
      ),

      child(
        "purchase-invoices",
        "Purchase Bills",
        "ReceiptText",
        "/purchase/invoices",
        "purchase",
        ROLES.PURCHASE,
      ),

      child(
        "purchase-returns",
        "Purchase Returns",
        "Undo2",
        "/purchase/returns",
        "purchase",
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
        "inventory",
        ROLES.INVENTORY,
      ),

      child(
        "inventory-stock",
        "Stock",
        "Warehouse",
        "/inventory/stock",
        "inventory.stock",
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
        "inventory-warehouses",
        "Warehouses",
        "Building2",
        "/inventory/warehouses",
        "inventory.warehouses",
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
        "customers-groups",
        "Customer Groups",
        "Tags",
        "/customers/groups",
        "sales.customers",
        ROLES.SALES,
      ),

      child(
        "customers-outstanding",
        "Outstanding",
        "IndianRupee",
        "/customers/outstanding",
        "accounting.receivables",
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
        "suppliers-groups",
        "Supplier Groups",
        "Tags",
        "/suppliers/groups",
        "purchase.vendors",
        ROLES.PURCHASE,
      ),

      child(
        "suppliers-outstanding",
        "Outstanding",
        "IndianRupee",
        "/suppliers/outstanding",
        "accounting.payables",
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
    roles: ROLES.MANAGEMENT,
    order: 1,

    children: [
      child(
        "accounting-chart",
        "Chart of Accounts",
        "ListTree",
        "/accounting/chart-of-accounts",
        "accounting.chartOfAccounts",
        ROLES.MANAGEMENT,
      ),

      child(
        "accounting-journal",
        "Journal Vouchers",
        "BookOpen",
        "/accounting/journal",
        "accounting.journalEntries",
        ROLES.MANAGEMENT,
      ),

      child(
        "accounting-ledger",
        "Ledgers",
        "BookText",
        "/accounting/ledger",
        "accounting.ledgers",
        ROLES.MANAGEMENT,
      ),

      child(
        "accounting-daybook",
        "Day Book",
        "CalendarDays",
        "/accounting/daybook",
        "accounting.journalEntries",
        ROLES.MANAGEMENT,
      ),

      child(
        "accounting-trial-balance",
        "Trial Balance",
        "Scale",
        "/accounting/trial-balance",
        "accounting.trialBalance",
        ROLES.MANAGEMENT,
      ),

      child(
        "accounting-balance-sheet",
        "Balance Sheet",
        "FileText",
        "/accounting/balance-sheet",
        "accounting.reports",
        ROLES.MANAGEMENT,
      ),

      child(
        "accounting-customer-ledger",
        "Customer Ledger",
        "Users",
        "/accounting/customer-ledger",
        "accounting.ledgers",
        ROLES.MANAGEMENT,
      ),

      child(
        "accounting-supplier-ledger",
        "Supplier Ledger",
        "Truck",
        "/accounting/supplier-ledger",
        "accounting.ledgers",
        ROLES.MANAGEMENT,
      ),

      child(
        "accounting-receivables",
        "Receivables",
        "ArrowDownCircle",
        "/accounting/receivables",
        "accounting.receivables",
        ROLES.MANAGEMENT,
      ),

      child(
        "accounting-payables",
        "Payables",
        "ArrowUpCircle",
        "/accounting/payables",
        "accounting.payables",
        ROLES.MANAGEMENT,
      ),

      child(
        "accounting-bank-reconciliation",
        "Bank Reconciliation",
        "Landmark",
        "/accounting/bank-reconciliation",
        "bank.reconciliation",
        ROLES.MANAGEMENT,
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
    roles: ROLES.MANAGEMENT,
    order: 1,

    children: [
      child(
        "bank-accounts",
        "Bank Accounts",
        "Building2",
        "/accounting/banks",
        "bank.accounts",
        ROLES.MANAGEMENT,
      ),

      child(
        "bank-receipts",
        "Receipts",
        "ArrowDownCircle",
        "/payments/receipts",
        "bank.receipts",
        ROLES.MANAGEMENT,
      ),

      child(
        "bank-payments",
        "Payments",
        "ArrowUpCircle",
        "/payments/payments",
        "bank.payments",
        ROLES.MANAGEMENT,
      ),

      child(
        "bank-transfer",
        "Bank Transfer",
        "ArrowLeftRight",
        "/payments/bank-transfer",
        "bank.transfers",
        ROLES.MANAGEMENT,
      ),

      child(
        "bank-ledger",
        "Bank Ledger",
        "BookText",
        "/accounting/bank-ledger",
        "accounting.ledgers",
        ROLES.MANAGEMENT,
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
    roles: ROLES.MANAGEMENT,
    order: 1,

    children: [
      child(
        "expenses-list",
        "All Expenses",
        "ReceiptText",
        "/expenses/list",
        "expenses.list",
        ROLES.MANAGEMENT,
      ),

      child(
        "expenses-categories",
        "Expense Categories",
        "Tags",
        "/expenses/categories",
        "expenses.categories",
        ROLES.MANAGEMENT,
      ),

      child(
        "expenses-approval",
        "Expense Approval",
        "CheckCircle",
        "/expenses/approval",
        "expenses.approvals",
        ROLES.MANAGEMENT,
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
    roles: ROLES.MANAGEMENT,
    order: 1,

    children: [
      child(
        "gst-summary",
        "GST Summary",
        "ReceiptIndianRupee",
        "/gst-tax/summary",
        "gst.summary",
        ROLES.MANAGEMENT,
      ),

      child(
        "gst-reports",
        "GSTR Reports",
        "BarChart3",
        "/gst-tax/reports",
        "gst.gstrReports",
        ROLES.MANAGEMENT,
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
    group: "Production",
    groupOrder: 10,
    label: "Production",
    icon: "Factory",
    path: "/production",
    feature: "production",
    roles: ROLES.INVENTORY,
    order: 1,

    children: [
      child(
        "production-orders",
        "Production Orders",
        "ClipboardPen",
        "/production/orders",
        "production.orders",
        ROLES.INVENTORY,
      ),

      child(
        "production-bom",
        "Bill of Materials",
        "Layers3",
        "/production/bom",
        "production.bom",
        ROLES.INVENTORY,
      ),

      child(
        "production-work-orders",
        "Work Orders",
        "ClipboardList",
        "/production/work-orders",
        "production.workOrders",
        ROLES.INVENTORY,
      ),

      child(
        "production-reports",
        "Production Reports",
        "BarChart3",
        "/production/reports",
        "production.reports",
        ROLES.MANAGEMENT,
      ),
    ],
  },

  {
    group: "HR & Payroll",
    groupOrder: 11,
    label: "HR & Payroll",
    icon: "UsersRound",
    path: "/hr",
    feature: "hr",
    roles: ROLES.MANAGEMENT,
    order: 1,

    children: [
      child(
        "hr-employees",
        "Employees",
        "UserRound",
        "/hr/employees",
        "hr.employees",
        ROLES.MANAGEMENT,
      ),

      child(
        "hr-attendance",
        "Attendance",
        "CalendarDays",
        "/hr/attendance",
        "hr.attendance",
        ROLES.MANAGEMENT,
      ),

      child(
        "hr-leave",
        "Leave",
        "CalendarDays",
        "/hr/leave",
        "hr.leave",
        ROLES.MANAGEMENT,
      ),

      child(
        "hr-payroll",
        "Payroll",
        "CircleDollarSign",
        "/hr/payroll",
        "hr.payroll",
        ROLES.MANAGEMENT,
      ),
    ],
  },

  {
    group: "Assets",
    groupOrder: 12,
    label: "Assets",
    icon: "Box",
    path: "/assets",
    feature: "assets",
    roles: ROLES.MANAGEMENT,
    order: 1,

    children: [
      child(
        "assets-list",
        "All Assets",
        "Monitor",
        "/assets/list",
        "assets.list",
        ROLES.MANAGEMENT,
      ),

      child(
        "assets-categories",
        "Asset Categories",
        "Tags",
        "/assets/categories",
        "assets.categories",
        ROLES.MANAGEMENT,
      ),

      child(
        "assets-depreciation",
        "Depreciation",
        "Percent",
        "/assets/depreciation",
        "assets.depreciation",
        ROLES.MANAGEMENT,
      ),

      child(
        "assets-reports",
        "Asset Reports",
        "BarChart3",
        "/assets/reports",
        "assets.reports",
        ROLES.MANAGEMENT,
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
        "reports-inventory",
        "Inventory Reports",
        "Boxes",
        "/reports/inventory",
        "reports.inventory",
        ROLES.INVENTORY,
      ),

      child(
        "reports-accounting",
        "Accounting Reports",
        "PieChart",
        "/reports/accounting",
        "reports.accounting",
        ROLES.MANAGEMENT,
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
    ],
  },
];

const buildChild = (
  entry,
  index,
  parentRoles,
) => ({
  id: entry.id,
  label: entry.label,
  icon: entry.icon || null,
  path: entry.path || null,
  feature: entry.feature
    ? normalize(entry.feature)
    : null,

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
      throw new Error(
        `Duplicate parent menu: ${parentKey}`,
      );
    }

    parentKeys.add(parentKey);

    if (
      !menu.path?.startsWith("/") ||
      menu.path.includes(":")
    ) {
      throw new Error(
        `Invalid parent navigation path: ${menu.label}`,
      );
    }

    if (
      !Array.isArray(menu.roles) ||
      menu.roles.length === 0
    ) {
      throw new Error(
        `Missing roles for menu: ${menu.label}`,
      );
    }

    for (const entry of menu.children || []) {
      if (!entry.id || childIds.has(entry.id)) {
        throw new Error(
          `Missing or duplicate child ID: ${entry.id}`,
        );
      }

      childIds.add(entry.id);

      if (
        !entry.path?.startsWith("/") ||
        entry.path.includes(":")
      ) {
        throw new Error(
          `Invalid child navigation path: ${entry.label}`,
        );
      }

      for (const role of entry.roles || menu.roles) {
        if (!menu.roles.includes(role)) {
          throw new Error(
            `Child "${entry.label}" allows "${role}" but its parent "${menu.label}" does not`,
          );
        }
      }
    }
  }
};

const seedMenus = async () => {
  try {
    validateMenus();

    console.log("Connecting to MongoDB...");

    await mongoose.connect(MONGODB_URI);

    console.log(
      `Connected to database: ${mongoose.connection.name}`,
    );

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let childCount = 0;

    for (const menu of menus) {
      const children = (menu.children || []).map(
        (entry, index) =>
          buildChild(
            entry,
            index,
            menu.roles,
          ),
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

      if (result.upsertedCount > 0) {
        created += 1;
      } else if (result.modifiedCount > 0) {
        updated += 1;
      } else {
        unchanged += 1;
      }

      childCount += children.length;

      console.log(
        `${menu.group} → ${menu.label}: ${children.length} submenu(s)`,
      );
    }

    console.log("");
    console.log("Menu seeding completed");
    console.log(`Application: ${APP_CODE}`);
    console.log(`Created: ${created}`);
    console.log(`Updated: ${updated}`);
    console.log(`Unchanged: ${unchanged}`);
    console.log(`Parent menus: ${menus.length}`);
    console.log(`Child menus: ${childCount}`);
  } catch (error) {
    console.error(
      "Menu seeding failed:",
      error?.message || error,
    );

    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

seedMenus();