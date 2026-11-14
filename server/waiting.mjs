// One count of what waits for you (docs/ROOMS-CONTRACT.md «One count of what waits for you»).
//
// `waitingItems(store, now)` is the single definition. Every number the app shows (the Inicio
// badge, the sidebar foot, the «Te necesitan» column of Trabajo, «te espera» on a bot,
// Actividad, the taskbar and the tray) is the length of this list or a FILTER of it; none of
// them counts on its own. The list travels in GET /api/state as `waiting` (light: ids only).
//
// What waits:
//   - approvals that are pending, not put off («Recordar después», snooze.mjs) and not expired;
//   - unarchived missions that wait for a plan decision or a choice and have no such approval
//     (a room whose only request is put off does not wait either: it comes back with it);
//   - open notes of the bot that watches your apps (watch.mjs);
//   - people-side asks: an errand another person sent to one of your bots that waits for your
//     OK (state `asked`, server/peers/errands.mjs). It is read from the stored records only;
//   - «please add» requests of a room you made (`roomRequests` you received, still `asked`);
//   - asks to decide a red line of another person's routine (`peerApprovalAsks`, still `asked`,
//     within its 24 h: server/peers/delegation.mjs).
import { approvalExpiresAt } from "./state.mjs";
import { isSnoozed } from "./snooze.mjs";

const DECIDE = new Set(["awaiting_plan", "awaiting_choice"]);
const stamp = (iso) => { const t = Date.parse(iso || ""); return Number.isNaN(t) ? null : t; };

/** A pending approval that can no longer be decided: its time to approve it ran out. */
export function isExpired(a, now = Date.now()) {
  if (!a || a.status !== "pending") return false;
  const end = stamp(a.kind === "secret" ? a.expiresAt : approvalExpiresAt(a));
  return end != null && end <= now;
}

/**
 * Everything that waits for the person now, the oldest first:
 *   [{ kind: "approval" | "mission" | "note" | "errand", id, missionId, roomId, botId, what, at }]
 * `id` is the record's own id (approval, mission, watch note, errand). `missionId` is the
 * room or chat it belongs to (null for an errand); `roomId` is where it is answered: the
 * mission, or the conversation with that person for an errand. `what` says which request it
 * is (the approval's kind, the mission's status). A room that waits for a choice or a plan
 * waits as a room: it names a bot only when it is that bot's own chat. An errand also carries `title`, since the
 * state has no other record of it.
 */
export function waitingItems(store, now = Date.now(), { approvals = null } = {}) {
  const items = [];
  // `approvals`: the stored approvals when the caller has just listed them.
  const pending = (approvals || store.list("approvals")).filter((a) => a.status === "pending" && !isExpired(a, now));
  // A room with a request of its own, put off or not, is not counted a second time.
  const covered = new Set(pending.map((a) => a.missionId));
  const missions = store.columns("missions", ["id", "status", "archived", "botIds", "conversation", "updatedAt", "createdAt"]);
  // A bot's own chat: what waits there is that bot's. Anywhere else a plan is the room's.
  const chatBot = new Map();
  for (const m of missions) {
    let botIds = m.botIds;
    if (typeof botIds === "string") { try { botIds = JSON.parse(botIds); } catch { botIds = []; } }
    chatBot.set(m.id, m.conversation && Array.isArray(botIds) && botIds.length === 1 ? botIds[0] : null);
  }
  for (const a of pending) {
    if (isSnoozed(a, now)) continue;
    const roomLevel = a.kind === "plan" && !chatBot.get(a.missionId);
    items.push({ kind: "approval", id: a.id, missionId: a.missionId ?? null, roomId: a.missionId ?? a.roomId ?? null, botId: roomLevel ? null : a.botId ?? null, what: a.kind || "permission", at: a.createdAt ?? null });
  }
  for (const m of missions) {
    if (!DECIDE.has(m.status) || m.archived || covered.has(m.id)) continue;
    items.push({ kind: "mission", id: m.id, missionId: m.id, roomId: m.id, botId: chatBot.get(m.id) ?? null, what: m.status, at: m.updatedAt ?? m.createdAt ?? null });
  }
  for (const n of store.list("watchNotes")) {
    if (n.status !== "open") continue;
    items.push({ kind: "note", id: n.id, missionId: n.missionId ?? null, roomId: n.missionId ?? null, botId: n.botId ?? null, what: "note", at: n.createdAt ?? null });
  }
  // ---- People-side asks (the hook for what other people ask of you) -------------------
  // Today: inbound errands that wait for the owner's OK. Requests to your bots from a shared
  // room (the owner's rule «Pregúntame») belong here too once server/peers stores them.
  for (const item of peerAsks(store)) items.push(item);
  for (const item of addAsks(store)) items.push(item);
  // Another person asks you to decide a red line of their routine (peers/delegation.mjs).
  for (const ask of delegatedAsks(store, now)) if (ask.state === "asked") items.push({ kind: "delegated", id: ask.id, missionId: null, roomId: null, botId: null, what: "delegated", at: ask.at ?? null, title: `${firstOf(ask.from)} te pide que decidas`, ask });
  return items.sort((x, y) => (stamp(x.at) ?? 0) - (stamp(y.at) ?? 0));
}

