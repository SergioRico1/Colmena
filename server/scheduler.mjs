import { now } from "./store.mjs";
import { TIME_TYPES, TriggerEngine, intervalMs, nextRun } from "./triggers.mjs";
import { Notifier } from "./notifications.mjs";
import { missingFor } from "./quiet.mjs";
import { watchRooms, wakeDue } from "./rooms.mjs";
import { detectInjection, sanitizeValue, wrapExternal } from "./external-content.mjs";

const EVENT_SOURCE = { correo: "email", web: "web", evento: "calendar", hoja: "app", archivo: "file", sala: "chat" };

const ACCOUNTS_MS = 5 * 60 * 1000;

const TERMINAL = new Set(["completed", "cancelled", "failed"]);
const ACTIVE = new Set(["queued", "planning", "running"]);
const STALE_MS = 24 * 3600 * 1000;
const PURGE_MS = 24 * 3600 * 1000;
const LABEL = { waiting: "esperando tu respuesta", awaiting_plan: "esperando que revises el plan", awaiting_choice: "esperando que elijas una propuesta", paused: "en pausa", blocked: "bloqueada" };
const LATE_MS = 10 * 60000;
const DELIVERIES_KEPT = 50;

// Where each run goes (DeepSeek Harness schedule targets: new, new_once, session):
// «nueva» a new conversation per run (the default), «misma» one conversation created on the
// first run and reused after (created again if it was deleted), «sala» a room you chose.
export const DELIVERY_MODES = ["nueva", "misma", "sala"];
const ROOM_MODES = new Set(["misma", "sala"]);
export const deliveryMode = (rule) => (ROOM_MODES.has(rule?.delivery?.mode) ? rule.delivery.mode : "nueva");

/**
 * Time rules (dia/semana/vez/cada) fire on their local-time schedule; event rules fire
 * from a queue filled by TriggerEngine. One run per rule at a time; a run left
 * waiting on the user is visible as state 'waiting' instead of silently stalling.
 * Runs that came due while Colmena was closed, or while the rule's conversation was
 * still busy, are delivered once (the latest), never replayed one by one.
 */
