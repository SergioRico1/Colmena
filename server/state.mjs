import { impactOf, ownDomainsOf } from "./impact.mjs";
import { engineName, whenText } from "./limits.mjs";
import { appActionLabel, appLabel } from "./appactions.mjs";
import { isAppToolName } from "./apptools.mjs";
import { createHash } from "node:crypto";
import { chooseModel } from "./models.mjs";
import { ago, subtitle, TOOLKITS, CONNECTOR_NAMES, editorConfig } from "./triggers.mjs";
import { TOOL_KEYS } from "./store.mjs";
import { extraToolCard, documentCardExtras, webSearchToolCall, recoveryToolCalls } from "./tools.mjs";
import { isProjectTool, projectToolCard } from "./projects/tools.mjs";

// Computed, lightweight view for GET /api/state (docs/CONTRACT.md §1).
// Never includes large contents (artifact text, SKILL.md, SOUL, provider history).

export const MISSION_LABELS = {
  queued: "Pendiente", planning: "Atlas prepara el plan", awaiting_plan: "Revisa el plan", running: "En marcha",
  waiting: "Te espera", paused: "En pausa", blocked: "Bloqueada", awaiting_choice: "Elige una propuesta",
  completed: "Terminada", cancelled: "Cancelada", failed: "Bloqueada",
};
const BOT_LABELS = { trabaja: "Trabaja", espera: "Te espera", libre: "Libre", pausado: "En pausa", bloqueado: "Bloqueado", limitado: "Limitado" };
const OPEN = new Set(["queued", "planning", "awaiting_plan", "running", "waiting", "paused", "blocked", "awaiting_choice"]);
const WORKING = new Set(["queued", "planning", "running"]);
const WEEK = 7 * 86400000;

const slug = (s) =>
  String(s || "sala").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "sala";
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k] ?? null]));

export const missionRoom = (m) => m.room || slug(m.title);

/** Activity map from the runtime (Map or plain object) as botId → { verb, missionId, detail }. */
function activityOf(runtime) {
  const a = runtime?.activity;
  if (!a) return new Map();
  return a instanceof Map ? a : new Map(Object.entries(a));
}

const FORMATS = { md: "document", txt: "document", doc: "document", docx: "document", csv: "table", tsv: "table", xlsx: "sheet", json: "code", py: "code", js: "code", ts: "code", html: "design", svg: "design", pptx: "slides" };
export function artifactSummary(a, missions) {
  const ext = /\.([a-z0-9]{1,6})$/i.exec(a.title || a.path || "")?.[1]?.toLowerCase();
  const format = a.format || ext || "md";
  const kind = ["document", "table", "slides", "design", "code", "sheet"].includes(a.kind) ? a.kind : FORMATS[format] || "document";
  const m = missions?.get?.(a.missionId);
  return {
    id: a.id, missionId: a.missionId ?? null, stepId: a.stepId ?? null, botId: a.botId ?? m?.botIds?.[0] ?? null, title: a.title || "Entregable",
    kind, format, status: a.status || "final", version: a.version || 1, room: a.room || (m ? missionRoom(m) : null),
    createdAt: a.createdAt ?? null, updatedAt: a.updatedAt ?? null,
    // Its working file in the mission folder (code you can run, a page with «Vista previa»).
    ...(a.workFile ? { workFile: a.workFile } : {}),
    // A presentation: how many slides, whether each has its picture and whether there is a PDF.
    ...(a.deck ? { slides: a.slides || a.deck.slides?.length || 0, thumbs: (a.thumbs || []).length, pdf: !!a.pdf, theme: a.deck.theme || "colmena" } : {}),
    // A Word document: its pages (pictures once the desktop app printed it) and whether there is a PDF.
    ...(a.document ? { paged: true, pages: a.pages || 0, thumbs: (a.thumbs || []).length, pdf: !!a.pdf } : {}),
    // An Excel workbook: its sheets (the tabs of the preview) and how many data rows.
    ...(a.workbook ? { sheets: (a.workbook.sheets || []).map((s) => s.name), rows: a.rows ?? 0, charts: (a.charts || []).length } : {}),
  };
}

export function skillSummary(s) {
  return {
    id: s.id, name: s.name, description: s.description || "", botId: s.botId ?? null,
    status: s.status || "pending", origin: s.origin || (s.missionId ? "learned" : "imported"), version: s.version || 1,
    steps: s.steps ?? (String(s.content || "").match(/^\s*\d+[.)]\s+\S/gm) || []).length,
    uses: s.uses || 0, learnedFrom: s.learnedFrom ?? null, missionId: s.missionId ?? null, createdAt: s.createdAt ?? null,
  };
}

