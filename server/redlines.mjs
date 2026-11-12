// Red lines judged by their effect, not only by the tool's name:
//   - its own creations: what this mission made (a file it wrote, an event or a draft it
//     created in your account without notifying anyone) can be deleted or overwritten by it
//     again without asking — it only undoes its own work;
//   - your explicit words: when your own message in this turn names the action and the exact
//     target, that is the OK for that one action. Only text you wrote counts (never a tool
//     result, a file, another bot, a routine's prompt or another person's errand); outside
//     content quoted in it is dropped; a negation or anything ambiguous keeps asking;
//   - unattended runs: a routine or trigger working while you are away (Ajustes › Autonomía ›
//     «Rutinas sin supervisión») never waits for a red line: it is left for you in the
//     Bandeja and the bot is told to finish the rest and say what is left.
import path from "node:path";
import { withoutExternal } from "./external-content.mjs";
import { stepHistory } from "./histories.mjs";

const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

// ------------------------------------------------------------ own creations
const CREATE_TOOL = /(?:^|_)(?:CREATE|INSERT|ADD|QUICK_ADD|NEW|UPLOAD|DRAFT)(?:_|$)/;
const UNDO_TOOL = /(?:^|_)(?:DELETE|REMOVE|TRASH|DESTROY|PURGE|ARCHIVE|CANCEL|UPDATE|PATCH|EDIT|REPLACE|OVERWRITE)(?:_|$)/;
// Never «own work»: anything that leaves your account or moves money.
const LEAVES = /(?:^|_)(?:SEND|REPLY|FORWARD|INVITE|SHARE|PUBLISH|POST|TWEET|PAY|PAYOUT|CHARGE|REFUND|TRANSFER|PURCHASE|ORDER)(?:_|$)/;
const ID_KEY = /^(?:id|.*_id|.*Id)$/;

const idsIn = (value, depth = 0, out = new Set()) => {
  if (!value || typeof value !== "object" || depth > 3) return out;
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string" && v.length >= 3 && ID_KEY.test(k)) out.add(v);
    else if (v && typeof v === "object") idsIn(v, depth + 1, out);
  }
  return out;
};

/**
 * What this mission created in your apps and kept inside your account: [{tool, ids:Set}] from
 * the app actions it ran (approvals executed with a result). A creation that notified people
 * (a red line itself, like an event with guests) does not count.
 */
export function missionCreations(store, missionId) {
  return store.where("approvals", "missionId", missionId)
    .filter((a) => a.tool === "apps_execute" && a.status === "executed" && a.result?.ok && !a.redLine
      && CREATE_TOOL.test(String(a.review?.tool || "").toUpperCase()))
    .map((a) => ({ tool: String(a.review.tool).toUpperCase(), toolkit: a.review?.toolkit || null, ids: idsIn(a.result?.data) }))
    .filter((c) => c.ids.size);
}

/**
 * The app action only deletes or changes things this mission created (every id it names is
 * one of them) and does not leave your account: it may run without asking. Returns a short
 * reason or null.
 */
export function ownAppTarget(store, missionId, { tool, toolkit = null, arguments: args = {} } = {}) {
  const name = String(tool || "").toUpperCase();
  if (!UNDO_TOOL.test(name) || LEAVES.test(name)) return null;
  // Guests in the change, or an explicit notice: it reaches other people, not only your account.
  const guests = [args.attendees, args.attendee_emails, args.guests].some((v) => (Array.isArray(v) ? v.length : typeof v === "string" && v.trim()));
  const notifies = args.send_updates ?? args.sendUpdates ?? null;
  if ((notifies && !["none", "false", false].includes(notifies)) || (guests && !["none", "false", false].includes(notifies ?? "all"))) return null;
  const targets = [...idsIn(args)];
  if (!targets.length) return null;
  const made = missionCreations(store, missionId).filter((c) => !toolkit || !c.toolkit || c.toolkit === toolkit);
  const known = new Set(made.flatMap((c) => [...c.ids]));
  // Something a red line of this mission touched since (guests added, shared…) is no longer only yours.
  for (const a of store.where("approvals", "missionId", missionId))
    if (a.tool === "apps_execute" && a.redLine && a.status === "executed") for (const x of idsIn(a.review?.arguments)) known.delete(x);
  return targets.every((t) => known.has(t)) ? "Lo creó esta misión" : null;
}

/** Files this mission wrote in its folder (relative paths, lower-case on Windows). */
export function missionFiles(store, missionId) {
  const files = new Set();
  const add = (p) => { if (typeof p === "string" && p) files.add(normalizeRel(p)); };
  // write_file keeps its path; deliverables their work file; files made by tools their file.
  for (const a of store.where("artifacts", "missionId", missionId)) { add(a.path); add(a.workFile); add(a.file); }
  // Project files it wrote (project_write in the steps' own history).
  for (const s of store.where("steps", "missionId", missionId))
    for (const x of stepHistory(store, s) || []) {
      if (x?.type !== "function_call" || x.name !== "project_write") continue;
      try {
        const args = JSON.parse(x.arguments || "{}");
        if (args.project && args.path) add("proyectos/" + args.project + "/" + args.path);
      } catch {}
    }
  return files;
}
export const normalizeRel = (p) => {
  const clean = String(p).replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/");
  return process.platform === "win32" ? clean.toLowerCase() : clean;
};

const DELETERS = new Set(["del", "erase", "rm", "remove-item", "ri"]);
const base = (program) => path.win32.basename(path.posix.basename(String(program || "").trim())).toLowerCase().replace(/\.(exe|com)$/i, "");

/**
 * run_command that only deletes files this mission wrote in its own folder (`rm informe.txt`):
 * no red line. Flags are allowed; every other argument must be one of its files. Returns a
 * reason or null.
 */
