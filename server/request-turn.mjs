// What a turn that answers ANOTHER PERSON's request may use (docs/PEOPLE.md › «Bots trabajando
// en salas compartidas», docs/ROOMS-CONTRACT.md › «A request turn»): a request to your bot in a
// shared room (`step.roomAsk`, Runtime#turnMission) and an errand between bots
// (`mission.peerErrand`, server/peers/errands.mjs).
//
// It is an ALLOW-LIST, closed by default. A tool that is not named here is neither offered nor
// accepted in such a turn, whatever it is and whenever it was added: the bot's memory, the
// history of other conversations, the sala's brief, files and deliverables, skills, notes,
// blocks, proposals, other bots, Código, commands, MCP, secrets and projects all stay out
// because nothing here lets them in. Runtime#toolsForStep applies it last, and that list is the
// only authority for what a step may run (a direct call, use_tool and find_tools all read it).
import { isAppToolName } from "./apptools.mjs";

/**
 * Always: asking (the requester in the room, the owner here), making a deliverable, and reading
 * back what THIS request made (read_file and read_deliverable are scoped to it: EffectMethods).
 */
export const REQUEST_ALWAYS = Object.freeze([
  "ask_room", "ask_user",
  "create_deliverable", "create_document", "create_spreadsheet", "create_presentation", "create_image",
  "read_deliverable", "read_file",
]);
/**
 * By the capabilities the owner allows for other people's requests (Ajustes › Personas ›
 * Encargos), exactly these and nothing else. Hosted web search follows `web` (Runtime#searchFor).
 * `apps` also lets in the direct tools of the connected apps (isAppToolName); every change in an
 * app asks the owner (server/connections.mjs). `ordenador` is the browser and the desktop apps,
 * with their own red lines: never commands, files of the computer, saved passwords or projects.
 */
export const REQUEST_BY_CAPABILITY = Object.freeze({
  web: Object.freeze(["web_fetch"]),
  carpetas: Object.freeze(["list_folder", "read_folder_file"]),
  apps: Object.freeze(["apps_accounts", "apps_search", "apps_describe", "apps_execute", "apps_table"]),
  ordenador: Object.freeze([
    "browser_open", "browser_read", "browser_screenshot", "browser_act", "browser_fill", "browser_submit", "browser_download",
    "open_app", "desktop_windows", "desktop_open", "desktop_look", "desktop_do",
  ]),
});
const ALWAYS = new Set(REQUEST_ALWAYS);
const CAPABILITY = new Map(Object.entries(REQUEST_BY_CAPABILITY).flatMap(([capability, names]) => names.map((name) => [name, capability])));

/** The capability a tool needs in a request turn: "siempre", one of the four, or null (never). */
export function requestCapability(name) {
  const n = String(name || "");
  if (ALWAYS.has(n)) return "siempre";
  return CAPABILITY.get(n) || (isAppToolName(n) ? "apps" : null);
}
/** Whether a request turn with these capabilities ({web, carpetas, apps, ordenador}) may use a tool. */
export function requestToolAllowed(name, capabilities = {}) {
  const needs = requestCapability(name);
  return needs === "siempre" || (!!needs && capabilities?.[needs] === true);
}
/** `tools` (definitions with a `name`) cut down to what a request turn may use. */
export const requestTools = (tools, capabilities = {}) => (Array.isArray(tools) ? tools : []).filter((t) => requestToolAllowed(t?.name, capabilities));
/** Files a deliverable tool reads from the sala's folder: `image` (documents, slides) and `rows_from` (sheets), at any depth. */
export function referencedFiles(args, out = []) {
  if (Array.isArray(args)) for (const x of args) referencedFiles(x, out);
  else if (args && typeof args === "object")
    for (const [key, value] of Object.entries(args)) {
      if ((key === "image" || key === "rows_from") && typeof value === "string" && value.trim()) out.push(value);
      else referencedFiles(value, out);
    }
  return out;
}
