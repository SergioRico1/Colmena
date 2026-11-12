import { id as newId, now } from "./store.mjs";
import { TIME_TYPES, TriggerEngine, intervalMs, nextRun } from "./triggers.mjs";
import { Notifier } from "./notifications.mjs";
import { missingFor } from "./quiet.mjs";
import { watchRooms, wakeDue } from "./rooms.mjs";
import { cleanHeader, detectInjection, sanitizeValue, wrapExternal } from "./external-content.mjs";
import { MAX_CHAIN_DEPTH, makeOrigin } from "./origin.mjs";
import { isNo } from "./appactions.mjs";
import {
  CHAIN_TEXT, COST, LOOP, LOOP_TEXT, NEVER_TEXT, OPEN_STATUSES, START_OPTIONS, START_TOOL,
  costGate, digestNow, signatureOf, startsOf, withArrival, withDigest, withStart,
} from "./brakes.mjs";

const EVENT_SOURCE = { correo: "email", web: "web", evento: "calendar", hoja: "app", archivo: "file", sala: "chat", webhook: "webhook" };
const NOTES_KEPT = 30;
const INTERRUPTED_GRACE_MS = 15 * 60_000;

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
  constructor(store, runtime, isConnected = () => true, { connections = null, interval = 10000, pollMs, fetchPage, notifier, clock = Date.now } = {}) {
    this.store = store;
    this.clock = clock;
    // The person's answer to «<Bot> quiere empezar…» (a question card) reaches the rule here.
    this.listener = (change) => this.onChange(change);
    store.listeners.add(this.listener);
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
  tick(time = this.clock()) {
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
    // A run that failed or was left paused no longer holds the rule: the next one supersedes it.
    if (this.dead(rule, last)) return { state: "scheduled", lastStatus: last.status };
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
  /**
   * The «one run at a time» policy. A later run waits only while the previous one is truly
   * running (queued, planning, running) or waits on you (a question, a plan, a choice). A
   * previous run that failed («blocked») or, for a rule that opens a conversation per run, was
   * left paused (parked by the plan, paused by you) no longer holds the rule: `dead`.
   * Two exceptions: a room you paused stays yours (a routine never wakes it), and work cut by
   * a close gets INTERRUPTED_GRACE_MS to go on by itself (Runtime#resumeInterrupted) first.
   */
  dead(rule, last) {
    if (!last) return false;
    if (last.status === "blocked") return true;
    if (last.status !== "paused" || deliveryMode(rule) !== "nueva") return false;
    return !(last.interrupted && this.clock() - Date.parse(last.interrupted.at || 0) < INTERRUPTED_GRACE_MS);
  }
  process(rule, time, settings, isConnected) {
    const last = this.current(rule);
    this.settleProposal(last);
    // Stopped by a brake and switched on again by you: it starts counting from now.
    if (rule.enabled && rule.stoppedBy) rule = this.set(rule, { stoppedBy: null, loopResetAt: new Date(time).toISOString(), ...(rule.stoppedBy === "never" ? { costSnoozeUntil: null } : {}) });
    if (!rule.enabled) return this.set(rule, { state: "paused" });
    if (["connector", "folder"].includes(rule.blockedBy)) return this.set(rule, { state: "blocked" });
    const checked = this.precheck(rule);
    if (checked.missing) return checked.rule;
    rule = checked.rule;
    const busy = last && !TERMINAL.has(last.status) && !this.dead(rule, last);
    const view = this.observed(rule, last, time);
    const timed = isTimed(rule);
    // Rules saved without a schedule (older data) get one instead of staying idle.
    if (timed && !rule.nextRun && rule.trigger) rule = this.set(rule, { nextRun: this.next(rule, new Date(time)) });
    // Events held for a digest (they came too often) go together when their wait ends.
    const digestDue = !timed && rule.digest?.events?.length > 0 && Date.parse(rule.digest.dueAt) <= time;
    const due = timed ? rule.nextRun && Date.parse(rule.nextRun) <= time : (rule.queue || []).length > 0 || digestDue;
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
    if (!queue.length) return this.fire(rule, { events: rule.digest.events, time, queue, digest: { count: rule.digest.events.length, dropped: rule.digest.dropped || 0 } });
    const together = deliveryMode(rule) !== "nueva" ? queue.length : 1;
    return this.fire(rule, { events: queue.slice(0, together), time, queue: queue.slice(together) });
  }
  /** Creates and launches the mission of one run, or delivers it into the rule's conversation. */
  fire(rule, { event = null, events = event ? [event] : [], time = Date.now(), queue = rule.queue, test = false, digest = null } = {}) {
    const timed = isTimed(rule);
    const previous = test ? null : this.current(rule);
    const schedule = test ? {} : timed
      ? rule.trigger.type === "vez"
        ? { nextRun: null, enabled: false }
        : { nextRun: this.next(rule, new Date(time)) }
      : { queue: queue || [], ...(digest ? { digest: null } : {}) };
    const caught = timed && !test ? this.catchUp(rule, time) : { scheduledAt: null, missed: 0 };
    const roomMode = deliveryMode(rule) !== "nueva";
    const room = roomMode ? this.target(rule) : null;
    let mission;
    let messageId = null;
    // What this run is: a routine on its schedule or a trigger's event, how deep in a chain of
    // self-started runs, and what it is about (brakes.mjs). Never the person's words (origin.mjs).
    const signature = digest ? rule.id + ":digest" : events[0]?.signature || (events[0] ? signatureOf(rule.id, events[0]) : rule.id + ":" + (timed ? "hora" : "prueba"));
    const origin = makeOrigin({ type: timed ? "automation" : "trigger", id: rule.id, depth: Math.max(0, ...events.map((e) => Number(e.chain) || 0)), signature, instruction: rule.prompt || rule.name || "" });
    // Costly work a trigger starts for the first time is proposed, not started (a new conversation only).
    let cost = !test && !timed && !roomMode ? costGate(this.store, rule, time) : null;
    if (cost?.adopt) {
      rule = this.store.patch("automations", rule.id, { costOk: { team: cost.team, monthly: cost.monthly } });
      cost = null;
    }
    if (cost && Date.parse(rule.costSnoozeUntil || "") > time) {
      // «Ahora no»: quiet until tomorrow; what arrives meanwhile is not started.
      this.note(rule.id, { kind: "snoozed", text: (events.length === 1 ? "Un aviso sin empezar" : events.length + " avisos sin empezar") + ": dijiste «Ahora no»" });
      return this.store.patch("automations", rule.id, { ...schedule });
    }
    try {
      const team = rule.botId === "atlas" ? { mode: "equipo", botIds: [] } : { mode: "solo", botIds: [rule.botId] };
      const context = eventContext(rule, events, digest);
      const found = events.length ? detectInjection(JSON.stringify(events)) : [];
      if (found.length) console.warn(`[security] Posible inyección en el disparador de «${rule.name}»: ${found.join(", ")}`);
      const prompt = (rule.prompt || rule.name || "Automatización") + context + lateNote(caught, time);
      if (room) {
        // Not the person's message: the router (router.mjs) leaves it to whoever takes the room's messages.
        const message = this.runtime.addMessage(room.id, "Rutina «" + rule.name + "»: " + prompt, [], { route: false, origin, automationId: rule.id });
        messageId = message?.id || null;
        if (messageId && this.store.get("messages", messageId)) this.store.patch("messages", messageId, { automationId: rule.id, origin });
        mission = this.store.get("missions", room.id) || room;
      } else {
        mission = this.runtime.create({
          prompt,
          title: (test && !roomMode ? "Prueba · " : "") + rule.name,
          ...team,
          automationId: rule.id,
          safety: "preguntar",
        });
        this.mark(mission, origin, digest);
        mission = this.store.get("missions", mission.id) || mission;
      }
      // The whole run read it: nothing it proposes is approved on its own (external-content.mjs isFlagged).
      if (found.length && this.store.get("missions", mission.id))
        mission = this.store.patch("missions", mission.id, (m) => ({ suspicious: [...(room ? m.suspicious || [] : []), { tool: "disparador", found, at: now() }] }));
    } catch (error) {
      this.store.patch("automations", rule.id, { ...schedule, state: "blocked", blockedBy: "run", error: error.message, lastRun: now(), lastStatus: "blocked" });
      throw error;
    }
    const merged = caught.missed + Math.max(0, events.length - 1);
    if (previous && previous.id !== mission.id && this.dead(rule, previous)) this.supersede(rule, previous, mission);
    this.store.patch("automations", rule.id, (r) => ({
      ...schedule,
      ...(test ? {} : { starts: withStart(r, digest ? [] : events.map((e) => e.signature || signatureOf(rule.id, e)), time) }),
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
      ...(room ? { deliveries: [...(r.deliveries || []), { at: now(), missionId: room.id, messageId, scheduledAt: caught.scheduledAt, merged, ...(digest ? { digest: digest.count } : {}), ...(test ? { test: true } : {}) }].slice(-DELIVERIES_KEPT) } : {}),
    }));
    if (cost && !room) return this.propose(rule, mission, cost);
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
    // A plan waiting for the person's review is theirs to decide: the routine's text is not their answer.
    if (last && deliveryMode(rule) !== "nueva" && last.status === "awaiting_plan")
      throw Object.assign(Error("La conversación de esta rutina está " + LABEL.awaiting_plan + ". Revísalo antes de probarla."), { status: 409 });
    if (!safe(this.isConnected))
      throw Error("Conecta una cuenta de IA en Ajustes › Cuentas de IA para probar la automatización.");
    const timed = isTimed(rule);
    if (!timed && !rule.lastEvent)
      throw Error("Todavía no ha llegado nada que encaje con esta regla, así que no hay con qué probarla. Se probará sola con lo próximo que llegue.");
    return this.fire(rule, { event: timed ? null : rule.lastEvent, test: true });
  }
  /**
   * «Actualizar» on a live block (blocks.mjs): one more run of its routine now. Unlike «Probar
   * ahora» it is a real run, not a test: it carries the routine's origin marker, respects the
   * pause of the whole team and a rule a brake stopped, never overlaps the run under way, and
   * an event rule goes through the brakes of self-started work (chain, open work, the loop
   * limit, the cost proposal). Every model call of the run passes the admission gate as usual.
   * → the run's mission (the open one when the same thing is already being worked on).
   */
  refreshNow(ruleId) {
    const rule = this.store.get("automations", ruleId);
    if (!rule) throw Object.assign(Error("La rutina de este dato ya no existe."), { status: 404 });
    const time = this.clock();
    const refuse = (text) => Object.assign(Error(text), { status: 409 });
    if (this.store.get("settings", "main")?.paused) throw refuse("El equipo está en pausa. Reanúdalo para actualizar este dato.");
    if (rule.stoppedBy) throw refuse(rule.error || "Esta rutina está parada. Reanúdala en Rutinas para actualizar este dato.");
    const missing = missingFor(rule, { bots: this.store.list("bots"), accounts: this.accounts });
    if (missing) throw refuse(missing);
    const last = this.current(rule);
    if (last && !TERMINAL.has(last.status) && !this.dead(rule, last))
      throw refuse(ACTIVE.has(last.status) ? "Ya se está actualizando. Espera a que termine." : "La rutina de este dato está " + (LABEL[last.status] || "ocupada") + ". Atiéndela y vuelve a probar.");
    if (!safe(this.isConnected)) throw refuse("Conecta una cuenta de IA en Ajustes › Cuentas de IA para actualizar este dato.");
    if (isTimed(rule)) return this.fire(rule, { time, queue: rule.queue, test: rule.trigger?.type === "vez" });
    if (!rule.lastEvent) throw refuse("Todavía no ha llegado nada que ponga en marcha esta rutina. Se actualizará sola con lo próximo que llegue.");
    const signature = rule.lastEvent.signature || signatureOf(rule.id, rule.lastEvent);
    if ((Number(rule.lastEvent.chain) || 0) > MAX_CHAIN_DEPTH) throw refuse(CHAIN_TEXT);
    const open = this.openRun(rule, signature);
    if (open) return open;
    if (startsOf(rule, signature, time) >= LOOP.limit) throw refuse("Esta rutina ya se ha puesto en marcha " + LOOP.limit + " veces hoy por lo mismo. Vuelve a probar mañana.");
    return this.fire(rule, { event: { ...rule.lastEvent, signature }, time, queue: rule.queue });
  }
  /**
   * An event of a rule (from TriggerEngine or a webhook), through the brakes (brakes.mjs), in
   * this order: a chain of rules firing each other is cut; an event about work that is still
   * open joins it; the same thing for the fourth time in a day stops the rule; a rule that
   * fires too often collects the rest for one digest run. → {status}: 'queued' | 'joined' |
   * 'digest' | 'stopped' | 'chain' | 'duplicate' | 'off'.
   */
  enqueue(ruleId, incoming) {
    const rule = this.store.get("automations", ruleId);
    if (!rule?.enabled) return { status: "off" };
    if ((rule.queue || []).some((e) => e.id === incoming.id) || (rule.digest?.events || []).some((e) => e.id === incoming.id)) return { status: "duplicate" };
    const time = this.clock();
    const signature = signatureOf(rule.id, incoming);
    const event = { ...incoming, signature };
    const seen = { lastEvent: event, lastEventAt: now() };
    if ((Number(event.chain) || 0) > MAX_CHAIN_DEPTH) {
      this.store.patch("automations", ruleId, seen);
      this.note(ruleId, { kind: "chain", text: CHAIN_TEXT }, { once: 3600_000 });
      return { status: "chain" };
    }
    const open = this.openRun(rule, signature);
    if (open) {
      this.store.patch("automations", ruleId, seen);
      this.join(rule, open, event, time);
      return { status: "joined", missionId: open.id };
    }
    if (startsOf(rule, signature, time) >= LOOP.limit) {
      this.stopForLoop(rule, event, time);
      return { status: "stopped" };
    }
    if (digestNow(rule, time)) {
      this.store.patch("automations", ruleId, (r) => ({ ...seen, arrivals: withArrival(r, time), digest: withDigest(r, event, time) }));
      return { status: "digest" };
    }
    // The same thing again while its turn has not come: the newest stands for both.
    this.store.patch("automations", ruleId, (r) => ({ ...seen, arrivals: withArrival(r, time), queue: [...(r.queue || []).filter((e) => e.signature !== signature), event].slice(-20) }));
    setImmediate(() => this.tick());
    return { status: "queued" };
  }
  /** The rule's run about the same thing that is still open (running or waiting on the person), or null. */
  openRun(rule, signature) {
    if (deliveryMode(rule) !== "nueva") return null;
    return this.store.where("missions", "automationId", rule.id)
      .find((m) => m.origin?.signature === signature && (OPEN_STATUSES.has(m.status) || (m.status === "paused" && !!m.limited))) || null;
  }
  /**
   * Adds an event to open work instead of starting a second mission: one activity line in its
   * conversation, and the event itself — wrapped as outside content, with its origin — left on
   * the mission for the bot, which reads it at its next round, or when the run goes on after
   * the person's decision (Runtime#injectJoined). Never a message of the person, and nothing is
   * launched: a run that waits or is parked stays as it is. The loop limit still holds: the
   * run's start and the events passed on to it count together, and from LOOP.limit on the same
   * thing again only leaves its line.
   */
  join(rule, mission, event, time = this.clock()) {
    const what = cleanHeader(event.summary || "un aviso nuevo", 160);
    const origin = makeOrigin({ type: "trigger", id: rule.id, depth: Number(event.chain) || 0, signature: event.signature });
    const since = time - LOOP.windowMs;
    const passed = (mission.joined || []).filter((j) => j.passed && Date.parse(j.at) > since).length;
    const pass = startsOf(rule, event.signature, time) + passed < LOOP.limit;
    const found = pass ? detectInjection(JSON.stringify(event)) : [];
    if (found.length) console.warn(`[security] Posible inyección en un aviso sumado a «${rule.name}»: ${found.join(", ")}`);
    this.store.put("messages", {
      id: newId(), missionId: mission.id, role: "system", kind: "activity", at: now(), origin,
      text: "Ha llegado algo más sobre lo mismo (" + what + "). " + (pass ? "Lo sumo a este trabajo en vez de empezar otro." : "Ya van " + LOOP.limit + " veces hoy: queda apuntado aquí, sin pasárselo al bot."),
    });
    this.store.patch("missions", mission.id, (m) => ({
      joined: [...(m.joined || []), { at: new Date(time).toISOString(), id: event.id, summary: what, ...(pass ? { passed: true, origin, text: wrapEvent(rule, event) } : {}) }].slice(-20),
      // Whatever the run proposes after reading it is decided by the person (external-content.mjs isFlagged).
      ...(found.length ? { suspicious: [...(m.suspicious || []), { tool: "disparador", found, at: now() }].slice(-20) } : {}),
    }));
    this.note(rule.id, { kind: "joined", missionId: mission.id, text: "Sumado a «" + (mission.title || rule.name) + "»: " + what });
  }
  /** The same thing a fourth time in a day: the rule stops and you are told once, with «Reanudar». */
  stopForLoop(rule, event, time) {
    this.store.patch("automations", rule.id, {
      enabled: false, autoPaused: true, state: "paused", stoppedBy: "loop", stoppedAt: new Date(time).toISOString(), error: LOOP_TEXT,
      lastEvent: event, lastEventAt: now(), queue: (rule.queue || []).filter((e) => e.signature !== event.signature),
    });
    this.note(rule.id, { kind: "loop", text: "Parada: «" + cleanHeader(event.summary || "lo mismo", 120) + "» la disparó más de " + LOOP.limit + " veces en un día" });
    try {
      this.notifier.notify({ kind: "needs", botId: rule.botId, title: "He parado «" + rule.name + "»", text: LOOP_TEXT, url: "/automatizaciones?id=" + rule.id, extra: { resume: { automationId: rule.id } } });
    } catch {}
  }
  /** Switches a rule stopped by a brake back on («Reanudar»); it counts again from now. */
  resume(ruleId) {
    const rule = this.store.get("automations", ruleId);
    if (!rule) throw Object.assign(Error("Automatización no encontrada."), { status: 404 });
    const at = new Date(this.clock());
    return this.store.patch("automations", ruleId, {
      enabled: true, autoPaused: false, state: "scheduled", stoppedBy: null, blockedBy: null, error: null, webFailures: 0, lastPollAt: null,
      loopResetAt: at.toISOString(), costSnoozeUntil: null, ...(isTimed(rule) ? { nextRun: this.next(rule, at) } : {}),
    });
  }
  /** One line in the rule's history for something a brake did (shown with its runs). */
  note(ruleId, { kind, text, missionId = null }, { once = 0 } = {}) {
    const rule = this.store.get("automations", ruleId);
    if (!rule) return;
    const last = (rule.notes || []).findLast((n) => n.kind === kind);
    if (once && last && this.clock() - Date.parse(last.at) < once) return;
    this.store.patch("automations", ruleId, (r) => ({ notes: [...(r.notes || []), { at: new Date(this.clock()).toISOString(), kind, text, missionId }].slice(-NOTES_KEPT) }));
  }
  /** Stamps a new run and its first message (stored as «user») with where they come from. */
  mark(mission, origin, digest = null) {
    if (!this.store.get("missions", mission.id)) return;
    this.store.patch("missions", mission.id, { origin, ...(digest ? { digest: digest.count } : {}) });
    const first = this.store.where("messages", "missionId", mission.id).find((m) => m.role === "user");
    if (first) this.store.patch("messages", first.id, { automationId: origin.id, origin });
  }
  /**
   * A new run starts although the previous one failed or was left paused, and the history says
   * so. A routine on a schedule does the same job again, so the new run replaces the old one:
   * it never resumes by itself (you can still press «Continuar»). A trigger's previous run was
   * about something else: it is left as it was (parked work goes on when the plan renews).
   */
  supersede(rule, old, mission) {
    const failed = old.status === "blocked";
    const before = failed ? "La vez anterior falló" : "La vez anterior se quedó en pausa";
    if (!isTimed(rule)) return this.note(rule.id, { kind: "superseded", missionId: old.id, text: before + ": sigue con lo nuevo sin esperarla" });
    this.store.patch("missions", old.id, {
      supersededBy: mission.id, limited: null, interrupted: null,
      error: (failed ? "Esta ejecución falló" : "Esta ejecución se quedó en pausa") + " y la rutina ha vuelto a ponerse en marcha con una nueva. Pulsa «Continuar» si aun así quieres terminarla.",
    });
    this.store.put("messages", { id: newId(), missionId: old.id, role: "system", kind: "activity", text: "La rutina «" + rule.name + "» ha empezado una ejecución nueva; esta se queda como estaba.", at: now() });
    this.note(rule.id, { kind: "superseded", missionId: old.id, text: before + ": la sustituye una nueva" });
  }
  /**
   * Costly work proposed instead of started: the run's conversation is created, waits, and a
   * question card asks «<Bot> quiere empezar: …» (Adelante / Ahora no / Nunca / Siempre). The
   * answer is an ordinary answer to a question (Runtime#answer), heard in onChange.
   */
  propose(rule, mission, cost) {
    const botId = rule.botId;
    const name = this.store.get("bots", botId)?.name || "Un bot";
    const title = (name + " quiere empezar: " + rule.name).slice(0, 140);
    const summary = title + "\n\n" + cost.reasons.map((r) => r.text).join(" ") + "\n\nLo pone en marcha la regla «" + rule.name + "» y es la primera vez que haría algo así.";
    const approvalId = "start:" + mission.id;
    const options = START_OPTIONS.map((o) => ({ ...o }));
    this.store.put("approvals", {
      id: approvalId, missionId: mission.id, botId, stepId: null, callId: null, tool: START_TOOL, kind: "question",
      title, summary, context: name + " · " + rule.name, blocks: 1, options, email: null, canAlways: false, status: "pending", createdAt: now(),
      decidedAt: null, decidedBy: null, resolution: null, startWork: { ruleId: rule.id, team: cost.team, monthly: cost.monthly, reasons: cost.reasons.map((r) => r.id) },
    });
    this.store.put("messages", { id: "question:" + approvalId, missionId: mission.id, botId, role: "assistant", kind: "question", text: summary, options, approvalId, stepId: null, at: now() });
    const why = { team: "trabajo en equipo", monthly: "muchas veces al mes", budget: "presupuesto del bot" };
    this.note(rule.id, { kind: "proposed", missionId: mission.id, text: "Te pregunta antes de empezar: " + cost.reasons.map((r) => why[r.id]).join(", ") });
    const waiting = this.store.patch("missions", mission.id, { status: "waiting", error: null });
    this.store.patch("automations", rule.id, { state: "waiting", lastStatus: "waiting", costAsked: true });
    return waiting;
  }
  onChange(change) {
    if (change?.type !== "record" || change.kind !== "approvals" || !change.data) return;
    const a = change.data;
    if (a.tool !== START_TOOL || a.status === "pending" || a.startHandled) return;
    try {
      this.decideStart(a);
    } catch (error) {
      console.warn("Propuesta de «" + (a.title || a.id) + "»: " + error.message);
    }
  }
  /** Your answer to «quiere empezar»: go on (once or always), not now, or never for this rule. */
  decideStart(a) {
    const said = String(a.answer?.text || "").trim();
    const picked = a.status !== "answered" ? "later" : START_OPTIONS.find((o) => o.id === a.answer?.optionId)?.id
      || START_OPTIONS.find((o) => o.label.toLowerCase() === said.toLowerCase())?.id || (isNo(said) ? "later" : "go");
    const label = START_OPTIONS.find((o) => o.id === picked).label;
    this.store.patch("approvals", a.id, { startHandled: true, startChoice: picked, resolution: label });
    const ruleId = a.startWork?.ruleId;
    const rule = ruleId ? this.store.get("automations", ruleId) : null;
    const time = this.clock();
    if (picked === "go" || picked === "always") {
      if (rule) this.store.patch("automations", rule.id, { costOk: { team: !!a.startWork.team, monthly: a.startWork.monthly || 0 }, costSnoozeUntil: null, ...(picked === "always" ? { costly: "siempre" } : {}) });
      return; // the runtime relaunches the conversation: the work starts
    }
    // Not started: the conversation closes before the runtime looks at it again.
    const mission = this.store.get("missions", a.missionId);
    if (mission && !TERMINAL.has(mission.status)) this.store.patch("missions", mission.id, { status: "cancelled", completedAt: now(), error: null });
    if (!rule) return;
    if (picked === "never")
      this.store.patch("automations", rule.id, { enabled: false, autoPaused: true, state: "paused", stoppedBy: "never", error: NEVER_TEXT, queue: [], digest: null });
    else this.store.patch("automations", rule.id, { costSnoozeUntil: new Date(time + COST.snoozeMs).toISOString(), queue: [], digest: null });
    this.note(rule.id, { kind: picked, missionId: a.missionId, text: picked === "never" ? "Dijiste «Nunca para esta regla»" : "Dijiste «Ahora no»: hasta mañana no vuelve a preguntar" });
  }
  /** A proposal whose conversation went on some other way (you wrote in it, or it was cancelled) is closed. */
  settleProposal(last) {
    if (!last || last.status === "waiting") return;
    const a = this.store.get("approvals", "start:" + last.id);
    if (!a || a.status !== "pending") return;
    const gone = last.status === "cancelled";
    this.store.patch("approvals", a.id, {
      status: gone ? "dismissed" : "answered", startHandled: true, decidedAt: now(), decidedBy: "tú",
      resolution: gone ? "Sin empezar" : "Empezó porque escribiste en su conversación", ...(gone ? {} : { answer: { optionId: "go", label: "Adelante", text: null } }),
    });
  }
  /** Runs of a rule, newest first: [{ at, missionId, title, status }]. */
  runs(ruleId) {
    const own = this.store
      .where("missions", "automationId", ruleId)
      .map((m) => ({ at: m.createdAt, missionId: m.id, title: m.title, status: m.status, ...(m.nothingNew ? { statusLabel: "Sin novedades" } : m.digest ? { statusLabel: "Resumen de " + m.digest + " avisos" } : m.supersededBy ? { statusLabel: "Sustituida" } : {}) }));
    // Deliveries into an existing conversation: one row per message, with the conversation's state.
    const delivered = (this.store.get("automations", ruleId)?.deliveries || []).map((d) => {
      const m = this.store.get("missions", d.missionId);
      return { at: d.at, missionId: d.missionId, messageId: d.messageId, title: m?.title || "Conversación borrada", status: m?.status || "cancelled", ...(d.digest ? { statusLabel: "Resumen de " + d.digest + " avisos" } : d.merged ? { merged: d.merged, statusLabel: "Juntaba " + (d.merged + 1) } : {}) };
    });
    // What the brakes did (joined to open work, stopped, cut, superseded): a line each, no run of its own.
    const notes = (this.store.get("automations", ruleId)?.notes || []).map((n) => ({ at: n.at, missionId: n.missionId || null, title: n.text, status: "note", statusLabel: "Aviso", note: n.kind }));
    return [...own, ...delivered, ...notes].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 50);
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
    this.store.listeners.delete(this.listener);
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
const wrapEvent = (rule, event) => wrapExternal(JSON.stringify(sanitizeValue({ tipo: event.kind, resumen: event.summary, ...event.data })), {
  source: EVENT_SOURCE[event.kind] || "trigger", label: rule.name,
  sender: event.data?.de || null, subject: event.data?.asunto || null,
});
function eventContext(rule, events, digest = null) {
  if (!events.length) return "";
  const wrap = (event) => wrapEvent(rule, event);
  if (digest)
    return "\n\nQué lo ha puesto en marcha (" + (digest.count + digest.dropped) + " avisos seguidos; Colmena los ha juntado en una sola vez porque llegaban demasiado a menudo" +
      (digest.dropped ? ", y solo te pasa los " + digest.count + " últimos" : "") + "). Atiéndelos juntos, una vez:\n" + events.map(wrap).join("\n");
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