const SOURCE_LABELS = { importado: "De ChatGPT", dijiste: "Se lo dijiste", dedujo: "Lo dedujo", acuerdo: "Acuerdo del equipo", documento: "De un documento" };
const MS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export function memorySummary(m) {
  const scope = m.scope || (m.botId ? "bot" : "equipo");
  const origin = m.origin || (m.source === "dijiste" || (!m.source && !m.missionId) ? "persona" : "bot");
  const source = m.source && SOURCE_LABELS[m.source] ? m.source : m.missionId ? "dedujo" : "dijiste";
  const review = m.review ?? false;
  const date = m.createdAt ? new Date(m.createdAt) : null;
  const sourceLabel = origin === "externo" && review
    ? "Viene de una web, un correo o una app · confírmalo para que lo usen"
    : review
    ? SOURCE_LABELS[source] + " · revisar"
    : scope === "equipo" && source !== "dijiste" && source !== "importado"
      ? "Compartido · equipo"
      : SOURCE_LABELS[source] + (date ? " · " + date.getDate() + " " + MS[date.getMonth()] : "");
  return { id: m.id, text: m.text, botId: m.botId ?? null, scope, source, sourceLabel, review, origin, missionId: m.missionId ?? null, createdAt: m.createdAt ?? null };
}

// ---- Approvals bound to their exact content (OpenMuse actions.ts, MIT: licenses/OpenMuse.txt) ----
/** Sends and outbound app actions must be decided within 30 minutes of being prepared. */
export const APPROVAL_TTL_MS = 30 * 60 * 1000;
const REVIEW_KEYS = ["name", "toolkit", "tool", "account", "account_id", "account_alias", "arguments", "revision"];
const stable = (value) =>
  Array.isArray(value)
    ? "[" + value.map(stable).join(",") + "]"
    : value && typeof value === "object"
      ? "{" + Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + stable(value[k])).join(",") + "}"
      : JSON.stringify(value ?? null);
/**
 * SHA-256 of everything the person reviews (email, fields, command, arguments, options…)
 * plus the account and version it targets. Any change means the decision is stale.
 */
export function approvalRevision(a) {
  const review = a.review && typeof a.review === "object" ? Object.fromEntries(REVIEW_KEYS.filter((k) => a.review[k] !== undefined).map((k) => [k, a.review[k]])) : null;
  const content = {
    id: a.id, kind: a.kind ?? null, tool: a.tool ?? null, title: a.title ?? null, summary: a.summary ?? null,
    email: a.email ?? null, options: a.options ?? null, args: a.args ?? null, plan: a.plan ?? null, review,
    command: a.command ?? null, proposal: a.proposal ?? null, skillId: a.skillId ?? null, target: a.target ?? null,
    account: a.account ?? a.review?.account ?? a.review?.account_id ?? a.args?.account ?? null,
    version: a.version ?? null, editedAt: a.editedAt ?? null,
  };
  return createHash("sha256").update(stable(content)).digest("hex");
}
/** True for actions that leave this computer: sends and app actions behind a red line. */
export function isExternalApproval(a, kind = a.kind) {
  return kind === "send" || a.tool === "apps_execute" || !!a.redLine;
}
/** ISO time when a pending external approval stops being valid, or null. */
export function approvalExpiresAt(a, kind = a.kind) {
  if (a.status !== "pending" || !isExternalApproval(a, kind)) return null;
  const base = Math.max(...[a.preparedAt, a.editedAt, a.createdAt].map((t) => Date.parse(t || "")).filter((t) => !Number.isNaN(t)), -Infinity);
  return Number.isFinite(base) ? new Date(base + APPROVAL_TTL_MS).toISOString() : null;
}

