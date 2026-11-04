// A conversation as a tree (after assistant-ui message-repository.ts and its branch picker):
// editing a message you sent, or asking for «Otra respuesta», starts a branch that replaces
// that message from there on; the old one stays, and «‹ 1/3 ›» moves between them.
//
// Nothing is rewritten: a chat without branches is the linear branch «main» (every existing
// chat already is). A branch is { id, parent, fork, at }: it replaces message `fork` of its
// parent's path. Which branch a message belongs to follows from when it was written: the
// mission keeps `branchLog`, the moments a branch became the active one, so whatever is
// written afterwards (your message, the bot's answer, its progress lines) lands there.
// The bot only ever sees the active path.

export const MAIN = "main";

const byAt = (a, b) => String(a.at || "").localeCompare(String(b.at || ""));
const branchesOf = (mission) => new Map([[MAIN, { id: MAIN, parent: null, fork: null, at: "" }], ...(mission?.branches || []).map((b) => [b.id, b])]);

/** The branch that was active when `at` happened. */
export function branchAt(mission, at) {
  let current = MAIN;
  for (const e of mission?.branchLog || []) {
    if (String(e.at) <= String(at || "")) current = e.branch;
    else break;
  }
  return current;
}

/** The messages of branch `id`'s path, oldest first: its parent's path up to the fork, then its own. */
export function pathOf(mission, messages, id = mission?.branch || MAIN) {
  const branches = branchesOf(mission);
  if (!mission?.branches?.length) return messages;
  const own = new Map();
  for (const m of [...messages].sort(byAt)) {
    const b = branchAt(mission, m.at);
    if (!own.has(b)) own.set(b, []);
    own.get(b).push(m);
  }
  const walk = (bid, seen = new Set()) => {
    const b = branches.get(bid);
    if (!b || seen.has(bid)) return [];
    seen.add(bid);
    const mine = own.get(bid) || [];
    if (!b.parent) return mine;
    const above = walk(b.parent, seen);
    const cut = above.findIndex((m) => m.id === b.fork);
    return [...(cut >= 0 ? above.slice(0, cut) : above), ...mine];
  };
  return walk(branches.has(id) ? id : MAIN);
}

/** The active path of a mission (all its messages when it never branched). */
export const visibleMessages = (mission, messages) => pathOf(mission, messages, mission?.branch || MAIN);

/**
 * Where a new branch hangs to replace `messageId` of the active path. A message that is
 * itself a replacement shares its original's place, so all the versions of one spot are
 * siblings («1/3»), whichever of them you edit.
 */
export function forkPoint(mission, messages, messageId) {
  const branches = [...branchesOf(mission).values()];
  const path = visibleMessages(mission, messages);
  if (!path.some((m) => m.id === messageId)) return null;
  for (const b of branches) {
    if (!b.parent) continue;
    const first = pathOf(mission, messages, b.id).find((m) => branchAt(mission, m.at) === b.id);
    if (first?.id === messageId) return { parent: b.parent, fork: b.fork };
  }
  return { parent: branchAt(mission, path.find((m) => m.id === messageId).at), fork: messageId };
}

/** The versions of one spot: the original message and each branch's first own message. */
export function siblingsAt(mission, messages, { parent, fork }) {
  const original = pathOf(mission, messages, parent).find((m) => m.id === fork);
  const out = original ? [{ id: original.id, branch: parent }] : [];
  for (const b of (mission?.branches || []).filter((x) => x.parent === parent && x.fork === fork).sort(byAt)) {
    const first = pathOf(mission, messages, b.id).find((m) => branchAt(mission, m.at) === b.id);
    out.push({ id: first?.id || null, branch: b.id });
  }
  return out;
}

/**
 * For the chat: { [messageId of the active path]: { index, count, ids } } at every spot that
 * has more than one version.
 */
export function branchPoints(mission, messages) {
  if (!mission?.branches?.length) return {};
  const path = visibleMessages(mission, messages);
  const onPath = new Set(path.map((m) => m.id));
  const spots = new Map();
  for (const b of mission.branches) spots.set(b.parent + "\u0000" + b.fork, { parent: b.parent, fork: b.fork });
  const out = {};
  for (const spot of spots.values()) {
    const versions = siblingsAt(mission, messages, spot);
    const index = versions.findIndex((v) => v.id && onPath.has(v.id));
    if (index < 0 || versions.length < 2) continue;
    out[versions[index].id] = { index: index + 1, count: versions.length, ids: versions.map((v) => v.id) };
  }
  return out;
}

const branchId = () => "b-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/**
 * Changes for the mission that open a branch replacing `messageId` and make it the active
 * one (`at`: now). Returns null when the message is not on the active path.
 */
export function openBranch(mission, messages, messageId, at) {
  const point = forkPoint(mission, messages, messageId);
  if (!point) return null;
  const branch = { id: branchId(), parent: point.parent, fork: point.fork, at };
  return { branch, changes: activate({ ...mission, branches: [...(mission.branches || []), branch] }, branch.id, at, { branches: [...(mission.branches || []), branch] }) };
}

/**
 * Changes that make `id` the active branch; every branch above it remembers it as the last
 * one used below (switchTo goes back there). The thread summary is per path: it goes.
 */
export function activate(mission, id, at, extra = {}) {
  const branches = branchesOf({ ...mission, ...extra });
  const target = branches.has(id) ? id : MAIN;
  const leaves = { ...(mission.branchLeaf || {}) };
  for (let b = branches.get(target); b; b = b.parent ? branches.get(b.parent) : null) leaves[b.id] = target;
  return { ...extra, branch: target, branchLeaf: leaves, branchLog: [...(mission.branchLog || []), { at, branch: target }], threadSummary: null };
}

/** Changes that show version `messageId` of its spot (one of `branchPoints(...).ids`). */
export function switchTo(mission, messages, messageId, at) {
  if (!mission?.branches?.length) return null;
  const spots = new Map();
  for (const b of mission.branches) spots.set(b.parent + "\u0000" + b.fork, { parent: b.parent, fork: b.fork });
  for (const spot of spots.values()) {
    const v = siblingsAt(mission, messages, spot).find((x) => x.id === messageId);
    if (!v) continue;
    if (pathOf(mission, messages).some((m) => m.id === messageId)) return {};
    // Back to a version: where you last were below it, if that still shows this version.
    const leaf = mission.branchLeaf?.[v.branch];
    const target = leaf && pathOf(mission, messages, leaf).some((m) => m.id === messageId) ? leaf : v.branch;
    return activate(mission, target, at);
  }
  return null;
}
