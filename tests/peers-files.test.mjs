// Files shared with people (server/peers/files.mjs): sealed with a key only the conversation
// has, left at the mailbox in parts it cannot read, checked on arrival and shown with a viewer
// that only reads plain data out of them.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../server/store.mjs";
import { Peers, dmId } from "../server/peers/service.mjs";
import { PeerFiles, cleanName } from "../server/peers/files.mjs";
import { startRelay } from "../relay/server.mjs";

const until = async (fn, what, ms = 10000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw Error("No llegó a cumplirse: " + what);
    await new Promise((r) => setTimeout(r, 30));
  }
};

async function world(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), "colmena-files-"));
  const relay = await startRelay({ port: 0, directory: path.join(base, "relay") });
  const people = [];
  for (const name of ["Sergio Rico", "Marta Ruiz"]) {
    const store = new Store(path.join(base, name.split(" ")[0]));
    const peers = await new Peers({ store, vault: null, relayUrl: relay.url, nameOf: () => name, notifier: { notify() {} }, log: () => {} }).start();
    peers.files = new PeerFiles({ peers, store }).start();
    people.push({ name, store, peers });
  }
  t.after(async () => {
    for (const p of people) { p.peers.files.stop(); p.peers.stop(); }
    await new Promise((r) => setTimeout(r, 300));
    for (const p of people) p.store.close();
    await relay.close();
    await rm(base, { recursive: true, force: true });
  });
  await until(() => people.every((p) => p.peers.relayStatus.status === "online"), "conectados");
  const [a, b] = people;
  const inv = await a.peers.createInvite(b.name);
  await b.peers.acceptInvite(inv.code);
  await until(() => a.peers.contact(b.peers.address)?.status === "active" && b.peers.contact(a.peers.address)?.status === "active", "contactos");
  return { people, base, relay, dm: dmId(a.peers.address, b.peers.address) };
}

test("a file travels sealed in parts, arrives whole, and the mailbox never had it readable", async (t) => {
  const { people: [sergio, marta], base, dm } = await world(t);
  // 2.5 MB: three parts. A marker that must never be readable at the mailbox.
  const bytes = Buffer.alloc(2_500_000, 7);
  bytes.write("SECRETO-DEL-PRESUPUESTO", 1000);
  const { message, file } = await sergio.peers.files.send(dm, { name: "../../presupuesto final.txt", bytes, caption: "El presupuesto" });
  assert.equal(file.name, "presupuesto final.txt");
  assert.equal(message.file.kind, "text");
  assert.equal(message.card.kind, "file");
  assert.equal(message.card.file, undefined, "the browser never gets the key");
  await until(() => marta.store.get("peerFiles", file.id)?.status === "ready", "llega a Marta");
  const got = marta.peers.files.pathOf(file.id);
  const { readFile } = await import("node:fs/promises");
  assert.ok((await readFile(got.path)).equals(bytes));
  assert.equal(marta.store.get("peerFiles", file.id).key, null, "the key is dropped once the file is here");
  const view = marta.peers.messages(dm).messages.at(-1);
  assert.equal(view.text, "El presupuesto");
  assert.equal(view.file.status, "ready");
  assert.equal(view.file.mine, false);
  // The mailbox: three sealed parts, no trace of the text.
  const db = new DatabaseSync(path.join(base, "relay", "relay.sqlite"));
  const parts = db.prepare("SELECT data FROM blob_parts WHERE id=?").all(file.id);
  db.close();
  assert.equal(parts.length, 3);
  assert.ok(!Buffer.concat(parts.map((p) => Buffer.from(p.data))).includes("SECRETO-DEL-PRESUPUESTO"));
  // Without the read token nobody downloads it.
  await assert.rejects(marta.peers.client.getBlob(file.id, 0, "otro"), /no existe/);
  // Deleted for everyone: it goes from the mailbox and from Marta's Colmena.
  sergio.peers.unsend(message.id);
  await until(() => !marta.store.get("peerFiles", file.id), "se borra en Marta");
  await assert.rejects(sergio.peers.client.getBlob(file.id, 0, "x"), /no existe/);
});