/** Approval in contract shape; tolerant to records written by older runtimes. */
export function approvalView(a, { bots, missions, automations, reference = Date.now(), stepsByMission, ownDomains = [] }) {
  const bot = bots.get(a.botId);
  const m = missions.get(a.missionId);
  const legacyKind = a.tool === "write_file" ? "write" : a.tool === "remember" ? "memory" : a.tool === "apps_execute" ? (a.kind === "send" ? "send" : "permission") : null;
  const kind = a.kind && a.tool !== "apps_execute" ? a.kind : legacyKind || a.kind || "permission";
  const args = a.args || {};
  const sendArgs = a.review?.arguments || {};
  const email =
    a.email ??
    (kind === "send" && a.review
      ? {
          // Everyone it goes to, also the «extra_recipients» the direct Gmail tool may add.
          to: [...String(sendArgs.recipient_email || "").split(","), ...(Array.isArray(sendArgs.extra_recipients) ? sendArgs.extra_recipients : [])].map((x) => String(x).trim()).filter(Boolean),
          cc: sendArgs.cc || [], cco: sendArgs.bcc || [], subject: sendArgs.subject || a.review?.thread?.subject || "", body: sendArgs.body || sendArgs.message_body || "", attachments: [],
        }
      : null);
  const title =
    a.title ||
    { write: "Crear «" + (args.path || "archivo") + "»", memory: "Guardar un recuerdo", send: "Enviar «" + (email?.subject || "correo") + "»", permission: a.review?.name || "Permiso para continuar", question: "Tiene una pregunta", plan: "Revisar el plan", skill: "Nueva habilidad", soul: "Cambio de personalidad" }[kind] ||
    "Necesita tu OK";
  const summary =
    a.summary ||
    (kind === "write" ? (bot?.name || "Un bot") + " quiere crear el archivo " + (args.path || "") + " en la misión." :
      kind === "memory" ? "«" + String(args.text || "").slice(0, 240) + "»" :
        kind === "send" ? "Enviar a " + (email?.to?.join(", ") || "destinatarios") + ": " + (email?.subject || "") :
          a.review ? (a.review.name || "Acción") + " en " + (a.review.account_alias || a.review.toolkit || "una app conectada") : title);
  const where = m ? (m.automationId && automations.get(m.automationId) ? automations.get(m.automationId).name : "#" + missionRoom(m)) : null;
  const context = a.context || [bot?.name, where, a.createdAt ? ago(a.createdAt, reference) : null].filter(Boolean).join(" · ");
  const pending = a.status === "pending";
  const blocked = pending ? (stepsByMission.get(a.missionId) || []).filter((s) => s.status === "waiting").length : 0;
  const expiresAt = kind === "secret" ? a.expiresAt ?? null : approvalExpiresAt(a, kind);
  const expired = !!expiresAt && Date.parse(expiresAt) <= reference;
  // Red lines say in one sentence what they affect (recipients, money, visibility, deletions).
  const impact = a.redLine || kind === "send" || a.tool === "apps_execute"
    ? impactOf({ tool: a.review?.name || a.review?.tool || a.tool, kind, payload: kind === "send" && email ? { recipient_email: email.to, cc: email.cc, bcc: email.cco } : (a.review?.arguments || args), ownDomains: ownDomains || [] })
    : null;
  return {
    id: a.id, missionId: a.missionId ?? null, stepId: a.stepId ?? null, botId: a.botId ?? null,
    status: expired ? "expired" : a.status === "executing" ? "approved" : a.status, kind, title, summary, context,
    revision: approvalRevision(a), expiresAt, external: isExternalApproval(a, kind),
    computer: !!a.computer, redLine: !!a.redLine, scopeLabel: a.scopeLabel ?? null,
    // An action in a connected app: which app, so «Siempre en Google Calendar» can say it.
    app: a.tool === "apps_execute" && a.review?.toolkit ? appLabel(a.review.toolkit) : null,
    // A send you asked for yourself leaves on its own at this time (cancel it before).
    autoSendAt: pending ? a.autoSendAt ?? null : null, askedByYou: !!a.askedByYou,
    blocks: a.blocks ?? (pending ? Math.max(1, blocked) : 0),
    options: kind === "question" ? a.options || [] : [],
    // A key request: its name, why, for which sites and whether it replaces one (never a value).
    secret: kind === "secret" && a.secret ? { name: a.secret.name, reason: a.secret.reason, allowedHosts: a.secret.allowedHosts || [], existing: a.secret.existing || null } : null,
    email: kind === "send" ? email : null,
    impact,
    edited: !!a.edited,
    canAlways: a.canAlways ?? (pending && ["write", "permission"].includes(kind)),
    createdAt: a.createdAt ?? null, decidedAt: a.decidedAt ?? null,
    decidedBy: a.decidedBy ?? (a.decidedAt ? "tú" : null), resolution: a.resolution ?? null,
    denyReason: a.denyReason ?? null, reviewing: !!a.reviewing, reviewNote: a.reviewNote ?? null,
  };
}

