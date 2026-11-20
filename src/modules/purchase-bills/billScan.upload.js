const multer = require("multer");

const config = require("./billScan.config");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxFileBytes,
    files: config.upload.maxFiles,
  },
});

const uploadBillFiles = (req, res, next) =>
  upload.array("files", config.upload.maxFiles)(req, res, (error) => {
    if (!error) return next();

    let message = error.message;

    if (error.code === "LIMIT_FILE_SIZE") {
      message = `Each file must be ${config.upload.maxFileMb} MB or smaller`;
    } else if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE") {
      message = `Upload up to ${config.upload.maxFiles} files`;
    }

    return res.status(400).json({ success: false, message });
  });

module.exports = { uploadBillFiles };
