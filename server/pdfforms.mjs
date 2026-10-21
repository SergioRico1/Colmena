import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFString,
  PDFTextField,
  StandardFonts,
} from "pdf-lib";

// PDF forms with pdf-lib, adapted from OpenMuse packages/integrations/src/pdf.ts (MIT,
// licenses/OpenMuse.txt): inspect the fields, fill a COPY (the original is never written),
// strip every action/JavaScript entry point of the copy, refuse encrypted and XFA forms.

export const PDF_FORM_LIMITS = Object.freeze({ maxBytes: 10 * 1024 * 1024, maxPages: 500, maxFields: 500, maxValue: 10000 });

export class PdfFormError extends Error {
  constructor(message) {
    super(message);
    this.name = "PdfFormError";
    this.status = 422;
  }
}

async function guarded(operation, fallback) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PdfFormError) throw error;
    throw new PdfFormError(fallback);
  }
}

async function loadPdf(bytes) {
  if (!bytes?.length || bytes.length > PDF_FORM_LIMITS.maxBytes || Buffer.from(bytes.subarray(0, 1024)).indexOf("%PDF-") < 0)
    throw new PdfFormError("No es un PDF válido (máximo 10 MB).");
  try {
    const doc = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
    if (doc.isEncrypted) throw new PdfFormError("El PDF está cifrado: no se puede rellenar.");
    if (doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict)?.has(PDFName.of("XFA")))
      throw new PdfFormError("Es un formulario XFA (de Adobe LiveCycle): no se puede rellenar desde Colmena.");
    if (doc.getPageCount() < 1 || doc.getPageCount() > PDF_FORM_LIMITS.maxPages) throw new PdfFormError("El PDF debe tener entre 1 y 500 páginas.");
    return doc;
  } catch (error) {
    if (error instanceof PdfFormError) throw error;
    if (/encrypt/i.test(error?.message || "")) throw new PdfFormError("El PDF está cifrado: no se puede rellenar.");
    throw new PdfFormError("El PDF está dañado o mal formado.");
  }
}

const fieldType = (field) =>
  field instanceof PDFTextField ? "text" : field instanceof PDFCheckBox ? "checkbox" : field instanceof PDFDropdown ? "dropdown"
    : field instanceof PDFOptionList ? "list" : field instanceof PDFRadioGroup ? "radio" : "unsupported";

function inspectField(field, doc) {
  const name = field.getName();
  const type = fieldType(field);
  const pages = doc.getPages();
  const page = (() => {
    try {
      const ref = field.acroField.getWidgets()[0]?.P();
      const index = ref ? pages.findIndex((p) => p.ref === ref) : -1;
      return index >= 0 ? index + 1 : null;
    } catch { return null; }
  })();
  const base = { name, type, page, required: !!field.isRequired?.(), readOnly: !!field.isReadOnly?.() };
  if (field instanceof PDFTextField) {
    const value = field.acroField.dict.lookup(PDFName.of("V"));
    if (value !== undefined && !(value instanceof PDFString) && !(value instanceof PDFHexString))
      throw new PdfFormError("Un campo de texto del PDF tiene un valor mal formado.");
    return { ...base, value: field.getText() ?? "", maxLength: field.getMaxLength() ?? null };
  }
  if (field instanceof PDFCheckBox) return { ...base, value: field.isChecked() ? "sí" : "no" };
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return { ...base, value: field.getSelected().join(", "), options: field.getOptions().slice(0, 100) };
  if (field instanceof PDFRadioGroup) return { ...base, value: field.getSelected() ?? "", options: field.getOptions().slice(0, 100) };
  return { ...base, value: "" };
}

/** {pageCount, fields:[{name, type, value, page, required, readOnly, options?, maxLength?}]}. */
export async function inspectPdf(bytes) {
  return guarded(async () => {
    const doc = await loadPdf(bytes);
    const fields = doc.getForm().getFields();
    if (fields.length > PDF_FORM_LIMITS.maxFields) throw new PdfFormError("El formulario tiene demasiados campos.");
    return { pageCount: doc.getPageCount(), fields: fields.map((f) => inspectField(f, doc)) };
  }, "No se pudieron leer los campos: el PDF tiene campos dañados o no admitidos.");
}

/** Every action / JavaScript entry point of the new copy is removed: the output never runs scripts. */
function removeActions(doc) {
  const visited = new Set();
  const visit = (object) => {
    if (!object || visited.has(object)) return;
    visited.add(object);
    if (object instanceof PDFDict) {
      for (const key of ["OpenAction", "AA", "A", "JS", "JavaScript"]) object.delete(PDFName.of(key));
      for (const value of object.values()) visit(value);
    } else if (object instanceof PDFArray) for (const value of object.asArray()) visit(value);
  };
  for (const [, object] of doc.context.enumerateIndirectObjects()) visit(object);
}

