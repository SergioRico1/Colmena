// «Código» QA data: throwaway git repositories, projects and tasks in every state the screen knows,
// written straight to an ISOLATED data folder the way server/code/service.mjs stores them (real
// worktrees and restore points, so diffs, «Volver aquí» and the terminal work). No engine runs and
// nothing touches the network. Refuses the real Colmena data folder.
//
//   COLMENA_DATA_DIR=.local/qa-code node scripts/seed-code-qa.mjs           seeds (wipes that folder first)
//   COLMENA_DATA_DIR=.local/qa-code node scripts/seed-code-qa.mjs --serve   serves dist/ on it (port COLMENA_PORT, 4334)
//
// --serve runs the app with stand-ins only: the fake Claude Code and gh of tests/fixtures, no Codex
// nor OpenCode, no mailbox, and one task «working» driven from here (a live log that never ends).
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { Store } from "../server/store.mjs";
import { git, addWorktree, Snapshots } from "../server/code/git.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = process.env.COLMENA_DATA_DIR;
const real = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "Colmena");
if (!dir || path.resolve(dir).toLowerCase() === path.resolve(real).toLowerCase() || path.resolve(dir).toLowerCase().startsWith(path.resolve(real).toLowerCase() + path.sep))
  throw Error("Usa COLMENA_DATA_DIR con una carpeta de QA aislada.");
const DATA = path.resolve(dir);

/** The ids the seed writes (the tests and the screenshot script open them by these). */
export const QA_TASKS = {
  running: "ct-qarun01", plan: "ct-qaplan1", question: "ct-qaask01", redline: "ct-qared01", review: "ct-qarev01",
  ready: "ct-qardy01", prFailing: "ct-qapr001", prGreen: "ct-qapr002", prPending: "ct-qapr003", conflict: "ct-qacnf01",
  saved: "ct-qasav01", archived: "ct-qaarc01", stuck: "ct-qaerr01", compareA: "ct-qacmpa1", compareB: "ct-qacmpb1",
};
export const QA_GROUP = "cg-0a0001";
export const QA_MIRROR = "cm-qamarta1";
export const QA_HANDOFF = "ho-qaluis01";
const MARTA = "qa-marta-0000000000000000000000000000000000000000";
const LUIS = "qa-luis-00000000000000000000000000000000000000000";

const at = (min) => new Date(Date.now() - min * 60000).toISOString();

// ------------------------------------------------------------------ the repositories
const FILES = {
  tienda: {
    "package.json": JSON.stringify({ name: "tienda-web", version: "1.3.0", type: "module", scripts: { test: "node --test", dev: "vite" } }, null, 2) + "\n",
    "README.md": "# tienda-web\n\nLa tienda en línea: carrito, pago y catálogo.\n",
    "src/cart.js": [
      "// The cart: lines, totals and VAT.",
      "export function createCart() {",
      "  return { lines: [] };",
      "}",
      "",
      "export function addLine(cart, product, qty = 1) {",
      "  const line = cart.lines.find((l) => l.id === product.id);",
      "  if (line) line.qty += qty;",
      "  else cart.lines.push({ id: product.id, name: product.name, price: product.price, qty });",
      "  return cart;",
      "}",
      "",
      "export function subtotal(cart) {",
      "  return cart.lines.reduce((n, l) => n + l.price * l.qty, 0);",
      "}",
      "",
      "export function total(cart, vat = 0.21) {",
      "  return subtotal(cart) * (1 + vat);",
      "}",
      "",
    ].join("\n"),
    "src/checkout.js": [
      "import { total } from \"./cart.js\";",
      "import { request } from \"./api/client.js\";",
      "",
      "export async function pay(cart, card) {",
      "  const amount = total(cart);",
      "  return request(\"/payments\", { method: \"POST\", body: { amount, card } });",
      "}",
      "",
    ].join("\n"),
    "src/api/client.js": [
      "import axios from \"axios\";",
      "",
      "const api = axios.create({ baseURL: \"/api\" });",
      "",
      "export async function request(url, { method = \"GET\", body } = {}) {",
      "  const res = await api.request({ url, method, data: body });",
      "  return res.data;",
      "}",
      "",
    ].join("\n"),
    "src/search.js": [
      "export function search(products, query) {",
      "  const q = query.toLowerCase();",
      "  return products.filter((p) => p.name.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q)));",
      "}",
      "",
    ].join("\n"),
    "src/theme.css": ":root {\n  --bg: #ffffff;\n  --ink: #111111;\n}\n\nbody {\n  background: var(--bg);\n  color: var(--ink);\n}\n",
    "tests/cart.test.js": [
      "import test from \"node:test\";",
      "import assert from \"node:assert/strict\";",
      "import { createCart, addLine, total } from \"../src/cart.js\";",
      "",
      "test(\"total with VAT\", () => {",
      "  const cart = addLine(createCart(), { id: 1, name: \"Taza\", price: 10 }, 2);",
      "  assert.equal(total(cart), 24.2);",
      "});",
      "",
    ].join("\n"),
  },
  facturas: {
    "package.json": JSON.stringify({ name: "api-facturas", version: "0.9.2", type: "module", scripts: { test: "node --test", start: "node server.mjs" } }, null, 2) + "\n",
    "README.md": "# api-facturas\n\nAPI interna de facturación.\n",
    "server.mjs": [
      "import http from \"node:http\";",
      "import { listInvoices } from \"./lib/invoices.mjs\";",
      "",
      "http.createServer(async (req, res) => {",
      "  if (req.url.startsWith(\"/facturas\")) {",
      "    res.setHeader(\"content-type\", \"application/json\");",
      "    return res.end(JSON.stringify(await listInvoices()));",
      "  }",
      "  res.statusCode = 404;",
      "  res.end();",
      "}).listen(3000);",
      "",
    ].join("\n"),
    "lib/invoices.mjs": [
      "import { db } from \"./db.mjs\";",
      "",
      "export async function listInvoices() {",
      "  return db.all(\"SELECT * FROM invoices ORDER BY issued_at DESC\");",
      "}",
      "",
      "export function vatOf(amount, rate = 0.21) {",
      "  return Math.round(amount * rate * 100) / 100;",
      "}",
      "",
    ].join("\n"),
    "lib/customers.mjs": [
      "export function createCustomer(data) {",
      "  if (!data.name) throw Error(\"Falta el nombre\");",
      "  return { id: crypto.randomUUID(), name: data.name, iban: data.iban, createdAt: new Date().toISOString() };",
      "}",
      "",
    ].join("\n"),
    "lib/payments.mjs": "export function charge(invoice) {\n  return { ok: true, invoice: invoice.id };\n}\n",
    "lib/db.mjs": "export const db = { all: async () => [] };\n",
  },
};