export class Scheduler {
  constructor(store, runtime, isConnected = () => true, { connections = null, interval = 10000, pollMs, fetchPage, notifier } = {}) {
    this.store = store;
    this.runtime = runtime;
    this.isConnected = isConnected;
    this.interval = interval;
    this.ticking = false;
    this.lastPurge = Date.now();
    this.engine = new TriggerEngine({ store, connections, pollMs, ...(fetchPage ? { fetchPage } : {}), enqueue: (ruleId, event) => this.enqueue(ruleId, event) });
    this.notifier = notifier || new Notifier(store);
    this.connections = connections;
    this.accounts = null; // connected apps, refreshed every 5 min (null = unknown, not checked)
  }
  async refreshAccounts() {
    if (!this.connections) return;
    try {
      this.accounts = (await this.connections.call("accounts", { cursor: "" }))?.items || [];
    } catch {
      this.accounts = null; // the connections service is down: don't block rules on a guess
    }
  }
  /**
   * Pre-run check (Hermes «blocked_config»): what the rule lacks, or null. A blocked rule
   * is told once with the reason and unblocks itself as soon as the gap is filled.
   */
  precheck(rule) {
    const missing = missingFor(rule, { bots: this.store.list("bots"), accounts: this.accounts });
    if (!missing) {
      if (rule.blockedBy === "config") return { rule: this.set(rule, { state: "scheduled", blockedBy: null, error: null }), missing: null };
      return { rule, missing: null };
    }
    if (rule.blockedBy !== "config" || rule.error !== missing) {
      try {
        this.notifier.notify({ kind: "failed", botId: rule.botId, title: "«" + rule.name + "» no puede ejecutarse", text: missing, url: "/automatizaciones?id=" + rule.id });
      } catch {}
    }
    return { rule: this.set(rule, { state: "blocked", blockedBy: "config", error: missing }), missing };
  }
  holidays() {
    return this.store.get("settings", "main")?.holidays || [];
  }
  /** Next scheduled time for a rule from `from`, or null. */
  next(rule, from = new Date()) {
    if (!rule.trigger && rule.intervalMinutes > 0) return new Date(from.getTime() + rule.intervalMinutes * 60000).toISOString(); // legacy rules
    if (!rule.trigger || !TIME_TYPES.has(rule.trigger.type)) return null;
    return nextRun(rule.trigger, from, { holidays: this.holidays(), anchor: rule.anchorAt || rule.trigger.config?.anchor || rule.createdAt });
  }
  /** The existing conversation a rule delivers into, or null («nueva», not created yet, or deleted). */
  target(rule) {
    if (deliveryMode(rule) === "nueva" || !rule.delivery?.missionId) return null;
    const room = this.store.get("missions", rule.delivery.missionId);
    return room && room.status !== "cancelled" ? room : null;
  }
  /**
   * Latest-only catch-up: the latest occurrence due at `time` and how many earlier ones it
   * stands for (they came due while Colmena was closed or the conversation was busy).
   */
  catchUp(rule, time) {
    const first = rule.nextRun ? Date.parse(rule.nextRun) : NaN;
    if (!Number.isFinite(first) || first > time) return { scheduledAt: null, missed: 0 };
    if (rule.trigger?.type === "cada") {
      const every = intervalMs(rule.trigger.config);
      const missed = Math.floor((time - first) / every);
      return { scheduledAt: new Date(first + missed * every).toISOString(), missed };
    }
    let at = first;
    let missed = 0;
    // Months away: count from two months back (the exact number no longer matters).
    const floor = time - 62 * 86400000;
    const resume = first < floor ? this.next(rule, new Date(floor)) : null;
    if (resume && Date.parse(resume) <= time) {
      at = Date.parse(resume);
      missed = 1;
    }
    for (let i = 0; i < 1000; i++) {
      const next = this.next(rule, new Date(at));
      if (!next || Date.parse(next) > time) break;
      at = Date.parse(next);
      missed++;
    }
    return { scheduledAt: new Date(at).toISOString(), missed };
  }
  tick(time = Date.now()) {
    if (this.ticking) return; // reentrancy guard: listeners may call tick while a tick runs
    this.ticking = true;
    try {
      const settings = this.store.get("settings", "main") || {};
      let connected = null;
      const isConnected = () => (connected ??= !!safe(this.isConnected));
      for (const rule of this.store.list("automations")) {
        try {
          this.process(rule, time, settings, isConnected);
        } catch (error) {
          console.warn("Automatización " + rule.id + ": " + error.message);
        }
      }
      try {
        wakeDue(this.store, (n) => this.notifier.notify(n), time); // snoozed rooms whose time came
      } catch (error) {
        console.warn("Salas pospuestas: " + error.message);
      }
      try {
        // Work paused by an AI's usage limit goes on when it renews (or a substitute can answer).
        if (isConnected() && typeof this.runtime?.resumeLimited === "function") this.runtime.resumeLimited(time);
      } catch (error) {
        console.warn("Reanudar tras el límite: " + error.message);
      }
      try {
        this.notifier.maybeRound(time);
      } catch (error) {
        console.warn("Ronda de avisos: " + error.message);
      }
      if (time - this.lastPurge > PURGE_MS) {
        this.lastPurge = time;
        this.store.maintain(time);
      }
    } finally {
      this.ticking = false;
    }
  }
  /** Persists state/error only when they change (avoids event noise). */
  set(rule, changes) {
    if (Object.entries(changes).every(([k, v]) => JSON.stringify(rule[k] ?? null) === JSON.stringify(v ?? null))) return rule;
    return this.store.patch("automations", rule.id, changes);
  }
  observed(rule, last, time) {
    if (!last) return { state: "scheduled" };
    if (ACTIVE.has(last.status)) return { state: "running" };
    if (TERMINAL.has(last.status)) return { state: "scheduled", lastStatus: last.status };
    const since = Date.parse(last.updatedAt || last.createdAt);
    const stale = time - since > STALE_MS;
    const room = deliveryMode(rule) !== "nueva";
    return {
      state: "waiting",
      lastStatus: last.status,
      error: !stale ? null : room
        ? "La conversación «" + (last.title || rule.name) + "» lleva más de 24 h " + (LABEL[last.status] || last.status) + ". Hasta que la atiendas, lo que toque se junta en una sola entrega."
        : "La ejecución del " + new Date(since).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) +
          " lleva más de 24 h " + (LABEL[last.status] || last.status) + ". Revísala: hasta entonces la regla no vuelve a ejecutarse.",
    };
  }
  /** The run a rule waits on: its conversation for «misma»/«sala», else its last mission. */
  current(rule) {
    if (deliveryMode(rule) !== "nueva") return this.target(rule);
    return rule.lastMissionId ? this.store.get("missions", rule.lastMissionId) : null;
  }
  process(rule, time, settings, isConnected) {
    const last = this.current(rule);
    if (!rule.enabled) return this.set(rule, { state: "paused" });
    if (["connector", "folder"].includes(rule.blockedBy)) return this.set(rule, { state: "blocked" });
    const checked = this.precheck(rule);
    if (checked.missing) return checked.rule;
    rule = checked.rule;
    const busy = last && !TERMINAL.has(last.status);
    const view = this.observed(rule, last, time);
    const timed = isTimed(rule);
    // Rules saved without a schedule (older data) get one instead of staying idle.
    if (timed && !rule.nextRun && rule.trigger) rule = this.set(rule, { nextRun: this.next(rule, new Date(time)) });
    const due = timed ? rule.nextRun && Date.parse(rule.nextRun) <= time : (rule.queue || []).length > 0;
    if (!due) {
      if (rule.blockedBy === "provider" && isConnected()) return this.set(rule, { ...view, blockedBy: null, error: view.error ?? null });
      if (rule.blockedBy) return rule;
      return this.set(rule, { ...view, error: view.error ?? null });
    }
    if (settings.paused) return rule; // global pause: the run happens once the team resumes
    // No overlap: the due run waits until the previous one (or the rule's conversation) is
    // free, and then everything that came due meanwhile goes as one delivery; the next
    // occurrence is computed from the moment it actually fires.
    if (busy) return this.set(rule, { ...view, error: view.error ?? null });
    if (!isConnected())
      return this.set(rule, { state: "blocked", blockedBy: "provider", error: "Conecta una cuenta de IA en Ajustes › Cuentas de IA para ejecutar esta automatización." });
    if (timed) return this.fire(rule, { time, queue: rule.queue });
    // Into one conversation, the events that piled up while it was busy go together.
    const queue = rule.queue || [];
    const together = deliveryMode(rule) !== "nueva" ? queue.length : 1;
    return this.fire(rule, { events: queue.slice(0, together), time, queue: queue.slice(together) });
  }
  /** Creates and launches the mission of one run, or delivers it into the rule's conversation. */
  fire(rule, { event = null, events = event ? [event] : [], time = Date.now(), queue = rule.queue, test = false } = {}) {
    const timed = isTimed(rule);
    const schedule = test ? {} : timed
      ? rule.trigger.type === "vez"
        ? { nextRun: null, enabled: false }
        : { nextRun: this.next(rule, new Date(time)) }
      : { queue: queue || [] };
    const caught = timed && !test ? this.catchUp(rule, time) : { scheduledAt: null, missed: 0 };
    const roomMode = deliveryMode(rule) !== "nueva";
    const room = roomMode ? this.target(rule) : null;
    let mission;
    let messageId = null;
    try {
      const team = rule.botId === "atlas" ? { mode: "equipo", botIds: [] } : { mode: "solo", botIds: [rule.botId] };
      const context = eventContext(rule, events);
      const found = events.length ? detectInjection(JSON.stringify(events)) : [];
      if (found.length) console.warn(`[security] Posible inyección en el disparador de «${rule.name}»: ${found.join(", ")}`);
      const prompt = (rule.prompt || rule.name || "Automatización") + context + lateNote(caught, time);
      if (room) {
        // Not the person's message: the router (router.mjs) leaves it to whoever takes the room's messages.
        const message = this.runtime.addMessage(room.id, "Rutina «" + rule.name + "»: " + prompt, [], { route: false });
        messageId = message?.id || null;
        if (messageId && this.store.get("messages", messageId)) this.store.patch("messages", messageId, { automationId: rule.id });
        mission = this.store.get("missions", room.id) || room;
      } else {
        mission = this.runtime.create({
          prompt,
          title: (test && !roomMode ? "Prueba · " : "") + rule.name,
          ...team,
          automationId: rule.id,
          safety: "preguntar",
        });
      }
      // The whole run read it: nothing it proposes is approved on its own (external-content.mjs isFlagged).
      if (found.length && this.store.get("missions", mission.id))
        mission = this.store.patch("missions", mission.id, (m) => ({ suspicious: [...(room ? m.suspicious || [] : []), { tool: "disparador", found, at: now() }] }));
    } catch (error) {
      this.store.patch("automations", rule.id, { ...schedule, state: "blocked", blockedBy: "run", error: error.message, lastRun: now(), lastStatus: "blocked" });
      throw error;
    }
    const merged = caught.missed + Math.max(0, events.length - 1);
    this.store.patch("automations", rule.id, (r) => ({
      ...schedule,
      state: rule.trigger?.type === "vez" && !test ? "paused" : "running",
      blockedBy: null,
      error: null,
      lastRun: now(),
      lastStatus: "running",
      lastMissionId: mission.id,
      lastScheduledAt: caught.scheduledAt,
      lastMerged: merged,
      // The conversation is created once, then reused; a chosen room that was deleted is replaced
      // by a new one the same way.
      ...(roomMode && !room ? { delivery: { mode: "misma", missionId: mission.id } } : {}),
      ...(room ? { deliveries: [...(r.deliveries || []), { at: now(), missionId: room.id, messageId, scheduledAt: caught.scheduledAt, merged, ...(test ? { test: true } : {}) }].slice(-DELIVERIES_KEPT) } : {}),
    }));
    if (!room) {
      try {
        this.runtime.launch?.(mission.id);
      } catch (error) {
        console.warn("No se pudo lanzar la automatización: " + error.message);
      }
    }
    return mission;
  }
  /** Runs the rule once now. Event rules replay the last observed event. */
  runNow(ruleId) {
    const rule = this.store.get("automations", ruleId);
    if (!rule) throw Object.assign(Error("Automatización no encontrada."), { status: 404 });
    const last = this.current(rule);
    if (last && !TERMINAL.has(last.status) && ACTIVE.has(last.status))
      throw Object.assign(Error(deliveryMode(rule) !== "nueva"
        ? "La conversación de esta rutina está ocupada. Espera a que termine para probarla."
        : "Ya hay una ejecución en marcha de esta regla. Espera a que termine."), { status: 409 });
    if (!safe(this.isConnected))
      throw Error("Conecta una cuenta de IA en Ajustes › Cuentas de IA para probar la automatización.");
    const timed = isTimed(rule);
    if (!timed && !rule.lastEvent)
      throw Error("Todavía no ha llegado nada que encaje con esta regla, así que no hay con qué probarla. Se probará sola con lo próximo que llegue.");
    return this.fire(rule, { event: timed ? null : rule.lastEvent, test: true });
  }
  enqueue(ruleId, event) {
    const rule = this.store.get("automations", ruleId);
    if (!rule?.enabled) return;
    if ((rule.queue || []).some((e) => e.id === event.id)) return;
    this.store.patch("automations", ruleId, (r) => ({ queue: [...(r.queue || []), event].slice(-20), lastEvent: event, lastEventAt: now() }));
    setImmediate(() => this.tick());
  }
  /** Runs of a rule, newest first: [{ at, missionId, title, status }]. */
  runs(ruleId) {
    const own = this.store
      .where("missions", "automationId", ruleId)
      .map((m) => ({ at: m.createdAt, missionId: m.id, title: m.title, status: m.status, ...(m.nothingNew ? { statusLabel: "Sin novedades" } : {}) }));
    // Deliveries into an existing conversation: one row per message, with the conversation's state.
    const delivered = (this.store.get("automations", ruleId)?.deliveries || []).map((d) => {
      const m = this.store.get("missions", d.missionId);
      return { at: d.at, missionId: d.missionId, messageId: d.messageId, title: m?.title || "Conversación borrada", status: m?.status || "cancelled", ...(d.merged ? { merged: d.merged, statusLabel: "Juntaba " + (d.merged + 1) } : {}) };
    });
    return [...own, ...delivered].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 50);
  }
  start() {
    this.timer = setInterval(() => this.tick(), this.interval);
    this.timer.unref?.();
    this.notifier.start();
    this.engine.start();
    this.unwatchRooms = watchRooms(this.store);
    void this.refreshAccounts();
    this.accountsTimer = setInterval(() => void this.refreshAccounts(), ACCOUNTS_MS);
    this.accountsTimer.unref?.();
    setImmediate(() => this.tick());
    // Hermes-style upkeep: weekly skill curation and daily user profile (self-scheduled inside).
    const learn = () => { if (typeof this.runtime?.learningTick === "function") Promise.resolve(this.runtime.learningTick()).catch(() => {}); };
    this.learnTimer = setInterval(learn, 3600e3);
    this.learnTimer.unref?.();
    setTimeout(learn, 60e3).unref?.();
  }
  stop() {
    clearInterval(this.learnTimer);
    clearInterval(this.accountsTimer);
    this.unwatchRooms?.();
    clearInterval(this.timer);
    this.engine.stop();
    this.notifier.stop();
  }
}

