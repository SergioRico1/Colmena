import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const now = () => new Date().toISOString();
export const id = () => randomUUID();

// Access levels per tool: 'none' | 'lee' | 'escribe' | 'pide' (reads, asks to write).
export const TOOL_KEYS = ["correo", "calendario", "carpeta", "hojas", "chat", "erp"];
const tools = (correo, calendario, carpeta, hojas, chat, erp = "none") => ({ correo, calendario, carpeta, hojas, chat, erp });
export const NO_TOOLS = tools("none", "none", "none", "none", "none");

export const BOT_DEFAULTS = Object.freeze({
  enabled: true,
  audience: "equipo",
  autonomy: "avisa",
  thinking: "equilibrado",
  location: "local",
  personality: { tono: 50, detalle: 50, riesgo: 30 },
  helpers: [],
  delegateFreely: false,
  channels: { colmena: true, correo: false, chat: false, movil: false },
  usesChatGPT: true,
});

// Seeds follow design/Bienvenida + design/Ajustes (matrix «Quién usa qué»).
const SEEDS = [
  ["atlas", "Atlas", "Coordinador", "Convierte objetivos en pasos claros. Reparte responsabilidades y entrega una síntesis respaldada por el trabajo del equipo.", "#FFC93C", "hex", tools("escribe", "escribe", "escribe", "escribe", "escribe")],
  ["nora", "Nora", "Investigación", "Contrasta datos, identifica lagunas y cita las fuentes realmente consultadas. Curiosa, rigurosa y directa.", "#2F6BFF", "circle", tools("none", "none", "escribe", "escribe", "escribe")],
  ["tomas", "Tomás", "Datos y finanzas", "Analiza datos y supuestos. Comprueba cifras y unidades; nunca inventes datos ausentes. Metódico y preciso.", "#0B8A5F", "square", tools("escribe", "none", "pide", "escribe", "escribe")],
  ["iris", "Iris", "Diseño", "Propone direcciones visuales y especificaciones concretas. No afirmes generar imágenes sin una herramienta disponible. Imaginativa y exigente.", "#FF5CA8", "diamond", tools("none", "none", "escribe", "escribe", "escribe")],
  ["vera", "Vera", "Redacción", "Redacta con voz humana, estructura clara y precisión. Adapta el tono al público. Cercana y con criterio.", "#7B4DFF", "leaf", tools("escribe", "escribe", "escribe", "none", "escribe")],
  ["bruno", "Bruno", "Código", "Resuelve problemas técnicos, produce código revisable y distingue pruebas ejecutadas de recomendaciones. Pragmático y cuidadoso.", "#FF7A1A", "arch", tools("none", "none", "escribe", "escribe", "escribe")],
];
// Roles written by earlier versions; migrated to the approved design names.
// Instructions of earlier seeds (without accents), replaced only if never edited.
const LEGACY_INSTRUCTIONS = {
  atlas: "Convierte objetivos en pasos claros. Reparte responsabilidades y entrega una sintesis respaldada por el trabajo del equipo.",
  nora: "Contrasta datos, identifica lagunas y cita las fuentes realmente consultadas. Curiosa, rigurosa y directa.",
  tomas: "Analiza datos y supuestos. Comprueba cifras y unidades; nunca inventes datos ausentes. Metodico y preciso.",
  iris: "Propone direcciones visuales y especificaciones concretas. No afirmes generar imagenes sin una herramienta disponible. Imaginativa y exigente.",
  vera: "Redacta con voz humana, estructura clara y precision. Adapta el tono al publico. Cercana y con criterio.",
  bruno: "Resuelve problemas tecnicos, produce codigo revisable y distingue pruebas ejecutadas de recomendaciones. Pragmatico y cuidadoso.",
};
const LEGACY_ROLES = { "Investigacion": "Investigación", "Diseno y creatividad": "Diseño", "Comunicacion": "Redacción", "Codigo y sistemas": "Código" };

export const LEO = {
  id: "leo",
  name: "Leo",
  role: "Asistente legal",
  instructions:
    "Revisas los contratos con proveedores. Señalas renovaciones automáticas, penalizaciones, permanencias y cambios de precio, citando la página. Llevas un calendario de renovaciones y avisas 30 días antes de cada preaviso. No das consejo legal definitivo: si algo es dudoso, lo dices y propones consultarlo con tu asesoría.",
  color: "#0E7C86",
  shape: "circle",
  autonomy: "sugiere",
  tools: tools("none", "escribe", "lee", "none", "escribe"),
};

