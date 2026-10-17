const mongoose = require("mongoose");

const {
  getReadyTenantConnection,
} = require("../../../tenancy/tenantConnectionManager");

const {
  postJournal,
} = require("./journal.service");

const createManualJournal = async (
  req,
  res,
  next,
) => {
  try {
    const connection =
      getReadyTenantConnection(req.tenant);

    const session =
      await connection.startSession();

    let journal;

    try {
      await session.withTransaction(
        async () => {
          const sourceId =
            req.body.sourceId ||
            new mongoose.Types.ObjectId();

          journal = await postJournal({
            tenant: req.tenant,
            connection,
            userId: req.user.userId,
            postingDate: req.body.postingDate,
            sourceType: "MANUAL_JOURNAL",
            sourceId,
            sourceNumber:
              req.body.sourceNumber ||
              `MANUAL-${sourceId.toString()}`,
            narration: req.body.narration,
            lines: req.body.lines,
            session,
          });
        },
      );

      return res.status(201).json({
        success: true,
        message:
          "Manual journal posted successfully",
        journal,
      });
    } finally {
      await session.endSession();
    }
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createManualJournal,
};