function activityLine(m, ctx) {
  const name = (botId) => ctx.bots.get(botId)?.name || "Un bot";
  if (m.activityLine) return m.activityLine;
  if (m.status === "paused" && m.limited) {
    const when = whenText(m.limited.resetsAt || m.limited.resumeAt);
    return "Limitado · " + engineName(m.limited.engine) + " renueva su límite" + (when ? " " + when : " pronto");
  }
  if (m.status === "running" || m.status === "queued") {
    for (const [botId, act] of ctx.activity) if (act?.missionId === m.id) return name(botId) + " está " + (act.verb || "trabajando") + (act.detail ? " · " + act.detail : "");
    const step = (ctx.stepsByMission.get(m.id) || []).find((s) => s.status === "running");
    if (step) return name(step.botId) + " está trabajando";
    return m.status === "queued" ? "En cola" : "En marcha";
  }
  if (m.status === "waiting") {
    const p = ctx.pendingByMission.get(m.id) || [];
    const q = p.filter((a) => a.kind === "question").length;
    const other = p.length - q;
    const parts = [q ? plural(q, "pregunta", "preguntas") : null, other ? plural(other, "permiso", "permisos") : null].filter(Boolean);
    return "Te espera" + (parts.length ? ": " + parts.join(" y ") : "");
  }
  if (m.status === "planning") return "Atlas prepara el plan";
  if (m.status === "awaiting_plan") return "Revisa el plan de Atlas";
  if (m.status === "awaiting_choice") return "Elige una propuesta";
  if (m.status === "blocked" || m.status === "failed") return m.error || "Bloqueada";
  if (m.status === "paused") return "En pausa";
  if (m.status === "completed") return "Entrega lista";
  return MISSION_LABELS[m.status] || "";
}

