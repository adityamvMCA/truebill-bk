// const express = require("express");
// const { login, me } = require("../controllers/authController");
// const verifyToken = require("../middleware/authMiddleware");
// const router = express.Router();
// router.post("/login", login);
// router.get("/me", verifyToken, me);
// module.exports = router;

const express = require("express");
const rateLimit = require("express-rate-limit");
const { login, me } = require("../controllers/authController");
const verifyToken = require("../middleware/authMiddleware");

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many login attempts. Try again later." },
});

router.post("/login", loginLimiter, login);
router.get("/me", verifyToken, me);

module.exports = router;