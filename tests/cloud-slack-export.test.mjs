import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, openZip, bufferSource, partsSource, zipStream, zipBytes } from "../server/cloud/zip.mjs";
import { classifyExport, parseUsers, parseConversations, convertText, emojiFor, normalizeMessage, tsToMs, dayOf } from "../server/cloud/slack-export.mjs";
import { buildSyntheticExport, syntheticExpectations } from "../server/cloud/slack-synthetic.mjs";

const enc = new TextEncoder();
const dec = new TextDecoder();

function pseudoRandomBytes(n, seed = 7) {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

const big = new Uint8Array(3 * 1024 * 1024);
for (let i = 0; i < big.length; i++) big[i] = (i * 31 + (i >> 10)) & 0xff;
const randomish = pseudoRandomBytes(200_000);

const SAMPLE = [
  { name: "hola.txt", data: "Hola, mundo" },
  { name: "carpeta/", data: null },
  { name: "carpeta/año-ñandú-😀.txt", data: "nombre UTF-8", deflate: true },
  { name: "vacío.txt", data: "" },
  { name: "vacío-deflate.txt", data: new Uint8Array(0), deflate: true },
  { name: "grande.bin", data: big, deflate: true },
  { name: "grande-stored.bin", data: big },
  { name: "aleatorio.bin", data: randomish, deflate: true },
  {
    name: "stream.txt",
    data: () =>
      new ReadableStream({
        start(c) {
          c.enqueue(enc.encode("uno "));
          c.enqueue("dos ");
          c.enqueue(enc.encode("tres"));
          c.close();
        },
      }),
    deflate: true,
  },
];
const expected = (e) => (e.name === "stream.txt" ? enc.encode("uno dos tres") : typeof e.data === "string" ? enc.encode(e.data) : e.data || new Uint8Array(0));

function python() {
  for (const cmd of ["python", "python3"]) {
    const r = spawnSync(cmd, ["-I", "-c", "import zipfile;print('ok')"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.includes("ok")) return cmd;
  }
  return null;
}
const PYTHON = python();

function pythonRead(bytes) {
  const dir = mkdtempSync(join(tmpdir(), "colmena-zip-"));
  try {
    const file = join(dir, "a.zip");
    writeFileSync(file, bytes);
    const script = "import zipfile,sys,json,hashlib\nz=zipfile.ZipFile(sys.argv[1])\nbad=z.testzip()\nprint(json.dumps({'bad':bad,'entries':[[i.filename,i.file_size,hashlib.sha256(z.read(i)).hexdigest()] for i in z.infolist()]}))";
    const r = spawnSync(PYTHON, ["-I", "-c", script, file], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------------------------
// ZIP

test("crc32 matches the standard check value and is incremental", () => {
  const data = enc.encode("123456789");
  assert.equal(crc32(data), 0xcbf43926);
  assert.equal(crc32(data.subarray(4), crc32(data.subarray(0, 4))), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test("zip round trip: stored, deflated, UTF-8 names, empty files, a 3 MB entry, a stream", async () => {
  const bytes = await zipBytes(SAMPLE);
  const zip = await openZip(bufferSource(bytes));
  assert.deepEqual(
    zip.entries.map((e) => e.name),
    SAMPLE.map((e) => e.name),
  );
  for (const [i, entry] of zip.entries.entries()) {
    assert.equal(entry.isDirectory, SAMPLE[i].name.endsWith("/"));
    assert.equal(entry.method, SAMPLE[i].deflate ? 8 : 0);
    if (entry.isDirectory) continue;
    const data = await zip.readEntry(entry);
    assert.deepEqual(data, expected(SAMPLE[i]), entry.name);
    assert.equal(entry.crc32, crc32(data));
  }
  const grande = zip.entries.find((e) => e.name === "grande.bin");
  assert.ok(grande.compressedSize < grande.size / 4, "the 3 MB entry is deflated");
  // streamEntry gives the same bytes in pieces.
  const chunks = [];
  for await (const chunk of zip.streamEntry(grande)) chunks.push(chunk);
  assert.equal(
    chunks.reduce((n, c) => n + c.length, 0),
    big.length,
  );
});

test("zip: the data offset comes from the local header", async () => {
  const bytes = await zipBytes([{ name: "a.txt", data: "abc" }]);
  const zip = await openZip(bufferSource(bytes));
  assert.equal(await zip.dataOffset(zip.entries[0]), 30 + "a.txt".length);
});

test("zip: a corrupted byte is caught by the CRC (stored) or the inflater/CRC (deflate)", async () => {
  const bytes = await zipBytes([
    { name: "a.txt", data: "contenido que se va a romper" },
    { name: "b.bin", data: randomish, deflate: true },
  ]);
  const zip = await openZip(bufferSource(bytes));
  const broken = bytes.slice();
  broken[(await zip.dataOffset(zip.entries[0])) + 3] ^= 0xff;
  const brokenZip = await openZip(bufferSource(broken));
  await assert.rejects(brokenZip.readEntry(brokenZip.entries[0]), /CRC/);
  const broken2 = bytes.slice();
  broken2[(await zip.dataOffset(zip.entries[1])) + 5000] ^= 0x55;
  const brokenZip2 = await openZip(bufferSource(broken2));
  await assert.rejects(brokenZip2.readEntry(brokenZip2.entries[1]));
});

test("zip: partsSource stitches uneven parts into the same archive", async () => {
  const bytes = await zipBytes(SAMPLE);
  const cuts = [0, 1234, 1234 + 2_000_000, bytes.length];
  const parts = cuts.slice(0, -1).map((start, i) => bufferSource(bytes.subarray(start, cuts[i + 1])));
  const source = partsSource(parts);
  assert.equal(source.size, bytes.length);
  assert.deepEqual(await source.read(1200, 100), bytes.subarray(1200, 1300));
  const zip = await openZip(source);
  const plain = await openZip(bufferSource(bytes));
  assert.deepEqual(
    zip.entries.map((e) => [e.name, e.size, e.crc32, e.headerOffset]),
    plain.entries.map((e) => [e.name, e.size, e.crc32, e.headerOffset]),
  );
  for (const entry of zip.entries) if (!entry.isDirectory) assert.equal(entry.crc32, crc32(await zip.readEntry(entry)));
});

test("zip: maxBytes refuses big entries and a lying size stops the inflater", async () => {
  const bytes = await zipBytes([{ name: "grande.bin", data: big, deflate: true }]);
  const zip = await openZip(bufferSource(bytes));
  await assert.rejects(zip.readEntry(zip.entries[0], { maxBytes: 1024 * 1024 }), /more than/);
  // A central directory that understates the size (a zip bomb's trick).
  const lying = { ...zip.entries[0], size: 1000 };
  await assert.rejects(zip.readEntry(lying), /past its declared/);
});

test("zip: encrypted entries and unknown methods are refused", async () => {
  const bytes = await zipBytes([{ name: "a.txt", data: "x" }]);
  const zip = await openZip(bufferSource(bytes));
  await assert.rejects(zip.readEntry({ ...zip.entries[0], encrypted: true }), /encrypted/);
  await assert.rejects(zip.readEntry({ ...zip.entries[0], method: 12 }), /method 12/);
  await assert.rejects(openZip(bufferSource(enc.encode("no soy un zip, solo texto suelto"))), /not a ZIP/);
});

test("zip: an archive comment and a CP437 name are read", async () => {
  // Hand-built: one stored entry with flag bit 11 unset and a CP437 name, plus a comment.
  const name = Uint8Array.of(0x61, 0xa4, 0x6f, 0x2e, 0x74, 0x78, 0x74); // "año.txt" in CP437
  const data = enc.encode("hola");
  const crc = crc32(data);
  const local = new Uint8Array(30 + name.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, name.length, true);
  local.set(name, 30);
  const central = new Uint8Array(46 + name.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, name.length, true);
  central.set(name, 46);
  const comment = enc.encode("un comentario");
  const eocd = new Uint8Array(22 + comment.length);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length + data.length, true);
  ev.setUint16(20, comment.length, true);
  eocd.set(comment, 22);
  const bytes = new Uint8Array([...local, ...data, ...central, ...eocd]);
  const zip = await openZip(bufferSource(bytes));
  assert.equal(zip.entries[0].name, "año.txt");
  assert.equal(dec.decode(await zip.readEntry(zip.entries[0])), "hola");
});

test("zip: forced ZIP64 records are written and parsed", async () => {
  const bytes = await zipBytes(SAMPLE, { zip64: true });
  // The EOCD saturates its fields and a ZIP64 locator precedes it.
  const tail = new DataView(bytes.buffer, bytes.length - 22);
  assert.equal(tail.getUint32(0, true), 0x06054b50);
  assert.equal(tail.getUint16(10, true), 0xffff);
  assert.equal(tail.getUint32(12, true), 0xffffffff);
  assert.equal(tail.getUint32(16, true), 0xffffffff);
  assert.equal(new DataView(bytes.buffer, bytes.length - 42).getUint32(0, true), 0x07064b50);
  const zip = await openZip(bufferSource(bytes));
  assert.equal(zip.entries.length, SAMPLE.length);
  for (const [i, entry] of zip.entries.entries()) {
    if (entry.isDirectory) continue;
    assert.deepEqual(await zip.readEntry(entry), expected(SAMPLE[i]));
  }
});

test("zip: more than 65535 entries switches to ZIP64 on its own", async () => {
  const count = 65_540;
  async function* many() {
    for (let i = 0; i < count; i++) yield { name: `f/${i}`, data: i % 1000 === 0 ? String(i) : "" };
  }
  const bytes = await zipBytes(many());
  assert.equal(new DataView(bytes.buffer, bytes.length - 22).getUint16(10, true), 0xffff);
  const zip = await openZip(bufferSource(bytes));
  assert.equal(zip.entries.length, count);
  assert.equal(zip.entries.at(-1).name, `f/${count - 1}`);
  assert.equal(dec.decode(await zip.readEntry(zip.entries[65_000])), "65000");
});

test("zip: Python's zipfile reads what zipStream writes (plain and ZIP64)", { skip: !PYTHON && "no Python" }, async () => {
  for (const zip64 of [false, true]) {
    const bytes = await zipBytes(SAMPLE, { zip64 });
    const result = pythonRead(bytes);
    assert.equal(result.bad, null);
    assert.deepEqual(
      result.entries.map((e) => e[0]),
      SAMPLE.map((e) => e.name),
    );
    for (const [i, [, size, hash]] of result.entries.entries()) {
      const want = expected(SAMPLE[i]);
      assert.equal(size, want.length);
      assert.equal(hash, await sha256(want));
    }
  }
});

test("zip: the streamed writer can be read as a stream", async () => {
  const stream = zipStream([{ name: "a.txt", data: "abc", deflate: true }]);
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  const zip = await openZip(bufferSource(bytes));
  assert.equal(dec.decode(await zip.readEntry(zip.entries[0])), "abc");
});

// ---------------------------------------------------------------------------------------------
// Slack export

let synthetic;
async function syntheticZip() {
  synthetic ??= (async () => {
    const bytes = await buildSyntheticExport();
    const zip = await openZip(bufferSource(bytes));
    const json = async (name) => JSON.parse(dec.decode(await zip.readEntry(zip.entries.find((e) => e.name === name))));
    return { bytes, zip, json };
  })();
  return synthetic;
}

test("synthetic export is deterministic for a seed", async () => {
  const a = await buildSyntheticExport({ seed: 3 });
  const b = await buildSyntheticExport({ seed: 3 });
  const c = await buildSyntheticExport({ seed: 4 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test("classifyExport finds the files, conversations and uploads", async () => {
  const { zip } = await syntheticZip();
  const info = classifyExport(zip.entries.map((e) => e.name));
  assert.equal(info.format, "business");
  assert.equal(info.users, "users.json");
  assert.equal(info.channels, "channels.json");
  assert.equal(info.groups, "groups.json");
  assert.equal(info.dms, "dms.json");
  assert.equal(info.mpims, "mpims.json");
  assert.deepEqual([...info.conversations.keys()].sort(), ["D0SYN0001", "direccion", "general", "mpdm-ana--beto--gil-1", "random"]);
  assert.deepEqual(info.conversations.get("general"), ["general/2024-03-04.json", "general/2024-03-05.json", "general/2024-03-06.json"]);
  assert.deepEqual([...info.uploads], [["F0SYN0001", "__uploads/F0SYN0001/informe.txt"]]);

  // Standard export, day files out of order, inside a top folder.
  const nested = classifyExport(["Export/", "Export/users.json", "Export/channels.json", "Export/general/2024-02-01.json", "Export/general/2023-12-31.json", "Export/integration_logs.json"]);
  assert.equal(nested.format, "standard");
  assert.equal(nested.root, "Export/");
  assert.equal(nested.users, "Export/users.json");
  assert.equal(nested.groups, null);
  assert.deepEqual(nested.conversations.get("general"), ["Export/general/2023-12-31.json", "Export/general/2024-02-01.json"]);
  assert.equal(dayOf("general/2024-02-01.json"), "2024-02-01");
});

test("parseUsers reads people, outsiders, the bot and the deleted user", async () => {
  const { json } = await syntheticZip();
  const users = parseUsers(await json("users.json"));
  assert.equal(users.length, 7);
  const ana = users.find((u) => u.email === "ana@example.com");
  assert.equal(ana.name, "Ana");
  assert.equal(ana.handle, "ana");
  assert.equal(ana.tz, "Europe/Madrid");
  assert.equal(ana.isBot, false);
  assert.match(ana.avatarColor, /^#[0-9a-f]{6}$/);
  assert.equal(users.filter((u) => u.email?.endsWith("@example.net")).length, 2);
  const bot = users.find((u) => u.isBot);
  assert.equal(bot.email, null);
  assert.equal(bot.name, "Informes");
  assert.equal(users.find((u) => u.deleted).email, "fran@example.org");
  // Name falls back through display_name, real_name, name; emails are lowercased.
  const [one] = parseUsers(JSON.stringify([{ id: "U9", name: "zeta", real_name: "Zeta Real", profile: { display_name: "", email: "Zeta@Example.COM" } }]));
  assert.equal(one.name, "Zeta Real");
  assert.equal(one.email, "zeta@example.com");
  assert.equal(one.title, null);
});

test("parseConversations covers every kind", async () => {
  const { json } = await syntheticZip();
  const convs = parseConversations({ channels: await json("channels.json"), groups: await json("groups.json"), dms: await json("dms.json"), mpims: await json("mpims.json") });
  assert.deepEqual(
    convs.map((c) => [c.kind, c.folder, c.name]),
    [
      ["public", "general", "general"],
      ["public", "random", "random"],
      ["private", "direccion", "direccion"],
      ["dm", "D0SYN0001", null],
      ["group", "mpdm-ana--beto--gil-1", "mpdm-ana--beto--gil-1"],
    ],
  );
  const general = convs[0];
  assert.equal(general.topic, "Avisos de todo el equipo");
  assert.equal(general.purpose, "Lo que nos afecta a todos");
  assert.equal(general.createdAt, 1704103200000);
  assert.equal(general.general, true);
  assert.equal(general.members.length, 5);
  assert.deepEqual(convs[3].members, ["U0SYN0001", "U0SYN0002"]);
  assert.deepEqual(parseConversations({ channels: [] }), []);
});

test("convertText maps markup and emoji, keeps links, entities and code", () => {
  const ctx = { user: (id, label) => `<@P-${id}>${label ? `(${label})` : ""}`, channel: (id, label) => `<#R-${id}|${label ?? "?"}>` };
  const cases = [
    ["Hola <@U1>", "Hola <@P-U1>"],
    ["Hola <@U1|ana>", "Hola <@P-U1>(ana)"],
    ["en <#C1|random> y <#C2>", "en <#R-C1|random> y <#R-C2|?>"],
    ["<!channel> <!everyone> <!here>", "<!channel> <!channel> <!here>"],
    ["<!subteam^S1|@diseño> mira", "@diseño mira"],
    ["<!date^1392734382^{date_short}|Feb 18, 2014>", "Feb 18, 2014"],
    ["<https://example.com/doc|el documento> <https://example.com> <mailto:a@example.com|a@example.com>", "<https://example.com/doc|el documento> <https://example.com> <mailto:a@example.com|a@example.com>"],
    ["a &lt;b&gt; &amp; c", "a &lt;b&gt; &amp; c"],
    [":+1: :thumbsup: :heart: :tada: :partyparrot:", "👍 👍 ❤️ 🎉 :partyparrot:"],
    [":wave::skin-tone-3: hola", "👋 hola"],
    ["a las 10:30:smile:", "a las 10:30😄"],
    ["usa `:smile:` o ```\n:tada: <@U1>\n``` :smile:", "usa `:smile:` o ```\n:tada: <@P-U1>\n``` 😄"],
    ["<https://example.com/:smile:/x|:smile:>", "<https://example.com/:smile:/x|:smile:>"],
  ];
  for (const [input, output] of cases) assert.equal(convertText(input, ctx), output, input);
  // Without callbacks mentions stay as they are.
  assert.equal(convertText("<@U1> <#C1|random>"), "<@U1> <#C1|random>");
  assert.equal(convertText(null), "");
});

test("emojiFor knows the common shortcodes", () => {
  for (const name of ["+1", "thumbsup", "-1", "heart", "joy", "smile", "tada", "white_check_mark", "eyes", "fire", "rocket", "pray", "clap", "100", "ok_hand", "raised_hands", "thinking_face", "wave", "slightly_smiling_face", "grinning", "sweat_smile", "sob", "rolling_on_the_floor_laughing", "heavy_check_mark", "x", "warning", "bulb", "memo", "calendar", "coffee", "beers", "party_popper"]) {
    assert.ok(emojiFor(name), name);
  }
  assert.equal(emojiFor("+1::skin-tone-4"), "👍");
  assert.equal(emojiFor("partyparrot"), null);
});

test("normalizeMessage: skips, threads, broadcast, edits, reactions, files, bot", async () => {
  assert.equal(tsToMs("1709546400.123456"), 1709546400123);
  for (const subtype of ["channel_join", "channel_leave", "group_join", "group_leave", "channel_purpose", "channel_topic", "channel_name", "channel_archive", "channel_unarchive", "pinned_item", "bot_add", "bot_remove", "tombstone"]) {
    assert.equal(normalizeMessage({ type: "message", subtype, user: "U1", text: "x", ts: "1.000001" }), null, subtype);
  }
  assert.equal(normalizeMessage({ type: "message", hidden: true, ts: "1.0" }), null);
  assert.equal(normalizeMessage(null), null);

  const { zip, json } = await syntheticZip();
  const days = classifyExport(zip.entries.map((e) => e.name)).conversations.get("general");
  const raw = [];
  for (const day of days) raw.push(...(await json(day)));
  const msgs = raw.map(normalizeMessage).filter(Boolean);
  assert.equal(msgs.length, 13);
  const root = msgs.find((m) => m.isRoot);
  assert.equal(root.threadTs, null);
  const replies = msgs.filter((m) => m.threadTs === root.ts);
  assert.equal(replies.length, 3);
  assert.equal(replies.filter((m) => m.broadcast).length, 1);
  const edited = msgs.find((m) => m.editedAt);
  assert.ok(edited.editedAt > edited.at);
  assert.match(edited.text, /<!here>/);
  const reacted = msgs.find((m) => m.reactions.length === 2);
  assert.deepEqual(
    reacted.reactions.map((r) => [r.name, r.emoji, r.users.length]),
    [
      ["+1", "👍", 2],
      ["tada", "🎉", 1],
    ],
  );
  assert.deepEqual(
    msgs.find((m) => m.pinned).reactions.map((r) => r.emoji),
    [":partyparrot:"],
  );
  const bot = msgs.find((m) => m.botName);
  assert.equal(bot.botName, "informes");
  assert.equal(bot.user, null);
  const files = msgs.flatMap((m) => m.files);
  assert.deepEqual(
    files.map((f) => [f.id, f.name, f.mimetype, f.external]),
    [
      ["F0SYN0001", "informe.txt", "text/plain", false],
      ["F0SYN0002", "presupuesto.pdf", "application/pdf", false],
    ],
  );
  assert.ok(files.every((f) => f.url?.startsWith("https://")));
  assert.equal(msgs.find((m) => m.files.length).text, "Os dejo el informe de la semana");
  // Timestamps increase within the conversation.
  for (let i = 1; i < msgs.length; i++) assert.ok(Number(msgs[i].ts) > Number(msgs[i - 1].ts));
  // External file and legacy `file`.
  const ext = normalizeMessage({ type: "message", user: "U1", ts: "2.0", file: { id: "F9", name: "doc", mode: "external", permalink: "https://example.org/doc" } });
  assert.deepEqual(ext.files, [{ id: "F9", name: "doc", title: "doc", mimetype: null, size: null, url: "https://example.org/doc", external: true }]);
});

test("syntheticExpectations agrees with a walk of the archive", async () => {
  for (const opts of [{}, { bigChannelMessages: 2345, seed: 9, people: [{ name: "Íñigo", email: "inigo@example.com" }, { name: "Beto", email: "BETO@example.com" }, { name: "Gil", email: "gil@example.com" }, { name: "Ona", email: "ona@example.com" }] }]) {
    const bytes = await buildSyntheticExport(opts);
    const want = syntheticExpectations(opts);
    const zip = await openZip(bufferSource(bytes));
    const read = async (name) => (name ? JSON.parse(dec.decode(await zip.readEntry(zip.entries.find((e) => e.name === name)))) : null);
    const info = classifyExport(zip.entries.map((e) => e.name));
    const users = parseUsers(await read(info.users));
    const people = new Set((opts.people || [{ email: "ana@example.com" }, { email: "beto@example.com" }, { email: "gil@example.com" }]).map((p) => p.email.toLowerCase()));
    const convs = parseConversations({ channels: await read(info.channels), groups: await read(info.groups), dms: await read(info.dms), mpims: await read(info.mpims) });
    const got = {
      users: users.length,
      people: people.size,
      matchedByEmail: users.filter((u) => u.email && people.has(u.email)).length,
      outsiders: users.filter((u) => u.email?.endsWith("@example.net")).length,
      bots: users.filter((u) => u.isBot).length,
      deleted: users.filter((u) => u.deleted).length,
      conversations: { public: 0, private: 0, dm: 0, group: 0, total: convs.length },
      dayFiles: 0,
      messages: 0,
      messagesByFolder: {},
      skipped: 0,
      threads: 0,
      replies: 0,
      broadcasts: 0,
      reactions: 0,
      reactionUsers: 0,
      edited: 0,
      pinned: 0,
      botMessages: 0,
      files: { total: 0, held: 0, linked: 0 },
      uploads: info.uploads.size,
    };
    for (const c of convs) got.conversations[c.kind]++;
    for (const c of convs) {
      got.messagesByFolder[c.folder] = 0;
      for (const day of info.conversations.get(c.folder) || []) {
        got.dayFiles++;
        const list = await read(day);
        if (c.folder === "historico") assert.ok(list.length <= 1000);
        for (const raw of list) {
          const m = normalizeMessage(raw);
          if (!m) {
            got.skipped++;
            continue;
          }
          got.messages++;
          got.messagesByFolder[c.folder]++;
          if (m.isRoot) got.threads++;
          if (m.threadTs) got.replies++;
          if (m.broadcast) got.broadcasts++;
          if (m.botName) got.botMessages++;
          if (m.editedAt) got.edited++;
          if (m.pinned) got.pinned++;
          got.reactions += m.reactions.length;
          got.reactionUsers += m.reactions.reduce((n, r) => n + r.users.length, 0);
          for (const f of m.files) {
            got.files.total++;
            if (info.uploads.has(f.id)) got.files.held++;
            else got.files.linked++;
          }
        }
      }
    }
    assert.deepEqual(got, want);
    if (opts.bigChannelMessages) {
      assert.equal(want.messagesByFolder.historico, 2345);
      assert.equal(info.conversations.get("historico").length, 3);
      assert.equal(want.people, 4);
      assert.equal(want.matchedByEmail, 4);
    } else {
      assert.equal(want.messages, 23);
      assert.equal(want.uploads, 1);
      const held = await zip.readEntry(zip.entries.find((e) => e.name === info.uploads.get("F0SYN0001")));
      assert.equal(dec.decode(held), "Informe semanal\nTodo en orden.\n");
    }
  }
});
