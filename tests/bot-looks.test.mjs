import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { applyOnboarding } from "../server/onboarding.mjs";
import { mentionedByName } from "../server/peers/bots.mjs";
import { addressees } from "../server/roomturns.mjs";
import { BOT_PALETTE, FACTORY, HONEY, INK, NAME_POOLS, amberish, ensureBotLooks, freeName, nextLook, seededLooks, undoBotLooks } from "../server/bot-looks.mjs";
import { botA11yName, botNameLabels, ownerBadgeText, ownerShort } from "../src/lib/identity.js";
import { compactBots, headerBots, memberPanel, mentionGroups, stackLabel } from "../src/lib/roomView.js";
import { resolveMentions } from "../src/lib/mentions.js";

const KEY_A = "pubkey-of-lucia-0001";
const KEY_B = "pubkey-of-sergio-0002";
const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Relative luminance and contrast (WCAG 2.x).
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("the palette: twelve distinct colours, never honey nor amber, 3:1 on the light surfaces", () => {
  assert.equal(BOT_PALETTE.length, 12);
  assert.equal(new Set(BOT_PALETTE.map(([c]) => c.toUpperCase())).size, 12);
  assert.ok(amberish(HONEY), "honey is amber");
  for (const [hex, name] of BOT_PALETTE) {
    assert.ok(name, "every colour has a name");
    assert.notEqual(hex.toUpperCase(), HONEY);
    assert.notEqual(hex.toUpperCase(), INK);
    assert.equal(amberish(hex), false, hex + " is not of the amber family");
    for (const surface of ["#FFFFFF", "#F5F5F2", "#F6F6F3"]) assert.ok(contrast(hex, surface) >= 3, `${hex} on ${surface}: ${contrast(hex, surface).toFixed(2)}`);
  }
});

test("name pools: 10-15 plain names per role, none twice, none of the factory names", () => {
  const all = Object.values(NAME_POOLS).flat().map(fold);
  assert.equal(new Set(all).size, all.length, "no name in two pools");
  const factory = Object.values(FACTORY).map((f) => fold(f.name));
  for (const [role, pool] of Object.entries(NAME_POOLS)) {
    assert.ok(pool.length >= 10 && pool.length <= 15, role);
    for (const n of pool) assert.ok(!factory.includes(fold(n)), n + " is a factory name");
  }
});

test("seeded looks are the same for the same key on any machine, distinct, and the coordinator stays ink", () => {
  const a = seededLooks(KEY_A), again = seededLooks(KEY_A), b = seededLooks(KEY_B);
  assert.deepEqual(a, again);
  assert.notDeepEqual(a, b, "two people get different bots");
  const ids = Object.keys(a);
  assert.equal(ids.length, 7);
  assert.equal(new Set(ids.map((id) => fold(a[id].name))).size, 7, "names distinct");
  assert.equal(a.atlas.color, INK);
  const colors = ids.filter((id) => id !== "atlas").map((id) => a[id].color.toUpperCase());
  assert.equal(new Set(colors).size, colors.length, "colours distinct");
  for (const c of colors) assert.ok(BOT_PALETTE.some(([p]) => p === c) && c !== HONEY);
  for (const id of ids) assert.ok(NAME_POOLS[id].includes(a[id].name), id + " name from its pool");
  // Many people: the six bots stay distinct for every one of them.
  for (let i = 0; i < 200; i++) {
    const l = seededLooks("key-" + i);
    const six = ["nora", "tomas", "iris", "vera", "bruno"].map((x) => l[x].color);
    assert.equal(new Set(six).size, 5);
  }
});

