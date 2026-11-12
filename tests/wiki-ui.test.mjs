import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

// The screens of «Notas» (docs/CONTRACT.md §16): the pure helpers behind them
// (src/lib/wikiLinks.js: links for drawing and for the editor's `[[` menu, the diff view
// model, the map's layout, the import preview), checked against the server's own reading of
// links (server/wiki.mjs), the batched link resolver (src/lib/wikiResolve.js) mounted in a
// linkedom document, and the guard that holds a navigation while a note has unsaved changes.

const { window, document } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, Event: window.Event, CustomEvent: window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });

const L = await import("../src/lib/wikiLinks.js");
const server = await import("../server/wiki.mjs");
const { diffText } = await import("../server/linediff.mjs");

// ------------------------------------------------------------------ links
const SAMPLE = [
  "# Acme",
  "Ver [[Plan 2027]] y [[Plan 2027|el plan]], [[clientes/Beta S.L.]], [[Guía#Paso 2]] y ![[Anexo]].",
  "No: `[[en código]]`, \\[[escapado]], [[#Apartado]], ![[foto.png]].",
  "```",
  "[[en bloque]]",
  "```",
  "| a | b |",
  "|---|---|",
  "| [[Tabla|con barra]] | x |",
].join("\n");

test("the links found for drawing are the ones the server counts, in the same places", () => {
  const found = L.findLinks(SAMPLE);
  assert.deepEqual(found.map((l) => [l.name, l.text, l.heading, l.embed]), [
    ["Plan 2027", "Plan 2027", null, false], ["Plan 2027", "el plan", null, false], ["Beta S.L.", "Beta S.L.", null, false],
    ["Guía", "Guía", "Paso 2", false], ["Anexo", "Anexo", null, true], ["Tabla", "con barra", null, false],
  ]);
  // Same names as server/wiki.mjs parseLinks (which lists each one once).
  assert.deepEqual([...new Set(found.map((l) => L.slugOf(l.name)))], server.parseLinks(SAMPLE).map((l) => l.slug));
  for (const l of found) assert.equal(SAMPLE.slice(l.start, l.end).replace(/^!/, "").startsWith("[["), true);
  assert.deepEqual(L.linkTargets(SAMPLE), ["Plan 2027", "clientes/Beta S.L.", "Guía#Paso 2", "Anexo", "Tabla"]);
});

test("the client slug is the server's for names with Latin letters or digits", () => {
  for (const name of ["Año 2024 · Acme, S.L.", "  Plan 2027 ", "Straße", "ÁÉÍ óú ñ", "a--b__c", "x".repeat(120)]) assert.equal(L.slugOf(name), server.slugOf(name), name);
  assert.equal(L.maskCode(SAMPLE), server.maskCode(SAMPLE));
});

