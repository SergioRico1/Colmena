// «Traer las conversaciones de la nube» (server/cloud-import.mjs): a company's export from hosted
// Colmena becomes private rooms on this computer with their history, threads and files; bots are
// not asked to work; bringing it again adds nothing twice.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import JSZip from "jszip";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { Connections } from "../server/connections.mjs";
import { Rooms } from "../server/room.mjs";
import { cloudText, importExport, previewExport } from "../server/cloud-import.mjs";
import { roomTimeline } from "../server/room-timeline.mjs";

const ANA = "11111111-1111-4111-8111-111111111111", BETO = "22222222-2222-4222-8222-222222222222";
const GENERAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", DM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function exportZip() {
  const zip = new JSZip();
  zip.file("workspace.json", JSON.stringify({ id: "ws-1", name: "K Global", exportedAt: "2026-11-17T10:00:00Z", format: "colmena-export-1" }));
  zip.file("people.json", JSON.stringify({ members: [{ id: ANA, name: "Ana Ruiz" }, { id: BETO, name: "Beto Gil" }], ghosts: [] }));
  zip.file("channels.json", JSON.stringify([{ id: GENERAL, kind: "public", name: "general", members: [ANA, BETO] }, { id: DM, kind: "dm", members: [ANA, BETO] }]));
  const at = Date.UTC(2026, 10, 16, 9, 0);
  zip.file(`channels/general-${GENERAL}/messages-0000.json`, JSON.stringify([
    { id: "m1", seq: 1, author: ANA, at, text: "Hola <@" + BETO + ">, mira *esto* &lt;ya&gt;", files: [{ id: "f1", name: "ventas.csv" }] },
    { id: "m2", seq: 2, author: "bot:nora", botName: "Nora", at: at + 60000, text: "**Hecho**: te lo dejo en el hilo.", format: "md", threadId: "m1" },
    { id: "m3", seq: 3, author: BETO, at: at + 120000, text: "Gracias <https://colmena.team|la web>" },
  ]));
  zip.file(`channels/dm-${DM}/messages-0000.json`, JSON.stringify([{ id: "d1", seq: 1, author: BETO, at, text: "¿Comemos?" }]));
  zip.file("files/f1-ventas.csv", "ciudad,importe\nMadrid,48200\n");
  return zip.generateAsync({ type: "nodebuffer" });
}

test("the cloud's text becomes the rooms' Markdown", () => {
  const names = { [BETO]: "Beto Gil" };
  assert.equal(cloudText("Hola <@" + BETO + ">, mira *esto* y ~eso~ &lt;ya&gt; <https://a.es|aquí> <!channel>", (id) => names[id] || "?"), "Hola @Beto Gil, mira **esto** y ~~eso~~ <ya> [aquí](https://a.es) @canal");
});

test("a company's export becomes private rooms here with their history, threads and files, once", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-import-"));
  const store = new Store(dir);
  store.patch("settings", "main", { model: "fixture", learning: false, userName: "Ana Ruiz" });
  const runtime = new Runtime(store, { respond: async () => { throw Error("no model should run"); } }, new Connections(store, { dispatch: async () => ({}) }));
  const rooms = new Rooms({ store, runtime, getPeers: () => null, log: () => {} }).start();
  t.after(async () => { rooms.stop(); await runtime.shutdown(); store.close(); await rm(dir, { recursive: true, force: true }); });
  const zip = await exportZip();

  const preview = await previewExport(zip);
  assert.equal(preview.company, "K Global");
  assert.deepEqual(preview.channels.map((c) => [c.title, c.messages]), [["general", 3], ["Ana Ruiz, Beto Gil", 1]]);
  assert.deepEqual(preview.members.map((p) => p.name), ["Ana Ruiz", "Beto Gil"]);

  const out = await importExport(zip, { store, rooms, runtime, me: ANA });
  assert.deepEqual(out.rooms.map((r) => [r.title, r.added]), [["#general · K Global", 3], ["Beto Gil · K Global", 1]]);
  assert.equal(out.files, 1);
  const general = out.rooms[0];
  const msgs = store.where("messages", "missionId", general.missionId).sort((a, b) => a.at.localeCompare(b.at));
  // Yours read «Tú»; the others keep their names; the bot its own; the thread a reply.
  assert.equal(msgs[0].role, "user");
  assert.equal(msgs[0].author, undefined);
  assert.equal(msgs[0].text, "Hola @Beto Gil, mira **esto** <ya>");
  assert.equal(msgs[1].role, "assistant");
  assert.equal(msgs[1].author.name, "Nora");
  assert.equal(msgs[1].replyTo, "nube:m1");
  assert.deepEqual([msgs[2].author.kind, msgs[2].author.name, msgs[2].text], ["person", "Beto Gil", "Gracias [la web](https://colmena.team)"]);
  // The file is in the room's folder, attached to its message.
  assert.equal(await readFile(path.join(runtime.root(general.missionId), msgs[0].attachments[0].path), "utf8"), "ciudad,importe\nMadrid,48200\n");
  // Nobody was asked to work, and the room is a room of this computer.
  assert.equal(store.get("missions", general.missionId).status, "completed");
  assert.ok(rooms.detail(general.roomId));

  // The room's timeline says who said it: you, Beto by name (never «Tú»).
  const tl = roomTimeline({ store, room: rooms.must(general.roomId), peers: null, me: rooms.me(), messageView: (m) => ({ id: m.id, role: m.role, text: m.text, at: m.at, replyTo: m.replyTo || null }), stepView: (x) => x, work: rooms.work });
  assert.deepEqual(tl.items.map((i) => [i.author.you ? "tú" : i.author.name, i.author.kind]), [["tú", "person"], ["Beto Gil", "person"]]);
  const again = await importExport(zip, { store, rooms, runtime, me: ANA });
  assert.deepEqual(again.rooms.map((r) => [r.roomId, r.added, r.kept]), [[general.roomId, 0, 3], [out.rooms[1].roomId, 0, 1]]);
});
