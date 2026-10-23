// «Aprendido: …» notices with «Deshacer» (OpenClaw Skill Workshop / self-learning): when a
// bot changes its memory or activates a new version of a skill on its own, the room says so
// in one line, and one click puts things back as they were.
import { now } from "./store.mjs";
import { activateSkill } from "./skills.mjs";
import { forget } from "./forgotten.mjs";

const clip = (t, n = 120) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

/** One line for a batch of memory changes (results of applyMemoryOps, with ids). */
export function memoryNoticeText(changes) {
  const done = changes.filter((c) => !c.skipped && c.id);
  if (!done.length) return null;
  const c = done[0];
  const first = c.action === "add" ? "Aprendido: «" + clip(c.text) + "»"
    : c.action === "replace" ? "Aprendido: ahora «" + clip(c.text, 80) + "» (antes «" + clip(c.from, 60) + "»)"
    : "Olvidado: «" + clip(c.text) + "»";
  return first + (done.length > 1 ? " y " + (done.length - 1) + (done.length === 2 ? " cambio más" : " cambios más") : "");
}

/** Room line for a memory change (replaces the old «X ha guardado un recuerdo»). `why`: what justifies it (learning.mjs whyOf). */
export function postMemoryNotice(store, { missionId, bot, changes, key, pending = false, why = [] }) {
  const text = memoryNoticeText(changes);
  if (!text || !missionId) return null;
  return store.put("messages", {
    id: "note:" + key, missionId, botId: bot.id, role: "system", kind: "learned", text: text + (pending ? " · por revisar" : ""),
    learned: { type: "memory", changes: changes.filter((c) => !c.skipped && c.id), undone: false, ...(why?.length ? { why } : {}) }, at: now(),
  });
}

/** Room line for a skill version a bot activated on its own. */
export function postSkillNotice(store, { missionId, bot, skill, previousId, why = [] }) {
  if (!missionId || !skill) return null;
  return store.put("messages", {
    id: "note:skill:" + skill.id, missionId, botId: bot.id, role: "system", kind: "learned",
    text: "Aprendido: versión " + (skill.version || 1) + " de «" + clip(skill.name, 80) + "»",
    learned: { type: "skill", skillId: skill.id, previousId: previousId || null, undone: false, ...(why?.length ? { why } : {}) }, at: now(),
  });
}

/**
 * «Deshacer»: memory back as it was (adds forgotten, edits reverted, removals restored) or the
 * previous skill version active again. What was undone leaves a hash (forgotten.mjs): the
 * review never proposes it again.
 */
export function undoLearned(store, messageId) {
  const msg = store.get("messages", messageId);
  if (!msg || msg.kind !== "learned" || !msg.learned) throw Error("Ese aviso ya no existe.");
  if (msg.learned.undone) return msg;
  if (msg.learned.type === "memory") {
    for (const c of msg.learned.changes || []) {
      const m = store.get("memories", c.id);
      if (!m) continue;
      if (c.action === "add") {
        store.patch("memories", c.id, { active: false, removedAt: now(), removedBy: "tú", undone: true });
        forget(store, "memory", m.text, null, { missionId: msg.missionId, reason: "undone" });
      } else if (c.action === "replace") {
        store.patch("memories", c.id, { text: c.from, previousText: m.text, undone: true });
        forget(store, "memory", m.text, null, { missionId: msg.missionId, reason: "undone" });
      }
      else if (c.action === "remove") store.patch("memories", c.id, { active: true, removedAt: null, removedBy: null, undone: true });
    }
  } else if (msg.learned.type === "skill") {
    const { skillId, previousId } = msg.learned;
    const skill = store.get("skills", skillId);
    if (skill) forget(store, previousId ? "skill-patch" : "skill", previousId ? skill.content : skill.name, skill.botId ?? null, { missionId: msg.missionId, reason: "undone" });
    if (previousId && store.get("skills", previousId)) activateSkill(store, previousId, "active");
    else if (store.get("skills", skillId)) activateSkill(store, skillId, "disabled");
  }
  return store.patch("messages", messageId, { text: "Deshecho: " + String(msg.text).replace(/^(Aprendido|Olvidado): /, ""), learned: { ...msg.learned, undone: true, undoneAt: now() } });
}

