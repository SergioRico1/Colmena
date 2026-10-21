import zlib from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";

/** Minimal ZIP writer for fixtures (stored or deflated entries). */
export function makeZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content, deflate = false] of entries) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const body = deflate ? zlib.deflateRawSync(data) : data;
    const nameBytes = Buffer.from(name, "utf8");
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
    local.writeUInt16LE(deflate ? 8 : 0, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(deflate ? 8 : 0, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const CT = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const RELS = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';

/** A .docx with one paragraph per string. */
export function makeDocx(paragraphs) {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</w:t></w:r></w:p>`).join("");
  const doc = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return makeZip([["[Content_Types].xml", CT], ["_rels/.rels", RELS], ["word/document.xml", doc, true]]);
}

/** An .xlsx with one sheet «Gastos»: shared strings, a number, a date-styled serial and a boolean. */
export function makeXlsx() {
  const workbook = '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Gastos &amp; ingresos" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const rels = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
  const shared = '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Fecha</t></si><si><t>Concepto</t></si><si><t>Importe</t></si><si><r><t>Super</t></r><r><t>mercado, &quot;centro&quot;</t></r></si></sst>';
  const styles = '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>';
  const sheet = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="inlineStr"><is><t>Pagado</t></is></c></row>' +
    '<row r="2"/>' +
    '<row r="3"><c r="A3" s="1"><v>45580</v></c><c r="B3" t="s"><v>3</v></c><c r="C3"><v>42.5</v></c><c r="D3" t="b"><v>1</v></c></row>' +
    '</sheetData></worksheet>';
  return makeZip([["xl/workbook.xml", workbook], ["xl/_rels/workbook.xml.rels", rels], ["xl/sharedStrings.xml", shared, true], ["xl/styles.xml", styles], ["xl/worksheets/sheet1.xml", sheet, true]]);
}

/** A tiny valid PNG (w×h, white RGB). */
export function makePng(width = 4, height = 3) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** PDF with text on page 1 and an empty (scanned-like) page 2; optional form fields. */
export async function makePdf({ pages = ["Factura 2026-17\nTotal: 120,50 €", null], form = false } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const added = pages.map((text) => {
    const page = doc.addPage([600, 800]);
    if (text) text.split("\n").forEach((line, i) => page.drawText(line, { x: 50, y: 740 - i * 20, size: 14, font }));
    return page;
  });
  if (form) {
    const f = doc.getForm();
    const name = f.createTextField("nombre");
    name.addToPage(added[0], { x: 50, y: 600, width: 300, height: 24 });
    const dni = f.createTextField("dni");
    dni.setMaxLength(9);
    dni.addToPage(added[0], { x: 50, y: 560, width: 200, height: 24 });
    const ok = f.createCheckBox("acepto");
    ok.addToPage(added[0], { x: 50, y: 520, width: 16, height: 16 });
    const city = f.createDropdown("provincia");
    city.addOptions(["Madrid", "Valencia"]);
    city.addToPage(added[0], { x: 50, y: 480, width: 200, height: 24 });
    f.updateFieldAppearances(font);
  }
  return Buffer.from(await doc.save());
}