export const BOT_SEEDS = SEEDS.map(([botId, name, role, instructions, color, shape, botTools]) => ({
  ...structuredClone(BOT_DEFAULTS),
  id: botId,
  name,
  role,
  instructions,
  color,
  shape,
  tools: botTools,
  builtin: true,
  createdAt: now(),
}));
export const SEED_TOOLS = Object.fromEntries([...SEEDS.map((s) => [s[0], s[6]]), ["leo", LEO.tools]]);

export const SETTINGS_DEFAULTS = Object.freeze({
  model: "",
  spaceName: "Mi espacio",
  userName: "Tu cuenta",
  userRole: "Administrador",
  onboarded: false,
  learning: true,
  limits: { monthlyTokens: null, pauseAtLimit: true, warnAt80: true },
  fallback: "none",
  paused: false,
});

/** Bot with every contract field present; existing values always win. */
export function withBotDefaults(bot) {
  const d = structuredClone(BOT_DEFAULTS);
  return {
    ...d,
    ...bot,
    personality: { ...d.personality, ...(bot.personality || {}) },
    channels: { ...d.channels, ...(bot.channels || {}) },
    tools: { ...(SEED_TOOLS[bot.id] && bot.builtin !== false ? SEED_TOOLS[bot.id] : NO_TOOLS), ...(bot.tools || {}) },
    helpers: Array.isArray(bot.helpers) ? bot.helpers : [],
  };
}

const EVENT_RETENTION_DAYS = 30;
// Tool bodies older than this keep a preview only (pruneReceipts).
const SLIM_AFTER_DAYS = 7, SLIM_MAX = 32 * 1024, PREVIEW_CHARS = 4000;

