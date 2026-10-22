const {
  getReadyTenantConnection,
} = require("../../../tenancy/tenantConnectionManager");

const {
  getTenantAccountingModels,
} = require("../../../tenancy/tenantAccountingModels");

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeText = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");

const resolveContext = (tenant) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  if (!models.Product || models.Product.db !== connection) {
    throw createError("Invalid tenant Product model", 500);
  }

  return {
    models,
    tenantId: tenant._id,
  };
};

const getLowStockProducts = async ({
  tenant,
  search = "",
  category,
  brand,
  page = 1,
  limit = 20,
}) => {
  const { models, tenantId } = resolveContext(tenant);

  const { Product } = models;

  const currentPage = Math.max(Math.floor(Number(page) || 1), 1);

  const pageLimit = Math.min(Math.max(Math.floor(Number(limit) || 20), 1), 100);

  const skip = (currentPage - 1) * pageLimit;

  if (!Number.isSafeInteger(skip)) {
    throw createError("Pagination offset exceeds the supported range");
  }

  const filter = {
    tenantId,
    isDeleted: false,
    status: "ACTIVE",
    type: "GOODS",
    trackInventory: true,

    $expr: {
      $lte: ["$currentStock", "$reorderLevel"],
    },
  };

  if (category) {
    filter.category = normalizeText(category);
  }

  if (brand) {
    filter.brand = normalizeText(brand);
  }

  const searchText = normalizeText(search);

  if (searchText) {
    const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const regex = new RegExp(escaped, "i");

    filter.$or = [
      { name: regex },
      { productCode: regex },
      { category: regex },
      { brand: regex },
    ];
  }

  const [data, total] = await Promise.all([
    Product.find(filter)
      .sort({
        currentStock: 1,
        reorderLevel: -1,
        name: 1,
        _id: 1,
      })
      .skip(skip)
      .limit(pageLimit)
      .select(
        "productCode name category brand unit currentStock reorderLevel salePrice purchasePrice status",
      )
      .lean(),

    Product.countDocuments(filter),
  ]);

  const enrichedData = data.map((product) => {
    const currentStock = Number(product.currentStock) || 0;

    const reorderLevel = Number(product.reorderLevel) || 0;

    const shortageQuantity = Math.max(reorderLevel - currentStock, 0);

    let alertLevel = "LOW";

    if (currentStock <= 0) {
      alertLevel = "OUT_OF_STOCK";
    } else if (reorderLevel > 0 && currentStock <= reorderLevel * 0.5) {
      alertLevel = "CRITICAL";
    }

    return {
      ...product,
      shortageQuantity,
      alertLevel,
    };
  });

  return {
    data: enrichedData,

    summary: {
      totalLowStockItems: total,
    },

    pagination: {
      page: currentPage,
      limit: pageLimit,
      total,

      totalPages: Math.ceil(total / pageLimit),
    },
  };
};

const getStockSummary = async ({ tenant }) => {
  const { models, tenantId } = resolveContext(tenant);

  const { Product } = models;

  const [totalProducts, lowStock, outOfStock, criticalStock] =
    await Promise.all([
      Product.countDocuments({
        tenantId,
        isDeleted: false,
        status: "ACTIVE",
        type: "GOODS",
        trackInventory: true,
      }),

      Product.countDocuments({
        tenantId,
        isDeleted: false,
        status: "ACTIVE",
        type: "GOODS",
        trackInventory: true,

        $expr: {
          $lte: ["$currentStock", "$reorderLevel"],
        },
      }),

      Product.countDocuments({
        tenantId,
        isDeleted: false,
        status: "ACTIVE",
        type: "GOODS",
        trackInventory: true,
        currentStock: {
          $lte: 0,
        },
      }),

      Product.countDocuments({
        tenantId,
        isDeleted: false,
        status: "ACTIVE",
        type: "GOODS",
        trackInventory: true,

        $expr: {
          $and: [
            {
              $gt: ["$currentStock", 0],
            },
            {
              $lte: [
                "$currentStock",
                {
                  $multiply: ["$reorderLevel", 0.5],
                },
              ],
            },
          ],
        },
      }),
    ]);

  return {
    totalProducts,
    lowStock,
    outOfStock,
    criticalStock,
  };
};

module.exports = {
  getLowStockProducts,
  getStockSummary,
};
