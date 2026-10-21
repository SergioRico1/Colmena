import { createHash } from "node:crypto";
import { goalsDigest } from "./goals.mjs";
import { id, now } from "./store.mjs";
import { approvalExpiresAt, isExternalApproval } from "./state.mjs";

/**
 * What a desktop notification may offer as buttons for one pending approval: local
 * permissions («Permitir»), a question's options, a plan («Aprobar el plan»). Anything that
 * leaves this computer (sends, payments, publishing, app actions) only opens Colmena.
 */
export function quickActions(a) {
  if (!a || a.status !== "pending") return null;
  if (a.kind === "question") {
    const options = (a.options || []).slice(0, 3).map((o) => ({ id: o.id, label: String(o.label || o.text || o.id).slice(0, 40) })).filter((o) => o.id);
    return options.length ? { approvalId: a.id, kind: "question", options } : null;
  }
  if (a.kind === "plan") return { approvalId: a.id, kind: "plan", missionId: a.missionId };
  if (isExternalApproval(a) || ["send", "skill", "soul"].includes(a.kind)) return null;
  return { approvalId: a.id, kind: "permission" };
}

// Avisos: only when something ends, needs the person or fails (never intermediate
// steps), plus Atlas's half-hourly round (OpenClaw heartbeat, without a model).
// Pattern adapted from OpenMuse background-updates (MIT: licenses/OpenMuse.txt).

export const ROUND_MS = 30 * 60 * 1000;
export const ROUND_HOURS = [8, 20]; // from 08:00 to 19:59, local time
const APPROVAL_WAIT_MS = 2 * 3600 * 1000;
const SKILL_WAIT_MS = 3 * 86400 * 1000;
const KEEP = 200;

const NEEDS = new Set(["waiting", "awaiting_plan", "awaiting_choice"]);
const FAILED = new Set(["blocked", "failed"]);
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

/** 'done' | 'needs' | 'failed' | null for a mission status. */
export function notificationKind(status) {
  if (status === "completed") return "done";
  if (NEEDS.has(status)) return "needs";
  if (FAILED.has(status)) return "failed";
  return null;
}

/** Same route as the SPA's roomUrl(). */
export function missionUrl(m) {
  if (!m) return "/";
  if (m.conversation) return "/chat/" + (m.botIds?.[0] || "nora") + "?c=" + m.id;
  if (m.mode === "debate" && m.status === "awaiting_choice") return "/sala/" + m.id + "/debate";
  return "/sala/" + m.id;
}

