// Shared formatting + URL helpers (Spanish locale).
export const isRoom = (m) => !m.conversation && m.status !== "cancelled";
/** Everything in the Bandeja that waits for you: pending, and expired ones still to clear. */
export const waitingOnYou = (approvals = []) => approvals.filter((a) => a.status === "pending" || a.status === "expired");
export const needsYou = (m) => ["waiting", "awaiting_choice", "awaiting_plan"].includes(m.status) || m.pendingCount > 0 || m.watchAsks > 0;

/**
 * Sidebar rooms (newest first in `rooms`). Until you drag one, rooms that wait for you go
 * first; once you have an order (settings.roomOrder) it is kept, and new rooms go on top.
 */
export function orderRooms(rooms, order = null) {
  if (!Array.isArray(order) || !order.length) return [...rooms.filter(needsYou), ...rooms.filter((m) => !needsYou(m))];
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...rooms.filter((m) => !pos.has(m.id)), ...rooms.filter((m) => pos.has(m.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id))];
}

/** The ids in `ids` with `id` moved before (or after) `target`. */
export function moveId(ids, id, target, after = false) {
  if (id === target || !ids.includes(id) || !ids.includes(target)) return ids;
  const rest = ids.filter((x) => x !== id);
  const at = rest.indexOf(target) + (after ? 1 : 0);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

export function roomUrl(m) {
  if (!m) return "/";
  if (m.conversation) return `/chat/${m.botIds?.[0] || "nora"}?c=${m.id}`;
  if (m.mode === "debate" && m.status === "awaiting_choice") return `/sala/${m.id}/debate`;
  return `/sala/${m.id}`;
}
export const missionUrl = (m) => `/misiones/${m.id}`;

export function time(value) {
  return value ? new Date(value).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "";
}
export function shortDate(value) {
  if (!value) return "";
  const d = new Date(value);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (d.toDateString() === yesterday.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric" }).replace(".", "");
}
export function dateTime(value) {
  return value ? new Date(value).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
}
export function ago(value) {
  if (!value) return "";
  const s = Math.max(0, (Date.now() - Date.parse(value)) / 1000);
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}
export function todayLabel() {
  return new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }).replace(",", ",");
}
export function greeting() {
  const h = new Date().getHours();
  return h < 13 ? "Buenos días." : h < 20 ? "Buenas tardes." : "Buenas noches.";
}
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const words = (text) => (text || "").trim().split(/\s+/).filter(Boolean).length;
