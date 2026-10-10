const express = require("express");

const ledgerGroupRoutes = require("./ledger-groups/ledgerGroup.routes");
const ledgerRoutes = require("./ledgers/ledger.routes");

const router = express.Router();

router.use("/ledger-groups", ledgerGroupRoutes);
router.use("/ledgers", ledgerRoutes);

module.exports = router;