const express = require("express");
const verifyToken = require("../middleware/authMiddleware");
const requirePlatformRole = require("../middleware/platformMiddleware");

const {
  getMenuByRole,
  getAllMenus,
  createMenu,
  addChild,
  updateMenu,
  deleteMenu,
  bulkMenus,
  getMenuByDocumentNumber,
} = require("../controllers/menuController");

const router = express.Router();

const developerOnly = [verifyToken, requirePlatformRole("developer")];
const platformRead = [verifyToken, requirePlatformRole("developer", "support")];

router.get("/", verifyToken, getMenuByRole);
router.get("/all", platformRead, getAllMenus);

router.post("/create", developerOnly, createMenu);
router.post("/bulk-upload", developerOnly, bulkMenus);
router.post("/:documentNumber/children", developerOnly, addChild);
router.put("/update/:documentNumber", developerOnly, updateMenu);
router.delete("/delete/:documentNumber", developerOnly, deleteMenu);

router.get("/:documentNumber", platformRead, getMenuByDocumentNumber);

module.exports = router;