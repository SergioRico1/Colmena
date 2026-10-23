// What was forgotten, undone or rejected is never learned again (OpenClaw memory provenance).
// records 'forgotten': {id: '<kind>:<hash>' | 'mission:<id>', kind, hash, missionId, botId, reason, createdAt}
//   memory      a fact, by its text (any bot)
//   skill       a new skill, by its name and owner
//   skill-patch an improved version, by its content and owner
//   soul        a change of character, by the proposed text and bot
import { createHash } from "node:crypto";
import { now } from "./store.mjs";

const fold = (text) => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Stable hash of what was forgotten: memories by text; the rest by text and owner. */
export function forgetHash(kind, text, botId = null) {
  const key = kind === "memory" ? fold(text) : fold(text) + "\u0000" + (botId || "");
  return createHash("sha256").update(kind + "\u0000" + key).digest("hex").slice(0, 32);
}
export function isForgotten(store, kind, text, botId = null) {
  if (!text || !fold(text)) return false;
  return !!store.get("forgotten", kind + ":" + forgetHash(kind, text, botId));
}
/** Leaves the hash so the review never proposes it again. `reason`: forgotten · undone · rejected · revert. */
export function forget(store, kind, text, botId = null, { missionId = null, reason = "forgotten" } = {}) {
  if (!text || !fold(text)) return null;
  const hash = forgetHash(kind, text, botId);
  const key = kind + ":" + hash;
  return store.get("forgotten", key) || store.put("forgotten", { id: key, kind, hash, missionId, botId: botId ?? null, reason, createdAt: now() });
}
