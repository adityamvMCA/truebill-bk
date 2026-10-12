require("dotenv").config();

const mongoose = require("mongoose");
const crypto = require("crypto");

 const Menu = require("../src/models/Menu");

const MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017/truebill";

const APP_CODE = "truebill";

const normalize = (value) =>
  String(value || "").trim().toLowerCase();

const generateDocumentNumber = () =>
  `MNU-${APP_CODE.toUpperCase()}-${Date.now()}-${crypto
    .randomBytes(3)
    .toString("hex")}`;

const buildChild = (child, index, parentRoles) => ({
  id: child.id,
  label: child.label,
  icon: child.icon || null,
  path: child.path || null,
  feature: child.feature ? normalize(child.feature) : null,
  roles: child.roles || parentRoles,
  order: child.order ?? index + 1,
  isActive: child.isActive !== false,
});

const menus = [
  {
    group: "Main",
    groupOrder: 1,
    label: "Dashboard",
    icon: "LayoutDashboard",
    path: "/dashboard",
    feature: "dashboard",
    roles: [
      "admin",
      "manager",
      "sales",
      "purchase",
      "inventory",
      "viewer",
    ],
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
    roles: ["admin", "manager", "sales"],
    order: 1,
    children: [
      {
        id: "sales-quotations",
        label: "Quotations",
        icon: "FileText",
        path: "/sales/quotations",
        feature: "sales.quotations",
        roles: ["admin", "manager", "sales"],
        order: 1,
      },
      {
        id: "sales-orders",
        label: "Sales Orders",
        icon: "ClipboardList",
        path: "/sales/orders",
        feature: "sales.orders",
        roles: ["admin", "manager", "sales"],
        order: 2,
      },
      {
        id: "sales-delivery",
        label: "Delivery Notes",
        icon: "Truck",
        path: "/sales/delivery",
        feature: "sales",
        roles: ["admin", "manager", "sales"],
        order: 3,
      },
      {
        id: "sales-invoices",
        label: "Sales Invoices",
        icon: "ReceiptText",
        path: "/sales/invoices",
        feature: "sales.invoices",
        roles: ["admin", "manager", "sales"],
        order: 4,
      },
      {
        id: "sales-returns",
        label: "Sales Returns",
        icon: "Undo2",
        path: "/sales/returns",
        feature: "sales",
        roles: ["admin", "manager", "sales"],
        order: 5,
      },
    ],
  },

  {
    group: "Purchase",
    groupOrder: 3,
    label: "Purchase",
    icon: "ShoppingBag",
    path: "/purchase",
    feature: "purchase",
    roles: ["admin", "manager", "purchase"],
    order: 1,
    children: [
      {
        id: "purchase-requisitions",
        label: "Purchase Requisitions",
        icon: "ClipboardPen",
        path: "/purchase/requisitions",
        feature: "purchase.requisitions",
        roles: ["admin", "manager", "purchase"],
        order: 1,
      },
      {
        id: "purchase-rfq",
        label: "RFQ",
        icon: "FileSearch",
        path: "/purchase/rfq",
        feature: "purchase.rfq",
        roles: ["admin", "manager", "purchase"],
        order: 2,
      },
      {
        id: "purchase-quotations",
        label: "Supplier Quotations",
        icon: "FileText",
        path: "/purchase/quotations",
        feature: "purchase.quotations",
        roles: ["admin", "manager", "purchase"],
        order: 3,
      },
      {
        id: "purchase-quotation-comparison",
        label: "Quotation Comparison",
        icon: "Scale",
        path: "/purchase/quotation-comparison",
        feature: "purchase.quotations",
        roles: ["admin", "manager", "purchase"],
        order: 4,
      },
      {
        id: "purchase-orders",
        label: "Purchase Orders",
        icon: "ClipboardList",
        path: "/purchase/orders",
        feature: "purchase.orders",
        roles: ["admin", "manager", "purchase"],
        order: 5,
      },
      {
        id: "purchase-grn",
        label: "Goods Receipt",
        icon: "PackageCheck",
        path: "/purchase/grn",
        feature: "purchase",
        roles: ["admin", "manager", "purchase", "inventory"],
        order: 6,
      },
      {
        id: "purchase-invoices",
        label: "Purchase Bills",
        icon: "ReceiptText",
        path: "/purchase/invoices",
        feature: "purchase",
        roles: ["admin", "manager", "purchase"],
        order: 7,
      },
      {
        id: "purchase-returns",
        label: "Purchase Returns",
        icon: "Undo2",
        path: "/purchase/returns",
        feature: "purchase",
        roles: ["admin", "manager", "purchase"],
        order: 8,
      },
    ],
  },

  {
    group: "Inventory",
    groupOrder: 4,
    label: "Inventory",
    icon: "Boxes",
    path: "/inventory",
    feature: "inventory",
    roles: ["admin", "manager", "inventory"],
    order: 1,
    children: [
      {
        id: "inventory-products",
        label: "Products",
        icon: "Package",
        path: "/inventory/products",
        feature: "inventory.products",
        roles: ["admin", "manager", "inventory"],
        order: 1,
      },
      {
        id: "inventory-categories",
        label: "Categories",
        icon: "Tags",
        path: "/inventory/categories",
        feature: "inventory.categories",
        roles: ["admin", "manager", "inventory"],
        order: 2,
      },
      {
        id: "inventory-units",
        label: "Units",
        icon: "Ruler",
        path: "/inventory/units",
        feature: "inventory",
        roles: ["admin", "manager", "inventory"],
        order: 3,
      },
      {
        id: "inventory-stock",
        label: "Stock",
        icon: "Warehouse",
        path: "/inventory/stock",
        feature: "inventory.stock",
        roles: ["admin", "manager", "inventory"],
        order: 4,
      },
      {
        id: "inventory-stock-movements",
        label: "Stock Movements",
        icon: "ArrowLeftRight",
        path: "/stock-movements",
        feature: "inventory.stock",
        roles: ["admin", "manager", "inventory"],
        order: 5,
      },
      {
        id: "inventory-warehouses",
        label: "Warehouses",
        icon: "Building2",
        path: "/inventory/warehouses",
        feature: "inventory.warehouses",
        roles: ["admin", "manager", "inventory"],
        order: 6,
      },
      {
        id: "inventory-transfer",
        label: "Stock Transfer",
        icon: "ArrowLeftRight",
        path: "/inventory/stock-transfer",
        feature: "inventory.transfers",
        roles: ["admin", "manager", "inventory"],
        order: 7,
      },
      {
        id: "inventory-adjustment",
        label: "Stock Adjustment",
        icon: "SlidersHorizontal",
        path: "/inventory/stock-adjustment",
        feature: "inventory.adjustments",
        roles: ["admin", "manager", "inventory"],
        order: 8,
      },
      {
        id: "inventory-valuation",
        label: "Stock Valuation",
        icon: "IndianRupee",
        path: "/inventory/stock-valuation",
        feature: "inventory.reports",
        roles: ["admin", "manager", "inventory"],
        order: 9,
      },
    ],
  },

  {
    group: "Parties",
    groupOrder: 5,
    label: "Customers",
    icon: "Users",
    path: "/customers",
    feature: "sales.customers",
    roles: ["admin", "manager", "sales"],
    order: 1,
    children: [
      {
        id: "customers-list",
        label: "All Customers",
        icon: "Users",
        path: "/customers/list",
        feature: "sales.customers",
        roles: ["admin", "manager", "sales"],
        order: 1,
      },
      {
        id: "customers-groups",
        label: "Customer Groups",
        icon: "Tags",
        path: "/customers/groups",
        feature: "sales.customers",
        roles: ["admin", "manager", "sales"],
        order: 2,
      },
      {
        id: "customers-outstanding",
        label: "Outstanding",
        icon: "IndianRupee",
        path: "/customers/outstanding",
        feature: "accounting.receivables",
        roles: ["admin", "manager"],
        order: 3,
      },
    ],
  },

  {
    group: "Parties",
    groupOrder: 5,
    label: "Suppliers",
    icon: "Truck",
    path: "/suppliers",
    feature: "purchase.vendors",
    roles: ["admin", "manager", "purchase"],
    order: 2,
    children: [
      {
        id: "suppliers-list",
        label: "All Suppliers",
        icon: "Truck",
        path: "/suppliers/list",
        feature: "purchase.vendors",
        roles: ["admin", "manager", "purchase"],
        order: 1,
      },
      {
        id: "suppliers-groups",
        label: "Supplier Groups",
        icon: "Tags",
        path: "/suppliers/groups",
        feature: "purchase.vendors",
        roles: ["admin", "manager", "purchase"],
        order: 2,
      },
      {
        id: "suppliers-outstanding",
        label: "Outstanding",
        icon: "IndianRupee",
        path: "/suppliers/outstanding",
        feature: "accounting.payables",
        roles: ["admin", "manager"],
        order: 3,
      },
    ],
  },

  {
    group: "Accounting",
    groupOrder: 6,
    label: "Accounting",
    icon: "BookOpen",
    path: "/accounting",
    feature: "accounting",
    roles: ["admin", "manager"],
    order: 1,
    children: [
      {
        id: "accounting-chart",
        label: "Chart of Accounts",
        icon: "ListTree",
        path: "/accounting/chart-of-accounts",
        feature: "accounting.chartOfAccounts",
        roles: ["admin", "manager"],
        order: 1,
      },
      {
        id: "accounting-journal",
        label: "Journal Vouchers",
        icon: "BookOpen",
        path: "/accounting/journal",
        feature: "accounting.journalEntries",
        roles: ["admin", "manager"],
        order: 2,
      },
      {
        id: "accounting-ledger",
        label: "Ledgers",
        icon: "BookText",
        path: "/accounting/ledger",
        feature: "accounting.ledgers",
        roles: ["admin", "manager"],
        order: 3,
      },
      {
        id: "accounting-receivables",
        label: "Receivables",
        icon: "ArrowDownCircle",
        path: "/accounting/receivables",
        feature: "accounting.receivables",
        roles: ["admin", "manager"],
        order: 4,
      },
      {
        id: "accounting-payables",
        label: "Payables",
        icon: "ArrowUpCircle",
        path: "/accounting/payables",
        feature: "accounting.payables",
        roles: ["admin", "manager"],
        order: 5,
      },
      {
        id: "accounting-bank-reconciliation",
        label: "Bank Reconciliation",
        icon: "Landmark",
        path: "/accounting/bank-reconciliation",
        feature: "bank.reconciliation",
        roles: ["admin", "manager"],
        order: 6,
      },
    ],
  },

  {
    group: "Bank & Payments",
    groupOrder: 7,
    label: "Bank & Payments",
    icon: "Landmark",
    path: "/payments",
    feature: "bank",
    roles: ["admin", "manager"],
    order: 1,
    children: [
      {
        id: "bank-accounts",
        label: "Bank Accounts",
        icon: "Building2",
        path: "/payments/bank-accounts",
        feature: "bank.accounts",
        roles: ["admin", "manager"],
        order: 1,
      },
      {
        id: "bank-receipts",
        label: "Receipts",
        icon: "ArrowDownCircle",
        path: "/payments/receipts",
        feature: "bank.receipts",
        roles: ["admin", "manager"],
        order: 2,
      },
      {
        id: "bank-payments",
        label: "Payments",
        icon: "ArrowUpCircle",
        path: "/payments/payments",
        feature: "bank.payments",
        roles: ["admin", "manager"],
        order: 3,
      },
      {
        id: "bank-transfer",
        label: "Bank Transfer",
        icon: "ArrowLeftRight",
        path: "/payments/bank-transfer",
        feature: "bank.transfers",
        roles: ["admin", "manager"],
        order: 4,
      },
    ],
  },

  {
    group: "Expenses",
    groupOrder: 8,
    label: "Expenses",
    icon: "Wallet",
    path: "/expenses",
    feature: "expenses",
    roles: ["admin", "manager"],
    order: 1,
    children: [
      {
        id: "expenses-list",
        label: "All Expenses",
        icon: "ReceiptText",
        path: "/expenses/list",
        feature: "expenses.list",
        roles: ["admin", "manager"],
        order: 1,
      },
      {
        id: "expenses-categories",
        label: "Expense Categories",
        icon: "Tags",
        path: "/expenses/categories",
        feature: "expenses.categories",
        roles: ["admin", "manager"],
        order: 2,
      },
      {
        id: "expenses-approval",
        label: "Expense Approval",
        icon: "CheckCircle",
        path: "/expenses/approval",
        feature: "expenses.approvals",
        roles: ["admin", "manager"],
        order: 3,
      },
    ],
  },

  {
    group: "GST & Tax",
    groupOrder: 9,
    label: "GST & Tax",
    icon: "ReceiptIndianRupee",
    path: "/gst-tax",
    feature: "gst",
    roles: ["admin", "manager"],
    order: 1,
    children: [
      {
        id: "gst-summary",
        label: "GST Summary",
        icon: "ReceiptIndianRupee",
        path: "/gst-tax/summary",
        feature: "gst.summary",
        roles: ["admin", "manager"],
        order: 1,
      },
      {
        id: "gst-reports",
        label: "GSTR Reports",
        icon: "BarChart3",
        path: "/gst-tax/reports",
        feature: "gst.gstrReports",
        roles: ["admin", "manager"],
        order: 2,
      },
      {
        id: "gst-configuration",
        label: "Tax Configuration",
        icon: "Settings2",
        path: "/gst-tax/configuration",
        feature: "gst.taxConfiguration",
        roles: ["admin"],
        order: 3,
      },
    ],
  },

  {
    group: "Production",
    groupOrder: 10,
    label: "Production",
    icon: "Factory",
    path: "/production",
    feature: "production",
    roles: ["admin", "manager", "inventory"],
    order: 1,
    children: [
      {
        id: "production-orders",
        label: "Production Orders",
        icon: "ClipboardPen",
        path: "/production/orders",
        feature: "production.orders",
        roles: ["admin", "manager", "inventory"],
        order: 1,
      },
      {
        id: "production-bom",
        label: "Bill of Materials",
        icon: "Layers3",
        path: "/production/bom",
        feature: "production.bom",
        roles: ["admin", "manager", "inventory"],
        order: 2,
      },
      {
        id: "production-work-orders",
        label: "Work Orders",
        icon: "ClipboardList",
        path: "/production/work-orders",
        feature: "production.workOrders",
        roles: ["admin", "manager", "inventory"],
        order: 3,
      },
      {
        id: "production-reports",
        label: "Production Reports",
        icon: "BarChart3",
        path: "/production/reports",
        feature: "production.reports",
        roles: ["admin", "manager"],
        order: 4,
      },
    ],
  },

  {
    group: "HR & Payroll",
    groupOrder: 11,
    label: "HR & Payroll",
    icon: "UsersRound",
    path: "/hr",
    feature: "hr",
    roles: ["admin", "manager"],
    order: 1,
    children: [
      {
        id: "hr-employees",
        label: "Employees",
        icon: "UserRound",
        path: "/hr/employees",
        feature: "hr.employees",
        roles: ["admin", "manager"],
        order: 1,
      },
      {
        id: "hr-attendance",
        label: "Attendance",
        icon: "CalendarDays",
        path: "/hr/attendance",
        feature: "hr.attendance",
        roles: ["admin", "manager"],
        order: 2,
      },
      {
        id: "hr-leave",
        label: "Leave",
        icon: "CalendarDays",
        path: "/hr/leave",
        feature: "hr.leave",
        roles: ["admin", "manager"],
        order: 3,
      },
      {
        id: "hr-payroll",
        label: "Payroll",
        icon: "CircleDollarSign",
        path: "/hr/payroll",
        feature: "hr.payroll",
        roles: ["admin", "manager"],
        order: 4,
      },
    ],
  },

  {
    group: "Assets",
    groupOrder: 12,
    label: "Assets",
    icon: "Box",
    path: "/assets",
    feature: "assets",
    roles: ["admin", "manager"],
    order: 1,
    children: [
      {
        id: "assets-list",
        label: "All Assets",
        icon: "Monitor",
        path: "/assets/list",
        feature: "assets.list",
        roles: ["admin", "manager"],
        order: 1,
      },
      {
        id: "assets-categories",
        label: "Asset Categories",
        icon: "Tags",
        path: "/assets/categories",
        feature: "assets.categories",
        roles: ["admin", "manager"],
        order: 2,
      },
      {
        id: "assets-depreciation",
        label: "Depreciation",
        icon: "Percent",
        path: "/assets/depreciation",
        feature: "assets.depreciation",
        roles: ["admin", "manager"],
        order: 3,
      },
      {
        id: "assets-reports",
        label: "Asset Reports",
        icon: "BarChart3",
        path: "/assets/reports",
        feature: "assets.reports",
        roles: ["admin", "manager"],
        order: 4,
      },
    ],
  },

  {
    group: "Reports",
    groupOrder: 13,
    label: "Reports",
    icon: "BarChart3",
    path: "/reports",
    feature: "reports",
    roles: [
      "admin",
      "manager",
      "sales",
      "purchase",
      "inventory",
      "viewer",
    ],
    order: 1,
    children: [
      {
        id: "reports-sales",
        label: "Sales Reports",
        icon: "ChartIcon",
        path: "/reports/sales",
        feature: "reports.sales",
        roles: ["admin", "manager", "sales"],
        order: 1,
      },
      {
        id: "reports-purchase",
        label: "Purchase Reports",
        icon: "ChartIcon",
        path: "/reports/purchase",
        feature: "reports.purchase",
        roles: ["admin", "manager", "purchase"],
        order: 2,
      },
      {
        id: "reports-inventory",
        label: "Inventory Reports",
        icon: "BarChart3",
        path: "/reports/inventory",
        feature: "reports.inventory",
        roles: ["admin", "manager", "inventory"],
        order: 3,
      },
      {
        id: "reports-accounting",
        label: "Accounting Reports",
        icon: "PieChart",
        path: "/reports/accounting",
        feature: "reports.accounting",
        roles: ["admin", "manager"],
        order: 4,
      },
    ],
  },

  {
    group: "Settings",
    groupOrder: 14,
    label: "Settings",
    icon: "Settings",
    path: "/settings",
    feature: "settings",
    roles: ["admin"],
    order: 1,
    children: [
      {
        id: "settings-company",
        label: "Company Settings",
        icon: "Building2",
        path: "/settings/company",
        feature: "settings.company",
        roles: ["admin"],
        order: 1,
      },
      {
        id: "settings-users",
        label: "Users",
        icon: "Users",
        path: "/settings/users",
        feature: "settings.users",
        roles: ["admin"],
        order: 2,
      },
      {
        id: "settings-roles",
        label: "Roles & Permissions",
        icon: "UsersRound",
        path: "/settings/roles",
        feature: "settings.roles",
        roles: ["admin"],
        order: 3,
      },
      {
        id: "settings-appearance",
        label: "Appearance",
        icon: "Settings2",
        path: "/settings/appearance",
        feature: "settings.appearance",
        roles: ["admin"],
        order: 4,
      },
      {
        id: "settings-notifications",
        label: "Notifications",
        icon: "Bell",
        path: "/settings/notifications",
        feature: "settings.notifications",
        roles: ["admin"],
        order: 5,
      },
    ],
  },
];