const YES = /^(s[ií]|si|yes|true|x|1|on|marcad[oa]|verdadero)$/i;
const NO = /^(no|false|0|off|desmarcad[oa]|falso|)$/i;

/** Normalizes values {campo: valor} against the form; throws a clear error for each problem. */
export function normalizeValues(fields, values) {
  const byName = new Map(fields.map((f) => [f.name, f]));
  const out = [];
  for (const [name, raw] of Object.entries(values || {})) {
    const field = byName.get(name);
    if (!field) throw new PdfFormError(`El PDF no tiene un campo «${name}». Usa pdf_fields para ver los nombres exactos.`);
    if (field.readOnly) throw new PdfFormError(`El campo «${name}» es de solo lectura.`);
    if (field.type === "checkbox") {
      const text = typeof raw === "boolean" ? (raw ? "sí" : "no") : String(raw ?? "").trim();
      if (!YES.test(text) && !NO.test(text)) throw new PdfFormError(`La casilla «${name}» necesita sí o no.`);
      out.push({ name, type: field.type, value: YES.test(text) });
      continue;
    }
    if (typeof raw !== "string" && typeof raw !== "number") throw new PdfFormError(`El campo «${name}» necesita un texto.`);
    const value = String(raw);
    if (value.length > PDF_FORM_LIMITS.maxValue) throw new PdfFormError(`El valor de «${name}» es demasiado largo.`);
    if (field.type === "text" && field.maxLength && value.length > field.maxLength) throw new PdfFormError(`«${name}» admite como máximo ${field.maxLength} caracteres.`);
    if (["dropdown", "list", "radio"].includes(field.type) && value && !field.options.includes(value))
      throw new PdfFormError(`«${name}» solo admite: ${field.options.slice(0, 12).join(", ")}.`);
    if (field.type === "unsupported") throw new PdfFormError(`El campo «${name}» es de un tipo que no se puede rellenar (firma o botón).`);
    out.push({ name, type: field.type, value });
  }
  if (!out.length) throw new PdfFormError("Indica al menos un campo que rellenar.");
  return out;
}

/** Fills a copy: returns {bytes, filled:[{name, type, value}]}. The input buffer is not modified. */
export async function fillPdf(bytes, values) {
  return guarded(async () => {
    const doc = await loadPdf(bytes);
    const form = doc.getForm();
    const fields = form.getFields().map((f) => inspectField(f, doc));
    const filled = normalizeValues(fields, values);
    for (const item of filled) {
      const field = form.getField(item.name);
      if (field instanceof PDFTextField) field.setText(item.value);
      else if (field instanceof PDFCheckBox) item.value ? field.check() : field.uncheck();
      else if (field instanceof PDFDropdown || field instanceof PDFOptionList) item.value ? field.select(item.value) : field.clear();
      else if (field instanceof PDFRadioGroup) item.value ? field.select(item.value) : field.clear();
    }
    removeActions(doc);
    try {
      form.updateFieldAppearances(await doc.embedFont(StandardFonts.Helvetica));
      return { bytes: Buffer.from(await doc.save()), filled };
    } catch {
      throw new PdfFormError("No se pudieron dibujar los valores: usa caracteres que admita la fuente del formulario (sin emojis ni alfabetos no latinos).");
    }
  }, "No se pudo rellenar: el PDF tiene campos dañados o no admitidos.");
}

/** PNG preview of one page (pdfjs + @napi-rs/canvas). Throws {code:'NO_PREVIEW'} if rendering is not available. */
export async function renderPdfPage(bytes, pageNumber = 1, { width = 900 } = {}) {
  const { openPdf } = await import("./documents.mjs");
  const { task, pdf } = await openPdf(bytes);
  try {
    if (pageNumber < 1 || pageNumber > pdf.numPages) throw Object.assign(Error("Página fuera del documento."), { status: 404 });
    const page = await pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, Math.max(0.5, width / base.width)) });
    let surface;
    try { surface = pdf.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height)); }
    catch { throw Object.assign(Error("La vista previa de PDF no está disponible en este equipo."), { code: "NO_PREVIEW", status: 501 }); }
    await page.render({ canvasContext: surface.context, viewport, canvas: surface.canvas }).promise;
    const png = surface.canvas.toBuffer("image/png");
    return { png, pages: pdf.numPages };
  } finally {
    await task.destroy().catch(() => {});
  }
}