/**
 * «Please add»: a member of a room you made asks you to let someone in (server/room.mjs). It
 * waits for you, the owner, in that room. What YOU asked another owner (`dir: "out"`) waits
 * for them, not for you, and is never counted.
 */
function addAsks(store) {
  let rows = [];
  try { rows = store.list("roomRequests"); } catch { return []; }
  return rows.filter((r) => r.status === "asked" && r.dir !== "out" && r.roomId).map((r) => ({
    kind: "roomadd", id: r.id, missionId: null, roomId: r.roomId, botId: null, what: "roomadd", at: r.at ?? null,
    title: `${firstOf(nameOf(store, r.from))} pide añadir a ${r.member?.name || "una persona"}`, room: roomTitle(store, r.roomId),
  }));
}
const roomTitle = (store, id) => { try { return store.get("rooms", id)?.title || null; } catch { return null; } };
const firstOf = (name) => String(name || "Alguien").trim().split(/\s+/)[0] || "Alguien";
const nameOf = (store, address) => { try { return store.get("peerContacts", address)?.name || null; } catch { return null; } };

/** Inbound errands in state `asked`: another person asked one of your bots and you decide. */
function peerAsks(store) {
  let errands = [];
  try { errands = store.list("peerErrands"); } catch { return []; }
  const line = (text, max) => { const s = String(text || "").replace(/\s+/g, " ").trim(); return s.length > max ? s.slice(0, max - 1) + "…" : s; };
  return errands.filter((e) => e.dir === "in" && e.state === "asked").map((e) => ({
    kind: "errand", id: e.id, missionId: null, roomId: e.shareId ?? null, botId: e.bot?.id ?? null, what: "errand", at: e.at ?? null,
    title: `${String(e.fromName || "Alguien").split(" ")[0]} pide a ${e.bot?.name || "tu bot"}: ${line(e.text, 120)}`,
  }));
}

/**
 * What other people of your team asked you to decide for their routines (peers/delegation.mjs),
 * as the Bandeja shows them: those still waiting and the ones closed in the last day. An ask
 * past its 24 h reads «expired» even before the sweep marks it. Plain text from someone else:
 * it is only shown, never given to a model.
 */
export function delegatedAsks(store, now = Date.now()) {
  let rows = [];
  try { rows = store.list("peerApprovalAsks"); } catch { return []; }
  return rows.filter((x) => Date.parse(x.expiresAt) > now - 3600e3)
    .map((x) => ({
      id: x.id, from: x.fromName, title: x.title, routine: x.routine ?? null, details: x.details || {},
      state: x.state === "asked" && Date.parse(x.expiresAt) <= now ? "expired" : x.state,
      decision: x.decision ?? null, reason: x.reason ?? null, resolution: x.resolution ?? null, at: x.at ?? null, expiresAt: x.expiresAt, closedAt: x.closedAt ?? x.decidedAt ?? null,
    }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** How many things wait for the person: the number every surface shows. */
export const waitingCount = (store, now = Date.now()) => waitingItems(store, now).length;
