// One-off repair (2026-11-16): before chats with a bot became personal (server/threads.mjs),
// writing to a bot in the hosted app continued the company's one thread with it, so a chat could
// hold the turns of several people. This splits such a chat: each turn (a person's message, the
// bot's answer and everything that turn produced) goes to a chat of the person who wrote it; the
// chat stays its creator's. Runs once per workspace, from server/cloud/host.mjs.
import { randomUUID } from "node:crypto";
import { chatOwner, personalChat } from "../threads.mjs";

const MARK = "migration:split-chats-v1";
const timeOf = (r) => Date.parse(r?.at || r?.createdAt || r?.startedAt || r?.updatedAt || 0) || 0;
// What a chat of someone else may start from: only structure, never a title, a prompt, a result
// or a summary (those come from the other person's words).
const KEEP = ["mode", "botIds", "chosenBotIds", "conversation", "kind", "kindBy", "teamId", "safety"];

/** Splits shared chats; returns [{from, to, person, moved}] (empty after the first run). */
export function splitSharedChats(store, { newId = randomUUID, log = () => {} } = {}) {
  if (store.get("cloud", MARK)) return [];
  const made = [];
  const kinds = store.sql("SELECT DISTINCT kind FROM records").all().map((r) => r.kind).filter((k) => k !== "missions" && k !== "cloud");
  for (const chat of store.list("missions").filter(personalChat)) {
    const owner = chatOwner(chat);
    if (!owner) continue;
    // Whose each turn is: the author of the last person's message before it.
    const messages = store.where("messages", "missionId", chat.id).sort((a, b) => timeOf(a) - timeOf(b));
    const turns = []; // [{at, person}]
    for (const m of messages) if (m.role === "user" && m.by?.id) turns.push({ at: timeOf(m), person: m.by.id });
    const at = (t) => { let who = owner; for (const turn of turns) { if (turn.at <= t) who = turn.person; else break; } return who; };
    const byMessage = new Map(messages.map((m) => [m.id, m.role === "user" && m.by?.id ? m.by.id : at(timeOf(m))]));
    const steps = store.where("steps", "missionId", chat.id);
    const byStep = new Map();
    for (const m of messages) if (m.stepId && !byStep.has(m.stepId)) byStep.set(m.stepId, byMessage.get(m.id));
    for (const s of steps) if (!byStep.has(s.id)) byStep.set(s.id, at(timeOf(s)));
    const whose = (kind, r) => (kind === "messages" ? byMessage.get(r.id) : kind === "steps" ? byStep.get(r.id) : r.stepId && byStep.has(r.stepId) ? byStep.get(r.stepId) : at(timeOf(r)));
    const others = [...new Set([...byMessage.values(), ...byStep.values()].filter((p) => p && p !== owner))];
    if (!chat.audience) store.patch("missions", chat.id, { audience: [owner] });
    for (const person of others) {
      const id = newId();
      const mine = steps.filter((s) => byStep.get(s.id) === person);
      const times = messages.filter((m) => byMessage.get(m.id) === person).map(timeOf);
      const first = times.length ? new Date(Math.min(...times)).toISOString() : chat.createdAt;
      const last = times.length ? new Date(Math.max(...times)).toISOString() : chat.updatedAt;
      const twin = { id, title: "Chat", status: "completed", createdAt: first, updatedAt: last, completedAt: last, createdBy: person, askedBy: person, audience: [person], thread: true, splitFrom: chat.id, steps: mine.map((s) => s.key).filter(Boolean) };
      for (const k of KEEP) if (chat[k] !== undefined) twin[k] = chat[k];
      if (chat.room) twin.room = chat.room + "-" + id.slice(0, 6);
      store.put("missions", twin);
      let moved = 0;
      for (const kind of kinds) {
        for (const r of store.where(kind, "missionId", chat.id)) {
          if (whose(kind, r) !== person) continue;
          store.put(kind, { ...r, missionId: id });
          moved++;
        }
      }
      made.push({ from: chat.id, to: id, person, moved });
      log(`chat ${chat.id.slice(0, 8)}: ${moved} records of ${person.slice(0, 8)} moved to ${id.slice(0, 8)}`);
    }
    if (others.length) {
      // What is left is the creator's: their turns only, and no answer or summary of someone else's.
      const keys = new Set(steps.filter((s) => byStep.get(s.id) === owner).map((s) => s.key));
      store.patch("missions", chat.id, { steps: (chat.steps || []).filter((k) => keys.has(k)), askedBy: owner, result: null, partial: null });
    }
  }
  store.put("cloud", { id: MARK, at: new Date().toISOString(), made: made.length });
  return made;
}
