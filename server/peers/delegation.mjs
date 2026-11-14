// «Delegar aprobaciones»: another person of your team decides a routine's red lines too
// (docs/PEOPLE.md «Delegar aprobaciones»). A small protocol between Colmenas, like errands.mjs:
//   owner → delegate   approval.ask    {ref, title, routine, details}
//   delegate → owner   approval.decide {ref, decision, reason}        decision: approved | denied
//   owner → delegate   approval.closed {ref, resolution}              the owner decided first, it expired or was cancelled
// - Owner side: a routine with `approver: {contactId}` (an active contact). When one of its runs
//   leaves a red line pending (asking, or left for later without supervision), the ask goes to
//   that person and the approval keeps `delegation: {contactId, ref, sentAt}`. You can always
//   still decide it yourself; whoever decides first wins.
// - What travels: the action's name, who it goes to, the subject, the start of the text (4000
//   characters at most), the command and the bot's name. Never keys, tokens, vault data or
//   browser sessions; never an ask about a sign-in or a key.
// - Delegate side: asks from active contacts only, a few per hour per person, kept 24 h. Shown
//   in the Bandeja as «<Nombre> te pide que decidas», plain text marked as someone else's
//   content; never given to a model.
// - A decision back is applied only when it comes from that approval's contact with its ref,
//   while it is still pending, unexpired and its step read nothing suspicious, through the same
//   path as the card (approval-decide.mjs) with decidedBy = their name. A delegate's decision
//   never brings «Siempre» nor «Aprobado por adelantado».
import { randomUUID } from "node:crypto";
import { now } from "../store.mjs";
import { cleanLabel, isFlagged } from "../external-content.mjs";
import { isExpired } from "../waiting.mjs";
import { stepOf } from "../preapprovals.mjs";
import { PeerError } from "./service.mjs";

export const DELEGATION_LIMITS = Object.freeze({ ttlMs: 24 * 3600e3, perHour: 20, body: 4000, title: 200, reason: 500, command: 1000, recipients: 30 });
const ASKS = "peerApprovalAsks";
const REF = /^[A-Za-z0-9-]{8,64}$/;
// Never delegated: keys, sign-ins and anything about passwords or browser sessions.
const PRIVATE_TOOL = /sign_?in|vault|password|secret|credential|login|session/i;

const text = (s, n) => String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, n);
const line = (s, n) => text(s, n * 2).replace(/\s+/g, " ").trim().slice(0, n);
const first = (name) => String(name || "Alguien").trim().split(/\s+/)[0] || "Alguien";
const addresses = (v) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;]/) : []).map((x) => line(x, 200)).filter(Boolean);

/** What the delegate reads about approval `a`: only what it does, never anything secret. */
export function askDetails(store, a) {
  const bot = a.botId ? store.get("bots", a.botId) : null;
  const d = { action: line(a.review?.name || a.title || "Una acción", DELEGATION_LIMITS.title), bot: bot?.name ? line(bot.name, 60) : null };
  if (a.tool === "apps_execute") {
    const args = a.review?.arguments || {};
    const draft = a.review?.draft || null;
    const to = draft ? addresses(draft.to) : [...addresses(args.recipient_email), ...addresses(args.extra_recipients), ...addresses(args.attendees), ...addresses(args.attendee_emails)];
    const cc = draft ? addresses(draft.cc) : addresses(args.cc);
    if (to.length) d.to = to.slice(0, DELEGATION_LIMITS.recipients);
    if (cc.length) d.cc = cc.slice(0, DELEGATION_LIMITS.recipients);
    const subject = args.subject || draft?.subject || a.review?.thread?.subject || args.summary || args.title || "";
    if (subject) d.subject = line(subject, DELEGATION_LIMITS.title);
    const body = args.body || args.message_body || args.text || args.description || draft?.body || "";
    if (body) d.body = text(body, DELEGATION_LIMITS.body);
    if (a.review?.toolkit) d.app = line(a.review.toolkit, 40);
  } else if (a.tool === "run_command" && a.args?.program) {
    d.command = line([a.args.program, ...(a.args.args || [])].join(" "), DELEGATION_LIMITS.command);
  }
  return d;
}

/** The delegate's view of an ask from what arrived (cleaned again: it is someone else's). */
function cleanDetails(raw = {}) {
  const d = raw && typeof raw === "object" ? raw : {};
  const out = { action: line(d.action, DELEGATION_LIMITS.title) || "Una acción", bot: d.bot ? line(d.bot, 60) : null };
  for (const k of ["to", "cc"]) if (Array.isArray(d[k])) out[k] = d[k].slice(0, DELEGATION_LIMITS.recipients).map((x) => line(x, 200)).filter(Boolean);
  if (d.subject) out.subject = line(d.subject, DELEGATION_LIMITS.title);
  if (d.body) out.body = text(d.body, DELEGATION_LIMITS.body);
  if (d.command) out.command = line(d.command, DELEGATION_LIMITS.command);
  if (d.app) out.app = line(d.app, 40);
  return out;
}

