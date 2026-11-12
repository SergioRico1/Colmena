// Who wrote it: every message and mission that Colmena writes by itself (a routine, a trigger,
// the watcher) carries `origin: {type, id, depth, signature?, instruction?}`. The marker is how
// the rest of the server tells the person's words from automation text that happens to be
// stored as a «user» message (a run's first message, a routine writing in its room):
//   · loops.mjs / triggers.mjs: such a message never counts as the person writing;
//   · appactions.mjs (send guards) and redlines.mjs: only `instruction`, the rule's own standing
//     instruction, may count as asked for; what set the rule off (an email, a webhook body, a
//     file) never does, even if its wrapping were lost;
//   · `depth` is how many self-started runs led to this one: rules that fire each other are cut
//     at MAX_CHAIN_DEPTH (brakes.mjs).
import { readOutsideByTools, withoutExternal } from "./external-content.mjs";

export const ORIGIN_TYPES = Object.freeze(["automation", "trigger", "watch"]);
/** Self-started runs in a row (A's output fires B, B's fires A…) before the chain is cut. */
export const MAX_CHAIN_DEPTH = 3;
const INSTRUCTION_MAX = 4000;

/** The marker as stored. `instruction`: the rule's own prompt (what the person wrote in it). */
export function makeOrigin({ type, id, depth = 0, signature = null, instruction = null }) {
  if (!ORIGIN_TYPES.includes(type)) throw Error("Origen no válido.");
  return {
    type, id: String(id ?? ""), depth: Math.max(0, Math.round(Number(depth) || 0)),
    ...(signature ? { signature: String(signature) } : {}),
    ...(typeof instruction === "string" && instruction.trim() ? { instruction: instruction.slice(0, INSTRUCTION_MAX) } : {}),
  };
}

/** Written by Colmena on its own (a routine, a trigger, the watcher), not by the person. */
export const isAutomated = (record) => !!record?.origin && ORIGIN_TYPES.includes(record.origin.type);

/** A message the person wrote: role «user» and no origin marker. */
export const isPersonMessage = (message) => message?.role === "user" && !isAutomated(message);

/**
 * What the person is taken to have said in `message`: its text without the outside content
 * wrapped in it; for an automation-written message only the rule's standing instruction.
 */
export function personWords(message) {
  if (!isAutomated(message)) return withoutExternal(message?.text);
  return typeof message.origin.instruction === "string" ? withoutExternal(message.origin.instruction) : "";
}

/** How deep in a chain of self-started runs a message is (0: the person, or ordinary work). */
export function chainDepth(message, mission = null) {
  if (isPersonMessage(message)) return 0;
  const depth = Number(message?.origin?.depth ?? mission?.origin?.depth ?? 0);
  return Number.isFinite(depth) && depth > 0 ? Math.round(depth) : 0;
}

/** Origins whose text carries what set them off (an email, a page, a webhook body): outside content. */
const OUTSIDE_ORIGINS = new Set(["trigger", "watch"]);
/** A mission or a message started by an outside event (a trigger — webhooks included — or the watcher). */
export const isOutsideOrigin = (record) => isAutomated(record) && OUTSIDE_ORIGINS.has(record.origin.type);

/**
 * The one answer to «is this step working from outside content?», for everything that keeps
 * the outside mark on what a bot writes (wiki_write, remember, block_post, the reviewer):
 *   · it read outside content with its tools (`history`: the step's conversation), or a note
 *     or block that carries the mark (`wikiOutside`);
 *   · an outside event started its run (the mission's origin), or wrote the message this step
 *     answers (`ackOn` / `ackExtra`): the payload travels inside the request text, not in a
 *     tool call. Never the room's last message: the person may write while the step works.
 * A step that goes on after the person's «continúa» keeps it (`outsideOrigin`).
 */
export function worksFromOutside(store, mission, step, { history = null } = {}) {
  if (!step) return isOutsideOrigin(mission);
  const fresh = (step.id && store?.get("steps", step.id)) || step;
  if (fresh.wikiOutside || fresh.outsideOrigin) return true;
  if (readOutsideByTools(history ?? fresh.history ?? step.history)) return true;
  if (isOutsideOrigin(mission)) return true;
  const asked = [fresh.ackOn, ...(fresh.ackExtra || [])].filter(Boolean);
  if (asked.length) return asked.some((id) => isOutsideOrigin(store.get("messages", id)));
  // A step that answers no message in particular (a conversation's first one): its latest request.
  return !!mission?.id && isOutsideOrigin(store.where("messages", "missionId", mission.id).filter((m) => m.role === "user").at(-1));
}
