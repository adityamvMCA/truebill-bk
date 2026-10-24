const { getReadyTenantConnection } = require("../../../tenancy/tenantConnectionManager");
const noteService = require("./note.service");

const createNote = async (req, res, next) => {
  try {
    const connection = getReadyTenantConnection(req.tenant);
    const session = await connection.startSession();
    let note;

    try {
      await session.withTransaction(async () => {
        note = await noteService.createNote({
          tenant: req.tenant,
          connection,
          userId: req.user.userId,
          body: req.body,
          session,
        });
      });

      return res.status(201).json({
        success: true,
        message: `${note.noteType === "CREDIT_NOTE" ? "Credit" : "Debit"} note ${note.noteNumber} posted`,
        note,
      });
    } finally {
      await session.endSession();
    }
  } catch (error) {
    return next(error);
  }
};

const listNotes = async (req, res, next) => {
  try {
    const connection = getReadyTenantConnection(req.tenant);
    const result = await noteService.listNotes({ tenant: req.tenant, connection, ...req.query });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
};

const getNote = async (req, res, next) => {
  try {
    const connection = getReadyTenantConnection(req.tenant);
    const note = await noteService.getNoteById({ tenant: req.tenant, connection, id: req.params.id });
    return res.status(200).json({ success: true, note });
  } catch (error) {
    return next(error);
  }
};

module.exports = { createNote, listNotes, getNote };