/** How a closed approval reads for the person who was also asked. */
function resolutionOf(a, mission) {
  if (mission?.status === "cancelled") return "Se canceló";
  if (a.status === "pending") return isExpired(a) ? "Caducó sin decidirse" : "Sigue pendiente";
  if (a.status === "expired") return "Caducó sin decidirse";
  const approved = ["approved", "executing", "executed"].includes(a.status);
  return line(a.resolution || (approved ? "Aprobado" : "Denegado"), 200);
}

export class Delegation {
  constructor({ peers, store, decide = null, clock = () => Date.now(), sweepMs = 60000, settleMs = 40 }) {
    this.peers = peers;
    this.store = store;
    this.decide = decide; // (approval, {decision, reason, decidedBy}) → Promise (approval-decide.mjs)
    this.clock = clock;
    this.sweepMs = sweepMs;
    this.settleMs = settleMs;
    this.asked = new Map(); // contact → [times] (asks received per hour)
    this.soon = new Set(); // approvals waiting to be looked at once they settle
  }
  start() {
    this.onMessage = ({ from, body }) => { try { this.receive(from, body); } catch (error) { this.peers.log?.("Aprobación delegada: " + error.message); } };
    this.peers.on("approval", this.onMessage);
    this.onRecord = (event) => { if (event?.type === "record" && event.kind === "approvals" && event.data) this.later(event.data.id); };
    this.store.listeners.add(this.onRecord);
    this.timer = setInterval(() => this.sweep(), this.sweepMs);
    this.timer.unref?.();
    return this;
  }
  stop() {
    this.peers.off("approval", this.onMessage);
    this.store.listeners.delete(this.onRecord);
    clearInterval(this.timer);
  }

  // ------------------------------------------------------------------ owner: asking
  /** Looks at an approval once the code that made it has settled it (an auto-approval, «later»). */
  later(id) {
    if (this.soon.has(id)) return;
    this.soon.add(id);
    const t = setTimeout(() => { this.soon.delete(id); try { this.look(id); } catch (error) { this.peers.log?.("Aprobación delegada: " + error.message); } }, this.settleMs);
    t.unref?.();
  }
  look(id) {
    const a = this.store.get("approvals", id);
    if (!a) return;
    if (a.delegation && !a.delegation.closedAt && a.status !== "pending") return this.close(a);
    if (this.shouldAsk(a)) this.ask(a);
  }
  /** The contact who also decides this approval's red line, or null. */
  approverFor(a) {
    if (a.status !== "pending" || a.delegation || !(a.redLine || a.kind === "send") || a.autoSendAt) return null;
    if (a.kind === "secret" || PRIVATE_TOOL.test(String(a.tool || "")) || PRIVATE_TOOL.test(String(a.review?.tool || ""))) return null;
    const mission = a.missionId ? this.store.get("missions", a.missionId) : null;
    if (!mission?.automationId || mission.incognito || mission.peerErrand || mission.status === "cancelled") return null;
    if (isExpired(a, this.clock()) || isFlagged(this.store, stepOf(a))) return null;
    const rule = this.store.get("automations", mission.automationId);
    const c = rule?.approver?.contactId ? this.peers.contact(rule.approver.contactId) : null;
    return c?.status === "active" ? { contact: c, rule } : null;
  }
  shouldAsk(a) { return !!this.approverFor(a); }
  ask(a) {
    const who = this.approverFor(a);
    if (!who) return null;
    const ref = randomUUID();
    const body = { type: "approval.ask", ref, title: line(a.review?.name || a.title || "Una acción", DELEGATION_LIMITS.title), routine: line(who.rule.name, 120), details: askDetails(this.store, a) };
    this.store.patch("approvals", a.id, { delegation: { contactId: who.contact.id, ref, sentAt: now() } });
    this.peers.enqueue(who.contact.id, body);
    void this.peers.flushOutbox?.();
    return ref;
  }
  /** The owner decided first, it expired or was cancelled: the other person's card closes. */
  close(a, resolution = null) {
    const d = a.delegation;
    if (!d || d.closedAt) return;
    const mission = a.missionId ? this.store.get("missions", a.missionId) : null;
    this.store.patch("approvals", a.id, (old) => ({ delegation: { ...old.delegation, closedAt: now() } }));
    this.peers.enqueue(d.contactId, { type: "approval.closed", ref: d.ref, resolution: resolution || resolutionOf(a, mission) });
    void this.peers.flushOutbox?.();
  }
  /** Expired or cancelled while delegated (owner), and asks past their 24 h (delegate). */
  sweep() {
    const t = this.clock();
    for (const a of this.store.list("approvals")) {
      if (!a.delegation || a.delegation.closedAt) continue;
      const mission = a.missionId ? this.store.get("missions", a.missionId) : null;
      if (a.status !== "pending" || isExpired(a, t) || !mission || mission.status === "cancelled") this.close(a);
    }
    for (const x of this.store.list(ASKS)) if (x.state === "asked" && Date.parse(x.expiresAt) <= t) this.store.patch(ASKS, x.id, { state: "expired", closedAt: now() });
  }

