// const mongoose = require("mongoose");

// const SalesInvoice = require("../sales-invoices/salesInvoice.model");
// const PurchaseBill = require("../purchase-bills/purchaseBill.model");

// const REPORT_TIMEZONE = "Asia/Kolkata";

// const CONFIG = {
//   customer: {
//     model: SalesInvoice,
//     partyId: "customerId",
//     partyCode: "customerCode",
//     partyName: "customerName",
//     documentNumber: "invoiceNumber",
//     documentDate: "invoiceDate",
//   },

//   supplier: {
//     model: PurchaseBill,
//     partyId: "supplierId",
//     partyCode: "supplierCode",
//     partyName: "supplierName",
//     documentNumber: "billNumber",
//     documentDate: "billDate",
//   },
// };

// const createError = (message, statusCode = 400) => {
//   const error = new Error(message);
//   error.statusCode = statusCode;
//   return error;
// };

// const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// const emptyTotals = () => ({
//   documentCount: 0,
//   partyCount: 0,
//   outstandingAmountPaise: 0,
//   overdueAmountPaise: 0,
//   notDueAmountPaise: 0,
// });

// const getOutstanding = async ({
//   tenantId,
//   kind,
//   view = "party",
//   partyId,
//   search = "",
//   overdueOnly = false,
//   page = 1,
//   limit = 20,
// }) => {
//   const config = CONFIG[kind];

//   if (!config) {
//     throw createError("Invalid outstanding report type");
//   }

//   if (!mongoose.isObjectIdOrHexString(tenantId)) {
//     throw createError("Invalid tenantId");
//   }

//   if (partyId && !mongoose.isObjectIdOrHexString(partyId)) {
//     throw createError("Invalid partyId");
//   }

//   // Mongoose aggregation requires explicit ObjectId conversion.
//   const match = {
//     tenantId: new mongoose.Types.ObjectId(String(tenantId)),
//     status: "POSTED",
//     isDeleted: false,
//     outstandingAmountPaise: { $gt: 0 },
//   };

//   if (partyId) {
//     match[config.partyId] = new mongoose.Types.ObjectId(String(partyId));
//   }

//   const searchText = String(search).trim();

//   if (searchText) {
//     const regex = {
//       $regex: escapeRegex(searchText),
//       $options: "i",
//     };

//     match.$or = [
//       { [config.partyCode]: regex },
//       { [config.partyName]: regex },
//       { [config.documentNumber]: regex },
//     ];
//   }

//   const currentPage = Math.max(1, Math.floor(Number(page) || 1));

//   const pageLimit = Math.min(100, Math.max(1, Math.floor(Number(limit) || 20)));

//   // Capture once so every document uses the same report time.
//   const generatedAt = new Date();

//   const pipeline = [
//     { $match: match },

//     {
//       $project: {
//         _id: 1,

//         partyId: `$${config.partyId}`,
//         partyCode: `$${config.partyCode}`,
//         partyName: `$${config.partyName}`,

//         documentNumber: `$${config.documentNumber}`,
//         documentDate: `$${config.documentDate}`,

//         dueDate: 1,
//         currency: 1,

//         totalAmountPaise: 1,
//         paidAmountPaise: 1,
//         outstandingAmountPaise: 1,
//         paymentStatus: 1,
//       },
//     },

//     {
//       $set: {
//         overdueDays: {
//           $cond: [
//             { $eq: [{ $type: "$dueDate" }, "date"] },

//             {
//               $max: [
//                 0,
//                 {
//                   $dateDiff: {
//                     startDate: "$dueDate",
//                     endDate: generatedAt,
//                     unit: "day",
//                     timezone: REPORT_TIMEZONE,
//                   },
//                 },
//               ],
//             },

//             null,
//           ],
//         },
//       },
//     },

//     {
//       $set: {
//         isOverdue: {
//           $gt: ["$overdueDays", 0],
//         },
//       },
//     },

//     {
//       $set: {
//         overdueAmountPaise: {
//           $cond: ["$isOverdue", "$outstandingAmountPaise", 0],
//         },

