import { cheapestModel } from "../checkins.mjs";
import { visibleMessages } from "../branches.mjs";
import { now } from "../store.mjs";
import { cleanUse, turnNote } from "../turnoptions.mjs";
import { ROUTER_INSTRUCTIONS, coordinationAsk, lastExchange, parsePick, quotedBot, routed, routerInput, spokenLines } from "../router.mjs";

/** «Atlas está eligiendo quién responde» while the model picks (the room's typing line). */
export const ROUTING_VERB = "eligiendo quién responde";
/** The kinds of step of a team plan: while one is unfinished, Atlas coordinates every message. */
const PLAN_KINDS = new Set(["plan", "work", "synthesis"]);

/** Runtime methods: who answers a message that names nobody in a room with several specialists (router.mjs). */
export class RoutingMethods {
  /** The room's bots a message may be routed to: members, switched on, with an AI account. Never Atlas (the fallback). */
  routeCandidates(mission) {
    return [...new Set(mission?.botIds || [])].filter((b) => b !== "atlas").map((b) => this.bot(b))
      .filter((b) => b && b.enabled && b.usesChatGPT !== false && b.audience !== "yo");
  }
  /**
   * Whether the router decides for a message that names nobody, outside a thread: only in a
   * team room (Atlas would get it otherwise) with two or more specialists that can answer,
   * with no plan under way, and with Ajustes › «Elegir solo quién responde en las salas» on.
   */
  routerApplies(mission, steps) {
    if (!this.routerOn || this.settings().routing === false) return false;
    if (!mission || mission.mode !== "equipo" || mission.conversation) return false;
    if ((steps || []).some((s) => PLAN_KINDS.has(s.kind) && s.status !== "completed")) return false;
    return this.routeCandidates(mission).length > 1;
  }
  /** What was said in the room's main line before the message `exceptId` (all of it without one). */
  routeLines(mission, exceptId = null) {
    const lines = spokenLines(visibleMessages(mission, this.store.where("messages", "missionId", mission.id)));
    const at = exceptId ? lines.findIndex((x) => x.id === exceptId) : -1;
    return at >= 0 ? lines.slice(0, at) : lines;
  }
  /** Step 1, no model: a decision ({to, by: 'regla', why, ms}), or null when the model has to pick. */
  routeByRules(mission, text, { exceptId = null } = {}) {
    const started = Date.now();
    const lines = this.routeLines(mission, exceptId);
    const ok = new Set(this.routeCandidates(mission).map((b) => b.id));
    const name = (botId) => this.bot(botId)?.name || botId;
    const rule = (to, why) => routed([to], "regla", why, Date.now() - started);
    const quoted = quotedBot(text, lines);
    if (quoted === "atlas" || (quoted && ok.has(quoted))) return rule(quoted, "Citas un mensaje de " + name(quoted));
    const job = coordinationAsk(text);
    if (job) return rule("atlas", job);
    const recent = lastExchange(lines);
    if (recent && ok.has(recent)) return rule(recent, "Estabas hablando con " + name(recent));
    return null;
  }
  /**
   * Step 2: the cheapest model picks, as a side job (skipped by the plan gate when little is
   * left, never retried). Always answers with a decision: its pick ('modelo') or, when it is
   * slow, fails, is skipped or says something that is not a bot of the room, Atlas ('atlas').
   */
  async routeByModel(mission, text, { exceptId = null } = {}) {
    const started = Date.now();
    const atlas = (why) => routed(["atlas"], "atlas", why, Date.now() - started);
    const bots = this.routeCandidates(mission);
    const model = cheapestModel(this.availableModels());
    if (!model) return atlas("No hay un modelo rápido para elegir");
    const controller = new AbortController();
    let timer = null;
    const late = new Promise((resolve) => { timer = setTimeout(() => { controller.abort(Error("El enrutador tardó demasiado.")); resolve(null); }, this.routerTimeoutMs); });
    const shown = !this.activity.has("atlas");
    if (shown) {
      this.activity.set("atlas", { verb: ROUTING_VERB, missionId: mission.id, detail: "", at: now() });
      this.emit({ type: "activity", mission: mission.id, botId: "atlas", verb: ROUTING_VERB, detail: "" });
    }
    try {
      const call = this.infer({
        model, tools: [], reasoning: { effort: "low" }, signal: controller.signal, instructions: ROUTER_INSTRUCTIONS,
        input: [{ role: "user", content: routerInput(text, this.routeLines(mission, exceptId), bots, (botId) => this.bot(botId)?.name || "Un bot") }],
      }, { missionId: mission.id, botId: "atlas", retry: false });
      call.catch(() => {}); // an answer or a failure after the deadline is nobody's
      const result = await Promise.race([call, late]);
      if (!result) return atlas("Tardaba en elegir");
      const pick = parsePick(result.text, bots.map((b) => b.id));
      if (!pick) return atlas("No quedó claro para quién era");
      // Somebody may have been switched off or left the room while the model thought.
      const fresh = this.store.get("missions", mission.id);
      const still = new Set(fresh ? this.routeCandidates(fresh).map((b) => b.id) : []);
      if (pick.to.some((b) => b !== "atlas" && !still.has(b))) return atlas("Ese bot ya no está disponible");
      const why = pick.why || (pick.to[0] === "atlas" ? "Es cosa de coordinar" : pick.to.length > 1 ? "Va para varios" : "Encaja con su especialidad");
      return routed(pick.to, "modelo", why, Date.now() - started);
    } catch {
      return atlas("No se pudo elegir ahora");
    } finally {
      clearTimeout(timer);
      if (shown && this.activity.get("atlas")?.verb === ROUTING_VERB) this.clearActivity("atlas", mission.id);
    }
  }
  /**
   * A message whose turn is queued later: it waits for the model's pick, or it arrived while
   * an earlier message of the room was still being routed. One after another per room, so the
   * turns are queued in the order the messages were written.
   */
  routeLater(missionId, turn, { router, botIds }) {
    const prior = this.routes.get(missionId) || Promise.resolve();
    const job = prior.then(() => this.routeAndDeliver(missionId, turn, { router, botIds }))
      .catch((error) => {
        console.warn("Colmena: no se pudo entregar un mensaje enrutado: " + (error?.message || error));
        // The pick failed without a word: the message is not lost, Atlas takes it.
        try { this.recoverRouting({ missionId, messageId: turn.messageId }); } catch (again) { console.warn("Colmena: tampoco se pudo dejar a Atlas: " + (again?.message || again)); }
      });
    this.routes.set(missionId, job);
    this.jobs.add(job);
    void job.finally(() => {
      this.jobs.delete(job);
      if (this.routes.get(missionId) === job) this.routes.delete(missionId);
    });
    return job;
  }
  /**
   * A message left with no turn — Colmena closed during the pick, or the pick failed without a
   * word — gets one, once, in the order the messages were written:
   *   · one left «eligiendo quién responde» (`routing`) is queued for Atlas (the fallback): it
   *     keeps `routed.by: "atlas"` and stops being `routing`;
   *   · one that waited behind it (`awaitsTurn`: an @mention, a reply in a thread, a routine's
   *     message) goes to whom it was for — a named bot stays named — or to Atlas when none of
   *     them is in the room any more.
   * A second look finds nothing to do. Without arguments it looks at every team room (on
   * startup, before the interrupted work goes on); with them, at that one message. Returns the
   * ids it queued.
   */
  recoverRouting({ missionId = null, messageId = null } = {}) {
    const recovered = [];
    const rooms = missionId ? [this.store.get("missions", missionId)].filter(Boolean) : this.store.list("missions").filter((m) => m.mode === "equipo" && !m.conversation);
    for (const m of rooms) {
      if (m.status === "cancelled" || (!messageId && this.routes.has(m.id))) continue;
      const lost = this.store.where("messages", "missionId", m.id).filter((x) => x.role === "user" && (x.routing === true || x.awaitsTurn) && (!messageId || x.id === messageId));
      for (const msg of lost) {
        // Read again for each one: the turn of the one before is already in the room.
        const answered = this.steps(m.id).some((s) => s.ackOn === msg.id || (s.ackExtra || []).includes(msg.id));
        if (answered) { this.store.patch("messages", msg.id, { routing: false, ...(msg.awaitsTurn ? { awaitsTurn: null } : {}) }); continue; }
        const waited = msg.routing === true ? null : msg.awaitsTurn;
        // Whom it was for, if they are still here; nobody named (or nobody left): Atlas.
        const members = new Set(this.roomMembers(m).map((b) => b.id));
        const to = (waited?.to || []).filter((b) => members.has(b) && this.bot(b)?.enabled);
        const own = (waited ? waited.own !== false && !msg.origin : true) && !msg.author;
        const mode = msg.mode || m.queueMode || "steer";
        const root = waited && msg.replyTo ? this.store.get("messages", msg.replyTo) : null;
        // Another person's request goes only to the bot it named: with that bot gone, to nobody (never Atlas).
        if (msg.author && !to.length) { this.store.patch("messages", msg.id, { routing: false, awaitsTurn: null }); continue; }
        if (waited) this.store.patch("messages", msg.id, { awaitsTurn: null });
        else this.store.patch("messages", msg.id, { routing: false, routed: routed(["atlas"], "atlas", messageId ? "No se pudo elegir ahora" : "Colmena se cerró mientras elegía") });
        this.deliverTurn(m.id, {
          messageId: msg.id, text: this.saidBy(String(msg.text || ""), msg.author || null), note: turnNote(cleanUse(msg.use || []), { deep: !!msg.deep }), effort: msg.deep ? "high" : undefined,
          about: root ? this.threadAbout(root) : "", thread: root ? msg.replyTo : null, mode: !own && mode === "interrupt" ? "steer" : mode, named: (msg.to || []).filter((b) => to.includes(b)), own,
        }, to.length ? to : ["atlas"]);
        recovered.push(msg.id);
      }
    }
    return recovered;
  }
  async routeAndDeliver(missionId, turn, { router, botIds }) {
    const live = () => {
      const m = this.store.get("missions", missionId);
      return m && m.status !== "cancelled" && this.store.get("messages", turn.messageId) ? m : null;
    };
    let mission = live();
    if (!mission) return;
    let to = botIds;
    if (router) {
      let route = null;
      try {
        const working = this.active.has(missionId) && !["completed", "paused", "waiting"].includes(mission.status);
        route = !this.routerApplies(mission, this.steps(missionId)) ? routed(["atlas"], "atlas", "Atlas lo coordina")
          : this.routeByRules(mission, turn.text, { exceptId: turn.messageId })
            || (working && turn.mode === "interrupt" ? routed(["atlas"], "atlas", "Interrumpes: Atlas lo atiende ya") : await this.routeByModel(mission, turn.text, { exceptId: turn.messageId }));
      } catch {
        route = routed(["atlas"], "atlas", "No se pudo elegir ahora");
      }
      mission = live();
      if (!mission) return;
      to = route.to;
      this.store.patch("messages", turn.messageId, { routed: route, routing: false });
    }
    this.deliverTurn(missionId, turn, to);
  }
}