  // ------------------------------------------------------------------ arriving
  receive(c, body) {
    const ref = typeof body.ref === "string" && REF.test(body.ref) ? body.ref : null;
    if (!ref || c?.status !== "active") return;
    if (body.type === "approval.ask") return this.arrived(c, ref, body);
    if (body.type === "approval.closed") return this.closedThere(c, ref, body);
    if (body.type === "approval.decide") return void this.decided(c, ref, body).catch((error) => this.peers.log?.("Aprobación delegada: " + error.message));
  }

  // ------------------------------------------------------------------ delegate: you decide for them
  arrived(c, ref, body) {
    const id = c.id + ":" + ref;
    if (this.store.get(ASKS, id)) return;
    const t = this.clock();
    const recent = (this.asked.get(c.id) || []).filter((x) => t - x < 3600e3);
    if (recent.length >= DELEGATION_LIMITS.perHour) return;
    this.asked.set(c.id, [...recent, t]);
    const ask = {
      id, ref, from: c.id, fromName: cleanLabel(c.name, 60), title: line(body.title, DELEGATION_LIMITS.title) || "Una acción", routine: line(body.routine, 120) || null,
      details: cleanDetails(body.details), state: "asked", at: now(), expiresAt: new Date(t + DELEGATION_LIMITS.ttlMs).toISOString(),
    };
    this.store.put(ASKS, ask);
    try { this.peers.notifier?.notify({ kind: "needs", title: `${first(ask.fromName)} te pide que decidas`, text: ask.title, url: "/bandeja", extra: {} }); } catch {}
  }
  closedThere(c, ref, body) {
    const ask = this.store.get(ASKS, c.id + ":" + ref);
    if (!ask || ask.from !== c.id || ["closed", "expired"].includes(ask.state)) return;
    this.store.patch(ASKS, ask.id, { ...(ask.state === "asked" ? { state: "closed" } : {}), resolution: line(body.resolution, 200) || null, closedAt: now() });
  }
  /** Your decision on someone else's routine: it goes back to them; nothing runs here. */
  answer(id, { decision, reason = "" } = {}) {
    const ask = this.store.get(ASKS, String(id));
    if (!ask) throw new PeerError("Esa petición ya no existe.", 404);
    if (ask.state !== "asked") throw new PeerError(ask.state === "closed" ? `Ya lo decidió ${first(ask.fromName)}.` : "Esa petición ya no espera tu respuesta.", 409);
    if (Date.parse(ask.expiresAt) <= this.clock()) {
      this.store.patch(ASKS, ask.id, { state: "expired", closedAt: now() });
      throw new PeerError("Esa petición caducó.", 409);
    }
    if (!["approved", "denied"].includes(decision)) throw new PeerError("Elige aprobar o denegar.", 400);
    const why = decision === "denied" ? line(reason, DELEGATION_LIMITS.reason) : "";
    this.peers.requireRelay?.();
    this.peers.enqueue(ask.from, { type: "approval.decide", ref: ask.ref, decision, ...(why ? { reason: why } : {}) });
    void this.peers.flushOutbox?.();
    return this.view(this.store.patch(ASKS, ask.id, { state: "decided", decision, reason: why || null, decidedAt: now() }));
  }
  view(x) {
    return x ? { id: x.id, from: x.fromName, title: x.title, routine: x.routine, details: x.details, state: x.state, decision: x.decision || null, reason: x.reason || null, resolution: x.resolution || null, at: x.at, expiresAt: x.expiresAt, closedAt: x.closedAt || x.decidedAt || null } : null;
  }

  // ------------------------------------------------------------------ owner: their decision
  async decided(c, ref, body) {
    if (!["approved", "denied"].includes(body.decision)) return false;
    const a = this.store.list("approvals").find((x) => x.delegation?.ref === ref);
    // Only that approval's person, about that approval, while it still waits and nothing it
    // read was suspicious; never past its deadline.
    if (!a || a.delegation.contactId !== c.id || a.status !== "pending" || a.delegation.closedAt) return false;
    if (isExpired(a, this.clock()) || isFlagged(this.store, stepOf(a))) return false;
    const mission = a.missionId ? this.store.get("missions", a.missionId) : null;
    if (!mission || mission.status === "cancelled") return false;
    if (!this.decide) return false;
    await this.decide(a, { decision: body.decision, reason: body.decision === "denied" ? line(body.reason, DELEGATION_LIMITS.reason) : "", decidedBy: cleanLabel(c.name, 60) || "otra persona" });
    return true;
  }
}

