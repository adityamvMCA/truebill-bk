const deliveryNoteService = require("./deliveryNote.service");

/* ==========================================
   REQUEST CONTEXT
   ========================================== */

const getRequestContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
});

const getDeliveryNoteNumber = (req) => req.validatedParams.deliveryNoteNumber;

/* ==========================================
   CREATE
   ========================================== */

const createDeliveryNote = async (req, res, next) => {
  try {
    const deliveryNote = await deliveryNoteService.createDeliveryNote({
      ...getRequestContext(req),
      payload: req.validatedBody,
    });

    return res.status(201).json({
      success: true,
      message: "Delivery Note created successfully",
      data: deliveryNote,
    });
  } catch (error) {
    return next(error);
  }
};


const createDeliveryNoteFromOrder = async (req, res, next) => {
  try {
    const deliveryNote = await deliveryNoteService.createDeliveryNoteFromOrder({
      ...getRequestContext(req),

      orderNumber: req.validatedParams.orderNumber,

      payload: req.validatedBody,
    });

    return res.status(201).json({
      success: true,
      message: "Delivery Note created from Sales Order successfully",
      data: deliveryNote,
    });
  } catch (error) {
    return next(error);
  }
};

const getDeliveryNotes = async (req, res, next) => {
  try {
    const result = await deliveryNoteService.getDeliveryNotes({
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
const getDeliveryNoteByNumber = async (req, res, next) => {
  try {
    const deliveryNote = await deliveryNoteService.getDeliveryNoteByNumber({
      tenant: req.tenant,
      deliveryNoteNumber: getDeliveryNoteNumber(req),
    });

    return res.status(200).json({
      success: true,
      data: deliveryNote,
    });
  } catch (error) {
    return next(error);
  }
};

const updateDeliveryNote = async (req, res, next) => {
  try {
    const deliveryNote = await deliveryNoteService.updateDeliveryNote({
      ...getRequestContext(req),

      deliveryNoteNumber: getDeliveryNoteNumber(req),

      payload: req.validatedBody,
    });

    return res.status(200).json({
      success: true,
      message: "Delivery Note updated successfully",
      data: deliveryNote,
    });
  } catch (error) {
    return next(error);
  }
};

const dispatchDeliveryNote = async (req, res, next) => {
  try {
    const deliveryNote = await deliveryNoteService.dispatchDeliveryNote({
      ...getRequestContext(req),

      deliveryNoteNumber: getDeliveryNoteNumber(req),

      payload: req.validatedBody,
    });

    return res.status(200).json({
      success: true,
      message: "Delivery Note dispatched successfully",
      data: deliveryNote,
    });
  } catch (error) {
    return next(error);
  }
};


const deliverDeliveryNote = async (req, res, next) => {
  try {
    const deliveryNote = await deliveryNoteService.deliverDeliveryNote({
      ...getRequestContext(req),

      deliveryNoteNumber: getDeliveryNoteNumber(req),

      payload: req.validatedBody,
    });

    return res.status(200).json({
      success: true,
      message: "Delivery acknowledgment recorded successfully",
      data: deliveryNote,
    });
  } catch (error) {
    return next(error);
  }
};

const cancelDeliveryNote = async (req, res, next) => {
  try {
    const deliveryNote = await deliveryNoteService.cancelDeliveryNote({
      ...getRequestContext(req),

      deliveryNoteNumber: getDeliveryNoteNumber(req),

      payload: req.validatedBody,
    });

    return res.status(200).json({
      success: true,
      message: "Delivery Note cancelled successfully",
      data: deliveryNote,
    });
  } catch (error) {
    return next(error);
  }
};

const deleteDeliveryNote = async (req, res, next) => {
  try {
    await deliveryNoteService.deleteDeliveryNote({
      ...getRequestContext(req),

      deliveryNoteNumber: getDeliveryNoteNumber(req),

      payload: req.validatedBody,
    });

    return res.status(200).json({
      success: true,
      message: "Delivery Note deleted successfully",
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createDeliveryNote,
  createDeliveryNoteFromOrder,
  getDeliveryNotes,
  getDeliveryNoteByNumber,
  updateDeliveryNote,
  dispatchDeliveryNote,
  deliverDeliveryNote,
  cancelDeliveryNote,
  deleteDeliveryNote,
};
