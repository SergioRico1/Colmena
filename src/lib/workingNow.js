// «Trabajando ahora» (Inicio's side column, the row on top of Trabajo): the bots at work this
// moment, what each is doing and since when. From the state the store already has (each bot's
// `busy` and `activity`, the missions' activity lines): no new server data. Pure.
import { placeName, roomUrl } from "./format.js";

const MOVING = new Set(["running", "queued", "planning"]);
const ts = (x) => Date.parse(x || 0) || 0;
const VERB = { pensando: "Pensando", escribiendo: "Escribiendo", leyendo: "Leyendo", buscando: "Buscando" };

/** [{bot, what, place, since, href, missionId}] for the bots at work, the longest at it first. */
export function workingNow(state = {}) {
  const { bots = [], missions = [], paused = false } = state;
  if (paused) return [];
  return bots
    .filter((b) => b.enabled !== false && (b.busy || b.status === "trabaja"))
    .map((b) => {
      const mine = missions.filter((m) => (m.botIds || []).includes(b.id) && !m.archived);
      const m = mine.find((x) => x.id === b.activity?.missionId) || mine.filter((x) => MOVING.has(x.status)).sort((x, y) => ts(y.updatedAt || y.createdAt) - ts(x.updatedAt || x.createdAt))[0] || null;
      const verb = b.activity?.verb ? VERB[b.activity.verb] || b.activity.verb.charAt(0).toUpperCase() + b.activity.verb.slice(1) : "";
      const doing = verb && b.activity?.detail ? `${verb} ${b.activity.detail}` : m?.narration?.botId === b.id ? m.narration.text : verb || m?.activityLine || "Trabajando";
      return {
        bot: b, what: doing, place: m ? placeName(m) : "", missionId: m?.id || null,
        since: m ? m.startedAt || m.createdAt || null : null,
        href: m ? (m.conversation ? `/chat/${b.id}?c=${m.id}` : m.room ? roomUrl(m) : `/encargo/${m.id}`) : `/chat/${b.id}`,
      };
    })
    .sort((a, b) => ts(a.since) - ts(b.since));
}

/** «12 min», «1 h 5 min», «ahora» since an ISO date (now = Date.now()). */
export function elapsed(iso, now = Date.now()) {
  const min = Math.floor((now - ts(iso)) / 60000);
  if (!iso || !Number.isFinite(min) || min < 1) return "ahora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h${min % 60 ? ` ${min % 60} min` : ""}` : `${Math.floor(h / 24)} d`;
}