test("linkifyNotes writes each link as a Markdown link and leaves code, escapes and files alone", () => {
  const out = L.linkifyNotes(SAMPLE);
  assert.match(out, /Ver \[Plan 2027\]\(#nota:Plan%202027\) y \[el plan\]\(#nota:Plan%202027\)/);
  assert.match(out, /\[Beta S\.L\.\]\(#nota:clientes%2FBeta%20S\.L\.\)/);
  assert.match(out, /\[Guía\]\(#nota:Gu%C3%ADa%23Paso%202\)/);
  assert.match(out, /`\[\[en código\]\]`, \\\[\[escapado\]\], \[\[#Apartado\]\], !\[\[foto\.png\]\]/);
  assert.match(out, /```\n\[\[en bloque\]\]\n```/);
  // In a table the `|` of the link no longer splits the cell.
  assert.match(out, /\| \[con barra\]\(#nota:Tabla\) \| x \|/);
  assert.equal(L.linkifyNotes("sin enlaces [x](y)"), "sin enlaces [x](y)");
  assert.equal(L.linkifyNotes("[[a*b_c]]"), "[a\\*b\\_c](#nota:a*b_c)");
  assert.equal(L.noteOfHref("#nota:clientes%2FBeta%20S.L."), "clientes/Beta S.L.");
  assert.equal(L.noteOfHref("#file:x"), null);
  assert.deepEqual(L.targetName("clientes/Beta S.L.#Contacto|texto"), { name: "Beta S.L.", heading: "Contacto" });
  assert.equal(L.noteUrl("acme-s-l"), "/biblioteca/notas/acme-s-l");
  assert.equal(L.plainLinks("Ver [[Plan 2027]], [[Acme S.L.|el cliente]] y [[clientes/Beta#Contacto]]."), "Ver Plan 2027, el cliente y Beta.");
  assert.equal(L.bodyWithoutTitle("# Acme S.L.\n\nCliente.", "Acme S.L."), "Cliente.");
  assert.equal(L.bodyWithoutTitle("# Otra cosa\n\nCliente.", "Acme S.L."), "# Otra cosa\n\nCliente.");
  assert.equal(L.bodyWithoutTitle("## Acme S.L.\nx", "Acme S.L."), "## Acme S.L.\nx");
  assert.equal(L.noteUrl("Plan 2027", "editar"), "/biblioteca/notas/Plan%202027?ver=editar");
});

test("the `[[` menu opens only inside an open link, and offers titles, aliases and a new note", () => {
  const at = (text) => L.linkTrigger(text, text.length);
  assert.deepEqual(at("Ver [[Pla"), { start: 6, query: "Pla" });
  assert.deepEqual(at("[["), { start: 2, query: "" });
  assert.equal(at("Ver [[Plan]] y"), null, "closed");
  assert.equal(at("Ver [[Plan|el"), null, "after the bar the text is free");
  assert.equal(at("Ver [[Plan\nsigue"), null, "another line");
  assert.equal(at("Ver \\[[Plan"), null, "escaped");
  assert.equal(at("```\n[[Pla"), null, "inside a code block");
  assert.equal(at("un `x` y `[[Pla` "), null);
  assert.equal(L.linkTrigger("Ver [[Pla y más", 9)?.query, "Pla");

  const pages = [
    { slug: "plan-2027", title: "Plan 2027", aliases: ["Estrategia"], folder: "planes" },
    { slug: "acme-s-l", title: "Acme S.L.", aliases: ["Acme"], folder: "clientes" },
    { slug: "explanada", title: "Explanada", aliases: [], folder: "" },
  ];
  assert.deepEqual(L.linkOptions(pages, "pla").map((o) => [o.kind, o.title]), [["page", "Plan 2027"], ["page", "Explanada"], ["new", "pla"]]);
  assert.deepEqual(L.linkOptions(pages, "ESTRAT").map((o) => [o.kind, o.title, o.alias]), [["page", "Plan 2027", "Estrategia"], ["new", "ESTRAT", undefined]]);
  // The exact name of a page (or of an alias) is not offered as a new note.
  assert.deepEqual(L.linkOptions(pages, "acme s.l.").map((o) => o.kind), ["page"]);
  assert.deepEqual(L.linkOptions(pages, "Acme").map((o) => o.kind), ["page"]);
  assert.deepEqual(L.linkOptions(pages, "").map((o) => o.kind), ["page", "page", "page"]);
  assert.deepEqual(L.linkOptions(pages, "Nueva cosa").map((o) => [o.kind, o.title]), [["new", "Nueva cosa"]]);

  const text = "Ver [[Pla y más";
  const done = L.completeLink(text, 9, L.linkTrigger(text, 9), "Plan 2027");
  assert.deepEqual(done, { text: "Ver [[Plan 2027]] y más", caret: 17 });
  // Brackets already closed after the caret are not doubled.
  assert.equal(L.completeLink("[[Pl]]", 4, { start: 2, query: "Pl" }, "Plan").text, "[[Plan]]");
});

// ------------------------------------------------------------------ diff
test("the diff view model reads the server's patch: rows, line numbers, counts", () => {
  const before = ["uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce"].join("\n");
  const after = before.replace("dos", "DOS").replace("once", "once\nonce y medio");
  const diff = diffText(before, after);
  const model = L.diffModel(diff);
  assert.equal(model.same, false);
  assert.equal(model.added, diff.added);
  assert.equal(model.removed, diff.removed);
  assert.deepEqual(model.rows.filter((r) => r.type === "del").map((r) => [r.a, r.text]), [[2, "dos"]]);
  assert.deepEqual(model.rows.filter((r) => r.type === "add").map((r) => [r.b, r.text]), [[2, "DOS"], [12, "once y medio"]]);
  assert.equal(model.rows.filter((r) => r.type === "gap").length, model.rows.some((r) => r.type === "gap") ? 1 : 0);
  assert.equal(L.diffSummary(model), "2 líneas nuevas, 1 quitada");
  // The same from the patch alone (an approval's `wiki.patch`).
  assert.deepEqual(L.diffModel(diff.patch).rows, model.rows);
  // Nothing changed.
  const none = L.diffModel(diffText(before, before));
  assert.equal(none.same, true);
  assert.equal(L.diffSummary(none), "Sin cambios");
  assert.equal(L.diffModel(null).same, true);
  assert.equal(L.diffModel({ patch: "@@ -1 +1 @@\n-a\n+b", added: 1, removed: 1, truncated: true }).truncated, true);
});

test("what a bot asks to do with a note, in words", () => {
  assert.equal(L.noteAskTitle({ title: "Acme", action: "create", create: true }), "Crear la nota «Acme»");
  assert.equal(L.noteAskTitle({ title: "Acme", action: "append" }), "Añadir texto a la nota «Acme»");
  assert.equal(L.noteAskTitle({ title: "Acme", action: "section", section: "Contacto" }), "Cambiar «Contacto» en la nota «Acme»");
  assert.equal(L.noteAskTitle({ title: "Acme", action: "replace" }), "Cambiar la nota «Acme»");
  assert.equal(L.byName({ kind: "person" }), "Tú");
  assert.equal(L.byName({ kind: "bot", botId: "nora", name: "Nora" }), "Nora");
});

// ------------------------------------------------------------------ graph
const GRAPH = {
  nodes: [
    { id: "acme", title: "Acme", exists: true, folder: "clientes", degree: 3 },
    { id: "plan", title: "Plan", exists: true, folder: "", degree: 2 },
    { id: "beta", title: "Beta", exists: true, folder: "clientes", degree: 1 },
    { id: "falta", title: "Falta", exists: false, folder: "", degree: 1 },
    { id: "sola", title: "Sola", exists: true, folder: "", degree: 0 },
  ],
  edges: [{ from: "acme", to: "plan" }, { from: "acme", to: "beta" }, { from: "plan", to: "falta" }, { from: "acme", to: "acme" }, { from: "acme", to: "no-esta" }],
};

test("the map is always the same picture for the same data, whatever order it arrives in", () => {
  const a = L.layoutGraph(GRAPH);
  const b = L.layoutGraph({ nodes: [...GRAPH.nodes].reverse(), edges: [...GRAPH.edges].reverse() });
  assert.deepEqual(a.nodes, b.nodes);
  assert.deepEqual(new Set(a.edges.map((e) => e.from + ">" + e.to)), new Set(b.edges.map((e) => e.from + ">" + e.to)));
  assert.deepEqual(L.layoutGraph(GRAPH), a, "no randomness between calls");
  // Loops and edges to notes that are not drawn are left out; every node is inside the box.
  assert.deepEqual(a.edges.map((e) => e.from + ">" + e.to).sort(), ["acme>beta", "acme>plan", "plan>falta"]);
  for (const n of a.nodes) assert.ok(n.x >= 0 && n.x <= 720 && n.y >= 0 && n.y <= 480, n.id);
  assert.equal(new Set(a.nodes.map((n) => n.x + "," + n.y)).size, a.nodes.length, "no two notes in the same place");
  // The most linked note sits nearer the middle and is drawn bigger.
  const dist = (n) => Math.hypot(n.x - 360, n.y - 240);
  const of = (id) => a.nodes.find((n) => n.id === id);
  assert.ok(dist(of("acme")) < dist(of("sola")));
  assert.ok(of("acme").r > of("sola").r);
  assert.deepEqual(L.layoutGraph(null), { nodes: [], edges: [] });
  assert.deepEqual(L.layoutGraph({ nodes: [GRAPH.nodes[0]], edges: [] }).nodes.map((n) => [n.x, n.y]), [[360, 240]]);
});

test("with a note in focus it is in the middle and the rest in rings by how many links away", () => {
  const g = L.layoutGraph(GRAPH, { focus: "acme" });
  const of = (id) => g.nodes.find((n) => n.id === id);
  assert.deepEqual([of("acme").x, of("acme").y, of("acme").level], [360, 240, 0]);
  assert.deepEqual([of("plan").level, of("beta").level, of("falta").level], [1, 1, 2]);
  assert.equal(of("sola").level, 3, "what is not connected goes to the outer ring");
  const dist = (n) => Math.hypot((n.x - 360) / (360 - 46), (n.y - 240) / (240 - 46));
  assert.ok(dist(of("plan")) < dist(of("falta")) && dist(of("falta")) < dist(of("sola")));
  assert.deepEqual(L.layoutGraph(GRAPH, { focus: "acme" }), g);
  // A focus that is not in the data falls back to the plain map.
  assert.deepEqual(L.layoutGraph(GRAPH, { focus: "nadie" }), L.layoutGraph(GRAPH));
});

// ------------------------------------------------------------------ import preview
test("the import preview says what would be created, changed, left alone and skipped", () => {
  const plan = {
    applied: false, planId: "p1",
    counts: { create: 2, update: 1, same: 1, skipped: 1, rejected: 1, attachments: 3, embeds: 1, ignored: 2, missing: 1 },
    create: [{ path: "Acme.md", title: "Acme", slug: "acme", folder: "", links: 1, size: 10 }, { path: "b/Acme.md", title: "Acme", slug: "acme-2", folder: "b", links: 0, size: 5, renamed: true }],
    update: [{ path: "Plan.md", title: "Plan", slug: "plan", folder: "", links: 0, size: 9 }],
    same: [{ path: "Igual.md", title: "Igual", slug: "igual", folder: "", links: 0, size: 3 }],
    skipped: [{ path: "enorme.md", reason: "Es demasiado grande." }], rejected: [{ path: "../fuera.md", reason: "Sale de la carpeta." }],
    missing: [{ slug: "falta", title: "Falta" }], truncated: false,
  };
  const m = L.importModel(plan);
  assert.equal(m.canApply, true);
  assert.equal(m.changes, 3);
  assert.equal(m.planId, "p1");
  assert.equal(m.headline, "2 notas nuevas · 1 cambia · 1 ya está igual");
  assert.deepEqual(m.groups.map((g) => [g.id, g.count, g.rows.length]), [["create", 2, 2], ["update", 1, 1], ["same", 1, 1], ["skipped", 2, 2]]);
  assert.match(m.groups[0].rows[1].note, /acme-2/);
  assert.deepEqual(m.groups[3].rows.map((r) => r.note), ["Es demasiado grande.", "Sale de la carpeta."]);
  assert.equal(m.notes.length, 4);
  assert.match(m.notes.join(" "), /3 archivos que no son notas \(imágenes y demás\) no se traen/);
  assert.match(L.importModel({ counts: { attachments: 1 } }).notes[0], /^1 archivo que no es una nota .* no se trae\.$/);
  assert.match(m.groups[1].hint, /historial/);
  // Applied: what was done.
  const done = L.importModel({ ...plan, applied: true, created: ["acme", "acme-2"], updated: ["plan"] });
  assert.equal(done.applied, true);
  assert.equal(done.canApply, false);
  assert.equal(done.headline, "2 notas nuevas y 1 actualizada");
  // Nothing to bring.
  const same = L.importModel({ applied: false, planId: "p2", counts: { create: 0, update: 0, same: 4 }, same: [] });
  assert.equal(same.canApply, false);
  assert.equal(same.headline, "Ya tienes todas estas notas, iguales");
  assert.equal(L.importModel({ counts: {} }).headline, "Aquí no hay notas que traer");
  assert.equal(L.importModel(null).canApply, false);
});

// ------------------------------------------------------------------ mounted: resolver and leave guard
const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");
const calls = [];
// The server answers only once the test lets it (so «before the answer» is not a race).
let answer;
const answered = new Promise((r) => { answer = r; });
globalThis.fetch = async (url, init = {}) => {
  if (String(url).endsWith("/api/bootstrap")) return { ok: true, status: 200, json: async () => ({ csrf: "t" }) };
  const body = JSON.parse(init.body || "{}");
  calls.push({ url: String(url), targets: body.targets });
  await answered;
  const results = Object.fromEntries(body.targets.map((t) => [t, t.startsWith("Falta") ? { slug: "falta", exists: false, title: t, archived: false } : { slug: server.slugOf(t.split("|")[0]), exists: true, title: t.toUpperCase(), archived: false }]));
  return { ok: true, status: 200, json: async () => ({ results }) };
};
const { useNoteTarget, refreshNoteLinks } = await import("../src/lib/wikiResolve.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Waits (inside act) until `cond()` holds, for at most 5 s. */
const until = (cond) => act(async () => { for (let i = 0; i < 500 && !cond(); i++) await wait(10); });

test("the links on screen are resolved in one call, kept, and asked again when the notes change", async () => {
  const node = document.createElement("div");
  document.body.appendChild(node);
  const root = createRoot(node);
  function Link({ target }) {
    const hit = useNoteTarget(target);
    return h("a", { "data-target": target, "data-state": !hit ? "?" : hit.exists ? "ok:" + hit.slug : "missing" }, hit?.title || target);
  }
  const all = (targets) => h("div", null, targets.map((t) => h(Link, { key: t, target: t })));
  await act(async () => root.render(all(["Acme", "Plan 2027", "Falta una"])));
  assert.deepEqual([...node.querySelectorAll("a")].map((a) => a.getAttribute("data-state")), ["?", "?", "?"], "plain links until the server answers");
  const states = () => [...node.querySelectorAll("a")].map((a) => a.getAttribute("data-state"));
  await until(() => calls.length === 1);
  assert.deepEqual(states(), ["?", "?", "?"], "still plain while the call is on its way");
  answer();
  await until(() => !states().includes("?"));
  assert.equal(calls.length, 1, "one call for every link drawn together");
  assert.deepEqual(calls[0].targets, ["Acme", "Plan 2027", "Falta una"]);
  assert.match(calls[0].url, /\/api\/wiki\/resolve$/);
  assert.deepEqual([...node.querySelectorAll("a")].map((a) => a.getAttribute("data-state")), ["ok:acme", "ok:plan-2027", "missing"]);
  // The same names again: nothing is asked.
  await act(async () => root.render(all(["Acme", "Plan 2027", "Falta una"])));
  await act(async () => { await wait(40); });
  assert.equal(calls.length, 1);
  // The notes changed (SSE → «colmena:changed»): asked again, showing what it had meanwhile.
  await act(async () => { window.dispatchEvent(new window.CustomEvent("colmena:changed", { detail: { kinds: ["messages"] } })); await wait(40); });
  assert.equal(calls.length, 1, "other kinds do not ask");
  await act(async () => { window.dispatchEvent(new window.CustomEvent("colmena:changed", { detail: { kinds: ["wikiPages", "wikiLinks"] } })); });
  assert.equal(node.querySelector("a").getAttribute("data-state"), "ok:acme");
  await until(() => calls.length === 2);
  assert.equal(calls.length, 2);
  assert.deepEqual([...calls[1].targets].sort(), ["Acme", "Falta una", "Plan 2027"]);
  await act(async () => { refreshNoteLinks(); });
  await until(() => calls.length === 3);
  assert.equal(calls.length, 3);
  await act(async () => root.unmount());
  node.remove();
});

test("a screen with unsaved work can hold a navigation until the person answers", async () => {
  const { mayLeave, setLeaveGuard } = await import("../src/lib/leaveGuard.js");
  assert.equal(mayLeave("/chats"), true, "nobody holds it");
  let dirty = true;
  const asked = [];
  const stop = setLeaveGuard((to) => { if (!dirty) return true; asked.push(to); return false; });
  assert.equal(mayLeave("/chats"), false, "held, and the screen was asked");
  assert.deepEqual(asked, ["/chats"]);
  dirty = false;
  assert.equal(mayLeave("/equipo"), true);
  dirty = true;
  // A newer guard replaces it; removing the old one does not remove the new one.
  const stop2 = setLeaveGuard(() => false);
  stop();
  assert.equal(mayLeave("/inicio"), false);
  stop2();
  assert.equal(mayLeave("/inicio"), true, "no guard once the editor is gone");
  assert.deepEqual(asked, ["/chats"]);
});
