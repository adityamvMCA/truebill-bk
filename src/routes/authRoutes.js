const express = require("express");
const rateLimit = require("express-rate-limit");

const { login, sendOtp, verifyOtpLogin, me } = require("../controllers/authController");
const verifyToken = require("../middleware/authMiddleware");

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Try again later.",
  },
});

const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP requests. Please wait a few minutes before trying again.",
  },
});

const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many verification attempts. Please try again later.",
  },
});

router.post("/login", loginLimiter, login);
router.post("/otp/send", otpSendLimiter, sendOtp);
router.post("/otp/verify", otpVerifyLimiter, verifyOtpLogin);
router.get("/me", verifyToken, me);

module.exports = router;
