const service = require("./purchaseRfq.service");

const getContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
  rfqNumber: req.validatedParams?.rfqNumber,
  payload: req.validatedBody,
});

const writeHandler =
  (method, message, statusCode = 200) =>
  async (req, res, next) => {
    try {
      const data = await service[method](getContext(req));

      return res.status(statusCode).json({
        success: true,
        message,
        data,
      });
    } catch (error) {
      return next(error);
    }
  };

// const listRfqs = async (req, res, next) => {
//   try {
//     const result = await service.listRfqs({
//       ...req.validatedQuery,
//       tenant: req.tenant,
//     });

//     return res.status(200).json({
//       success: true,
//       data: result.data,
//       pagination: result.pagination,
//     });
//   } catch (error) {
//     return next(error);
//   }
// };
const listRfqs = async (req, res, next) => {
  try {
    const result = await service.listRfqs({
      ...req.validatedQuery,
      tenant: req.tenant,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    return next(error);
  }
};
const getRfq = async (req, res, next) => {
  try {
    const data = await service.getRfq(getContext(req));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const approveRfq = async (req, res, next) => {
  try {
    const { rfqNumber } = req.params;
    const { version } = req.validatedBody || req.body;

    const rfq = await PurchaseRfq.findOne({
      rfqNumber,
      tenantId: req.tenantId,
    });

    if (!rfq) {
      return res.status(404).json({
        success: false,
        message: "RFQ not found.",
      });
    }

    if (rfq.status !== "CREATED") {
      return res.status(409).json({
        success: false,
        message: "Only CREATED RFQs can be approved.",
      });
    }

    if (Number.isSafeInteger(version) && rfq.__v !== version) {
      return res.status(409).json({
        success: false,
        message: "RFQ was updated by another user. Refresh and try again.",
      });
    }

    rfq.status = "APPROVED";
    rfq.approvedBy = req.user._id;
    rfq.approvedAt = new Date();

    await rfq.save();

    return res.status(200).json({
      success: true,
      message: "RFQ approved successfully.",
      data: rfq,
    });
  } catch (error) {
    next(error);
  }
};

const rejectRfq = async (req, res, next) => {
  try {
    const { rfqNumber } = req.params;
    const { version, rejectionReason } = req.validatedBody || req.body;

    const rfq = await PurchaseRfq.findOne({
      rfqNumber,
      tenantId: req.tenantId,
    });

    if (!rfq) {
      return res.status(404).json({
        success: false,
        message: "RFQ not found.",
      });
    }

    if (rfq.status !== "CREATED") {
      return res.status(409).json({
        success: false,
        message: "Only CREATED RFQs can be rejected.",
      });
    }

    if (Number.isSafeInteger(version) && rfq.__v !== version) {
      return res.status(409).json({
        success: false,
        message: "RFQ was updated by another user. Refresh and try again.",
      });
    }

    rfq.status = "REJECTED";
    rfq.rejectionReason = rejectionReason;
    rfq.rejectedBy = req.user._id;
    rfq.rejectedAt = new Date();

    await rfq.save();

    return res.status(200).json({
      success: false,
      message: "RFQ rejected successfully.",
      data: rfq,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listRfqs,
  getRfq,
  approveRfq,
  rejectRfq,
  createRfq: writeHandler("createRfq", "RFQ created successfully", 201),

  updateRfq: writeHandler("updateRfq", "RFQ updated successfully"),

  issueRfq: writeHandler("issueRfq", "RFQ marked as issued successfully"),

  closeRfq: writeHandler("closeRfq", "RFQ closed successfully"),

  cancelRfq: writeHandler("cancelRfq", "RFQ cancelled successfully"),

  deleteRfq: writeHandler("deleteRfq", "RFQ deleted successfully"),
};
