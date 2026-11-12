// A room read as one conversation (docs/ROOMS-CONTRACT.md › Merged timeline). Its messages live
// in two stores that are never merged on disk: `messages` (your bots' sala, on this computer)
// and `peerMessages` (what people and their bots wrote, as it travelled). A page is made by
// taking the latest N top-level items below the cursor from each, merging them by
// (at, engine, place in its own store) and keeping the last N; the sala's thread replies,
// progress lines and steps for that span come along, as they do in a sala.
//
// One message in both stores is shown once. Your own message that started a bot turn and your
// bot's answer that went to the people carry `peerId` (and `peerParts`) on the mission row: the
// mission row is the body and the peer row only says how it travelled (sent, seen by, edited,
// reactions). A long answer of someone else's bot arrives in parts and is joined back here.
import { ROOM_PAGE, MAX_PAGE, stepsForPage } from "./history.mjs";
import { visibleMessages } from "./branches.mjs";
import { cleanPart, threadsOf } from "./peers/service.mjs";
import { joinParts } from "./room.mjs";

const RANK = { mission: 0, peer: 1 };
const atOf = (m) => String(m?.at || "");
const isTop = (m) => !m.replyTo && m.kind !== "progress";
/** (at, engine): the order between the two stores; inside one, its own order holds. */
const before = (a, b) => a.at < b.at || (a.at === b.at && RANK[a.engine] < RANK[b.engine]);

/** The cursor is opaque to whoever pages: {at, id, e} of the oldest item of the page it came with. */
export const encodeCursor = (c) => Buffer.from(JSON.stringify([c.at, c.id, c.engine === "peer" ? 1 : 0])).toString("base64url");
export function decodeCursor(text) {
  if (!text) return null;
  try {
    const [at, id, e] = JSON.parse(Buffer.from(String(text), "base64url").toString("utf8"));
    if (typeof at !== "string" || typeof id !== "string") throw Error("x");
    return { at, id, engine: e === 1 ? "peer" : "mission" };
  } catch {
    throw Object.assign(Error("Ese punto de la conversación no es válido."), { status: 400 });
  }
}

/**
 * The latest `need` top-level peer messages of a share below `below` {at, id}, newest first,
 * walking the (shareId, at) index in chunks. `skip`: ids shown by their mission row. The parts
 * of a long bot answer become one item at the place of its first part.
 */
function peerItems(store, shareId, { below, need, skip }) {
  const out = [];
  const chunk = Math.max(40, need * 2);
  let cur = below, more = true;
  while (out.length < need && more) {
    const rows = store.ordered("peerMessages", "shareId", shareId, { before: cur, limit: chunk, lacks: "thread" });
    more = rows.length === chunk;
    for (let i = 0; i < rows.length; i++) {
      const m = rows[i];
      cur = { at: m.at, id: m.id };
      if (skip.has(m.id)) continue;
      const part = cleanPart(m.part);
      // A later part belongs to the item of its first part, if that one is here.
      if (part && part.n > 1) {
        const first = store.get("peerMessages", part.of);
        if (first && first.shareId === shareId && first.from === m.from && cleanPart(first.part)?.of === part.of) continue;
      }
      out.push(part && part.n === 1 ? joined(store, m, part) : { row: m });
      if (out.length >= need) { more = more || i < rows.length - 1; break; }
    }
  }
  return { items: out, more };
}
/** The first part of a long answer with the parts that followed it (the next rows of its sender). */
function joined(store, first, part) {
  const rows = store.ordered("peerMessages", "shareId", first.shareId, { after: { at: first.at, id: first.id }, limit: 60, asc: true });
  const rest = rows.filter((m) => m.from === first.from && !m.deletedAt && m.bot?.id === first.bot?.id && cleanPart(m.part)?.of === part.of && m.part.n > 1)
    .sort((a, b) => a.part.n - b.part.n).filter((m, i, list) => !i || list[i - 1].part.n !== m.part.n);
  if (!rest.length || first.deletedAt) return { row: first };
  const pieces = [{ text: first.text, glue: "" }, ...rest.map((m) => ({ text: m.text, glue: m.part.glue }))];
  return { row: { ...first, text: joinParts(pieces) }, parts: [first.id, ...rest.map((m) => m.id)], total: part.total };
}

/**
 * One page of a room: { items, attached, steps, cursor, more }.
 *  - items: top-level messages of both stores, oldest first, each `{engine, author, …view}`;
 *  - attached: the sala's thread replies and progress lines that hang from those items;
 *  - steps: the steps of the span (the live ones too, on the latest page);
 *  - cursor: what to ask the page before with (null at the very start).
 * `messageView` / `stepView`: the missions route's own views; `peers`: «Personas» or null.
 */