const isTimed = (rule) => !rule.trigger || TIME_TYPES.has(rule.trigger.type);

// The event is outside content (an email, a page, a calendar change): wrapped as data, its
// sender and subject cleaned, so neither the model nor «what you said» (preferences.mjs,
// appactions.mjs) takes it for the person's words.
function eventContext(rule, events) {
  if (!events.length) return "";
  const wrap = (event) => wrapExternal(JSON.stringify(sanitizeValue({ tipo: event.kind, resumen: event.summary, ...event.data })), {
    source: EVENT_SOURCE[event.kind] || "trigger", label: rule.name,
    sender: event.data?.de || null, subject: event.data?.asunto || null,
  });
  if (events.length === 1) return "\n\nQué lo ha puesto en marcha:\n" + wrap(events[0]);
  return "\n\nQué lo ha puesto en marcha (" + events.length + " avisos juntos, llegaron mientras la conversación estaba ocupada):\n" + events.map(wrap).join("\n");
}

const at = (iso) => new Date(iso).toLocaleString("es-ES", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
/** A line for the bot when the run is late or stands for several (latest-only catch-up). */
function lateNote({ scheduledAt, missed }, time) {
  if (!scheduledAt) return "";
  if (missed > 0)
    return "\n\n(Nota de Colmena: esta rutina tenía " + (missed + 1) + " ejecuciones pendientes, la última del " + at(scheduledAt) +
      ", porque Colmena estaba cerrada o la conversación ocupada. Hazla una sola vez, con lo que haya ahora.)";
  if (time - Date.parse(scheduledAt) > LATE_MS) return "\n\n(Nota de Colmena: tocaba el " + at(scheduledAt) + "; va con retraso porque Colmena estaba cerrada o la conversación ocupada.)";
  return "";
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return false;
  }
}
