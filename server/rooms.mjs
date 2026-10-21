// Keeping the sidebar tidy (OpenClaw sessions: snooze, archive, fork):
// - «Posponer»: the room leaves the sidebar until a time, and comes back on its own then or as
//   soon as something new happens in it (a bot answers, it needs you);
// - «Archivar»: finished rooms leave the sidebar without being deleted; writing in one, or a
//   bot answering in it, brings it back;
// - «Duplicar desde aquí»: a new room with the conversation up to a message, to try another
//   way without touching the original.
import { id, now } from "./store.mjs";

const NEEDS_YOU = new Set(["waiting", "awaiting_plan", "awaiting_choice", "failed"]);

/** Clears snooze/archive when the room moves: new messages, or it needs the person. */
export function watchRooms(store) {
  // Only a change INTO «needs you» wakes it: a room snoozed while it waits stays snoozed.
  const statuses = new Map(store.list("missions").map((m) => [m.id, m.status]));
  const listener = (change) => {
    if (change?.type !== "record" || change.op === "remove" || !change.data) return;
    if (change.kind === "messages" && change.op === "insert") {
      const msg = change.data;
      if (!msg.missionId || !["user", "assistant"].includes(msg.role) || msg.copied) return;
      const m = store.get("missions", msg.missionId);
      if (m && (m.snoozedUntil || m.archived)) setImmediate(() => wake(store, m.id, "activity"));
    }
    if (change.kind === "missions") {
      const m = change.data;
      const before = change.op === "insert" ? m.status : statuses.get(m.id);
      statuses.set(m.id, m.status);
      if ((m.snoozedUntil || m.archived) && before !== m.status && NEEDS_YOU.has(m.status)) setImmediate(() => wake(store, m.id, "needs"));
    }
  };
  store.listeners.add(listener);
  return () => store.listeners.delete(listener);
}

function wake(store, missionId, why) {
  const m = store.get("missions", missionId);
  if (!m || (!m.snoozedUntil && !m.archived)) return null;
  return store.patch("missions", missionId, { snoozedUntil: null, archived: false, wokeAt: now(), wokeBy: why });
}

/** Snoozed rooms whose time came: back in the sidebar, with one notice each. */
export function wakeDue(store, notify, time = Date.now()) {
  const woke = [];
  for (const m of store.list("missions")) {
    if (!m.snoozedUntil || Date.parse(m.snoozedUntil) > time) continue;
    wake(store, m.id, "time");
    woke.push(m);
    try {
      notify?.({ kind: "needs", missionId: m.id, botId: m.mode === "solo" ? m.botIds?.[0] : "atlas", title: "Vuelve #" + (m.room || m.title), text: "La pospusiste hasta ahora.", url: m.conversation ? "/chat/" + (m.botIds?.[0] || "nora") + "?c=" + m.id : "/sala/" + m.id });
    } catch {}
  }
  return woke;
}

/** «Hasta esta tarde» → 17:00 today (or tomorrow morning if it is already late), «mañana» → 9:00, «lunes» → next Monday 9:00. */
export function snoozeUntil(choice, from = new Date()) {
  const at = new Date(from);
  if (choice === "tarde") {
    at.setHours(17, 0, 0, 0);
    if (at <= from) return snoozeUntil("manana", from);
    return at.toISOString();
  }
  if (choice === "manana") {
    at.setDate(at.getDate() + 1);
    at.setHours(9, 0, 0, 0);
    return at.toISOString();
  }
  if (choice === "lunes") {
    const days = ((8 - at.getDay()) % 7) || 7;
    at.setDate(at.getDate() + days);
    at.setHours(9, 0, 0, 0);
    return at.toISOString();
  }
  throw Error("Elige hasta cuándo.");
}

const CONVERSATION_KINDS = new Set(["message"]); // deliverables belong to the original room

/**
 * «Duplicar desde aquí»: a new room with the conversation up to `messageId` (the whole one if
 * empty). Nothing runs: the new room waits for you to write. The bots know what was said.
 */
export function forkRoom(store, missionId, messageId = null, { slug }) {
  const src = store.get("missions", missionId);
  if (!src) throw Object.assign(Error("Sala no encontrada."), { status: 404 });
  if (src.mode === "debate") throw Error("Los debates no se pueden duplicar; empieza uno nuevo.");
  const all = store.list("messages").filter((m) => m.missionId === missionId && !m.replyTo);
  let cut = all.length;
  if (messageId) {
    const i = all.findIndex((m) => m.id === messageId);
    if (i < 0) throw Object.assign(Error("Ese mensaje ya no existe."), { status: 404 });
    cut = i + 1;
  }
  const kept = all.slice(0, cut).filter((m) => ["user", "assistant"].includes(m.role) && CONVERSATION_KINDS.has(m.kind || "message") && (m.text || m.artifactId));
  const turns = kept.filter((m) => (m.kind || "message") === "message" && m.text).map((m) => ({ role: m.role, content: String(m.text).slice(0, 12000) }));
  const title = (String(src.title || "Sala").replace(/\s*\(copia\)$/i, "") + " (copia)").slice(0, 200);
  const taken = new Set(store.list("missions").map((m) => m.room).filter(Boolean));
  const newId = id();
  const lastBot = [...kept].reverse().find((m) => m.role === "assistant" && m.text);
  const mission = store.tx(() => {
    const created = store.put("missions", {
      id: newId, title, room: slug(title, taken), prompt: src.prompt, mode: src.mode, botIds: src.botIds || [],
      conversation: !!src.conversation, conversationOf: null, safety: src.safety || "avisar",
      status: "completed", createdAt: now(), completedAt: now(), error: null, steps: [], automationId: null,
      learningStatus: "skipped", priorMessages: [...(src.priorMessages || []), ...turns].slice(-30),
      chosenBotIds: src.chosenBotIds || [], plan: null, result: lastBot?.text || "",
      forkOf: { missionId: src.id, messageId: messageId || null, title: src.title, room: src.room || null },
    });
    for (const m of kept) {
      const { id: _old, reactions: _r, suggestions: _s, ...rest } = m;
      store.put("messages", { ...rest, id: id(), missionId: newId, copied: true });
    }
    store.put("messages", {
      id: "fork:" + newId, missionId: newId, role: "system", kind: "fork", at: now(),
      text: "Copia de #" + (src.room || src.title) + (messageId ? " hasta el mensaje elegido" : "") + ". Lo que escribas aquí no cambia la original.",
    });
    return created;
  });
  store.event(newId, "created", { text: "Copia de #" + (src.room || src.title) });
  return mission;
}
