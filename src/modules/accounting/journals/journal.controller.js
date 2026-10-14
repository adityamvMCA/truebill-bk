const mongoose = require("mongoose");

const Journal = require("./journal.model");
const { postJournal } = require("./journal.service");

const createManualJournal = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    let journal;

    await session.withTransaction(async () => {
      const sourceId =
        req.body.sourceId ||
        new mongoose.Types.ObjectId();

      journal = await postJournal({
        tenantId: req.tenantId,
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
    });

    return res.status(201).json({
      success: true,
      message: "Manual journal posted successfully",
      journal,
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
};

module.exports = {
  createManualJournal,
};