async function makeRepo(name, files, commits) {
  const repo = path.join(DATA, "qa-repos", name);
  mkdirSync(repo, { recursive: true });
  await git(["init", "-q", "-b", "main"], { cwd: repo });
  await git(["config", "user.email", "qa@colmena.invalid"], { cwd: repo });
  await git(["config", "user.name", "Colmena QA"], { cwd: repo });
  await git(["config", "commit.gpgsign", "false"], { cwd: repo });
  write(repo, Object.fromEntries(Object.entries(files).filter(([rel]) => !commits.some(([, change]) => rel in change))));
  await git(["add", "-A"], { cwd: repo });
  await git(["commit", "-q", "-m", "Initial commit"], { cwd: repo });
  for (const [message, change] of commits) {
    write(repo, change);
    await git(["add", "-A"], { cwd: repo });
    await git(["commit", "-q", "-m", message], { cwd: repo });
  }
  // A branch with changes of its own (someone else's work in progress).
  await git(["checkout", "-q", "-b", "feature/envios"], { cwd: repo });
  write(repo, { "NOTAS.md": "# Envíos\n\nPendiente: tarifas por zona.\n" });
  await git(["add", "-A"], { cwd: repo });
  await git(["commit", "-q", "-m", "Start shipping notes"], { cwd: repo });
  await git(["checkout", "-q", "main"], { cwd: repo });
  return repo;
}

function write(folder, files) {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(folder, rel);
    if (text === null) { rmSync(file, { force: true }); continue; }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
}
const edit = (folder, rel, fn) => {
  const file = path.join(folder, rel);
  return { [rel]: fn(existsSync(file) ? String(readText(file)) : "") };
};
const readText = (file) => readFileSync(file, "utf8");

