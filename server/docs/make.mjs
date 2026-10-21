// create_document end to end: the editable .docx, the A4 page the viewer and the PDF come from,
// and one picture per page (the PDF printed in a hidden window of the desktop app, its pages
// drawn here with pdf.js).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createUniqueFile, safePath } from "../files.mjs";
import { renderPdfPage } from "../pdfforms.mjs";
import { buildDocument, documentMarkdown, documentOutline } from "./index.mjs";
import { footerTemplate, PAGE } from "./html.mjs";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_PICTURES = 40;

/**
 * {root, input, computer} → {doc, docx: {path, bytes}, folder, html, pdf, pages, shots, warnings, markdown, outline}
 * Paths are relative to the mission folder.
 */
export async function makeDocument({ root, input, computer = null, signal } = {}) {
  const built = await buildDocument(input, { root });
  const { doc, theme } = built;
  const docx = await createUniqueFile(root, "documentos", doc.title, "docx", await built.docx());
  // Its page, PDF and page pictures go next to it, in a folder with the same name.
  const folder = docx.path.replace(/\.docx$/, "");
  const html = folder + "/documento.html";
  const htmlTarget = await safePath(root, html, { parent: true });
  await mkdir(path.dirname(htmlTarget), { recursive: true });
  await writeFile(htmlTarget, built.html());
  const warnings = [];
  let pdf = null, pages = null, shots = [];
  if (computer?.available) {
    try {
      const outDir = path.dirname(htmlTarget);
      const r = await computer.call("render", {
        htmlPath: htmlTarget, outDir, width: PAGE.width, height: PAGE.height, count: 1, shots: false, pdf: true,
        pdfName: path.basename(folder) + ".pdf", page: { footer: footerTemplate(doc, theme) },
      }, { signal });
      pdf = r.pdf ? folder + "/" + r.pdf : null;
    } catch (e) {
      warnings.push("No pude imprimir el documento en PDF para revisarlo (" + e.message + "). El .docx está guardado.");
    }
  }
  if (pdf) {
    try {
      const bytes = await readFile(path.join(root, pdf));
      for (let n = 1; n <= MAX_PICTURES; n++) {
        const { png, pages: total } = await renderPdfPage(bytes, n, { width: 1100 });
        pages = total;
        const name = `pagina-${String(n).padStart(2, "0")}.png`;
        await writeFile(path.join(path.dirname(htmlTarget), name), png);
        shots.push(folder + "/" + name);
        if (n >= total) break;
      }
    } catch (e) {
      if (!shots.length) warnings.push("No pude dibujar las páginas para la vista previa (" + e.message + ").");
    }
  }
  return { doc, built, docx, folder, html, pdf, pages, shots, warnings, markdown: documentMarkdown(doc), outline: documentOutline(doc) };
}
