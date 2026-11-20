const os = require("os");
const path = require("path");

const positive = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

module.exports = {
  llm: {
    // FreeLLMAPI exposes an OpenAI-compatible API, e.g. http://localhost:3001/v1
    baseUrl: (process.env.LLM_BASE_URL || "https://llm.trustiqtech.com/v1").replace(/\/+$/, ""),
    apiKey: process.env.LLM_API_KEY || "",
    // Text model or a fallback chain such as "auto:bills"
    model: process.env.LLM_MODEL || "",
    // Optional. Leave empty to use OCR for photos/scans.
    visionModel: process.env.LLM_VISION_MODEL || "",
    timeoutMs: positive(process.env.LLM_TIMEOUT_MS, 120000),
    maxOutputTokens: positive(process.env.LLM_MAX_OUTPUT_TOKENS, 4096),
    retries: positive(process.env.LLM_RETRIES, 2),
  },
  upload: {
    maxFiles: 6,
    maxFileMb: positive(process.env.SCAN_MAX_FILE_MB, 12),
    get maxFileBytes() {
      return this.maxFileMb * 1024 * 1024;
    },
  },
  maxImages: 8,
  maxPdfPages: 20,
  maxOcrPdfPages: 6,
  maxTextChars: positive(process.env.SCAN_MAX_TEXT_CHARS, 28000),
  minPdfTextChars: 60,
  maxConcurrentScans: positive(process.env.SCAN_CONCURRENCY, 2),
  ocrLang: process.env.OCR_LANG || "eng",
  tessCache: process.env.TESSDATA_CACHE || path.join(os.tmpdir(), "tessdata"),
};
