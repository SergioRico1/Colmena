// Draws a page Colmena generated (a presentation, a document) in a hidden window: one PNG per
// slide, the PDF, and the boxes whose text does not fit — what OpenAI's and Anthropic's slide
// skills check by rendering and looking. A document is printed on its own A4 pages (`page`).
// The page is Colmena's own (escaped text, embedded images); it never
// reaches the network.
const { BrowserWindow, session } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const PARTITION = "colmena-render";
let guarded = false;

function guard() {
  if (guarded) return;
  guarded = true;
  const ses = session.fromPartition(PARTITION);
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(file|data):/i.test(details.url) }));
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * {htmlPath, outDir, width, height, count, shots, pdf, page?: {footer}} → {shots: [file], pdf: file|null, overflow: [{slide, what}]}
 * With `page` the PDF takes its size and margins from the page's CSS (@page) and prints
 * `page.footer` (Chromium's template: .pageNumber, .totalPages) on every page.
 * Files are written in outDir (the mission's folder); only names come back.
 */
async function render(args = {}) {
  const width = Number(args.width) || 1280, height = Number(args.height) || 720, count = Math.min(60, Math.max(1, Number(args.count) || 1));
  const htmlPath = String(args.htmlPath || ""), outDir = String(args.outDir || "");
  if (!path.isAbsolute(htmlPath) || !path.isAbsolute(outDir) || !/\.html$/i.test(htmlPath)) throw Error("Ruta de renderizado no válida.");
  guard();
  const win = new BrowserWindow({
    show: false, width, height, useContentSize: true, paintWhenInitiallyHidden: true,
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, offscreen: false, backgroundThrottling: false },
  });
  try {
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    await win.loadFile(htmlPath);
    await win.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
    // The height of the lines themselves, not scrollHeight: with a tight line height the glyphs
    // of a big title stick out a few pixels and would count as text that does not fit.
    const overflow = await win.webContents.executeJavaScript(`[...document.querySelectorAll('[data-check]')]
      .filter((el) => {
        if (!el.dataset.check || el.tagName === 'TABLE') return false;
        const kids = [...el.children];
        if (!kids.length) return false;
        const top = Math.min(...kids.map((c) => c.offsetTop)), bottom = Math.max(...kids.map((c) => c.offsetTop + c.offsetHeight));
        return bottom - top > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2;
      })
      .map((el) => ({ slide: Number(el.dataset.slide) || 0, what: el.dataset.check }))`);
    const shots = [];
    if (args.shots) {
      await fs.mkdir(outDir, { recursive: true });
      for (let n = 1; n <= count; n++) {
        await win.webContents.executeJavaScript(`window.scrollTo(0, ${(n - 1) * height}); true`);
        await sleep(120);
        const image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
        const name = `diapositiva-${String(n).padStart(2, "0")}.png`;
        await fs.writeFile(path.join(outDir, name), image.toPNG());
        shots.push(name);
      }
    }
    let pdf = null;
    if (args.pdf) {
      const page = args.page && typeof args.page === "object" ? args.page : null;
      const bytes = await win.webContents.printToPDF(page
        ? {
          printBackground: true, preferCSSPageSize: true, generateDocumentOutline: true, generateTaggedPDF: true,
          displayHeaderFooter: !!page.footer, headerTemplate: "<span></span>", footerTemplate: String(page.footer || "<span></span>"),
        }
        : {
          printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 },
          pageSize: { width: width / 96, height: height / 96 },
        });
      pdf = String(args.pdfName || "presentacion.pdf").replace(/[\\/:*?"<>|]+/g, "-");
      await fs.writeFile(path.join(outDir, pdf), bytes);
    }
    return { shots, pdf, overflow };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = { render };