//         notDueAmountPaise: {
//           $cond: [{ $eq: ["$overdueDays", 0] }, "$outstandingAmountPaise", 0],
//         },
//       },
//     },
//   ];

//   if (overdueOnly) {
//     pipeline.push({
//       $match: { isOverdue: true },
//     });
//   }

//   const partyRows = [
//     // Use the latest document snapshot for the party display name.
//     {
//       $sort: {
//         documentDate: -1,
//         _id: -1,
//       },
//     },

//     {
//       $group: {
//         _id: "$partyId",

//         partyCode: { $first: "$partyCode" },
//         partyName: { $first: "$partyName" },

//         documentCount: { $sum: 1 },

//         totalAmountPaise: {
//           $sum: "$totalAmountPaise",
//         },

//         paidAmountPaise: {
//           $sum: "$paidAmountPaise",
//         },

//         outstandingAmountPaise: {
//           $sum: "$outstandingAmountPaise",
//         },

//         overdueAmountPaise: {
//           $sum: "$overdueAmountPaise",
//         },

//         notDueAmountPaise: {
//           $sum: "$notDueAmountPaise",
//         },

//         oldestDocumentDate: {
//           $min: "$documentDate",
//         },

//         earliestDueDate: {
//           $min: "$dueDate",
//         },

//         maxOverdueDays: {
//           $max: "$overdueDays",
//         },
//       },
//     },

//     {
//       $set: {
//         partyId: "$_id",
//       },
//     },

//     {
//       $sort: {
//         outstandingAmountPaise: -1,
//         _id: 1,
//       },
//     },
//   ];

//   const documentRows = [
//     {
//       $sort: {
//         dueDate: 1,
//         documentDate: 1,
//         _id: 1,
//       },
//     },
//   ];

//   const rowsPipeline = view === "party" ? partyRows : documentRows;

//   pipeline.push({
//     $facet: {
//       data: [
//         ...rowsPipeline,
//         {
//           $skip: (currentPage - 1) * pageLimit,
//         },
//         {
//           $limit: pageLimit,
//         },
//       ],

//       count:
//         view === "party"
//           ? [
//               {
//                 $group: {
//                   _id: "$partyId",
//                 },
//               },
//               { $count: "total" },
//             ]
//           : [{ $count: "total" }],

//       totals: [
//         {
//           $group: {
//             _id: "$partyId",

//             documentCount: { $sum: 1 },

//             outstandingAmountPaise: {
//               $sum: "$outstandingAmountPaise",
//             },

//             overdueAmountPaise: {
//               $sum: "$overdueAmountPaise",
//             },

//             notDueAmountPaise: {
//               $sum: "$notDueAmountPaise",
//             },
//           },
//         },

//         {
//           $group: {
//             _id: null,

//             partyCount: { $sum: 1 },

//             documentCount: {
//               $sum: "$documentCount",
//             },

//             outstandingAmountPaise: {
//               $sum: "$outstandingAmountPaise",
//             },

//             overdueAmountPaise: {
//               $sum: "$overdueAmountPaise",
//             },

//             notDueAmountPaise: {
//               $sum: "$notDueAmountPaise",
//             },
//           },
//         },

//         {
//           $project: {
//             _id: 0,
//           },
//         },
//       ],
//     },
//   });

//   const [result] = await config.model.aggregate(pipeline);

//   const total = result?.count?.[0]?.total || 0;
//   const totals = result?.totals?.[0] || emptyTotals();

//   // Avoid returning silently unsafe monetary totals.
//   const moneyFields = [
//     "totalAmountPaise",
//     "paidAmountPaise",
//     "outstandingAmountPaise",
//     "overdueAmountPaise",
//     "notDueAmountPaise",
//   ];

//   for (const record of [totals, ...(result?.data || [])]) {
//     for (const field of moneyFields) {
//       if (record[field] !== undefined && !Number.isSafeInteger(record[field])) {
//         throw createError("Outstanding totals exceed the supported range", 409);
//       }
//     }
//   }

//   return {
//     kind,
//     view,

//     basis: "CURRENT_POSTED_DOCUMENTS",
//     currency: "INR",