export function roomTimeline({ store, room, peers = null, me, cursor = null, limit = ROOM_PAGE, messageView, stepView }) {
  const size = Math.max(1, Math.min(MAX_PAGE, Math.floor(limit) || ROOM_PAGE));
  const at = decodeCursor(cursor);
  const mission = room.missionId ? store.get("missions", room.missionId) : null;
  const share = room.shareId && peers ? store.get("peerShares", room.shareId) : null;
  const bots = new Map(store.list("bots").map((b) => [b.id, b]));

  // ---- the sala: its visible path, top-level messages in the order of their time
  const all = mission ? visibleMessages(mission, store.where("messages", "missionId", mission.id)) : [];
  const top = all.filter(isTop).map((m, i) => ({ m, i })).sort((a, b) => atOf(a.m).localeCompare(atOf(b.m)) || a.i - b.i).map((x) => x.m);
  let mEnd = top.length;
  if (at) {
    const found = at.engine === "mission" ? top.findIndex((m) => m.id === at.id) : -1;
    // Below a peer item: everything up to its time (the sala goes first on a tie); else strictly older.
    mEnd = found >= 0 ? found : top.filter((m) => (at.engine === "peer" ? atOf(m) <= at.at : atOf(m) < at.at)).length;
  }
  const mStart = Math.max(0, mEnd - size);
  const mItems = top.slice(mStart, mEnd).map((m) => ({ engine: "mission", at: atOf(m), row: m }));

  // ---- the people: what the mission rows already show is left out
  const linked = new Map(); // peer id → the mission row that is its body
  for (const m of all) for (const id of [m.peerId, ...(m.peerParts || [])]) if (id) linked.set(id, m);
  const peer = share
    ? peerItems(store, share.id, { below: at ? (at.engine === "peer" ? { at: at.at, id: at.id } : { at: at.at, id: "" }) : null, need: size, skip: linked })
    : { items: [], more: false };
  const pItems = peer.items.reverse().map((x) => ({ engine: "peer", at: atOf(x.row), ...x }));

  // ---- merged, the last `size`
  const merged = [];
  for (let i = 0, j = 0; i < mItems.length || j < pItems.length;) {
    if (j >= pItems.length || (i < mItems.length && !before(pItems[j], mItems[i]))) merged.push(mItems[i++]);
    else merged.push(pItems[j++]);
  }
  const page = merged.slice(Math.max(0, merged.length - size));
  const more = merged.length > page.length || mStart > 0 || peer.more;
  const oldest = page[0];

  // ---- what hangs from the sala's part of the page
  const kept = page.filter((x) => x.engine === "mission").map((x) => x.row);
  const keep = new Set(kept.map((m) => m.id));
  const first = kept.length ? top.indexOf(kept[0]) : mEnd;
  const from = kept.length ? (first > 0 ? atOf(kept[0]) : "") : "￿";
  const until = mEnd < top.length ? atOf(top[mEnd]) : null;
  const inSpan = (m) => atOf(m) >= from && (until === null || atOf(m) < until);
  const hanging = all.filter((m) => !keep.has(m.id) && (keep.has(m.replyTo) || (m.kind === "progress" && !m.replyTo && inSpan(m))));
  const steps = mission && (kept.length || !at)
    ? stepsForPage(store.where("steps", "missionId", mission.id), { messages: [...kept, ...hanging], from, until }).map((s) => stepView(s, bots))
    : [];

  // ---- views
  const you = { address: me.address, name: me.name, you: true };
  const botAuthor = (bot, owner, botId) => ({ kind: "bot", botId, name: bot?.name || "Bot", role: bot?.role || "", shape: bot?.shape || "circle", color: bot?.color || "#8C8F99", owner });
  const person = (address) => (address === me.address ? you : { address, name: peers?.person(address).name || "Alguien", you: false });
  const missionAuthor = (m) => {
    if (m.role === "assistant" && m.botId) return botAuthor(bots.get(m.botId), you, m.botId);
    if (m.role !== "user" || m.origin) return { kind: "system" };
    return { kind: "person", ...(m.author?.address ? person(m.author.address) : you) };
  };
  const peerAuthor = (m) => {
    const owner = person(m.from);
    // Your own bot is named as in the sala; someone else's by owner and bot, as a mention is.
    return m.bot ? botAuthor(m.bot, owner, owner.you ? m.bot.id : { owner: m.from, bot: m.bot.id }) : { kind: "person", ...owner };
  };
  // Thread replies come after their root: the ones written since the page's oldest item.
  const replies = share && oldest ? threadsOf(store.ordered("peerMessages", "shareId", share.id, { after: { at: oldest.at, id: "" }, has: "thread" })) : new Map();
  const peerView = (row) => peers.messageView(row, share, replies);
  const WORST = ["failed", "sending", "sent", "received", "local"];
  /** How a mission row travelled to the people: the peer row(s) it is the body of. */
  const travel = (m) => {
    const ids = [m.peerId, ...(m.peerParts || [])].filter((id, i, list) => id && list.indexOf(id) === i);
    const rows = ids.map((id) => store.get("peerMessages", id)).filter(Boolean);
    if (!rows.length || !share) return m.peerId ? { peerId: m.peerId } : {};
    const view = peerView(rows[0]);
    const status = rows.map((r) => r.status || "received").sort((a, b) => WORST.indexOf(a) - WORST.indexOf(b))[0];
    return {
      peerId: m.peerId,
      peer: { id: rows[0].id, status, seenBy: view.seenBy, reactions: view.reactions, ...(view.edited ? { edited: view.edited } : {}), ...(rows.some((r) => r.deletedAt) ? { deleted: true } : {}), ...(view.replies ? { replies: view.replies } : {}), ...(rows.length > 1 ? { parts: rows.length } : {}) },
    };
  };
  const missionItem = (m) => ({ ...messageView(m), engine: "mission", author: missionAuthor(m), ...travel(m) });
  const peerItem = (x) => {
    const author = peerAuthor(x.row);
    const mine = author.you || author.owner?.you;
    return {
      ...peerView(x.row), engine: "peer", author,
      // Words that came from another computer are plain text: never Markdown, never HTML.
      ...(mine ? {} : { plain: true }), ...(x.parts ? { parts: x.parts.length, partIds: x.parts } : {}),
    };
  };
  return {
    items: page.map((x) => (x.engine === "mission" ? missionItem(x.row) : peerItem(x))),
    attached: hanging.map(missionItem),
    steps,
    cursor: more && oldest ? encodeCursor({ at: oldest.at, id: oldest.row.id, engine: oldest.engine }) : null,
    more,
  };
}
