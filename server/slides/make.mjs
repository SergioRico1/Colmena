// create_presentation end to end: the editable .pptx, the page the viewer and the PDF come
// from, one picture per slide and what does not fit (measured in a hidden window when the
// desktop app is there; estimated otherwise).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createUniqueFile, safePath } from "../files.mjs";
import { buildDeck, deckOutline } from "./index.mjs";
import { H, W } from "./layout.mjs";

export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/**
 * {root, input, computer} → {deck, pptx: {path, bytes}, folder, html, shots, pdf, warnings, outline}
 * Paths are relative to the mission folder.
 */
export async function makePresentation({ root, input, computer = null, signal } = {}) {
  const built = await buildDeck(input, { root });
  const { deck } = built;
  const bytes = await built.pptx();
  const pptx = await createUniqueFile(root, "presentaciones", deck.title, "pptx", bytes);
  // Its pictures, page and PDF go next to it, in a folder with the same name.
  const folder = pptx.path.replace(/\.pptx$/, "");
  const html = folder + "/presentacion.html";
  const htmlTarget = await safePath(root, html, { parent: true });
  await mkdir(path.dirname(htmlTarget), { recursive: true });
  await writeFile(htmlTarget, built.html());
  const warnings = [...built.warnings];
  let shots = [], pdf = null;
  if (computer?.available) {
    try {
      const outDir = path.dirname(htmlTarget);
      const r = await computer.call("render", {
        htmlPath: htmlTarget, outDir, width: W, height: H, count: deck.slides.length, shots: true, pdf: true,
        pdfName: path.basename(folder) + ".pdf",
      }, { signal });
      shots = (r.shots || []).map((n) => folder + "/" + n);
      pdf = r.pdf ? folder + "/" + r.pdf : null;
      for (const o of r.overflow || []) {
        const line = `Diapositiva ${o.slide}: ${o.what} no cabe; recórtalo o reparte el contenido en dos diapositivas.`;
        if (!warnings.includes(line)) warnings.push(line);
      }
    } catch (e) {
      warnings.push("No pude dibujar las diapositivas para revisarlas (" + e.message + "). El .pptx está guardado.");
    }
  }
  return { deck, built, pptx, folder, html, shots, pdf, warnings, outline: deckOutline(deck) };
}
