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

const roundAmount = (value) => Math.round(Number(value) * 100) / 100;

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

const buildFilter = ({ tenantId, category, brand, search }) => {
  const filter = {
    tenantId,
    isDeleted: false,
    status: "ACTIVE",
    type: "GOODS",
    trackInventory: true,
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

  return filter;
};

const getStockValuation = async ({
  tenant,
  category,
  brand,
  search = "",
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

  const filter = buildFilter({
    tenantId,
    category,
    brand,
    search,
  });

  const [products, aggregate] = await Promise.all([
    Product.find(filter)
      .sort({
        category: 1,
        name: 1,
        _id: 1,
      })
      .skip(skip)
      .limit(pageLimit)
      .select(
        "productCode name category brand unit currentStock purchasePrice salePrice",
      )
      .lean(),

    Product.aggregate([
      {
        $match: filter,
      },
      {
        $addFields: {
          stockValue: {
            $round: [
              {
                $multiply: ["$currentStock", "$purchasePrice"],
              },
              2,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,

          totalProducts: {
            $sum: 1,
          },

          totalQuantity: {
            $sum: "$currentStock",
          },

          totalStockValue: {
            $sum: "$stockValue",
          },
        },
      },
    ]),
  ]);

  const summary = aggregate[0] ?? {
    totalProducts: 0,
    totalQuantity: 0,
    totalStockValue: 0,
  };

  const enrichedProducts = products.map((product) => {
    const currentStock = Number(product.currentStock) || 0;

    const purchasePrice = Number(product.purchasePrice) || 0;

    const stockValue = roundAmount(currentStock * purchasePrice);

    return {
      ...product,
      stockValue,
    };
  });

  return {
    data: enrichedProducts,

    summary: {
      totalProducts: summary.totalProducts,

      totalQuantity: roundAmount(summary.totalQuantity),

      totalStockValue: roundAmount(summary.totalStockValue),
    },

    pagination: {
      page: currentPage,
      limit: pageLimit,
      total: summary.totalProducts,

      totalPages: Math.ceil(summary.totalProducts / pageLimit),
    },
  };
};

const getCategoryValuation = async ({ tenant }) => {
  const { models, tenantId } = resolveContext(tenant);

  const { Product } = models;

  const results = await Product.aggregate([
    {
      $match: {
        tenantId,
        isDeleted: false,
        status: "ACTIVE",
        type: "GOODS",
        trackInventory: true,
      },
    },

    {
      $addFields: {
        stockValue: {
          $round: [
            {
              $multiply: ["$currentStock", "$purchasePrice"],
            },
            2,
          ],
        },
      },
    },

    {
      $group: {
        _id: "$category",

        productCount: {
          $sum: 1,
        },

        totalQuantity: {
          $sum: "$currentStock",
        },

        totalStockValue: {
          $sum: "$stockValue",
        },
      },
    },

    {
      $project: {
        _id: 0,
        category: "$_id",
        productCount: 1,
        totalQuantity: 1,
        totalStockValue: 1,
      },
    },

    {
      $sort: {
        totalStockValue: -1,
        category: 1,
      },
    },
  ]);

  return results.map((item) => ({
    category: item.category ?? "Uncategorized",
    productCount: item.productCount,
    totalQuantity: roundAmount(item.totalQuantity),
    totalStockValue: roundAmount(item.totalStockValue),
  }));
};

module.exports = {
  getStockValuation,
  getCategoryValuation,
};
