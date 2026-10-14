const express = require("express");

const ledgerGroupRoutes = require("./ledger-groups/ledgerGroup.routes");
const ledgerRoutes = require("./ledgers/ledger.routes");
const journalRoutes = require("./journals/journal.routes");
const router = express.Router();

router.use("/ledger-groups", ledgerGroupRoutes);
router.use("/ledgers", ledgerRoutes);
router.use("/journals", journalRoutes);

module.exports = router;