test("what can be shared, and the viewer: Word text, workbook values, slides' text, PDF pages", async (t) => {
  const { people: [sergio, marta], dm } = await world(t);
  await assert.rejects(sergio.peers.files.send(dm, { name: "instalar.exe", bytes: Buffer.from("MZ") }), /no se puede compartir/);
  await assert.rejects(sergio.peers.files.send(dm, { name: "grande.pdf", bytes: Buffer.alloc(26 * 1024 * 1024) }), /25 MB/);
  assert.equal(cleanName("C:\\x\\..\\informe<1>.docx"), "informe-1-.docx");

  const { Document, Packer, Paragraph, HeadingLevel } = await import("docx");
  const doc = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ text: "Informe trimestral", heading: HeadingLevel.HEADING_1 }), new Paragraph("Las ventas suben un 12 %.")] }] }));
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Ventas");
  ws.addRow(["Mes", "Total"]); ws.addRow(["Enero", 1200]); ws.addRow(["Febrero", { formula: "B2*2", result: 2400 }]);
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
  const PptxGenJS = (await import("pptxgenjs")).default;
  const deck = new PptxGenJS();
  deck.addSlide().addText("Plan de lanzamiento", { x: 1, y: 1 });
  deck.addSlide().addText("Fechas clave", { x: 1, y: 1 });
  const pptx = Buffer.from(await deck.write({ outputType: "nodebuffer" }));
  const { PDFDocument } = await import("pdf-lib");
  const pdfDoc = await PDFDocument.create(); pdfDoc.addPage(); pdfDoc.addPage();
  const pdf = Buffer.from(await pdfDoc.save());

  const sent = {};
  for (const [name, bytes] of [["informe.docx", doc], ["ventas.xlsx", xlsx], ["lanzamiento.pptx", pptx], ["contrato.pdf", pdf]]) sent[name] = (await sergio.peers.files.send(dm, { name, bytes })).file.id;
  // A deliverable with its PDF: shown as its pages.
  sent.deck = (await sergio.peers.files.send(dm, { name: "propuesta.pptx", bytes: pptx, view: pdf })).file.id;
  await until(() => Object.values(sent).every((id) => marta.store.get("peerFiles", id)?.status === "ready"), "llegan todos");

  const w = await marta.peers.files.preview(sent["informe.docx"]);
  assert.equal(w.show, "doc");
  assert.deepEqual(w.blocks.slice(0, 2).map((b) => b.t + ":" + b.text), ["h:Informe trimestral", "p:Las ventas suben un 12 %."]);
  const x = await marta.peers.files.preview(sent["ventas.xlsx"]);
  assert.equal(x.sheets[0].name, "Ventas");
  assert.deepEqual(x.sheets[0].rows.map((r) => r.cells.join("|")), ["Mes|Total", "Enero|1200", "Febrero|2400"]);
  const p = await marta.peers.files.preview(sent["lanzamiento.pptx"]);
  assert.deepEqual(p.slides.map((s) => s.title), ["Plan de lanzamiento", "Fechas clave"]);
  assert.equal((await marta.peers.files.preview(sent["contrato.pdf"])).pages, 2);
  const d = await marta.peers.files.preview(sent.deck);
  assert.equal(d.show, "pdf");
  assert.equal(d.pages, 2);
});

test("an old file is gone from the mailbox: the person is told to ask for it again", async (t) => {
  const { people: [sergio, marta], relay, dm } = await world(t);
  marta.peers.files.fetchLater = () => {}; // she is not fetching yet
  const { file } = await sergio.peers.files.send(dm, { name: "foto.png", bytes: Buffer.from("not really a png") });
  await until(() => marta.store.get("peerFiles", file.id), "llega el aviso");
  // Seven days later: the mailbox's sweep took it.
  await sergio.peers.client.deleteBlob(file.id);
  await marta.peers.files.download(file.id);
  assert.equal(marta.store.get("peerFiles", file.id).status, "expired");
  assert.match(marta.store.get("peerFiles", file.id).error, /pídeselo otra vez/);
  assert.ok(relay.url);
});