test("«Otro nombre» / «Otro color» walk the bot's own sequence and never land on one of yours", () => {
  const looks = seededLooks(KEY_A);
  const bots = Object.entries(looks).map(([id, l]) => ({ id, name: l.name, color: l.color, look: l.look, builtin: true }));
  const vera = bots.find((b) => b.id === "vera");
  const first = nextLook(KEY_A, vera, bots, "name");
  assert.deepEqual(nextLook(KEY_A, vera, bots, "name"), first, "reproducible");
  assert.notEqual(first.name, vera.name);
  // Walk the whole circle: never one of the others' names or colours, never honey.
  let cur = { ...vera };
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const n = nextLook(KEY_A, cur, bots, "name"), c = nextLook(KEY_A, cur, bots, "color");
    assert.ok(!bots.some((b) => b.id !== "vera" && fold(b.name) === fold(n.name)));
    assert.ok(!bots.some((b) => b.id !== "vera" && b.color === c.color));
    assert.notEqual(c.color, HONEY);
    seen.add(n.name);
    cur = { ...cur, name: n.name, color: c.color, look: { name: n.look.name, color: c.look.color } };
  }
  assert.ok(seen.size >= 10, "it goes round the whole pool");
  assert.equal(nextLook(KEY_A, bots.find((b) => b.id === "atlas"), bots, "color"), null, "the coordinator keeps its ink");
  assert.equal(nextLook(KEY_A, { id: "made-by-you", name: "Pepa", color: "#2F6BFF" }, bots, "name"), null);
});

