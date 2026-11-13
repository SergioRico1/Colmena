// The words of a usage limit, shared by the limit notices (components/v2/LimitNotice.jsx) and
// by the reason a paused task gives (lib/pauseReason.js). Pure: no React, no network.
import { ENGINE_NAMES } from "./engineNames.js";

const ENGINE = ENGINE_NAMES;
export const engineName = (engine) => ENGINE[engine] || "La IA";

/** «hoy a las 15:40», «en 12 min», «mañana a las 9:05». */
export function renewText(iso, at = Date.now()) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return null;
  if (t - at < 60_000) return "en un momento";
  if (t - at < 3_600_000) return "en " + Math.ceil((t - at) / 60_000) + " min";
  const d = new Date(t), now = new Date(at);
  const hm = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
  if (days <= 0) return "hoy a las " + hm;
  if (days === 1) return "mañana a las " + hm;
  if (days < 7) return "el " + d.toLocaleDateString("es-ES", { weekday: "long" }) + " a las " + hm;
  return "el " + d.toLocaleDateString("es-ES", { day: "numeric", month: "long" }) + " a las " + hm;
}