export function missionSummary(m, ctx) {
  const steps = ctx.stepsByMission.get(m.id) || [];
  const pending = ctx.pendingByMission.get(m.id) || [];
  return {
    id: m.id, title: m.title, room: missionRoom(m), prompt: String(m.prompt || "").slice(0, 500),
    mode: m.mode || "solo", botIds: m.botIds || [], conversation: !!m.conversation, conversationOf: m.conversationOf ?? null,
    incognito: !!m.incognito, expiresAt: m.incognito ? m.expiresAt ?? null : null,
    status: m.status, statusLabel: m.status === "paused" && m.limited ? "Limitado" : MISSION_LABELS[m.status] || m.status, activityLine: activityLine(m, ctx),
    // Paused by an AI's usage limit: which one, when it renews, when the work goes on alone.
    limited: m.status === "paused" && m.limited ? { engine: m.limited.engine, label: m.limited.label, window: m.limited.window ?? null, resetsAt: m.limited.resetsAt ?? null, resumeAt: m.limited.resumeAt ?? null, botIds: m.limited.botIds || [] } : null,
    // The working bot's own line («Ya tengo dos tarifas…»), for the sidebar.
    narration: (() => { const s = steps.find((x) => x.status === "running" && x.narration?.text); return s ? { botId: s.botId, text: s.narration.text } : null; })(),
    progress: { done: steps.filter((s) => s.status === "completed").length, total: steps.length },
    // «Qué ha pasado aquí» in 1–3 sentences (recaps.mjs); status writing | ok | failed.
    recap: m.recap ? { text: m.recap.text || null, at: m.recap.at || null, status: m.recap.status || "ok" } : null,
    pendingCount: pending.length, questionCount: pending.filter((a) => a.kind === "question").length,
    // What you wrote while it worked, waiting for its turn (queue.mjs).
    queue: Array.isArray(m.queue) ? m.queue.map((q) => ({ id: q.id, text: q.text, at: q.at ?? null })) : [], queuePaused: m.queue?.length ? m.queuePaused ?? null : null,
    safety: m.safety || "avisar", queueMode: m.queueMode || "steer", quiet: m.quiet ?? null, suggestions: m.suggestions?.list || [], dueAt: m.dueAt ?? null, automationId: m.automationId ?? null,
    createdAt: m.createdAt ?? null, updatedAt: m.updatedAt ?? null, completedAt: m.completedAt ?? null,
    error: m.error ?? null, chosenBotIds: m.chosenBotIds || (m.chosenBotId ? [m.chosenBotId] : []),
    snoozedUntil: m.snoozedUntil ?? null, archived: !!m.archived, forkOf: m.forkOf ?? null, nothingNew: !!m.nothingNew,
    watch: !!m.watch, // «Tus novedades» (watch.mjs)
    thread: !!m.thread, // the bot's single chat (threads.mjs)
    // The last thing said in a chat, for its row in «Chats» (Markdown marks out).
    lastLine: m.conversation && m.result ? String(m.result).replace(/[*_#>`|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 140) : null,
  };
}

const BOT_FIELDS = ["id", "name", "role", "instructions", "color", "shape", "enabled", "builtin", "audience", "personality", "autonomy", "thinking", "location", "tools", "helpers", "delegateFreely", "channels", "usesChatGPT", "engine", "portrait", "createdAt", "updatedAt"];
export function botView(b, ctx) {
  const mine = ctx.missionsByBot.get(b.id) || [];
  const open = mine.filter((m) => OPEN.has(m.status));
  const waitingIn = new Set((ctx.pendingByBot.get(b.id) || []).map((a) => a.missionId)).size;
  const act = ctx.activity.get(b.id) || null;
  const working = act || open.some((m) => WORKING.has(m.status) && (ctx.stepsByMission.get(m.id) || []).some((s) => s.botId === b.id && s.status === "running"));
  // «Limitado»: its work waits for an AI's plan to renew (limits.mjs, Runtime#resumeLimited).
  const limited = open.find((m) => m.status === "paused" && m.limited && (!m.limited.botIds?.length || m.limited.botIds.includes(b.id)))?.limited || null;
  const status = ctx.paused || b.paused ? "pausado" : working ? "trabaja" : limited ? "limitado" : waitingIn ? "espera" : open.some((m) => m.status === "blocked") ? "bloqueado" : "libre";
  return {
    ...pick(b, BOT_FIELDS),
    helpers: b.helpers || [],
    status, statusLabel: BOT_LABELS[status],
    activity: act ? { verb: act.verb || "pensando", missionId: act.missionId ?? null, detail: act.detail ?? null } : null,
    waitingIn, missionCount: open.length, usesTotal: mine.length,
    limited: limited ? { engine: limited.engine, label: limited.label, resetsAt: limited.resetsAt ?? null, resumeAt: limited.resumeAt ?? null } : null,
  };
}

/** Indexes shared by the state and the detail endpoints. */
export function context(store, runtime, reference = Date.now()) {
  const bots = new Map(store.list("bots").map((b) => [b.id, b]));
  const missionList = store.list("missions");
  const missions = new Map(missionList.map((m) => [m.id, m]));
  const automations = new Map(store.list("automations").map((a) => [a.id, a]));
  const stepsByMission = new Map();
  for (const s of store.columns("steps", ["missionId", "status", "botId", "kind"])) {
    if (!stepsByMission.has(s.missionId)) stepsByMission.set(s.missionId, []);
    stepsByMission.get(s.missionId).push(s);
  }
  // «Your organisation»: the domains of your account and of the people you added.
  let accountEmail = null;
  try { accountEmail = runtime?.accountEmail?.() || null; } catch {}
  const ownDomains = ownDomainsOf([accountEmail, ...store.list("people").map((p) => p.email)].filter(Boolean));
  const ctx = { bots, missions, automations, stepsByMission, reference, activity: activityOf(runtime), paused: !!store.get("settings", "main")?.paused, ownDomains };
  const approvals = store.list("approvals").map((a) => approvalView(a, ctx));
  ctx.approvals = approvals;
  ctx.pendingByMission = new Map();
  ctx.pendingByBot = new Map();
  for (const a of approvals.filter((x) => x.status === "pending")) {
    for (const [map, key] of [[ctx.pendingByMission, a.missionId], [ctx.pendingByBot, a.botId]]) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(a);
    }
  }
  ctx.missionsByBot = new Map();
  for (const m of missionList)
    for (const botId of new Set([...(m.botIds || []), ...(m.mode === "equipo" ? ["atlas"] : [])])) {
      if (!ctx.missionsByBot.has(botId)) ctx.missionsByBot.set(botId, []);
      ctx.missionsByBot.get(botId).push(m);
    }
  return ctx;
}

/** Connected accounts are cached; /api/state never waits on the network. */
export class ConnectorCache {
  constructor(connections, onChange = () => {}, ttl = 60000) {
    this.connections = connections;
    this.onChange = onChange;
    this.ttl = ttl;
    this.items = [];
    this.at = 0;
    this.loading = null;
  }
  get() {
    if (this.connections && !this.loading && Date.now() - this.at > this.ttl) this.refresh();
    return this.items;
  }
  refresh() {
    if (!this.connections) return Promise.resolve([]);
    this.loading = Promise.race([
      this.connections.call("accounts", { cursor: "" }),
      new Promise((_, reject) => setTimeout(() => reject(Error("timeout")), 8000).unref?.()),
    ])
      .then((r) => (Array.isArray(r?.items) ? r.items : []))
      .catch(() => [])
      .then((items) => {
        const changed = JSON.stringify(items.map((i) => [i.id, i.toolkit, i.status])) !== JSON.stringify(this.items.map((i) => [i.id, i.toolkit, i.status]));
        this.items = items;
        this.at = Date.now();
        this.loading = null;
        if (changed) this.onChange();
        return items;
      });
    return this.loading;
  }
}

export function connectorsView(accounts, bots, folders) {
  return Object.keys(TOOLKITS).map((key) => {
    const connected =
      accounts.some((a) => a.status === "ACTIVE" && TOOLKITS[key].includes(String(a.toolkit).toLowerCase())) || (key === "carpeta" && folders.length > 0);
    const botCount = TOOL_KEYS.includes(key) ? bots.filter((b) => b.enabled && b.tools?.[key] && b.tools[key] !== "none").length : 0;
    return { id: key, name: CONNECTOR_NAMES[key], connected, botCount };
  });
}

const safe = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

/** GET /api/state. `extras` carries values owned by app.mjs (auth, caches, optional modules). */
export function buildState(store, runtime, extras = {}) {
  const reference = Date.now();
  const ctx = context(store, runtime, reference);
  const settings = store.get("settings", "main") || {};
  const { id: _id, holidays: _h, ...publicSettings } = settings;
  const account = safe(() => extras.session?.status?.()) || null;
  const provider =
    safe(() => runtime?.provider?.status?.()) ||
    (account ? { kind: "chatgpt", label: "ChatGPT" } : { kind: null, label: "Sin conectar" });
  const bots = [...ctx.bots.values()];
  const folders = store.list("folders").map((f) => pick(f, ["id", "path", "label", "botIds", "access", "createdAt"]));
  const recent = (a) => a.status === "pending" || reference - Date.parse(a.decidedAt || a.createdAt || 0) < WEEK;
  // Your name: the one you set, else the name of your ChatGPT account (or its email),
  // never the placeholder «Tu cuenta» when we know better.
  const fromEmail = (e) => String(e || "").split("@")[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  const ownName = settings.userName && settings.userName !== "Tu cuenta" ? settings.userName : (account?.name || fromEmail(account?.email) || "Tu cuenta");
  const user = { id: "me", name: ownName, email: account?.email || null, role: settings.userRole || "Administrador", self: true };
  return {
    account,
    provider,
    authError: extras.authError ?? null,
    models: extras.models || [],
    settings: publicSettings,
    usage: extras.usage || { monthTokens: 0, limitTokens: settings.limits?.monthlyTokens ?? null, percent: null },
    // The ChatGPT plan's own windows, when the backend reports them (provider planLimitsOf).
    planLimits: runtime?.planLimits || null,
    paused: !!settings.paused,
    computer: { available: !!extras.computer?.available },
    // ChatGPT, Claude and OpenCode Go: which are connected, the team's engine, the substitute.
    ai: safe(() => {
      const hub = runtime?.provider;
      if (typeof hub?.engines !== "function") return null;
      const c = hub.config();
      return { engines: hub.engines(), primary: hub.primary, local: !!(c.local?.baseUrl && c.local?.model), fallback: c.fallback ?? settings.fallback ?? "none", pins: c.pins || {}, catalog: Object.fromEntries(["anthropic", "opencode-go"].map((e) => [e, hub.modelsFor(e).map((m) => ({ slug: m.slug, label: m.label, families: m.families, utility: m.utility }))])) };
    }) || null,
    bots: bots.map((b) => {
      // Each bot thinks with its engine's models (its own choice, else the team's).
      const own = typeof runtime?.availableModels === "function" && typeof runtime?.provider?.engineFor === "function";
      const pick = chooseModel(b, own ? runtime.availableModels(b) : extras.models || [], own && typeof runtime.fallbackModel === "function" ? runtime.fallbackModel(b, settings.model) : settings.model);
      const engine = own ? runtime.provider.engineFor(b) : null;
      // The bot's engine is out of its plan right now (even if the bot is idle).
      const engineLimit = engine && typeof runtime.provider.limitOf === "function" ? safe(() => runtime.provider.limitOf(engine)) : null;
      return { ...botView(b, ctx), model: pick.slug ? { slug: pick.slug, label: pick.label, family: pick.family, reason: pick.reason, engine } : null, engineLimit: engineLimit ? { engine, label: engineLimit.label, resetsAt: engineLimit.resetsAt ?? null, until: engineLimit.until } : null };
    }),
    missions: [...ctx.missions.values()].map((m) => missionSummary(m, ctx)),
    approvals: ctx.approvals
      .filter(recent)
      .sort((a, b) => String(b.decidedAt || b.createdAt).localeCompare(String(a.decidedAt || a.createdAt))),
    automations: [...ctx.automations.values()].map((r) => automationView(r, reference)),
    suggestions: store
      .list("suggestions")
      .filter((s) => !s.status || ["active", "pending"].includes(s.status))
      .map((s) => pick(s, ["id", "kind", "text", "botId", "cta", "payload", "createdAt"])),
    grants: store
      .list("grants")
      .filter((g) => g.active !== false)
      .map((g) => ({ ...pick(g, ["id", "botId", "tool", "kind", "scope", "origin", "createdAt"]), label: grantLabel(g) })),
    skills: store.list("skills").map(skillSummary),
    memories: store.list("memories").filter((m) => m.active !== false).map(memorySummary),
    artifacts: store.list("artifacts").map((a) => artifactSummary(a, ctx.missions)),
    folders,
    people: [user, ...store.list("people").map((p) => pick(p, ["id", "name", "email", "role", "createdAt"]))],
    connectors: connectorsView(extras.accounts || [], bots, folders),
    ...notificationsState(store),
  };
}

export function notificationView(n) {
  return pick(n, ["id", "kind", "missionId", "botId", "title", "text", "url", "read", "count", "createdAt"]);
}
/** `unread` count and the 10 newest notifications for /api/state. */
export function notificationsState(store) {
  const all = store.list("notifications").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { unread: all.filter((n) => !n.read).length, notifications: all.slice(0, 10).map(notificationView) };
}

export function automationView(r, reference = Date.now()) {
  return {
    id: r.id, name: r.name, botId: r.botId, prompt: r.prompt, enabled: !!r.enabled,
    trigger: r.trigger ? { ...r.trigger, config: editorConfig(r.trigger.type, r.trigger.config) } : null, notify: r.notify || "resultado", needs: r.needs || [],
    state: r.state || "scheduled", nextRun: r.nextRun ?? null, lastRun: r.lastRun ?? null, lastStatus: r.lastStatus ?? null,
    subtitle: subtitle(r, new Date(reference)), error: r.error ?? null, lastMissionId: r.lastMissionId ?? null,
    createdAt: r.createdAt ?? null,
  };
}

const GRANT_KIND = { send: "Enviar correos", read: "Leer de una app", write: "Crear archivos", memory: "Guardar recuerdos", permission: "Permiso", question: "Pregunta" };
function grantLabel(g) {
  if (g.label) return g.label;
  const what = GRANT_KIND[g.kind] || (g.tool === "apps_execute" ? "Acciones en apps conectadas" : g.tool || "Acción");
  const scope = typeof g.scope === "string" ? g.scope : g.scope?.label || g.scope?.toolkit || g.scope?.tool || "";
  return scope ? what + " · " + scope : what;
}

// ---- One card per tool call (OpenMuse useRenderTool) ----------------------------------
const clipText = (v, n) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};
const hostOf = (url) => {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};
const baseName = (p) => String(p || "").split(/[\/]/).filter(Boolean).pop() || String(p || "");
// «Gmail» + «leer correos» for GMAIL_FETCH_EMAILS (in Spanish; the raw words only if no label fits).
const humanAction = (tool) => {
  const parts = String(tool || "").split("_").filter(Boolean);
  const app = parts[0] ? appLabel(parts[0].toLowerCase()) : "";
  const label = appActionLabel(tool);
  const action = label ? label.charAt(0).toLowerCase() + label.slice(1) : parts.slice(1).join(" ").toLowerCase();
  return { app, action };
};

// How many things an app read returned (5 mails, 12 events…), for «Ha leído 5 correos».
const LIST_KEYS = ["messages", "emails", "threads", "events", "items", "files", "results", "records", "values", "rows"];
const listCount = (r) => {
  for (const at of [r, r?.data, r?.data?.data, r?.response_data]) {
    if (Array.isArray(at)) return at.length;
    if (!at || typeof at !== "object") continue;
    for (const k of LIST_KEYS) if (Array.isArray(at[k])) return at[k].length;
  }
  return null;
};

/** Small, safe description of one tool call for its card (never the full page or file). */
export function toolCard(name, args, result, bots) {
  const r = result && typeof result === "object" ? result : {};
  if (name === "web_fetch") return { type: "web", url: r.finalUrl || args.url || null, domain: hostOf(r.finalUrl || args.url), title: clipText(r.title, 140) || null, excerpt: clipText(r.text, 260) || null };
  if (name === "read_file") return { type: "file", name: baseName(args.path), path: args.path || null, chars: typeof r.content === "string" ? r.content.length : null, ...(r.pages > 1 ? { page: r.page, pages: r.pages } : {}), ...documentCardExtras(r) };
  if (name === "read_folder_file") return { type: "file", name: r.name || baseName(args.path), path: args.path || null, page: r.page ?? args.page ?? null, pages: r.pages ?? null, ...documentCardExtras(r) };
  if (name === "list_folder" || name === "list_files") {
    const items = Array.isArray(r) ? r : r.entries || r.files || r.folders || r.items || [];
    return { type: "folder", path: args.path || null, count: Array.isArray(items) ? items.length : null };
  }
  if (name === "search_history" || name === "recall") {
    const items = Array.isArray(r) ? r : r.results || [];
    return { type: "search", query: clipText(args.query, 120) || null, count: Array.isArray(items) ? items.length : null };
  }
  if (name === "create_deliverable" || name === "write_file")
    return { type: "deliverable", title: args.title || baseName(args.path), artifactId: r.artifactId || null, version: r.version ?? null, kind: args.kind || null, format: args.format || null };
  if (name === "ask_bot") {
    const bot = bots?.get?.(args.botId);
    return { type: "bot", botId: args.botId || null, botName: r.name || bot?.name || args.botId || null, question: clipText(args.question, 220) || null, answer: clipText(r.answer, 320) || null };
  }
  if (name === "ask_user") return { type: "question", question: clipText(args.question, 220) || null };
  // Direct app tools (gmail_fetch_emails…) are app actions too; apps_table walks many items.
  if (name === "apps_table") {
    const { app } = humanAction(String(args.tool || "").toUpperCase());
    return { type: "app", app: app || null, action: r.leidos != null ? `revisar ${r.leidos} elementos y sumar` : "revisar muchos elementos", tool: args.tool || null, account: null, query: null };
  }
  if (name !== "apps_execute" && isAppToolName(name)) return toolCard("apps_execute", { ...args, tool: name.toUpperCase() }, result, bots);
  if (name.startsWith("apps_")) {
    const { app, action } = humanAction(args.tool);
    return { type: "app", app: app || null, action: name === "apps_search" ? "buscar herramientas" : name === "apps_accounts" ? "ver cuentas" : action || null, tool: args.tool || null, account: args.account && !/^ca_/.test(String(args.account)) ? args.account : null, query: clipText(args.query, 120) || null, count: name === "apps_execute" ? listCount(r) : null };
  }
  if (name.startsWith("browser_")) {
    const url = args.url || r.url || r.finalUrl || null;
    return { type: "browser", action: name.slice(8).replace(/_/g, " "), url, domain: hostOf(url), title: clipText(r.title, 140) || null };
  }
  if (name === "run_command") {
    const command = String(args.command || args.program || args.cmd || "");
    const output = r.stdout ?? r.output ?? r.text ?? "";
    return { type: "command", program: baseName(command.split(/\s+/)[0]) || null, command: clipText([command, ...(Array.isArray(args.args) ? args.args : [])].join(" "), 200) || null, exitCode: r.exitCode ?? r.code ?? null, output: clipText(String(output).slice(-600), 300) || null };
  }
  if (name === "remember") return { type: "memory", text: clipText(args.text, 200) || null };
  // This computer (Cua Driver) and apps connected by MCP.
  if (name.startsWith("desktop_"))
    return { type: "desktop", step: name.slice(8), action: args.action || null, app: r.app || args.app || null, title: clipText(r.title, 80) || null, typed: args.action === "type" ? clipText(args.text, 60) : null };
  if (name === "mcp_call" || name === "mcp_tools")
    return { type: "app", app: args.server || null, action: name === "mcp_tools" ? "ver sus acciones" : String(args.tool || "").replace(/^[a-z]+[-_.]/i, "").replace(/[-_]+/g, " ") || null };
  if (isProjectTool(name)) return projectToolCard(name, args, r);
  return extraToolCard(name, args, r) || { type: "other" };
}

/**
 * Tool calls of a step from its stored history (function_call + function_call_output) and
 * receipts: [{ id, name, status: 'running'|'waiting'|'done'|'error', error, card }].
 */
export function toolCalls(step, { bots, receipt } = {}) {
  const history = Array.isArray(step.history) ? step.history : [];
  const outputs = new Map();
  for (const x of history) if (x?.type === "function_call_output") outputs.set(x.call_id, x.output);
  // Hosted web searches (web_search_call items) keep their place among the function calls.
  const calls = history.filter((x) => x?.type === "function_call" || x?.type === "web_search_call");
  for (const c of step.pending || []) if (c?.call_id && !calls.some((x) => x.call_id === c.call_id)) calls.push(c);
  return [...calls.slice(-40).map((call) => {
    if (call.type === "web_search_call") return webSearchToolCall(call, step);
    let args = {};
    try {
      args = JSON.parse(call.arguments || "{}") || {};
    } catch {}
    let result;
    // A screenshot output is [input_text, input_image]: its text part is the JSON result.
    const stored = outputs.get(call.call_id);
    const raw = Array.isArray(stored) ? stored.find((p) => p?.type === "input_text")?.text : stored;
    if (raw !== undefined) {
      try {
        result = JSON.parse(raw);
      } catch {
        result = { text: String(raw) };
      }
    } else result = receipt?.(call.call_id)?.result;
    const has = result !== undefined && result !== null;
    const status = has
      ? result?.uncertain ? "uncertain" : result?.error ? "error" : result?.waiting ? "waiting" : "done"
      : step.status === "waiting" ? "waiting" : ["running", "queued", "active"].includes(step.status) ? "running" : "error";
    const error = has && result?.error ? clipText(result.error, 240) : !has && status === "error" ? "Se interrumpió antes de terminar." : null;
    return { id: call.call_id, name: call.name, status, error, card: toolCard(String(call.name || ""), args, has ? result : null, bots) };
  }), ...recoveryToolCalls(step)];
}