// ------------------------------------------------------------------ the seed
async function seed() {
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(DATA, { recursive: true });
  const store = new Store(DATA);
  store.patch("settings", "main", { onboarded: true, spaceName: "Equipo de producto", userName: "Sergio", model: "gpt-5", theme: "system" });

  const tiendaRepo = await makeRepo("tienda-web", FILES.tienda, [
    ["Add search", { "src/search.js": FILES.tienda["src/search.js"] }],
    ["Explain the cart", { "README.md": "# tienda-web\n\nLa tienda en línea: carrito, pago y catálogo.\n\n## Desarrollo\n\n`npm run dev` y abre http://localhost:5173.\n" }],
  ]);
  const factRepo = await makeRepo("api-facturas", FILES.facturas, [["Add payments", { "lib/payments.mjs": FILES.facturas["lib/payments.mjs"] }]]);
  const notas = path.join(DATA, "qa-repos", "notas-equipo");
  write(notas, { "ideas.md": "# Ideas\n\n- Plantillas de presupuesto\n" });

  const head = async (repo) => (await git(["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
  const projects = {
    tienda: { id: "cp-qatienda", name: "tienda-web", root: tiendaRepo, repo: true, top: tiendaRepo, base: "main", allow: [], createdAt: at(60 * 24 * 9), updatedAt: at(3) },
    fact: { id: "cp-qafactur", name: "api-facturas", root: factRepo, repo: true, top: factRepo, base: "main", allow: [], createdAt: at(60 * 24 * 6), updatedAt: at(20) },
    notas: { id: "cp-qanotas1", name: "notas-equipo", root: notas, repo: false, top: null, base: null, allow: [], createdAt: at(60 * 24 * 20), updatedAt: at(60 * 24 * 4) },
  };
  for (const p of Object.values(projects)) store.put("codeProjects", p);

  let seq = 0;
  const item = (taskId, minutes, data) => store.put("codeItems", { id: "ci-" + taskId.slice(3) + "-" + String(++seq).padStart(3, "0"), taskId, seq, at: at(minutes), ...data });

  /**
   * A task with its own copy and real restore points: `turns` are [{ask, minutes, edits(cwd), say, tools}];
   * each one leaves the user message, a work log, Bruno's answer and the «N archivos cambiados» card.
   */
  async function task({ id, project, title, turns = [], engine = "claude-code", model = "claude-opus-5-5", extra = {}, after = null, minutes = 60 }) {
    const p = projects[project];
    seq = 0;
    let cwd = p.root, branch = null, base = null, baseCommit = null, worktree = null;
    if (p.repo) {
      branch = "colmena/" + title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 28).replace(/-+$/, "") + "-" + id.slice(3, 7);
      base = "main";
      baseCommit = await head(p.root);
      worktree = cwd = path.join(DATA, "code", "worktrees", p.id, id);
      await addWorktree({ repo: p.root, dir: cwd, branch, base: baseCommit });
    }
    const snaps = new Snapshots({ key: id, dir: path.join(DATA, "code", "snapshots", id), root: cwd });
    const baseSnap = await snaps.capture("base");
    const records = [];
    let prev = baseSnap;
    let clock = minutes;
    for (const [k, t] of turns.entries()) {
      const n = k + 1;
      const user = item(id, clock, { kind: "user", text: t.ask, turn: n, mode: t.mode });
      clock -= 1;
      for (const [verb, text, detail, output] of t.tools || []) item(id, clock, { kind: "tool", tool: verb === "run" ? "Bash" : verb === "edit" ? "Edit" : verb === "read" ? "Read" : verb === "plan" ? "TodoWrite" : "Grep", verb, text, detail, output, status: "done", turn: n, ...(verb === "plan" ? { todos: t.todos } : {}) });
      if (t.edits) write(cwd, t.edits(cwd));
      const end = await snaps.capture("t" + n + "-end-" + n);
      const stat = await snaps.diff(prev, end);
      const files = stat.files.map((f) => ({ path: f.path, status: f.status, add: f.add, del: f.del }));
      const usage = { tokens: 18000 + n * 4200, cost: 0.08 * n };
      records.push({ n, mode: t.mode || "build", userItemId: user.id, startSnap: prev, endSnap: end, add: stat.add, del: stat.del, files, sessionAt: null, durationMs: (t.secs || 140) * 1000, engine, model, ...usage });
      if (t.say) item(id, clock, { kind: "text", text: t.say, turn: n, ...(files.length ? {} : { stats: { durationMs: (t.secs || 140) * 1000, files: 0, add: 0, del: 0, ...usage } }) });
      if (files.length) item(id, clock, { kind: "turn", n, files, add: stat.add, del: stat.del, endSnap: end, turn: n, stats: { durationMs: (t.secs || 140) * 1000, files: files.length, add: stat.add, del: stat.del, ...usage } });
      prev = end;
      clock -= 2;
    }
    const record = {
      id, projectId: p.id, title, botId: "bruno", engine, model, effort: "high", access: "project",
      isolated: !!p.repo, cwd, branch, base, baseCommit, worktree, repoTop: p.repo ? p.root : null,
      status: "idle", turns: records, queue: [], session: { id: "qa-session-" + id, started: records.length > 0, forkAt: null },
      createdAt: at(minutes + 5), updatedAt: at(Math.max(1, clock)), activeAt: at(Math.max(1, clock)), baseSnap,
      ...extra,
    };
    store.put("codeTasks", record);
    if (after) await after({ id, cwd, snaps, records, item: (min, data) => item(id, min, data), store });
    return record;
  }

  const cartTools = [
    ["read", "Leyó src/cart.js", "src/cart.js"],
    ["search", "Buscó «total(» en src", "total\\(", "src/checkout.js:5\nsrc/cart.js:17"],
    ["edit", "Editó src/cart.js", "src/cart.js"],
    ["run", "Ejecutó node --test", "node --test", "▶ total with VAT\n✔ total with VAT (1.2ms)\nℹ tests 1\nℹ pass 1\nℹ fail 0"],
  ];

  // 1 · Working right now (--serve drives its live log).
  await task({
    id: QA_TASKS.running, project: "tienda", title: "Añadir cupones de descuento al carrito", minutes: 30,
    turns: [{
      ask: "Añade cupones de descuento al carrito: un código, un porcentaje o un importe fijo, y que el total los descuente antes del IVA. Con tests.",
      tools: [...cartTools.slice(0, 2), ["plan", "Actualizó su lista de pasos", ""]],
      todos: [{ text: "Leer el carrito y el pago", status: "done" }, { text: "Añadir applyCoupon() al carrito", status: "done" }, { text: "Descontar antes del IVA en total()", status: "now" }, { text: "Tests de cupones (porcentaje, fijo, caducado)", status: "todo" }, { text: "Mostrar el cupón en el resumen del pago", status: "todo" }],
      edits: (cwd) => edit(cwd, "src/cart.js", (s) => s.replace("export function subtotal", [
        "export function applyCoupon(cart, coupon) {",
        "  if (coupon.expiresAt && Date.parse(coupon.expiresAt) < Date.now()) throw Error(\"El cupón ha caducado\");",
        "  cart.coupon = { code: coupon.code, percent: coupon.percent || 0, amount: coupon.amount || 0 };",
        "  return cart;",
        "}",
        "",
        "export function subtotal",
      ].join("\n"))),
      say: "He añadido `applyCoupon()` al carrito. Ahora hago que `total()` descuente el cupón antes del IVA.",
      secs: 212,
    }],
  });

  // 2 · A plan waiting for «Implementar».
  await task({
    id: QA_TASKS.plan, project: "tienda", title: "Migrar el cliente de la API a fetch", minutes: 75,
    turns: [{ ask: "Quita axios y usa fetch en el cliente de la API. Antes de tocar nada, propónme un plan.", mode: "plan", tools: [["read", "Leyó src/api/client.js", "src/api/client.js"], ["search", "Buscó «request(» en src", "request\\(", "src/checkout.js:6"]], say: null, secs: 64 }],
    extra: { status: "planned" },
    after: ({ item }) => item(70, { kind: "plan", status: "open", turn: 1, text: "## Plan\n\n1. Reescribir `src/api/client.js` con `fetch`, misma firma `request(url, { method, body })`.\n2. Lanzar un `Error` con el estado HTTP cuando la respuesta no sea `ok`.\n3. Quitar `axios` de `package.json`.\n4. Probar `pay()` de `src/checkout.js` con un `fetch` simulado.\n\nNo cambia nada fuera de esos tres archivos." }),
  });

  // 3 · A question for the person.
  await task({
    id: QA_TASKS.question, project: "fact", title: "Paginar el listado de facturas", minutes: 50,
    turns: [{
      ask: "El listado de /facturas tarda mucho: pagínalo.",
      tools: [["read", "Leyó server.mjs", "server.mjs"], ["read", "Leyó lib/invoices.mjs", "lib/invoices.mjs"], ["edit", "Editó lib/invoices.mjs", "lib/invoices.mjs"]],
      edits: (cwd) => edit(cwd, "lib/invoices.mjs", (s) => s.replace("export async function listInvoices() {\n  return db.all(\"SELECT * FROM invoices ORDER BY issued_at DESC\");", "export async function listInvoices({ page = 1, size = 50 } = {}) {\n  const offset = (page - 1) * size;\n  return db.all(\"SELECT * FROM invoices ORDER BY issued_at DESC LIMIT ? OFFSET ?\", [size, offset]);")),
      say: "He paginado la consulta. Antes de cambiar la respuesta de la API necesito saber una cosa.", secs: 98,
    }],
    extra: { status: "waiting" },
    after: ({ item }) => item(44, { kind: "ask", ask: "question", tool: "AskUserQuestion", title: "Bruno te pregunta", status: "pending", turn: 1, toolUseId: "toolu_qa_ask",
      questions: [{ question: "¿Cómo pagino la respuesta de /facturas?", header: "Paginación", multiSelect: false, options: [{ label: "Por páginas (?page=2)", description: "Lo más simple; vale para el panel." }, { label: "Por cursor (?after=…)", description: "Estable si entran facturas mientras lees." }, { label: "Las dos", description: "Página por defecto y cursor para integraciones." }] }] }),
  });

  // 4 · A red line: pushing asks.
  await task({
    id: QA_TASKS.redline, project: "fact", title: "Publicar la versión 0.9.3", minutes: 26,
    turns: [{ ask: "Sube la versión a 0.9.3, actualiza el changelog y súbelo.", tools: [["edit", "Editó package.json", "package.json"], ["edit", "Editó CHANGELOG.md", "CHANGELOG.md"], ["run", "Ejecutó git commit", "git commit -am \"Release 0.9.3\"", "[main 4c1e2aa] Release 0.9.3\n 2 files changed, 9 insertions(+), 1 deletion(-)"]],
      edits: (cwd) => ({ ...edit(cwd, "package.json", (s) => s.replace("0.9.2", "0.9.3")), "CHANGELOG.md": "# Changelog\n\n## 0.9.3\n\n- Facturas paginadas.\n- IVA redondeado al céntimo.\n- Pagos: reintento cuando el banco tarda.\n" }),
      say: "Versión y changelog listos. Para subirlo necesito tu OK.", secs: 75 }],
    extra: { status: "waiting" },
    after: ({ item }) => item(22, { kind: "ask", ask: "redline", tool: "Bash", rule: "Bash(git push:*)", durable: false, taskScope: "Bash(git push:*)", title: "Subir a GitHub", reason: "Subir cambios sale de este ordenador.", command: "git push origin colmena/publicar-la-version-0-9-3-qare", status: "pending", turn: 1, toolUseId: "toolu_qa_push" }),
  });

  // 5 · Review findings P0–P3 (current: it holds the merge).
  await task({
    id: QA_TASKS.review, project: "fact", title: "Validar el IBAN en el alta de clientes", minutes: 120,
    turns: [
      { ask: "Valida el IBAN al crear un cliente: formato y dígitos de control.", tools: [["read", "Leyó lib/customers.mjs", "lib/customers.mjs"], ["edit", "Editó lib/customers.mjs", "lib/customers.mjs"], ["edit", "Creó lib/iban.mjs", "lib/iban.mjs"]],
        edits: (cwd) => ({
          "lib/iban.mjs": "// IBAN check (ISO 13616): country, length and mod-97.\nconst LENGTH = { ES: 24, PT: 25, FR: 27, DE: 22, IT: 27 };\n\nexport function validIban(value) {\n  const iban = String(value).replace(/\\s+/g, \"\").toUpperCase();\n  if (!/^[A-Z]{2}\\d{2}[A-Z0-9]+$/.test(iban)) return false;\n  if (LENGTH[iban.slice(0, 2)] && iban.length !== LENGTH[iban.slice(0, 2)]) return false;\n  const moved = iban.slice(4) + iban.slice(0, 4);\n  const digits = moved.replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55);\n  return BigInt(digits) % 97n === 1n;\n}\n",
          ...edit(cwd, "lib/customers.mjs", (s) => "import { validIban } from \"./iban.mjs\";\n\n" + s.replace("  return { id", "  if (data.iban && !validIban(data.iban)) throw Error(\"IBAN no válido\");\n  return { id")),
        }), say: "Hecho: `validIban()` comprueba país, longitud y el control mod-97.", secs: 160 },
      { ask: "Guarda el IBAN sin espacios y enmascarado en los logs.", tools: [["edit", "Editó lib/customers.mjs", "lib/customers.mjs"], ["run", "Ejecutó node --test", "node --test", "ℹ tests 6\nℹ pass 6\nℹ fail 0"]],
        edits: (cwd) => edit(cwd, "lib/customers.mjs", (s) => s.replace("iban: data.iban,", "iban: data.iban?.replace(/\\s+/g, \"\"),").replace("export function createCustomer(data) {", "export const maskIban = (iban) => iban.slice(0, 4) + \" **** \" + iban.slice(-4);\n\nexport function createCustomer(data) {\n  console.log(\"Nuevo cliente\", data.name, data.iban);")),
        say: "Listo: se guarda sin espacios y he añadido `maskIban()`.", secs: 90 },
    ],
    after: ({ item, store, id }) => {
      const findings = [
        { severity: "P0", title: "El IBAN completo se escribe en los logs", file: "lib/customers.mjs", line: 4, detail: "console.log recibe data.iban sin enmascarar: usa maskIban() o quita el log." },
        { severity: "P1", title: "Un IBAN vacío pasa la validación", file: "lib/customers.mjs", line: 7, detail: "data.iban = \"\" es falsy y se guarda: decide si es obligatorio." },
        { severity: "P2", title: "Faltan longitudes de más países", file: "lib/iban.mjs", line: 2, detail: "Solo cinco países: el resto acepta cualquier longitud." },
        { severity: "P3", title: "maskIban no tiene test", file: "lib/customers.mjs", line: 1, detail: "Un test corto evita que se rompa." },
      ];
      const review = item(100, { kind: "review", summary: "Funciona, pero filtra datos personales a los logs y acepta un IBAN vacío.", findings, files: 2, turnsAt: 2 });
      store.patch("codeTasks", id, { review: { at: at(100), turns: 2, item: review.id, serious: 2, total: 4 } });
    },
  });

  // 6 · Ready to save (clean review).
  await task({
    id: QA_TASKS.ready, project: "fact", title: "Arreglar el redondeo del IVA", minutes: 40,
    turns: [{ ask: "vatOf(0.105) da 0.02 y debería dar 0.03: arregla el redondeo.", tools: [["read", "Leyó lib/invoices.mjs", "lib/invoices.mjs"], ["edit", "Editó lib/invoices.mjs", "lib/invoices.mjs"], ["run", "Ejecutó node --test", "node --test", "ℹ tests 4\nℹ pass 4\nℹ fail 0"]],
      edits: (cwd) => ({ ...edit(cwd, "lib/invoices.mjs", (s) => s.replace("return Math.round(amount * rate * 100) / 100;", "// Half away from zero on cents, without binary drift (0.105 → 0.03).\n  return Math.round((amount * rate + Number.EPSILON) * 100) / 100;")), "tests/vat.test.mjs": "import test from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { vatOf } from \"../lib/invoices.mjs\";\n\ntest(\"rounds half up on cents\", () => assert.equal(vatOf(0.5, 0.21), 0.11));\n" }),
      say: "Arreglado con `Number.EPSILON` y un test. Los cuatro tests pasan.", secs: 70 }],
    after: ({ item, store, id }) => { const r = item(30, { kind: "review", summary: "Todo bien.", findings: [], files: 2, turnsAt: 1 }); store.patch("codeTasks", id, { review: { at: at(30), turns: 1, item: r.id, serious: 0, total: 0 } }); },
  });

  // 7 · PR open, CI failing.
  const searchTurn = { ask: "La búsqueda va lenta con 5.000 productos: hazla más rápida.", tools: [["read", "Leyó src/search.js", "src/search.js"], ["edit", "Editó src/search.js", "src/search.js"], ["run", "Ejecutó node --test", "node --test", "✖ search finds by tag (3.1ms)\n  AssertionError: expected 2, got 0\nℹ tests 5\nℹ pass 4\nℹ fail 1"]],
    edits: () => ({ "src/search.js": "// An index built once per catalogue: name and tags, lower-cased.\nconst cache = new WeakMap();\n\nfunction indexOf(products) {\n  let index = cache.get(products);\n  if (!index) {\n    index = products.map((p) => ({ p, text: (p.name + \" \" + p.tags.join(\" \")).toLowerCase() }));\n    cache.set(products, index);\n  }\n  return index;\n}\n\nexport function search(products, query) {\n  const q = query.trim().toLowerCase();\n  if (!q) return products;\n  return indexOf(products).filter((x) => x.text.startsWith(q)).map((x) => x.p);\n}\n" }),
    say: "He indexado el catálogo una vez. Ojo: el CI dice que falla buscar por etiqueta.", secs: 180 };
  await task({ id: QA_TASKS.prFailing, project: "tienda", title: "Acelerar la búsqueda del catálogo", minutes: 180, turns: [searchTurn],
    extra: { pr: { number: 42, url: "https://github.com/qa-colmena/tienda-web/pull/42", state: "OPEN", mergeable: "MERGEABLE", headRefOid: "qa42", isDraft: false, reviewDecision: null, checks: "failing", branch: "colmena/acelerar-la-busqueda-del-c-qapr", watching: false, since: at(170), seen: [] } },
    after: ({ item }) => item(150, { kind: "notice", text: "Falla el CI de la PR #42: test (node 24).", url: "https://github.com/qa-colmena/tienda-web/pull/42", tone: "warn" }) });

  // 8 · PR approved, CI green.
  await task({ id: QA_TASKS.prGreen, project: "tienda", title: "Modo oscuro en la tienda", minutes: 300,
    turns: [{ ask: "Añade modo oscuro siguiendo el sistema.", tools: [["edit", "Editó src/theme.css", "src/theme.css"]], edits: (cwd) => edit(cwd, "src/theme.css", (s) => s + "\n@media (prefers-color-scheme: dark) {\n  :root {\n    --bg: #111318;\n    --ink: #f2f2f2;\n  }\n}\n"), say: "Hecho con `prefers-color-scheme`.", secs: 50 }],
    extra: { pr: { number: 39, url: "https://github.com/qa-colmena/tienda-web/pull/39", state: "OPEN", mergeable: "MERGEABLE", headRefOid: "qa39", isDraft: false, reviewDecision: "APPROVED", checks: "passing", branch: "colmena/modo-oscuro-en-la-tienda-qapr", watching: false, since: at(290), seen: [] } },
    after: ({ item }) => item(200, { kind: "notice", text: "La PR #39 está aprobada.", url: "https://github.com/qa-colmena/tienda-web/pull/39", tone: "done" }) });

  // 9 · Draft PR, CI pending.
  await task({ id: QA_TASKS.prPending, project: "fact", title: "Reintentar el cobro cuando el banco tarda", minutes: 95,
    turns: [{ ask: "Si el banco tarda más de 10 s, reintenta el cobro dos veces con espera creciente.", tools: [["edit", "Editó lib/payments.mjs", "lib/payments.mjs"]],
      edits: () => ({ "lib/payments.mjs": "const wait = (ms) => new Promise((r) => setTimeout(r, ms));\n\nexport async function charge(invoice, bank, { tries = 3 } = {}) {\n  for (let k = 0; k < tries; k++) {\n    try {\n      return await bank.charge(invoice, { timeout: 10000 });\n    } catch (error) {\n      if (k === tries - 1 || error.code !== \"ETIMEDOUT\") throw error;\n      await wait(1000 * 2 ** k);\n    }\n  }\n}\n" }), say: "Reintenta con 1 s y 2 s de espera, solo si el banco no contesta.", secs: 120 }],
    extra: { pr: { number: 17, url: "https://github.com/qa-colmena/api-facturas/pull/17", state: "OPEN", mergeable: "UNKNOWN", headRefOid: "qa17", isDraft: true, reviewDecision: null, checks: "pending", branch: "colmena/reintentar-el-cobro-cuand-qapr", watching: false, since: at(90), seen: [] } } });

  // 10 · Conflicts with the base.
  await task({ id: QA_TASKS.conflict, project: "tienda", title: "Renombrar checkout a pago", minutes: 140,
    turns: [{ ask: "Renombra checkout.js a pago.js y actualiza los imports.", tools: [["run", "Ejecutó git mv", "git mv src/checkout.js src/pago.js", ""], ["edit", "Editó src/pago.js", "src/pago.js"]],
      edits: (cwd) => ({ "src/checkout.js": null, "src/pago.js": readText(path.join(cwd, "src/checkout.js")).replace("export async function pay", "/** Pays the cart with the card (amount with VAT). */\nexport async function pay") }), say: "Renombrado.", secs: 40 }],
    extra: { merging: { base: "main", files: ["src/checkout.js", "README.md"], at: at(12) } },
    after: ({ item }) => item(12, { kind: "notice", text: "Hay cambios que chocan con main en src/checkout.js y README.md: Bruno los está resolviendo en su copia.", tone: "warn" }) });

  // 11 · Saved, PR merged (done).
  await task({ id: QA_TASKS.saved, project: "tienda", title: "Mostrar el IVA en el resumen del carrito", minutes: 60 * 26,
    turns: [{ ask: "Muestra el IVA aparte en el resumen.", tools: [["edit", "Editó src/cart.js", "src/cart.js"]], edits: (cwd) => edit(cwd, "src/cart.js", (s) => s + "\nexport function vat(cart, rate = 0.21) {\n  return subtotal(cart) * rate;\n}\n"), say: "Añadido `vat()`.", secs: 35 }],
    extra: { saved: { ref: "refs/colmena/saved/" + QA_TASKS.saved, commit: "qa", at: at(60 * 25), until: new Date(Date.now() + 29 * 86400000).toISOString() }, merged: { at: at(60 * 25), into: "main" }, pr: { number: 37, url: "https://github.com/qa-colmena/tienda-web/pull/37", state: "MERGED", checks: "passing", mergeable: "MERGEABLE", watching: false } } });

  // 12 · Archived (a plain folder, no copy).
  await task({ id: QA_TASKS.archived, project: "notas", title: "Ordenar las ideas por prioridad", minutes: 60 * 24 * 5,
    turns: [{ ask: "Ordena ideas.md por prioridad.", tools: [["edit", "Editó ideas.md", "ideas.md"]], edits: () => ({ "ideas.md": "# Ideas\n\n## Alta\n\n- Plantillas de presupuesto\n\n## Media\n\n- Exportar a PDF\n" }), say: "Ordenadas.", secs: 20 }],
    extra: { archived: { at: at(60 * 24 * 2), by: "idle" } } });

  // 13 · Stuck.
  await task({ id: QA_TASKS.stuck, project: "fact", title: "Exportar las facturas a CSV", minutes: 15,
    turns: [{ ask: "Añade /facturas.csv con las del mes.", tools: [["run", "Ejecutó npm install csv-stringify", "npm install csv-stringify", "npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org failed"]], say: null, secs: 30 }],
    extra: { status: "error", error: "turn" },
    after: ({ item }) => item(13, { kind: "error", text: "No hay conexión con el registro de npm: Bruno no pudo instalar csv-stringify.", turn: 1 }) });

  // 14 · The same request with two engines (compare).
  const cmpTurn = (say) => ({ ask: "Valida el código postal en el alta de clientes (5 dígitos, España).", tools: [["edit", "Editó lib/customers.mjs", "lib/customers.mjs"]],
    edits: (cwd) => edit(cwd, "lib/customers.mjs", (s) => s.replace("  return { id", "  if (data.zip && !/^(0[1-9]|[1-4]\\d|5[0-2])\\d{3}$/.test(data.zip)) throw Error(\"Código postal no válido\");\n  return { id")), say, secs: 66 });
  await task({ id: QA_TASKS.compareA, project: "fact", title: "Validar el código postal · Claude Code · Opus 5.5", minutes: 34, turns: [cmpTurn("Valido las 52 provincias con una expresión.")],
    extra: { group: QA_GROUP, label: "Claude Code · Opus 5.5", tests: { status: "passed", code: 0, durationMs: 4200, at: at(30) } } });
  await task({ id: QA_TASKS.compareB, project: "fact", title: "Validar el código postal · Codex · GPT-6.1 Sol", engine: "codex", model: "gpt-6.1-sol", minutes: 34, turns: [cmpTurn("Validado con la misma regla y un mensaje claro.")],
    extra: { group: QA_GROUP, label: "Codex · GPT-6.1 Sol", tests: { status: "failed", code: 1, durationMs: 5100, at: at(30) } } });

  // Terminal output kept on disk (server/code/terminal.mjs), as after a restart.
  const term = path.join(DATA, "code", "terminals", QA_TASKS.prFailing);
  mkdirSync(term, { recursive: true });
  writeFileSync(path.join(term, "tqa001.json"), JSON.stringify({ title: "npm test", command: "npm test" }));
  writeFileSync(path.join(term, "tqa001.log"), [
    "\x1b[1mPS\x1b[0m tienda-web> npm test", "", "> tienda-web@1.3.0 test", "> node --test", "",
    "\x1b[32m✔\x1b[0m total with VAT \x1b[90m(1.21ms)\x1b[0m", "\x1b[32m✔\x1b[0m search finds by name \x1b[90m(0.8ms)\x1b[0m",
    "\x1b[31m✖\x1b[0m search finds by tag \x1b[90m(3.1ms)\x1b[0m", "  \x1b[31mAssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\x1b[0m", "", "  2 !== 0", "",
    "      at TestContext.<anonymous> (tests/search.test.js:14:10)", "", "\x1b[34mℹ\x1b[0m tests 5", "\x1b[34mℹ\x1b[0m pass 4", "\x1b[31mℹ fail 1\x1b[0m", "",
  ].join("\r\n"));

  // People: Marta shares a task with you; Luis hands one over.
  store.put("peerContacts", { id: MARTA, name: "Marta Ruiz", status: "active", addedAt: at(60 * 24 * 30) });
  store.put("peerContacts", { id: LUIS, name: "Luis Gómez", status: "active", addedAt: at(60 * 24 * 12) });
  store.put("peerCodeMirrors", { id: QA_MIRROR, owner: MARTA, task: "ct-marta001", at: at(8), removedAt: null, createdAt: at(60 * 3),
    snapshot: { title: "Calendario de reservas en la web", project: "reservas", status: "working", running: true, branch: "colmena/calendario-reservas-m1", base: "main", add: 184, del: 22, turns: 3,
      pr: { number: 12, url: "https://github.com/qa-colmena/reservas/pull/12", state: "OPEN", checks: "pending", mergeable: "MERGEABLE" },
      plan: { id: "ci-mplan", text: "1. Vista de mes con los huecos libres.\n2. Bloquear el hueco al elegirlo (5 min).\n3. Confirmar por correo.", status: "implemented", votes: [] },
      people: [], owner: "Marta Ruiz", at: at(8), projectId: null,
      log: [{ kind: "tool", verb: "edit", text: "Editó src/Calendar.jsx", status: "done" }, { kind: "tool", verb: "run", text: "Ejecutó npm test", status: "done" }, { kind: "assistant", text: "El hueco se libera solo si no confirmas en 5 minutos." }] } });
  store.put("peerCodeHandoffs", { id: QA_HANDOFF, hid: "qahid01", owner: LUIS, task: "ct-luis0001", title: "Avisos por correo de facturas vencidas", project: "api-facturas", remote: "https://github.com/qa-colmena/api-facturas.git",
    branch: "colmena/avisos-vencidas-l1", base: "main", summary: "Qué se ha hecho:\nUna tarea diaria busca las facturas vencidas y prepara el aviso.\n\nQué falta: plantilla del correo y no avisar dos veces.", note: "Me voy de vacaciones, ¿la sigues tú?", state: "offered", at: at(25) });

  console.log(JSON.stringify({ seeded: DATA, projects: Object.keys(projects).length, tasks: Object.keys(QA_TASKS).length }));
}

// ------------------------------------------------------------------ --serve
async function serve() {
  const express = (await import("express")).default;
  const { Runtime } = await import("../server/runtime.mjs");
  const { createApp } = await import("../server/app.mjs");
  const { Connections } = await import("../server/connections.mjs");
  const { CodeService } = await import("../server/code/service.mjs");
  const { Peers } = await import("../server/peers/service.mjs");
  const { CodeShare } = await import("../server/peers/codeshare.mjs");
  const store = new Store(DATA);
  // Questions and red lines open when the seed was written: kept open (the constructor expires them).
  const pending = store.list("codeItems").filter((i) => i.kind === "ask" && i.status === "pending");
  const statuses = store.list("codeTasks").map((t) => [t.id, t.status]);
  const provider = { async respond() { return { text: "QA", output: [] }; } };
  const hub = { dispatch: async () => ({}) };
  const connections = new Connections(store, hub);
  const runtime = new Runtime(store, provider, connections);
  const ghState = path.join(DATA, "gh-fake.json");
  writeFileSync(ghState, JSON.stringify({ authed: true, pr: null }));
  process.env.GH_FAKE_STATE = ghState;
  runtime.code = new CodeService({
    store, directory: DATA, command: [process.execPath, path.join(root, "tests", "fixtures", "fake-claude-code.mjs")],
    codexCommand: null, opencodeCommand: null, ghCommand: [process.execPath, path.join(root, "tests", "fixtures", "fake-gh.mjs")],
  });
  const code = runtime.code;
  for (const i of pending) store.put("codeItems", i);
  for (const [id, status] of statuses) store.patch("codeTasks", id, { status, cut: null });
  // An answer to a seeded question or red line is taken (and nothing runs after it).
  for (const i of pending) code.asks.set(i.id, { taskId: i.taskId, resolve: () => { code.setTask(i.taskId, { status: "idle" }); } });
  const session = { status: () => ({ label: "QA", email: "qa@example.invalid", persistent: false }), models: [], async logout() { return { ok: true }; }, closePending() {}, async start() { throw Error("QA"); }, async listModels() { return []; } };
  let origin;
  const app = createApp({ store, runtime, session, connections, getOrigin: () => origin });
  const peers = new Peers({ store, directory: DATA, relayUrl: null, nameOf: () => "Sergio" });
  app.locals.peers = peers;
  await peers.start().catch((e) => console.warn("QA: «Personas» sin arrancar: " + e.message));
  try { peers.codeShare = new CodeShare({ peers, store, code, runtime }).start(); } catch (e) { console.warn("QA: sin compartir: " + e.message); }
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*path}", (_req, res) => res.sendFile("index.html", { root: path.join(root, "dist"), dotfiles: "allow" }));
  const server = http.createServer(app);
  const port = Number(process.env.COLMENA_PORT || 4334);
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  code.apiBase = origin + "/api";
  drive(code, QA_TASKS.running);
  console.log(JSON.stringify({ origin, pid: process.pid, data: DATA }));
}

/** The «working» task: a live log and text that keep coming until «Parar» (no engine behind it). */
function drive(code, taskId) {
  const steps = [
    ["edit", "Editó src/cart.js", "src/cart.js", "Ahora `total()` descuenta el cupón antes de sumar el IVA. "],
    ["run", "Ejecutó node --test", "node --test", "Los tests de siempre pasan; escribo los de cupones. "],
    ["edit", "Creó tests/coupon.test.js", "tests/coupon.test.js", "Un cupón caducado lanza un error con un mensaje claro. "],
    ["run", "Ejecutó node --test tests/coupon.test.js", "node --test tests/coupon.test.js", "Porcentaje y fijo, en verde. "],
    ["read", "Leyó src/checkout.js", "src/checkout.js", "Falta enseñarlo en el resumen del pago. "],
  ];
  const entry = { engine: { kind: "claude-code", pid: null, commands: [], interrupt: async () => { stop(); return true; }, close() {} }, turn: null, idle: null };
  const task = code.mustTask(taskId);
  const n = (task.turns || []).length + 1;
  const user = code.addItem(taskId, { kind: "user", text: "Sigue: que el resumen del pago enseñe el cupón aplicado.", turn: n });
  entry.turn = { n, mode: "build", startSnap: task.turns.at(-1)?.endSnap || task.baseSnap, userItemId: user.id, started: Date.now(), live: "", tools: new Map(), lastAssistant: null };
  code.engines.set(taskId, entry);
  code.setTask(taskId, { status: "working" });
  let k = 0, timer = null, words = [];
  const tick = () => {
    if (!entry.turn) return;
    if (!words.length) {
      const [verb, , detail, say] = steps[k++ % steps.length];
      const id = "toolu_qa_" + k;
      code.onEvent(taskId, entry, { type: "tool", id, name: verb === "run" ? "Bash" : verb === "read" ? "Read" : "Edit", input: verb === "run" ? { command: detail } : { file_path: detail } });
      setTimeout(() => code.onEvent(taskId, entry, { type: "toolDone", id, output: verb === "run" ? "ℹ pass 4\nℹ fail 0" : "" }), 900);
      words = say.split(/(?<= )/);
      if (k % steps.length === 0) code.onEvent(taskId, entry, { type: "text", text: entry.turn.live || "Sigo." });
    }
    code.onEvent(taskId, entry, { type: "delta", text: words.shift() });
    timer = setTimeout(tick, words.length ? 120 : 1600);
  };
  const stop = () => { clearTimeout(timer); void code.finishTurn(taskId, entry, null); };
  timer = setTimeout(tick, 400);
}

if (process.argv.includes("--serve")) await serve();
else await seed();