export function ownFileCommand(store, missionId, { program, args = [], folderId = null } = {}) {
  if (folderId && folderId !== "mision") return null;
  if (!DELETERS.has(base(program))) return null;
  const targets = (args || []).map(String).filter((a) => !a.startsWith("-") && !/^\/[a-z?]$/i.test(a));
  if (!targets.length || targets.some((t) => /(^|[\\/])\.\.([\\/]|$)|[*?]|^[a-z]:|^[\\/]/i.test(t))) return null;
  const mine = missionFiles(store, missionId);
  return targets.every((t) => mine.has(normalizeRel(t))) ? "Solo borra archivos que creó esta misión" : null;
}

// ------------------------------------------------------- your explicit words
const NEGATION = /\b(no|nunca|todavia no|aun no|ni)\s+(?:\w+\s+){0,2}?(borr|elimin|quit|cancel|ejecut|corr|lanz|instal|desinstal|archiv|envi|mand|public|pag|compr)/;
const ACTION_WORDS = {
  borrar: /\b(borr|elimin|quit|suprim|delete|remove|tira|papelera)\w*/,
  cancelar: /\b(cancel|anul)\w*/,
  archivar: /\barchiv\w*/,
  ejecutar: /\b(ejecut|corre|correr|lanza|lanzar|run|instal|desinstal|arranca)\w*/,
};
const ACTION_OF_TOOL = [[/(?:^|_)(?:DELETE|REMOVE|TRASH|DESTROY|PURGE)(?:_|$)/, "borrar"], [/(?:^|_)CANCEL(?:_|$)/, "cancelar"], [/(?:^|_)ARCHIVE(?:_|$)/, "archivar"]];

/**
 * The person's own words in this turn: the message the step answers (step.ackOn and what was
 * added to it), or the mission's first message for its first steps. Never a question's
 * answer, a routine's prompt, another person's errand or outside content quoted in it.
 */
export function personTurnText(store, mission, step) {
  if (!mission || mission.automationId || mission.peerErrand || mission.watch || step?.roomAsk) return "";
  // What a routine or a trigger wrote in a room is stored as «user» too (origin.mjs): never yours.
  // Nor what another person asked one of your bots in a room (`author`): their word approves nothing.
  const messages = store.where("messages", "missionId", mission.id).filter((m) => m.role === "user" && !m.origin && !m.author && (!m.kind || m.kind === "message") && !m.approvalId && typeof m.text === "string");
  const ids = [step?.ackOn, ...(step?.ackExtra || [])].filter(Boolean);
  const picked = ids.length ? messages.filter((m) => ids.includes(m.id))
    : !step || ["solo", "work", "plan", "synthesis"].includes(step.kind) ? messages.slice(0, 1) : [];
  return picked.map((m) => fold(withoutExternal(m.text))).join("\n");
}

const named = (text, target) => {
  const t = fold(target);
  if (t.length < 3) return false;
  const at = text.indexOf(t);
  // The exact target, once (twice is ambiguous: «borra informe.txt y informe.txt.bak»).
  if (at < 0) return false;
  const edge = (c) => !c || /[^a-z0-9._-]/.test(c);
  return edge(text[at - 1]) && edge(text[at + t.length]);
};

/**
 * Whether the person's message in this turn explicitly asked for this one action: the verb of
 * the action and every exact target. `action` is 'borrar' | 'cancelar' | 'archivar' |
 * 'ejecutar'. Returns false on a negation («no lo borres») or when anything is missing.
 */
export function personAsked(text, { action, targets = [] }) {
  if (!text || !ACTION_WORDS[action] || !targets.length) return false;
  if (NEGATION.test(text) || !ACTION_WORDS[action].test(text)) return false;
  return targets.every((t) => named(text, t));
}

/** The person's action word for an app tool slug (null: not one a message can approve). */
export function actionOfTool(tool) {
  const name = String(tool || "").toUpperCase();
  if (LEAVES.test(name)) return null;
  return ACTION_OF_TOOL.find(([re]) => re.test(name))?.[1] || null;
}

/** Exact targets of an app action: its ids, else its other string values (names, titles). */
export function appTargets(args = {}) {
  const ids = [...idsIn(args)];
  if (ids.length) return ids;
  return Object.values(args || {}).filter((v) => typeof v === "string" && v.trim().length >= 4).map((v) => v.trim());
}

// ----------------------------------------------------------- unattended runs
/**
 * A routine or trigger run with «Rutinas sin supervisión» on (off by default). A turn that
 * answers your own message in that chat (step.ackOn) means you are there: it asks as usual.
 */
export const isUnattended = (mission, settings = {}, step = null) => settings?.unattended === true && !!mission?.automationId && !step?.ackOn;

export const UNATTENDED_NOTE = "No se ha hecho: esta rutina trabaja sin supervisión y es una línea roja (necesita el OK de la persona). " +
  "Ha quedado en la Bandeja para que la persona la apruebe después. No lo intentes de otra forma: termina todo lo demás y, al final, di claramente qué ha quedado pendiente de su OK.";

/** What the bot gets for a red line left for later in an unattended run. */
export const deferredResult = (title) => ({ done: false, deferred: true, pendingApproval: String(title || "").slice(0, 200), message: UNATTENDED_NOTE });

/** «Pendiente de tu OK» lines for the end of an unattended run (empty when nothing waits). */
export function pendingSummary(store, missionId) {
  const open = store.where("approvals", "missionId", missionId).filter((a) => a.deferred && a.status === "pending");
  if (!open.length) return "";
  return "\n\n**Pendiente de tu OK** (en la Bandeja):\n" + open.map((a) => "- " + String(a.title || a.summary || "Una acción").slice(0, 160)).join("\n");
}