// ---- Weekly summary (OpenClaw extensions/team-reports), computed from the records ----
export const WEEKLY_DAY = 5; // Friday
export const WEEKLY_HOUR = 17;
const WEEK_MS = 7 * 86400000;
const within = (value, from, to) => {
  const t = Date.parse(value || "");
  return !Number.isNaN(t) && t > from && t <= to;
};
/** ISO week key, e.g. 2026-W42. */
export function weekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return d.getUTCFullYear() + "-W" + String(Math.ceil(((d - start) / 86400000 + 1) / 7)).padStart(2, "0");
}
export function weeklyStats(store, from, to) {
  const missions = store.list("missions").filter((m) => m.status === "completed" && !m.conversation && within(m.completedAt || m.updatedAt, from, to));
  const chats = store.list("missions").filter((m) => m.conversation && within(m.updatedAt || m.createdAt, from, to));
  const artifacts = store.list("artifacts").filter((a) => within(a.createdAt, from, to));
  const approvals = store.list("approvals").filter((a) => a.decidedBy === "tú" && ["approved", "executed", "answered", "denied"].includes(a.status) && within(a.decidedAt, from, to));
  const skills = store.list("skills").filter((s) => s.origin === "learned" && !s.removed && (within(s.createdAt, from, to) || within(s.activatedAt, from, to)));
  const bots = new Map(store.list("bots").map((b) => [b.id, b.name]));
  const busiest = new Map();
  for (const m of missions) for (const b of m.mode === "equipo" ? ["atlas", ...(m.botIds || [])] : m.botIds || []) busiest.set(b, (busiest.get(b) || 0) + 1);
  const top = [...busiest.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    missions: missions.length, chats: chats.length, artifacts: artifacts.length,
    approvals: approvals.filter((a) => a.status !== "denied").length, denied: approvals.filter((a) => a.status === "denied").length,
    skills: skills.length,
    highlights: {
      missions: missions.slice(-5).map((m) => ({ id: m.id, title: m.title, room: m.room || null })),
      artifacts: artifacts.slice(-5).map((a) => ({ id: a.id, title: a.title, missionId: a.missionId ?? null })),
      skills: skills.slice(-5).map((s) => ({ id: s.id, name: s.name, botId: s.botId ?? null, status: s.status })),
      busiest: top ? { botId: top[0], name: bots.get(top[0]) || top[0], missions: top[1] } : null,
    },
  };
}
export function weeklyText(s) {
  const parts = [
    s.missions ? plural(s.missions, "misión terminada", "misiones terminadas") : null,
    s.artifacts ? plural(s.artifacts, "entregable nuevo", "entregables nuevos") : null,
    s.approvals ? plural(s.approvals, "aprobación tuya", "aprobaciones tuyas") : null,
    s.skills ? plural(s.skills, "habilidad aprendida", "habilidades aprendidas") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") + "." : "Semana tranquila: no se terminó ninguna misión ni hubo entregables nuevos.";
}

// «Cómo te avisa» (Ajustes › Avisos, T3 Code threadNotifications): a Windows notice, a sound,
// both or nothing. The sound says which kind it is: «ha terminado» or «te necesita».
export const NOTIFY_MODES = ["both", "windows", "sound", "off"];
const SOUND_OF = { done: "done", needs: "needs", permission: "needs", question: "needs", plan: "needs", failed: "needs", blocked: "needs" };
/** {toast, sound} for a notice of `kind` that pops, by the person's notifyMode. */
export function delivery(settings, kind) {
  const mode = NOTIFY_MODES.includes(settings?.notifyMode) ? settings.notifyMode : "both";
  return { toast: mode === "both" || mode === "windows", sound: mode === "both" || mode === "sound" ? SOUND_OF[kind] || null : null };
}

/**
 * A short tag for a Windows notice (FNV-1a, 16 hex characters): Windows drops toasts whose
 * tag is long, and the same tag replaces the older notice of that room in the Action Center.
 */
export function noticeTag(key) {
  let hash = 0xcbf29ce484222325n;
  for (const ch of String(key || "colmena")) {
    hash ^= BigInt(ch.codePointAt(0));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

const NEEDS_STATUSES = new Set(["waiting", "awaiting_plan", "awaiting_choice"]);
/** What waits for the person (the taskbar counter): pending approvals plus rooms that need them without one. */
export function pendingCount(store) {
  const approvals = store.list("approvals").filter((a) => a.status === "pending");
  const withApproval = new Set(approvals.map((a) => a.missionId));
  const rooms = store.columns("missions", ["id", "status"]).filter((m) => NEEDS_STATUSES.has(m.status) && !withApproval.has(m.id));
  return approvals.length + rooms.length;
}

/** Quiet hours: 19:00–9:00 and weekends (local time). */
export const isQuietTime = (date) => date.getDay() === 0 || date.getDay() === 6 || date.getHours() >= 19 || date.getHours() < 9;
// What each «Avísame de» level lets through as a Windows notice (it is always kept in Hoy).
const POPS = { todo: null, importante: new Set(["needs", "failed", "blocked", "permission", "question", "plan", "digest", "limited"]), tuyo: new Set(["needs", "permission", "question", "plan"]) };
/** Whether a notice of `kind` should pop now; it is stored either way. */
export function shouldPop(settings, kind, date = new Date()) {
  if (settings?.notifyMode === "off") return false;
  if (settings?.quietHours && isQuietTime(date)) return false;
  const allowed = POPS[settings?.notifyLevel || "todo"];
  return !allowed || allowed.has(kind);
}

export class Notifier {
  /** `emit(event)` reaches the SSE stream; defaults to the store listeners. */
  constructor(store, { emit, clock = () => Date.now() } = {}) {
    this.store = store;
    this.clock = clock;
    this.emit = emit || ((event) => {
      for (const fn of [...store.listeners]) {
        try {
          fn(event);
        } catch {}
      }
    });
    this.statuses = new Map();
    this.lastRound = 0;
    // Extra work for each 30-min round (app.mjs adds Atlas's ideas with evidence).
    this.roundHooks = [];
    // Optional async (digest) => string|null: one closing sentence written by a model.
    this.closer = null;
    this.listener = (change) => this.onChange(change);
    this.started = false;
  }
  start() {
    if (this.started) return;
    this.started = true;
    for (const m of this.store.columns("missions", ["id", "status"])) this.statuses.set(m.id, m.status);
    this.store.listeners.add(this.listener);
  }
  stop() {
    this.started = false;
    this.store.listeners.delete(this.listener);
  }
  onChange(change) {
    if (change?.type !== "record" || change.kind !== "missions") return;
    if (change.op === "remove") return this.statuses.delete(change.id);
    if (change.data) this.observe(change.data);
  }
  /** Notifies on a status transition into done / needs / failed. */
  observe(m) {
    const prev = this.statuses.get(m.id);
    this.statuses.set(m.id, m.status);
    if (prev === m.status) return null;
    // Paused by an AI's usage limit: said once, with the renewal time (it goes on by itself).
    if (m.status === "paused" && m.limited) return this.notify(this.describeLimited(m));
    const kind = notificationKind(m.status);
    if (!kind) return null;
    const rule = m.automationId ? this.store.get("automations", m.automationId) : null;
    // A chat reply is seen in the chat itself; rules can ask to hear only about failures.
    if (kind === "done" && (m.conversation || rule?.notify === "fallo")) return null;
    // A run that found nothing new stays quiet unless the rule asks to hear every time.
    if (kind === "done" && m.nothingNew && rule?.notify !== "siempre") return null;
    // The same failure of a rule, run after run, is told once (Hermes alert dedupe).
    if (rule && kind === "failed") {
      const signature = String(m.error || "").slice(0, 300);
      if (rule.lastAlert === signature) return null;
      this.store.patch("automations", rule.id, { lastAlert: signature });
    }
    if (rule && kind === "done" && rule.lastAlert) this.store.patch("automations", rule.id, { lastAlert: null });
    return this.notify(this.describe(m, kind, rule));
  }
  describeLimited(m) {
    const botId = m.limited.botIds?.[0] || (m.mode === "solo" || m.conversation ? m.botIds?.[0] : "atlas");
    return { kind: "limited", missionId: m.id, botId, url: missionUrl(m), title: this.botName(botId) + " espera en «" + (m.title || "la misión") + "»", text: m.error || "Ha llegado al límite de uso de su IA. Seguirá por su cuenta cuando se renueve." };
  }
  botName(botId) {
    return this.store.get("bots", botId)?.name || "Un bot";
  }
  describe(m, kind, rule) {
    const title = m.title || "la misión";
    const lead = m.mode === "solo" || m.conversation ? m.botIds?.[0] : "atlas";
    const base = { kind, missionId: m.id, url: missionUrl(m) };
    if (kind === "done") {
      const artifacts = this.store.where("artifacts", "missionId", m.id);
      const text = artifacts.length
        ? "Entrega lista: " + artifacts.slice(-2).map((a) => "«" + a.title + "»").join(" y ")
        : rule ? "Automatización «" + rule.name + "» terminada." : "Entrega lista en #" + (m.room || "sala") + ".";
      return { ...base, botId: lead, title: this.botName(lead) + " ha terminado «" + title + "»", text };
    }
    if (kind === "needs") {
      const pending = this.store.where("approvals", "missionId", m.id).filter((a) => a.status === "pending");
      const first = pending[0];
      const botId = first?.botId || lead;
      const text =
        m.status === "awaiting_plan" ? "Revisa el plan de Atlas para empezar." :
          m.status === "awaiting_choice" ? "Elige una de las propuestas del debate." :
            first ? (first.title || first.summary || "Necesita tu OK.") + (pending.length > 1 ? " · " + plural(pending.length - 1, "cosa más", "cosas más") : "") :
              "Necesita tu respuesta para seguir.";
      const quick = pending.length === 1 ? quickActions(first) : null;
      return { ...base, botId, title: this.botName(botId) + " te necesita en «" + title + "»", text, ...(quick ? { extra: { quick } } : {}) };
    }
    return { ...base, botId: lead, title: "«" + title + "» se ha bloqueado", text: m.error || "Revisa qué ha pasado para que pueda seguir." };
  }
  /** Inserts (or refreshes the unread one of the same mission and kind) and emits {type:'notify'}. */
  notify({ kind, missionId = null, botId = null, title, text, url = null, signature = null, count = null, extra = null }) {
    const at = new Date(this.clock()).toISOString();
    const same = missionId ? this.store.where("notifications", "missionId", missionId).find((n) => !n.read && n.kind === kind) : null;
    const record = this.store.put("notifications", {
      ...(same || {}), id: same?.id || id(), kind, missionId, botId, title, text, url, read: false, createdAt: at,
      ...(signature ? { signature } : {}), ...(count != null ? { count } : {}), ...(extra || {}),
    });
    this.prune();
    const settings = this.store.get("settings", "main");
    if (shouldPop(settings, kind, new Date(this.clock()))) {
      const how = delivery(settings, kind);
      if (how.toast || how.sound)
        this.emit({ type: "notify", id: record.id, kind, title, text, url, tag: noticeTag(missionId || record.id), toast: how.toast, sound: how.sound, ...(extra?.quick ? { quick: extra.quick } : {}) });
    }
    return record;
  }
  prune() {
    const all = this.store.columns("notifications", ["id", "createdAt"]);
    if (all.length <= KEEP) return;
    all.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    for (const n of all.slice(0, all.length - KEEP)) this.store.remove("notifications", n.id);
  }
  markRead({ ids = null, all = false } = {}) {
    let changed = 0;
    this.store.tx(() => {
      for (const n of this.store.list("notifications")) {
        if (n.read || (!all && !(ids || []).includes(n.id))) continue;
        this.store.put("notifications", { ...n, read: true, readAt: now() });
        changed++;
      }
    });
    return changed;
  }
  /** Called from the scheduler tick; runs the round every 30 min inside working hours. */
  maybeRound(time = this.clock()) {
    try {
      this.maybeWeekly(time);
    } catch (error) {
      console.warn("Colmena: no se pudo preparar el resumen semanal: " + error.message);
    }
    if (time - this.lastRound < ROUND_MS) return null;
    this.lastRound = time;
    for (const hook of this.roundHooks) {
      try {
        void Promise.resolve(hook(time)).catch(() => null);
      } catch {}
    }
    return this.round(time);
  }
  /** Friday from 17:00 (local time): the week's summary, once per week. */
  maybeWeekly(time = this.clock()) {
    const d = new Date(time);
    // Only for a started notifier (the scheduler's), never for helpers built in tests.
    if (!this.started || d.getDay() !== WEEKLY_DAY || d.getHours() < WEEKLY_HOUR) return null;
    if (this.store.get("weeklyDigests", weekKey(d))) return null;
    return this.weekly(time);
  }
  /**
   * Atlas's weekly summary (OpenClaw team-reports), without a model: missions finished,
   * new deliverables, approvals you decided and skills learned in the last 7 days.
   * Stored in records 'weeklyDigests' (id = ISO week) + an aviso of kind 'digest'.
   */
  weekly(time = this.clock()) {
    const d = new Date(time);
    const key = weekKey(d);
    const stats = weeklyStats(this.store, time - WEEK_MS, time);
    const text = weeklyText(stats);
    const digest = this.store.put("weeklyDigests", {
      id: key, from: new Date(time - WEEK_MS).toISOString(), to: d.toISOString(), stats, text, closing: null, dismissed: false, createdAt: d.toISOString(),
    });
    this.notify({ kind: "digest", botId: "atlas", title: this.botName("atlas") + " te deja el resumen de la semana", text, url: "/?resumen=" + key, extra: { weekly: key } });
    if (typeof this.closer === "function") {
      void Promise.resolve()
        .then(() => this.closer(digest))
        .then((closing) => {
          const line = (String(closing || "").split(/\r?\n/).find((l) => l.trim()) || "").replace(/\s+/g, " ").trim().slice(0, 240);
          if (line && this.store.get("weeklyDigests", key)) this.store.patch("weeklyDigests", key, { closing: line });
        })
        .catch(() => null);
    }
    return digest;
  }
  /** What Atlas found that needs the person, without calling a model. */
  findings(time = this.clock()) {
    const approvals = this.store.list("approvals").filter((a) => {
      if (a.status !== "pending") return false;
      const created = Date.parse(a.createdAt || "");
      const expires = approvalExpiresAt(a);
      return (expires && Date.parse(expires) <= time) || (!Number.isNaN(created) && time - created > APPROVAL_WAIT_MS);
    });
    const missions = this.store.list("missions").filter((m) => FAILED.has(m.status));
    const automations = this.store.list("automations").filter((r) => r.enabled !== false
      ? ["blocked", "waiting"].includes(r.state) || ["failed", "blocked"].includes(r.lastStatus)
      : r.autoPaused);
    const skills = this.store.list("skills").filter((s) => s.status === "pending" && time - Date.parse(s.createdAt || "") > SKILL_WAIT_MS);
    let goals = [];
    try { goals = goalsDigest(this.store, time); } catch {}
    return { approvals, missions, automations, skills, goals };
  }
  round(time = this.clock()) {
    const hour = new Date(time).getHours();
    if (hour < ROUND_HOURS[0] || hour >= ROUND_HOURS[1]) return null;
    const f = this.findings(time);
    const parts = [
      f.approvals.length ? plural(f.approvals.length, "aprobación espera", "aprobaciones esperan") + " desde hace más de 2 h" : null,
      f.missions.length ? plural(f.missions.length, "misión bloqueada", "misiones bloqueadas") : null,
      f.automations.length ? plural(f.automations.length, "automatización falla o espera", "automatizaciones fallan o esperan") : null,
      f.skills.length ? plural(f.skills.length, "habilidad lleva", "habilidades llevan") + " más de 3 días sin revisar" : null,
      f.goals.length ? plural(f.goals.length, "objetivo va con retraso o sin avances", "objetivos van con retraso o sin avances") : null,
    ].filter(Boolean);
    if (!parts.length) return null;
    const keys = [...f.approvals.map((a) => "a:" + a.id), ...f.missions.map((m) => "m:" + m.id + ":" + m.status), ...f.automations.map((r) => "r:" + r.id + ":" + (r.state || "") + ":" + (r.lastStatus || "")), ...f.skills.map((s) => "s:" + s.id), ...f.goals.map((g) => "g:" + g.goalId + ":" + (g.overdue ? "o" : "") + (g.stale ? "s" : ""))].sort();
    const signature = createHash("sha256").update(keys.join("|")).digest("hex").slice(0, 32);
    const last = this.store.list("notifications").filter((n) => n.kind === "digest" && !n.weekly).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    if (last?.signature === signature) return null; // nothing new since the last round
    const url = f.approvals.length ? "/bandeja" : f.missions.length ? "/sala/" + f.missions[0].id : f.automations.length ? "/automatizaciones?id=" + f.automations[0].id : "/biblioteca";
    return this.notify({
      kind: "digest",
      missionId: f.missions[0]?.id || f.approvals[0]?.missionId || null,
      botId: "atlas",
      title: this.botName("atlas") + " ha repasado el equipo",
      text: parts.join(" · ") + ".",
      url,
      signature,
      count: keys.length,
    });
  }
}
