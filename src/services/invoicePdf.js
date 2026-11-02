// src/services/invoicePdf.js
const PDFDocument = require("pdfkit");

const COMPANY = () => process.env.COMPANY_NAME || "TrustIQ";

/* ---------------- formatting ---------------- */

// pdfkit's built-in Helvetica has no rupee glyph, so "Rs." is used.
const inr = (paise) =>
  `Rs. ${(Number(paise || 0) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const num = (value) =>
  Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });

const fmtDate = (value) => {
  if (!value) return "N/A";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "N/A"
    : d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
};

/* ---------------- layout constants (A4) ---------------- */

const MARGIN = 40;
const RIGHT = 555; // 595 - 40
const BOTTOM = 790;

const COLS = {
  no: { x: 40, w: 22, align: "left" },
  item: { x: 64, w: 168, align: "left" },
  hsn: { x: 234, w: 52, align: "left" },
  qty: { x: 288, w: 50, align: "right" },
  rate: { x: 340, w: 62, align: "right" },
  disc: { x: 404, w: 34, align: "right" },
  gst: { x: 440, w: 32, align: "right" },
  amount: { x: 474, w: 81, align: "right" },
};

/* ---------------- helpers ---------------- */

const toBuffer = (build) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      build(doc);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });

const drawTableHeader = (doc, y) => {
  doc.rect(MARGIN, y, RIGHT - MARGIN, 20).fill("#f1f5f9");
  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(8);

  const labels = [
    ["no", "#"],
    ["item", "Item"],
    ["hsn", "HSN/SAC"],
    ["qty", "Qty"],
    ["rate", "Rate"],
    ["disc", "Disc %"],
    ["gst", "GST %"],
    ["amount", "Amount"],
  ];

  for (const [key, label] of labels) {
    const col = COLS[key];
    doc.text(label, col.x, y + 6, { width: col.w, align: col.align });
  }

  doc.font("Helvetica").fillColor("#000000");
  return y + 26;
};

const ensureSpace = (doc, y, needed) => {
  if (y + needed <= BOTTOM) return y;
  doc.addPage();
  return MARGIN;
};

/* ---------------- invoice PDF ---------------- */

const buildInvoicePdf = (invoice) =>
  toBuffer((doc) => {
    const items = Array.isArray(invoice.items) ? invoice.items : [];

    /* ----- header ----- */
    doc
      .font("Helvetica-Bold")
      .fontSize(20)
      .fillColor("#0f172a")
      .text(COMPANY(), MARGIN, MARGIN);

    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("TAX INVOICE", MARGIN, MARGIN, {
        width: RIGHT - MARGIN,
        align: "right",
      });

    doc
      .moveTo(MARGIN, 72)
      .lineTo(RIGHT, 72)
      .strokeColor("#cbd5e1")
      .lineWidth(1)
      .stroke();

    /* ----- invoice meta + bill to ----- */
    let y = 84;

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#64748b");
    doc.text("BILL TO", MARGIN, y);
    doc.text("INVOICE DETAILS", 340, y);

    y += 14;

    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a");
    doc.text(invoice.customerName || "Customer", MARGIN, y, { width: 270 });

    doc.font("Helvetica").fontSize(9).fillColor("#334155");

    let leftY = doc.y + 2;
    doc.text(`Customer Code: ${invoice.customerCode || "N/A"}`, MARGIN, leftY, {
      width: 270,
    });
    leftY = doc.y;

    if (invoice.customerGstNo) {
      doc.text(`GSTIN: ${invoice.customerGstNo}`, MARGIN, leftY, {
        width: 270,
      });
      leftY = doc.y;
    }

    if (invoice.billingAddress) {
      doc.text(invoice.billingAddress, MARGIN, leftY, { width: 270 });
      leftY = doc.y;
    }

    const meta = [
      ["Invoice No", invoice.invoiceNumber],
      ["Invoice Date", fmtDate(invoice.invoiceDate)],
      ["Due Date", fmtDate(invoice.dueDate)],
      ["Payment Terms", invoice.paymentTerms || "N/A"],
      ["Status", invoice.status || "N/A"],
    ];

    let metaY = y;
    for (const [label, value] of meta) {
      doc.font("Helvetica").fontSize(9).fillColor("#64748b");
      doc.text(label, 340, metaY, { width: 90 });
      doc.font("Helvetica-Bold").fillColor("#0f172a");
      doc.text(String(value ?? "N/A"), 432, metaY, {
        width: RIGHT - 432,
        align: "right",
      });
      metaY += 14;
    }

    y = Math.max(leftY, metaY) + 16;

    /* ----- items table ----- */
    y = drawTableHeader(doc, y);

    doc.fontSize(8.5);

    items.forEach((item, index) => {
      const name = item.productName || "Item";
      const spec = item.specification ? `\n${item.specification}` : "";
      const itemText = `${name}${spec}`;

      doc.font("Helvetica");
      const rowHeight = Math.max(
        16,
        doc.heightOfString(itemText, { width: COLS.item.w }) + 6,
      );

      if (y + rowHeight > BOTTOM) {
        doc.addPage();
        y = drawTableHeader(doc, MARGIN);
        doc.fontSize(8.5);
      }

      doc.fillColor("#0f172a").font("Helvetica");
      doc.text(String(index + 1), COLS.no.x, y, {
        width: COLS.no.w,
        align: COLS.no.align,
      });
      doc.text(itemText, COLS.item.x, y, { width: COLS.item.w });
      doc.text(item.hsnSacCode || "-", COLS.hsn.x, y, { width: COLS.hsn.w });
      doc.text(`${num(item.quantity)} ${item.unit || ""}`.trim(), COLS.qty.x, y, {
        width: COLS.qty.w,
        align: "right",
      });
      doc.text(inr(item.unitRatePaise).replace("Rs. ", ""), COLS.rate.x, y, {
        width: COLS.rate.w,
        align: "right",
      });
      doc.text(num(item.discountPercent), COLS.disc.x, y, {
        width: COLS.disc.w,
        align: "right",
      });
      doc.text(num(item.gstRate), COLS.gst.x, y, {
        width: COLS.gst.w,
        align: "right",
      });
      doc.text(inr(item.totalAmountPaise).replace("Rs. ", ""), COLS.amount.x, y, {
        width: COLS.amount.w,
        align: "right",
      });

      y += rowHeight;

      doc
        .moveTo(MARGIN, y - 2)
        .lineTo(RIGHT, y - 2)
        .strokeColor("#e2e8f0")
        .lineWidth(0.5)
        .stroke();
    });

    /* ----- totals ----- */
    y = ensureSpace(doc, y + 10, 140);

    const totals = [
      ["Gross Amount", invoice.grossAmountPaise],
      ["Discount", invoice.discountAmountPaise],
      ["Taxable Amount", invoice.taxableAmountPaise],
    ];

    if (Number(invoice.cgstAmountPaise) > 0) {
      totals.push(["CGST", invoice.cgstAmountPaise]);
    }
    if (Number(invoice.sgstAmountPaise) > 0) {
      totals.push(["SGST", invoice.sgstAmountPaise]);
    }
    if (Number(invoice.igstAmountPaise) > 0) {
      totals.push(["IGST", invoice.igstAmountPaise]);
    }

    doc.fontSize(9);

    for (const [label, value] of totals) {
      doc.font("Helvetica").fillColor("#475569");
      doc.text(label, 340, y, { width: 130 });
      doc.fillColor("#0f172a");
      doc.text(inr(value), 440, y, { width: RIGHT - 440, align: "right" });
      y += 14;
    }

    doc.rect(340, y + 2, RIGHT - 340, 22).fill("#0f172a");
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#ffffff");
    doc.text("Invoice Total", 348, y + 8, { width: 100 });
    doc.text(inr(invoice.totalAmountPaise), 440, y + 8, {
      width: RIGHT - 448,
      align: "right",
    });
    y += 32;

    if (invoice.status === "POSTED") {
      doc.font("Helvetica").fontSize(9).fillColor("#475569");
      doc.text("Paid", 340, y, { width: 130 });
      doc.fillColor("#0f172a");
      doc.text(inr(invoice.paidAmountPaise), 440, y, {
        width: RIGHT - 440,
        align: "right",
      });
      y += 14;

      doc.font("Helvetica-Bold").fillColor("#b91c1c");
      doc.text("Balance Due", 340, y, { width: 130 });
      doc.text(inr(invoice.outstandingAmountPaise), 440, y, {
        width: RIGHT - 440,
        align: "right",
      });
      y += 18;
    }

    /* ----- notes / terms ----- */
    const blocks = [
      ["Notes", invoice.notes],
      ["Delivery Terms", invoice.deliveryTerms],
      ["Terms & Conditions", invoice.termsAndConditions],
    ].filter(([, text]) => text);

    for (const [title, text] of blocks) {
      const height = doc.heightOfString(String(text), {
        width: RIGHT - MARGIN,
      });

      y = ensureSpace(doc, y + 8, height + 24);

      doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a");
      doc.text(title, MARGIN, y);
      doc.font("Helvetica").fontSize(8.5).fillColor("#475569");
      doc.text(String(text), MARGIN, doc.y + 2, { width: RIGHT - MARGIN });
      y = doc.y + 6;
    }

    /* ----- footer ----- */
    y = ensureSpace(doc, y + 16, 30);
    doc.font("Helvetica").fontSize(8).fillColor("#94a3b8");
    doc.text(
      "This is a computer-generated invoice and does not require a signature.",
      MARGIN,
      y,
      { width: RIGHT - MARGIN, align: "center" },
    );
  });

/* ---------------- sample PDF (WhatsApp template header example) ---------------- */

const buildSamplePdf = () =>
  toBuffer((doc) => {
    doc
      .font("Helvetica-Bold")
      .fontSize(22)
      .fillColor("#0f172a")
      .text(COMPANY(), MARGIN, MARGIN);

    doc.moveDown(1);
    doc.fontSize(16).text("Sample Invoice");

    doc.moveDown(1);
    doc.font("Helvetica").fontSize(11).fillColor("#334155");
    doc.text("Invoice No: SI001");
    doc.text("Customer: Sample Customer");
    doc.text("Date: 01 Jan 2026");
    doc.text("Total: Rs. 1,000.00");

    doc.moveDown(2);
    doc
      .fontSize(9)
      .fillColor("#94a3b8")
      .text("This is a sample document used for template approval.");
  });

module.exports = { buildInvoicePdf, buildSamplePdf };