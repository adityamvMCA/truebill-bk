const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const config = require("./billScan.config");

const execFileAsync = promisify(execFile);

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

let sharp = null;
try {
  sharp = require("sharp");
} catch {
  sharp = null;
}

const tidy = (value) =>
  String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const ext = (name) => path.extname(String(name || "")).toLowerCase();

const startsWith = (buffer, bytes, offset = 0) =>
  bytes.every((byte, index) => buffer[offset + index] === byte);

/* Detect by file signature, never by the client-provided mimetype. */
const detectType = (file) => {
  const b = file.buffer;
  const extension = ext(file.originalname);

  if (!b || b.length < 4) return null;

  if (startsWith(b, [0x25, 0x50, 0x44, 0x46])) return { kind: "pdf" };
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return { kind: "image", mime: "image/png" };
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { kind: "image", mime: "image/jpeg" };
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && b.length > 12 && b.toString("ascii", 8, 12) === "WEBP") {
    return { kind: "image", mime: "image/webp" };
  }
  if (startsWith(b, [0x42, 0x4d])) return { kind: "image", mime: "image/bmp" };
  if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a])) {
    return { kind: "image", mime: "image/tiff" };
  }
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) {
    if (extension === ".docx") return { kind: "docx" };
    if (extension === ".xlsx") return { kind: "xlsx" };
    return null;
  }
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0]) && extension === ".doc") return { kind: "doc" };
  if ([".txt", ".csv"].includes(extension) && !b.subarray(0, 2000).includes(0)) {
    return { kind: "text" };
  }

  return null;
};

/* ---------- images ---------- */

const prepareImage = async (buffer, mime) => {
  if (!sharp) return { buffer, mime };

  try {
    const output = await sharp(buffer, { failOn: "none" })
      .rotate()
      .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    return { buffer: output, mime: "image/jpeg" };
  } catch {
    return { buffer, mime };
  }
};

const prepareForOcr = async (buffer) => {
  if (!sharp) return buffer;

  try {
    const image = sharp(buffer, { failOn: "none" }).rotate();
    const meta = await image.metadata();
    const width = !meta.width || meta.width < 1200 ? 1600 : Math.min(meta.width, 2400);

    return await image
      .resize({ width })
      .grayscale()
      .normalize()
      .sharpen()
      .png()
      .toBuffer();
  } catch {
    return buffer;
  }
};

const ocrImages = async (images) => {
  const { createWorker } = require("tesseract.js");

  await fs.mkdir(config.tessCache, { recursive: true });

  const worker = await createWorker(config.ocrLang, 1, {
    cachePath: config.tessCache,
  });

  try {
    const pages = [];

    for (const image of images) {
      const prepared = await prepareForOcr(image.buffer);
      const { data } = await worker.recognize(prepared);
      pages.push(data?.text || "");
    }

    return tidy(pages.join("\n\n"));
  } catch (error) {
    throw createError(`OCR failed: ${error.message}`, 422);
  } finally {
    await worker.terminate().catch(() => {});
  }
};

/* ---------- PDF ---------- */

const pdfText = async (buffer) => {
  // Import the library file directly: the package index runs debug code.
  const pdfParse = require("pdf-parse/lib/pdf-parse.js");
  const result = await pdfParse(buffer, { max: config.maxPdfPages });
  return tidy(result.text);
};

/* Scanned PDFs are rasterised with poppler's pdftoppm (apt install poppler-utils). */
const pdfToImages = async (buffer) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "billscan-"));

  try {
    const input = path.join(directory, "input.pdf");
    await fs.writeFile(input, buffer);

    await execFileAsync(
      "pdftoppm",
      ["-r", "200", "-png", "-l", String(config.maxOcrPdfPages), input, path.join(directory, "page")],
      { timeout: 60000 },
    );

    const names = (await fs.readdir(directory)).filter((name) => name.startsWith("page") && name.endsWith(".png")).sort();

    const images = [];
    for (const name of names) {
      images.push({ buffer: await fs.readFile(path.join(directory, name)), mime: "image/png" });
    }

    return images;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw createError(`Could not convert the PDF to images: ${error.message}`, 422);
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
};

/* ---------- Office / text ---------- */

const cellText = (value) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === "object") {
    if ("result" in value) return cellText(value.result);
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return String(value.text);
    if ("hyperlink" in value) return String(value.hyperlink);
    return "";
  }

  return String(value);
};

const xlsxText = async (buffer) => {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const lines = [];
  let rows = 0;

  workbook.eachSheet((sheet) => {
    lines.push(`# Sheet: ${sheet.name}`);

    sheet.eachRow({ includeEmpty: false }, (row) => {
      rows += 1;
      if (rows > 2000) return;

      const cells = [];
      row.eachCell({ includeEmpty: false }, (cell) => cells.push(cellText(cell.value)));

      const line = cells.filter(Boolean).join(" | ");
      if (line) lines.push(line);
    });
  });

  return lines.join("\n");
};

const docxText = async (buffer) => {
  const mammoth = require("mammoth");
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
};

const docText = async (buffer) => {
  const WordExtractor = require("word-extractor");
  const document = await new WordExtractor().extract(buffer);
  return document.getBody();
};

/* ---------- Public ---------- */

const readFile = async (file) => {
  const type = detectType(file);

  if (!type) {
    throw createError(
      `"${file.originalname}" is not a supported file. Use PDF, DOC, DOCX, XLSX, CSV, TXT, JPG, PNG, WebP, BMP or TIFF.`,
    );
  }

  const result = { name: file.originalname, kind: type.kind, text: "", images: [] };

  try {
    switch (type.kind) {
      case "pdf": {
        const text = await pdfText(file.buffer);

        if (text.length >= config.minPdfTextChars) {
          result.text = text;
          break;
        }

        const pages = await pdfToImages(file.buffer);

        if (!pages.length) {
          throw createError(
            `"${file.originalname}" looks like a scanned PDF with no text, and the server cannot convert it to images (install poppler-utils). Upload a photo of the bill instead.`,
            422,
          );
        }

        result.images = pages;
        result.text = text;
        break;
      }

      case "image":
        result.images = [await prepareImage(file.buffer, type.mime)];
        break;

      case "docx":
        result.text = tidy(await docxText(file.buffer));
        break;

      case "doc":
        result.text = tidy(await docText(file.buffer));
        break;

      case "xlsx":
        result.text = tidy(await xlsxText(file.buffer));
        break;

      default:
        result.text = tidy(file.buffer.toString("utf8"));
    }
  } catch (error) {
    if (error.statusCode) throw error;
    throw createError(`Could not read "${file.originalname}": ${error.message}`, 422);
  }

  return result;
};

module.exports = { readFile, ocrImages, tidy };