//     timezone: REPORT_TIMEZONE,
//     generatedAt,

//     totals,

//     data: result?.data || [],

//     pagination: {
//       page: currentPage,
//       limit: pageLimit,
//       total,
//       totalPages: Math.ceil(total / pageLimit),
//     },
//   };
// };

// module.exports = {
//   getOutstanding,
// };

const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const REPORT_TIMEZONE = "Asia/Kolkata";

const CONFIG = {
  customer: {
    modelName: "SalesInvoice",
    partyId: "customerId",
    partyCode: "customerCode",
    partyName: "customerName",
    documentNumber: "invoiceNumber",
    documentDate: "invoiceDate",
  },

  supplier: {
    modelName: "PurchaseBill",
    partyId: "supplierId",
    partyCode: "supplierCode",
    partyName: "supplierName",
    documentNumber: "billNumber",
    documentDate: "billDate",
  },
};

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const emptyTotals = () => ({
  documentCount: 0,
  partyCount: 0,
  outstandingAmountPaise: 0,
  overdueAmountPaise: 0,
  notDueAmountPaise: 0,
});

const getOutstanding = async ({
  tenant,
  kind,
  view = "party",
  partyId,
  search = "",
  overdueOnly = false,
  page = 1,
  limit = 20,
}) => {
  const config = CONFIG[kind];

  if (!config) {
    throw createError("Invalid outstanding report type");
  }

  const tenantId = tenant?._id;

  if (!mongoose.isObjectIdOrHexString(tenantId)) {
    throw createError("Invalid tenantId");
  }

  if (partyId && !mongoose.isObjectIdOrHexString(partyId)) {
    throw createError("Invalid partyId");
  }

  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const model = models[config.modelName];

  if (!model) {
    throw createError(
      `Tenant model is missing: ${config.modelName}`,
      500,
    );
  }

  // Mongoose aggregation requires explicit ObjectId conversion.
  const match = {
    tenantId: new mongoose.Types.ObjectId(String(tenantId)),
    status: "POSTED",
    isDeleted: false,
    outstandingAmountPaise: { $gt: 0 },
  };

  if (partyId) {
    match[config.partyId] = new mongoose.Types.ObjectId(
      String(partyId),
    );
  }

  const searchText = String(search).trim();

  if (searchText) {
    const regex = {
      $regex: escapeRegex(searchText),
      $options: "i",
    };

    match.$or = [
      { [config.partyCode]: regex },
      { [config.partyName]: regex },
      { [config.documentNumber]: regex },
    ];
  }

  const currentPage = Math.max(
    1,
    Math.floor(Number(page) || 1),
  );

  const pageLimit = Math.min(
    100,
    Math.max(1, Math.floor(Number(limit) || 20)),
  );

  // Capture once so every document uses the same report time.
  const generatedAt = new Date();

  const pipeline = [
    { $match: match },

    {
      $project: {
        _id: 1,

        partyId: `$${config.partyId}`,
        partyCode: `$${config.partyCode}`,
        partyName: `$${config.partyName}`,

        documentNumber: `$${config.documentNumber}`,
        documentDate: `$${config.documentDate}`,

        dueDate: 1,
        currency: 1,

        totalAmountPaise: 1,
        paidAmountPaise: 1,
        outstandingAmountPaise: 1,
        paymentStatus: 1,
      },
    },

    {
      $set: {
        overdueDays: {
          $cond: [
            { $eq: [{ $type: "$dueDate" }, "date"] },

            {
              $max: [
                0,
                {
                  $dateDiff: {
                    startDate: "$dueDate",
                    endDate: generatedAt,
                    unit: "day",
                    timezone: REPORT_TIMEZONE,
                  },
                },
              ],
            },

            null,
          ],
        },
      },
    },

    {
      $set: {
        isOverdue: {
          $gt: ["$overdueDays", 0],
        },
      },
    },

    {
      $set: {
        overdueAmountPaise: {
          $cond: [
            "$isOverdue",
            "$outstandingAmountPaise",
            0,
          ],
        },

        notDueAmountPaise: {
          $cond: [
            { $eq: ["$overdueDays", 0] },
            "$outstandingAmountPaise",
            0,
          ],
        },
      },
    },
  ];

  if (overdueOnly) {
    pipeline.push({
      $match: { isOverdue: true },
    });
  }

  const partyRows = [
    // Use the latest document snapshot for the party display name.
    {
      $sort: {
        documentDate: -1,
        _id: -1,
      },
    },

    {
      $group: {
        _id: "$partyId",

        partyCode: { $first: "$partyCode" },
        partyName: { $first: "$partyName" },

        documentCount: { $sum: 1 },

        totalAmountPaise: {
          $sum: "$totalAmountPaise",
        },

        paidAmountPaise: {
          $sum: "$paidAmountPaise",
        },

        outstandingAmountPaise: {
          $sum: "$outstandingAmountPaise",
        },

        overdueAmountPaise: {
          $sum: "$overdueAmountPaise",
        },

        notDueAmountPaise: {
          $sum: "$notDueAmountPaise",
        },

        oldestDocumentDate: {
          $min: "$documentDate",
        },

        earliestDueDate: {
          $min: "$dueDate",
        },

        maxOverdueDays: {
          $max: "$overdueDays",
        },
      },
    },

    {
      $set: {
        partyId: "$_id",
      },
    },

    {
      $sort: {
        outstandingAmountPaise: -1,
        _id: 1,
      },
    },
  ];

  const documentRows = [
    {
      $sort: {
        dueDate: 1,
        documentDate: 1,
        _id: 1,
      },
    },
  ];

  const rowsPipeline = view === "party"
    ? partyRows
    : documentRows;

  pipeline.push({
    $facet: {
      data: [
        ...rowsPipeline,
        {
          $skip: (currentPage - 1) * pageLimit,
        },
        {
          $limit: pageLimit,
        },
      ],

      count:
        view === "party"
          ? [
              {
                $group: {
                  _id: "$partyId",
                },
              },
              { $count: "total" },
            ]
          : [{ $count: "total" }],

      totals: [
        {
          $group: {
            _id: "$partyId",

            documentCount: { $sum: 1 },

            outstandingAmountPaise: {
              $sum: "$outstandingAmountPaise",
            },

            overdueAmountPaise: {
              $sum: "$overdueAmountPaise",
            },

            notDueAmountPaise: {
              $sum: "$notDueAmountPaise",
            },
          },
        },

        {
          $group: {
            _id: null,

            partyCount: { $sum: 1 },

            documentCount: {
              $sum: "$documentCount",
            },

            outstandingAmountPaise: {
              $sum: "$outstandingAmountPaise",
            },

            overdueAmountPaise: {
              $sum: "$overdueAmountPaise",
            },

            notDueAmountPaise: {
              $sum: "$notDueAmountPaise",
            },
          },
        },

        {
          $project: {
            _id: 0,
          },
        },
      ],
    },
  });

  const [result] = await model.aggregate(pipeline);

  const total = result?.count?.[0]?.total || 0;
  const totals = result?.totals?.[0] || emptyTotals();

  // Avoid returning silently unsafe monetary totals.
  const moneyFields = [
    "totalAmountPaise",
    "paidAmountPaise",
    "outstandingAmountPaise",
    "overdueAmountPaise",
    "notDueAmountPaise",
  ];

  for (const record of [totals, ...(result?.data || [])]) {
    for (const field of moneyFields) {
      if (
        record[field] !== undefined &&
        !Number.isSafeInteger(record[field])
      ) {
        throw createError(
          "Outstanding totals exceed the supported range",
          409,
        );
      }
    }
  }

  return {
    kind,
    view,

    basis: "CURRENT_POSTED_DOCUMENTS",
    currency: "INR",

    timezone: REPORT_TIMEZONE,
    generatedAt,

    totals,

    data: result?.data || [],

    pagination: {
      page: currentPage,
      limit: pageLimit,
      total,
      totalPages: Math.ceil(total / pageLimit),
    },
  };
};

module.exports = {
  getOutstanding,
};