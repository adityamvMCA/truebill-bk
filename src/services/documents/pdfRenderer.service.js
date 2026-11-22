const puppeteer = require("puppeteer");
const { createDocToken } = require("./documentToken");

/* One shared browser, reused for every document */
let browserPromise;
const getBrowser = () => {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      })
      .then((browser) => {
        browser.on("disconnected", () => {
          browserPromise = null;
        });
        return browser;
      })
      .catch((error) => {
        browserPromise = null;
        throw error;
      });
  }
  return browserPromise;
};

/* Limit concurrent renders so a burst cannot exhaust memory */
const MAX = Math.max(1, Number(process.env.PDF_MAX_PARALLEL) || 2);
let active = 0;
const waiters = [];
const acquire = () =>
  new Promise((resolve) => {
    const go = () => {
      active += 1;
      resolve();
    };
    active < MAX ? go() : waiters.push(go);
  });
const release = () => {
  active -= 1;
  waiters.shift()?.();
};

const DEBUG = process.env.PDF_DEBUG !== "false"; // set PDF_DEBUG=false to silence

/* -> PDF Buffer, rendered with the tenant's saved template */
const renderDocumentPdf = async ({ tenantId, docType, ref }) => {
  if (!process.env.FRONTEND_URL) throw new Error("FRONTEND_URL is missing");

  const token = createDocToken({ tenantId, docType, ref, ttlMinutes: 10 });
  const url = `${process.env.FRONTEND_URL.replace(/\/$/, "")}/print/${docType}/${encodeURIComponent(token)}`;

  await acquire();
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 1400 });
    await page.emulateMediaType("screen");

    if (DEBUG) {
      page.on("console", (m) => console.log("[print page]", m.type(), m.text()));
      page.on("pageerror", (e) => console.log("[print page] CRASH:", e.message));
      page.on("requestfailed", (r) =>
        console.log("[print page] request failed:", r.url(), r.failure()?.errorText),
      );
      page.on("response", (r) => {
        if (r.status() >= 400) console.log("[print page] HTTP", r.status(), r.url());
      });
    }

    // domcontentloaded: networkidle0 can hang with the Vite dev server
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });

    try {
      await page.waitForFunction(
        "window.__PDF_READY__ === true || window.__PDF_ERROR__ === true",
        { timeout: 20000 },
      );
    } catch {
      const where = page.url();
      const text = await page
        .evaluate(() => document.body.innerText.slice(0, 200))
        .catch(() => "");
      const error = new Error(
        `Print page never became ready. URL: ${where} | Page text: "${text}"`,
      );
      error.retryable = false; // a config problem, not a temporary glitch
      throw error;
    }

    if (await page.evaluate(() => window.__PDF_ERROR__ === true)) {
      const detail = await page.evaluate(() => window.__PDF_ERROR_MSG__ || "").catch(() => "");
      const error = new Error(`Print page could not render the document. ${detail}`.trim());
      error.retryable = false;
      throw error;
    }

    const paper = await page.evaluate(() => window.__PDF_PAPER__);
    if (!paper?.w || !paper?.h) throw new Error("Print page did not report a paper size");

    const pdf = await page.pdf({
      width: `${paper.w}mm`,
      height: `${paper.h}mm`,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    return Buffer.from(pdf);
  } finally {
    await page?.close().catch(() => {});
    release();
  }
};

module.exports = { renderDocumentPdf };