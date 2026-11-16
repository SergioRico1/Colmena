// One-off repair (2026-11-16): before what is learned about a person became theirs alone
// (server/visibility.mjs › canUseMemory, profileDirectory), a hosted company had one USER.md and
// its «about the person» memories carried no owner. This gives each such memory the person of
// the conversation it was learned in (nobody's when that is unknown: then it is never used),
// and retires the shared USER.md and its versions: the memories it condensed go back to each
// person's prompt and are condensed again into their own profile. Runs once per workspace.
import { rmSync } from "../doc-files.mjs";
import { memoryTarget, userProfilePath } from "../memory.mjs";
import { chatOwner, personalChat } from "../threads.mjs";

const MARK = "migration:personal-learning-v1";

/** → {owned, unknown, uncondensed, versions} (null after the first run). */
export function makeLearningPersonal(store) {
  if (store.get("cloud", MARK)) return null;
  const out = { owned: 0, unknown: 0, uncondensed: 0, versions: 0 };
  for (const m of store.list("memories")) {
    if (memoryTarget(m) !== "user" || m.personId) continue;
    const mission = m.missionId ? store.get("missions", m.missionId) : null;
    const person = mission ? (personalChat(mission) ? chatOwner(mission) : null) || mission.askedBy || mission.createdBy || null : null;
    const patch = { personId: person };
    if (m.condensed) { Object.assign(patch, { condensed: false, condensedAt: null }); out.uncondensed++; }
    store.patch("memories", m.id, patch);
    if (person) out.owned++; else out.unknown++;
  }
  for (const v of store.list("docVersions")) if (v.doc === "user" && !v.botId) { store.remove("docVersions", v.id); out.versions++; }
  try { if (store.directory) rmSync(userProfilePath(store.directory), { force: true }); } catch {}
  store.put("cloud", { id: MARK, at: new Date().toISOString(), ...out });
  return out;
}
