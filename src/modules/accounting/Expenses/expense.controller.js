const expenseService = require("./expense.service");
const { isTenantAdmin } = require("./expense.access");

const handleError = (error, res, next) => {
  if (error?.statusCode) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
    });
  }

  return next(error);
};

const getOptions = async (req, res, next) => {
  try {
    const data = await expenseService.getExpenseOptions({ tenant: req.tenant });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleError(error, res, next);
  }
};

const createExpense = async (req, res, next) => {
  try {
    const { expense, replayed } = await expenseService.createExpense({
      tenant: req.tenant,
      userId: req.user.userId,
      payload: req.body,
      ipAddress: req.ip,
    });

    return res.status(replayed ? 200 : 201).json({
      success: true,
      replayed,
      message: replayed
        ? "Expense was already created for this request"
        : "Expense created and sent for admin approval",
      data: expense,
    });
  } catch (error) {
    return handleError(error, res, next);
  }
};

const getExpenses = async (req, res, next) => {
  try {
    const result = await expenseService.getExpenses({
      tenant: req.tenant,
      search: req.query.search,
      status: req.query.status,
      paymentMode: req.query.paymentMode,
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
      page: req.query.page,
      limit: req.query.limit,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return handleError(error, res, next);
  }
};

const getExpenseByNumber = async (req, res, next) => {
  try {
    const expense = await expenseService.getExpenseByNumber({
      tenant: req.tenant,
      expenseNumber: req.params.expenseNumber,
    });

    const admin = isTenantAdmin(req.user);
    const isNew = expense.status === "NEW";

    return res.status(200).json({
      success: true,
      data: expense,
      // The frontend uses these flags to show or hide action buttons.
      permissions: {
        canApprove: admin && isNew,
        canReject: admin && isNew,
        canCancel:
          isNew &&
          (admin || String(expense.createdBy) === String(req.user.userId)),
      },
    });
  } catch (error) {
    return handleError(error, res, next);
  }
};

const approveExpense = async (req, res, next) => {
  try {
    const expense = await expenseService.approveExpense({
      tenant: req.tenant,
      userId: req.user.userId,
      expenseNumber: req.params.expenseNumber,
      ipAddress: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: "Expense approved and posted",
      data: expense,
    });
  } catch (error) {
    return handleError(error, res, next);
  }
};

const rejectExpense = async (req, res, next) => {
  try {
    const expense = await expenseService.rejectExpense({
      tenant: req.tenant,
      userId: req.user.userId,
      expenseNumber: req.params.expenseNumber,
      reason: req.body.reason,
      ipAddress: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: "Expense rejected",
      data: expense,
    });
  } catch (error) {
    return handleError(error, res, next);
  }
};

const cancelExpense = async (req, res, next) => {
  try {
    const expense = await expenseService.cancelExpense({
      tenant: req.tenant,
      userId: req.user.userId,
      isAdmin: isTenantAdmin(req.user),
      expenseNumber: req.params.expenseNumber,
      ipAddress: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: "Expense cancelled",
      data: expense,
    });
  } catch (error) {
    return handleError(error, res, next);
  }
};

module.exports = {
  getOptions,
  createExpense,
  getExpenses,
  getExpenseByNumber,
  approveExpense,
  rejectExpense,
  cancelExpense,
};