export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true });
    this.directory = directory;
    this.db = new DatabaseSync(path.join(directory, "colmena.sqlite"));
    // T3 Code's set: WAL with synchronous=NORMAL (FULL waits for the disk on every commit and
    // stalls the event loop; in WAL a crash can lose the last commit, never corrupt the file),
    // the WAL file kept under 32 MB, and space handed back in steps (incremental auto_vacuum,
    // which only a new database takes: see maintain).
    const fresh = !this.db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' LIMIT 1").get();
    if (fresh) this.db.exec("PRAGMA auto_vacuum=INCREMENTAL;");
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA journal_size_limit=33554432;" +
        "CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL, PRIMARY KEY(kind,id));" +
        "CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT,mission TEXT,data TEXT NOT NULL);" +
        "CREATE INDEX IF NOT EXISTS events_mission ON events(mission, seq);" +
        "CREATE INDEX IF NOT EXISTS records_mission ON records(kind, json_extract(data,'$.missionId'));",
    );
    this.listeners = new Set();
    this.depth = 0;
    this.queued = [];
    this.statements = new Map();
    this.migrate();
    this.purgeEvents();
  }
  sql(text) {
    let s = this.statements.get(text);
    if (!s) this.statements.set(text, (s = this.db.prepare(text)));
    return s;
  }
  migrate() {
    this.tx(() => {
      const fresh = !this.get("settings", "main");
      if (fresh) for (const b of BOT_SEEDS) this.put("bots", b);
      const settings = this.get("settings", "main") || { id: "main" };
      const merged = {
        ...structuredClone(SETTINGS_DEFAULTS),
        ...settings,
        limits: { ...SETTINGS_DEFAULTS.limits, ...(settings.limits || {}) },
      };
      // Autonomy by default (2026-10-20): changes that stay in your own accounts run on their
      // own, so the app columns set to «Lee» become «Escribe» once. «Pide para escribir» and
      // «No» are kept; a «Lee» you choose afterwards stays.
      const appWrites = !fresh && !settings.appWrites;
      if (!settings.appWrites) merged.appWrites = true;
      if (JSON.stringify(merged) !== JSON.stringify(settings)) this.put("settings", merged);
      const seedIds = new Set([...SEEDS.map((s) => s[0]), "leo"]);
      for (const bot of this.list("bots")) {
        const next = withBotDefaults({ ...bot, builtin: bot.builtin ?? seedIds.has(bot.id) });
        if (appWrites) for (const [key, value] of Object.entries(next.tools || {})) if (value === "lee") next.tools[key] = "escribe";
        if (next.builtin && LEGACY_ROLES[next.role]) next.role = LEGACY_ROLES[next.role];
        if (next.builtin && LEGACY_INSTRUCTIONS[next.id] === next.instructions)
          next.instructions = BOT_SEEDS.find((b) => b.id === next.id).instructions;
        if (next.builtin && next.id === "tomas" && next.name === "Tomas") next.name = "Tomás";
        // Desktop-only for now: always on this computer, no mobile channel.
        next.location = "local";
        next.channels.movil = false;
        if (JSON.stringify(next) !== JSON.stringify(bot)) this.put("bots", next);
      }
    });
  }
  /** Runs `fn` atomically (BEGIN IMMEDIATE). Nested calls join the outer transaction. */
  tx(fn) {
    if (this.depth > 0) {
      this.depth++;
      try {
        return this.check(fn());
      } finally {
        this.depth--;
      }
    }
    this.db.exec("BEGIN IMMEDIATE");
    this.depth = 1;
    let result;
    try {
      result = this.check(fn());
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      this.queued = [];
      throw error;
    } finally {
      this.depth = 0;
    }
    const pending = this.queued;
    this.queued = [];
    for (const change of pending) this.dispatch(change);
    return result;
  }
  check(result) {
    if (result && typeof result.then === "function")
      throw Error("Las transacciones del almacén deben ser síncronas.");
    return result;
  }
  notify(change) {
    if (this.depth > 0) this.queued.push(change);
    else this.dispatch(change);
  }
  dispatch(change) {
    for (const fn of [...this.listeners]) {
      try {
        fn(change);
      } catch (error) {
        console.warn("Colmena: un oyente del almacén falló: " + error.message);
      }
    }
  }
  list(kind) {
    return this.sql("SELECT data FROM records WHERE kind=? ORDER BY rowid")
      .all(kind)
      .map((r) => JSON.parse(r.data));
  }
  /** Records of a kind whose top-level `field` equals `value` (indexed for missionId). */
  where(kind, field, value) {
    if (!/^[A-Za-z0-9_]+$/.test(field)) throw Error("Campo no válido.");
    return this.sql(`SELECT data FROM records WHERE kind=? AND json_extract(data,'$.${field}')=? ORDER BY rowid`)
      .all(kind, value)
      .map((r) => JSON.parse(r.data));
  }
  /** Selected top-level fields of every record of a kind, without parsing the full JSON in JS. */
  columns(kind, fields) {
    if (!fields.every((f) => /^[A-Za-z0-9_]+$/.test(f))) throw Error("Campo no válido.");
    const select = fields.map((f) => `json_extract(data,'$.${f}') AS "${f}"`).join(",");
    return this.sql(`SELECT ${select} FROM records WHERE kind=? ORDER BY rowid`).all(kind);
  }
  /** Every record of a kind without some heavy top-level fields (dropped by SQLite, never parsed in JS). */
  listWithout(kind, fields) {
    if (!fields.length || !fields.every((f) => /^[A-Za-z0-9_]+$/.test(f))) throw Error("Campo no válido.");
    const paths = fields.map((f) => `'$.${f}'`).join(",");
    return this.sql(`SELECT json_remove(data,${paths}) AS data FROM records WHERE kind=? ORDER BY rowid`)
      .all(kind)
      .map((r) => JSON.parse(r.data));
  }
  get(kind, id) {
    const row = this.sql("SELECT data FROM records WHERE kind=? AND id=?").get(kind, id);
    return row ? JSON.parse(row.data) : null;
  }
  put(kind, data) {
    if (!data || typeof data.id !== "string" || !data.id) throw Error("Registro sin identificador.");
    const existed = !!this.sql("SELECT 1 AS x FROM records WHERE kind=? AND id=?").get(kind, data.id);
    this.sql(
      "INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
    ).run(kind, data.id, JSON.stringify(data));
    this.notify({ type: "record", kind, id: data.id, op: existed ? "update" : "insert", data });
    return data;
  }
  /** Atomic read-modify-write. `changes` may be an object or a function of the current record. */
  patch(kind, id, changes) {
    return this.tx(() => {
      const old = this.get(kind, id);
      if (!old) throw Error("No existe el registro.");
      const next = typeof changes === "function" ? changes(old) : changes;
      return this.put(kind, { ...old, ...next, id: old.id, updatedAt: now() });
    });
  }
  remove(kind, id) {
    const result = this.sql("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
    if (result.changes) this.notify({ type: "record", kind, id, op: "remove", data: null });
    return result.changes > 0;
  }
  event(mission, type, details = {}) {
    const value = { id: id(), mission, type, ...details, at: now() };
    const result = this.sql("INSERT INTO events(mission,data) VALUES(?,?)").run(mission, JSON.stringify(value));
    value.seq = Number(result.lastInsertRowid);
    this.notify(value);
    return value;
  }
  events(mission) {
    return this.sql("SELECT seq,data FROM events WHERE mission=? ORDER BY seq")
      .all(mission)
      .map((r) => ({ ...JSON.parse(r.data), seq: r.seq }));
  }
  /** Deletes mission events older than the retention window. Returns the number removed. */
  purgeEvents(days = EVENT_RETENTION_DAYS, time = Date.now()) {
    const cutoff = new Date(time - days * 86400000).toISOString();
    return Number(this.sql("DELETE FROM events WHERE json_extract(data,'$.at') < ?").run(cutoff).changes);
  }
  /**
   * What a tool returned stays whole while it can matter (a step resumes from its receipts, the
   * person opens a recent card); after `days` a big one keeps a short preview (T3 Code caps
   * stored tool bodies at 32 KB and drops image bytes). Finished steps lose their old tool
   * outputs the same way; messages, deliverables and the receipts' own fields stay.
   */
  pruneReceipts(days = SLIM_AFTER_DAYS, time = Date.now(), { max = SLIM_MAX } = {}) {
    const cutoff = new Date(time - days * 86400000).toISOString();
    const slim = (value) => {
      const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
      return text.length <= max ? value : { recortado: true, nota: "Guardado en resumen al cabo de unos días.", vista: text.slice(0, PREVIEW_CHARS) };
    };
    let changed = 0;
    this.tx(() => {
      for (const row of this.sql("SELECT kind, id, data FROM records WHERE kind IN ('receipts','approvals','steps') AND length(data) > ?").all(max)) {
        const r = JSON.parse(row.data);
        const at = r.at || r.updatedAt || r.completedAt || r.createdAt || "";
        if (!at || at >= cutoff) continue;
        let next = null;
        if (row.kind === "receipts" && JSON.stringify(r.result ?? null).length > max) next = { ...r, result: slim(r.result) };
        if (row.kind === "approvals" && r.status !== "pending" && JSON.stringify(r.result ?? null).length > max) next = { ...r, result: slim(r.result) };
        if (row.kind === "steps" && ["completed", "failed", "cancelled"].includes(r.status) && Array.isArray(r.history)) {
          const history = r.history.map((x) => x?.type === "function_call_output" && String(x.output ?? "").length > max ? { ...x, output: JSON.stringify(slim(String(x.output))) } : x);
          if (history.some((x, i) => x !== r.history[i])) next = { ...r, history };
        }
        if (!next) continue;
        this.sql("UPDATE records SET data=? WHERE kind=? AND id=?").run(JSON.stringify(next), row.kind, row.id);
        changed++;
      }
    });
    return changed;
  }
  /**
   * Periodic upkeep (scheduler, every PURGE_MS): old events and receipts go, freed pages are
   * handed back a few at a time and the WAL is folded into the database without blocking.
   */
  maintain(time = Date.now()) {
    const removed = { events: this.purgeEvents(undefined, time), receipts: this.pruneReceipts(undefined, time) };
    // Never VACUUM: it may renumber the rowids of `records`, and the store keeps insertion
    // order with ORDER BY rowid. A database made before auto_vacuum just reuses its free pages.
    try { this.db.exec("PRAGMA incremental_vacuum(1024); PRAGMA wal_checkpoint(PASSIVE);"); } catch {}
    return removed;
  }
  close() {
    this.statements.clear();
    this.db.close();
  }
}
