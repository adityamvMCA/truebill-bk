const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 5 * 1024 * 1024,
  },

  fileFilter: (req, file, callback) => {
    const allowedMimeTypes = [
      "text/csv",
      "application/csv",
      "application/vnd.ms-excel",
      "text/plain",
    ];

    const isCsv =
      allowedMimeTypes.includes(file.mimetype) ||
      file.originalname.toLowerCase().endsWith(".csv");

    if (!isCsv) {
      const error = new Error("Only CSV files are allowed");

      error.statusCode = 400;

      callback(error);

      return;
    }

    callback(null, true);
  },
});

module.exports = upload;