async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-looks-"));
  const store = new Store(dir);
  const runtime = new Runtime(store, { respond: async () => { throw Error("no provider"); } });
  let origin;
  const server = http.createServer(createApp({ store, runtime, session: { status: () => null, models: [] }, getOrigin: () => origin }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  t.after(async () => {
    await runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const send = (method) => async (route, body = {}) => {
    const r = await fetch(origin + "/api" + route, { method, headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { store, dir, post: send("POST"), patch: send("PATCH") };
}

test("a new installation: every built-in bot gets its own name and colour once, from the key", async (t) => {
  const { store, post } = await setup(t);
  assert.equal(store.get("settings", "main").botLooks.state, "fresh");
  assert.equal(store.get("bots", "vera").name, "Vera", "nothing before the identity is known");
  assert.equal(ensureBotLooks(store, KEY_A), "fresh");
  const want = seededLooks(KEY_A);
  for (const id of ["atlas", "nora", "tomas", "iris", "vera", "bruno"]) {
    const b = store.get("bots", id);
    assert.equal(b.name, want[id].name);
    assert.equal(b.color, want[id].color);
  }
  assert.equal(store.get("bots", "atlas").shape, "hex");
  assert.equal(store.get("bots", "atlas").color, INK);
  assert.equal(store.get("settings", "main").botLooks.key, KEY_A);
  assert.equal(ensureBotLooks(store, KEY_B), null, "applied once: a later key changes nothing");
  // Leo arrives at onboarding with the look it was shown.
  const leo = store.get("settings", "main").botLooks.leo;
  applyOnboarding(store, "legal");
  assert.equal(store.get("bots", "leo").name, leo.name);
  assert.equal(store.get("bots", "leo").color, leo.color);
  // «Otro nombre»: the next of its sequence; the old name keeps resolving.
  const before = store.get("bots", "vera").name;
  const r = await post("/bots/vera/look", { what: "name" });
  assert.equal(r.status, 200);
  assert.notEqual(r.body.name, before);
  assert.deepEqual(store.get("bots", "vera").previousNames, [before]);
  const c = await post("/bots/vera/look", { what: "color" });
  assert.equal(c.status, 200);
  const colors = store.list("bots").filter((b) => b.enabled !== false || b.builtin).map((b) => b.color);
  assert.equal(new Set(colors).size, colors.length, "still no two alike");
  assert.equal((await post("/bots/atlas/look", { what: "color" })).status, 409);
});

test("an existing installation keeps its names; factory colours become its own, with «Deshacer»", async (t) => {
  const { store } = await setup(t);
  store.patch("settings", "main", { botLooks: { state: "update" } });
  store.patch("bots", "iris", { color: "#0E7C86" }); // a colour the person chose stays
  assert.equal(ensureBotLooks(store, KEY_B), "update");
  const looks = store.get("settings", "main").botLooks;
  assert.equal(looks.notice, true);
  for (const id of ["atlas", "nora", "tomas", "iris", "vera", "bruno"]) assert.equal(store.get("bots", id).name, FACTORY[id].name, "names kept");
  assert.equal(store.get("bots", "atlas").color, INK);
  assert.equal(store.get("bots", "iris").color, "#0E7C86");
  const mine = ["nora", "tomas", "vera", "bruno"].map((id) => store.get("bots", id).color);
  for (const [i, id] of ["nora", "tomas", "vera", "bruno"].entries()) assert.notEqual(mine[i], FACTORY[id].color);
  const all = store.list("bots").map((b) => b.color.toUpperCase());
  assert.equal(new Set(all).size, all.length, "all distinct, including the one you chose");
  assert.ok(!all.includes(HONEY));
  assert.equal(undoBotLooks(store), 4);
  for (const id of ["nora", "tomas", "vera", "bruno"]) assert.equal(store.get("bots", id).color, FACTORY[id].color);
  assert.equal(store.get("bots", "iris").color, "#0E7C86");
  assert.equal(store.get("settings", "main").botLooks.notice, false);
});

test("your bots never share a name (accents and case out), and a rename keeps the old one for «@»", async (t) => {
  const { store, post, patch } = await setup(t);
  const clash = await patch("/bots/nora", { name: "tomas" });
  assert.equal(clash.status, 422);
  assert.match(clash.body.error, /Ya tienes un bot que se llama Tomás/);
  const made = await post("/bots", { name: "VERA", role: "Otra", instructions: "Escribe cosas con cuidado y sin prisa.", color: "#2F6BFF", shape: "leaf" });
  assert.equal(made.status, 422);
  assert.equal((await patch("/bots/vera", { name: "Amaia" })).status, 200);
  assert.deepEqual(store.get("bots", "vera").previousNames, ["Vera"]);
  const dup = await post("/bots/nora/duplicate", {});
  assert.equal(dup.body.name, "Nora (copia)");
  const dup2 = await post("/bots/nora/duplicate", {});
  assert.equal(dup2.body.name, "Nora (copia) 2");
  assert.equal(freeName([{ name: "Ana" }], "ana"), "ana 2");
  // «@Vera» typed by hand still finds her, in a conversation with people and in a sala.
  const bots = store.list("bots");
  assert.deepEqual(mentionedByName("hola @Vera, mira", bots).map((b) => b.id), ["vera"]);
  assert.deepEqual(addressees("@vera revisa esto", bots.map((b) => ({ id: b.id, name: b.name, previousNames: b.previousNames }))), ["vera"]);
  // A current name always wins over a previous one.
  assert.deepEqual(mentionedByName("@vera", [{ id: "x", name: "Amaia", previousNames: ["Vera"] }, { id: "y", name: "Vera" }]).map((b) => b.id), ["y"]);
  assert.deepEqual(resolveMentions("@Vera mira", [], [{ id: "vera", name: "Amaia", previousNames: ["Vera"] }], "me").map((m) => m.bot), ["vera"]);
});

/* ───────────── the client: whose bot, said and drawn ───────────── */

const lucia = { address: "addr-lucia", name: "Lucía Martín" };
const lucia2 = { address: "addr-lucia-2", name: "Lucía Sanz" };
const sergio = { address: "addr-sergio", name: "Sergio Rico" };
const me = { address: "addr-me", name: "Ana", you: true };
const view = {
  id: "r1", title: "campaña", people: [{ ...me }, { ...lucia }, { ...sergio }],
  bots: [
    { owner: me, bots: [{ id: "vera", name: "Vera", role: "Redacción" }, { id: "nora", name: "Nora" }] },
    { owner: lucia, bots: [{ id: "vera", name: "Vera", role: "Redacción" }, { id: "iris", name: "Iris" }] },
    { owner: sergio, bots: [{ id: "vera", name: "vera" }] },
  ],
};

test("two visible bots with one name: «Vera · de Lucía»; yours never «de ti»; twin first names get an initial", () => {
  const names = botNameLabels(view.bots);
  assert.equal(names.label(me, { name: "Vera" }), "Vera");
  assert.equal(names.label(lucia, { name: "Vera" }), "Vera · de Lucía");
  assert.equal(names.label(sergio, { name: "vera" }), "vera · de Sergio");
  assert.equal(names.label(lucia, { name: "Iris" }), "Iris", "no clash, no owner in the name");
  const twins = botNameLabels([...view.bots, { owner: lucia2, bots: [{ id: "vera", name: "Vera" }] }]);
  assert.equal(twins.label(lucia, { name: "Vera" }), "Vera · de Lucía M.");
  assert.equal(twins.label(lucia2, { name: "Vera" }), "Vera · de Lucía S.");
  assert.equal(ownerShort(sergio, [lucia, lucia2, sergio]), "Sergio");
});

test("the owner's badge and the accessible name", () => {
  assert.equal(botA11yName({ name: "Vera" }, lucia), "Vera, bot de Lucía");
  assert.equal(botA11yName({ name: "Vera" }, me), "Vera, bot tuyo");
  assert.equal(ownerBadgeText(lucia, 20), "L");
  assert.equal(ownerBadgeText(lucia, 32), "LM");
});

test("member panel and header: names in sight, compact rows, «N bots» without a misleading subset", () => {
  const panel = memberPanel(view);
  const theirs = panel.groups.find((g) => g.owner === lucia);
  assert.equal(theirs.bots[0].shown, "Vera · de Lucía");
  assert.equal(theirs.bots[0].a11y, "Vera, bot de Lucía");
  assert.equal(theirs.bots[0].owner, lucia);
  assert.equal(panel.groups[0].bots[0].owner, null, "your own bots carry no badge");
  assert.equal(headerBots(panel).length, 5, "five or fewer: all of them");
  const big = memberPanel({ ...view, bots: [...view.bots, { owner: { address: "x", name: "Luis" }, bots: Array.from({ length: 6 }, (_, i) => ({ id: "b" + i, name: "B" + i })) }] });
  assert.equal(big.botCount, 11);
  assert.deepEqual(headerBots(big), [], "more than five: words only");
  assert.match(stackLabel(big), /11 bots: 2 tuyos, 2 de Lucía, 6 de Luis y 1 de Sergio/);
  const luis = big.groups.find((g) => g.label === "Bots de Luis");
  assert.equal(compactBots(luis.bots).shown.length, 6);
  const seven = [...luis.bots, { id: "b7", name: "B7", state: "working" }];
  const c = compactBots(seven);
  assert.equal(c.shown.length, 5);
  assert.equal(c.hidden, 2);
  assert.equal(c.shown[0].id, "b7", "busy ones first");
  assert.equal(compactBots(seven, true).shown.length, 7);
});

test("«@Vera» typed in full is yours; a teammate's Vera is the second option: «¿Vera, de Lucía?»", () => {
  const groups = mentionGroups({ view, query: "vera" });
  const items = groups.flatMap((g) => g.items);
  assert.equal(items[0].type, "bot");
  assert.equal(items[0].bot.id, "vera");
  assert.equal(items[1].type, "peerbot");
  assert.equal(items[1].ask, "¿Vera, de Lucía?");
  assert.equal(items[1].owner, lucia);
  assert.equal(items.filter((x) => x.key === items[1].key).length, 1, "not listed twice");
  // Only a partial name: no question, the usual groups.
  assert.ok(mentionGroups({ view, query: "ve" }).flatMap((g) => g.items).every((x) => !x.ask));
});