const seedMenus = async () => {
  try {
    console.log("Connecting to MongoDB...");

    await mongoose.connect(MONGODB_URI);

    console.log("Connected to MongoDB");

    let created = 0;
    let updated = 0;

    for (const menu of menus) {
      const children = (menu.children || []).map((child, index) =>
        buildChild(child, index, menu.roles),
      );

      const filter = {
        appCode: APP_CODE,
        group: menu.group,
        label: menu.label,
      };

      const update = {
        $set: {
          appCode: APP_CODE,
          group: menu.group,
          groupOrder: menu.groupOrder,
          label: menu.label,
          icon: menu.icon,
          path: menu.path,
          feature: normalize(menu.feature),
          roles: menu.roles,
          order: menu.order,
          children,
          isActive: true,
        },
      };

      const result = await Menu.findOneAndUpdate(filter, update, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      });

      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        created += 1;
      } else {
        updated += 1;
      }

      console.log(
        `✔ ${menu.group} → ${menu.label} (${children.length} submenus)`,
      );
    }

    console.log("\nMenu seeding completed");
    console.log(`Created: ${created}`);
    console.log(`Updated: ${updated}`);
    console.log(`Total parent menus: ${menus.length}`);

    await mongoose.connection.close();

    process.exit(0);
  } catch (error) {
    console.error("Menu seeding failed:", error);

    await mongoose.connection.close();

    process.exit(1);
  }
};

seedMenus();