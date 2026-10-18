const express = require("express");

const verifyToken = require("../../middleware/authMiddleware");

const resolveTenant = require("../../middleware/tenantMiddleware");

const requirePermission = require("../../middleware/permissionMiddleware");

const controller = require("./deliveryNote.controller");

const validation = require("./deliveryNote.validation");

const router = express.Router();

/* ==========================================
   AUTHENTICATION AND TENANT CONTEXT
   ========================================== */

router.use(verifyToken, resolveTenant);

/* ==========================================
   CREATE FROM SALES ORDER

   Requires access to the source Sales Order
   as well as permission to create a note.
   ========================================== */

router.post(
  "/from-order/:orderNumber",
  requirePermission("deliveryNote.create"),
  requirePermission("salesOrder.view"),

  validation.validateSalesOrderParams,
  validation.validateCreateDeliveryNoteFromOrder,

  controller.createDeliveryNoteFromOrder,
);

/* ==========================================
   LIST
   ========================================== */

router.get(
  "/",
  requirePermission("deliveryNote.view"),

  validation.validateListDeliveryNotes,

  controller.getDeliveryNotes,
);

/* ==========================================
   CREATE
   ========================================== */

router.post(
  "/",
  requirePermission("deliveryNote.create"),

  validation.validateCreateDeliveryNote,

  controller.createDeliveryNote,
);

/* ==========================================
   DETAIL
   ========================================== */

router.get(
  "/:deliveryNoteNumber",
  requirePermission("deliveryNote.view"),

  validation.validateDeliveryNoteParams,

  controller.getDeliveryNoteByNumber,
);

/* ==========================================
   UPDATE CREATED NOTE
   ========================================== */

router.patch(
  "/:deliveryNoteNumber",
  requirePermission("deliveryNote.update"),

  validation.validateDeliveryNoteParams,
  validation.validateUpdateDeliveryNote,

  controller.updateDeliveryNote,
);

/* ==========================================
   DISPATCH
   ========================================== */

router.post(
  "/:deliveryNoteNumber/dispatch",
  requirePermission("deliveryNote.dispatch"),

  validation.validateDeliveryNoteParams,
  validation.validateDispatchDeliveryNote,

  controller.dispatchDeliveryNote,
);

/* ==========================================
   RECORD DELIVERY
   ========================================== */

router.post(
  "/:deliveryNoteNumber/deliver",
  requirePermission("deliveryNote.deliver"),

  validation.validateDeliveryNoteParams,
  validation.validateDeliverDeliveryNote,

  controller.deliverDeliveryNote,
);

/* ==========================================
   CANCEL CREATED NOTE
   ========================================== */

router.post(
  "/:deliveryNoteNumber/cancel",
  requirePermission("deliveryNote.cancel"),

  validation.validateDeliveryNoteParams,
  validation.validateCancelDeliveryNote,

  controller.cancelDeliveryNote,
);

/* ==========================================
   SOFT DELETE CREATED NOTE

   version is supplied in the JSON body.
   ========================================== */

router.delete(
  "/:deliveryNoteNumber",
  requirePermission("deliveryNote.delete"),

  validation.validateDeliveryNoteParams,
  validation.validateDeleteDeliveryNote,

  controller.deleteDeliveryNote,
);

module.exports = router;
