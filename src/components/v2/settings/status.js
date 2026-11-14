// Ajustes · the status of each section at a glance, beside its name in the list and under its
// title: whether an AI account thinks and how much of its plan is gone, which apps are connected,
// whether the mailbox is on, when the last backup was made, whether an update waits, what the
// diagnosis found. Pure: it reads the state the screen already has.
//
// A status is { text, tone, label }: `text` fits the list (a word or two), `label` is the whole
// sentence (the title line and what a screen reader hears), `tone` is ok | error | quiet | news.
import { ENGINE_NAMES } from "../../../lib/engineNames.js";

const ENGINE = { ...ENGINE_NAMES, local: "el modelo de este ordenador" };
const join = (list) => (list.length < 2 ? list.join("") : list.slice(0, -1).join(", ") + " y " + list.at(-1));
const DAY = 864e5;

/** «hoy», «ayer», «hace 3 días», «hace 5 semanas». */
export function agoWord(iso, now = Date.now()) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return null;
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.ceil((start.getTime() - t) / DAY));
  if (t >= start.getTime()) return "hoy";
  if (days <= 1) return "ayer";
  if (days < 14) return `hace ${days} días`;
  return `hace ${Math.round(days / 7)} semanas`;
}

/** Cuentas de IA: who thinks, and how much of the plan is gone. */
export function aiStatus(ai, planLimits = null) {
  if (!ai) return null;
  // Hosted (/api/state › ai: {policy, mine, fake}): whether the person signed in has an account.
  if (typeof ai.mine === "boolean" && !ai.engines) return ai.mine ? { text: "Conectada", tone: "ok", label: "Tu cuenta de IA está conectada" } : { text: "Sin conectar", tone: "error", label: "Conecta tu cuenta de IA para que los bots trabajen para ti." };
  const live = (ai.engines || []).filter((e) => e.connected);
  if (!live.length) return { text: "Sin conectar", tone: "error", label: "Ninguna cuenta de IA conectada: tus bots no pueden pensar." };
  const primary = live.find((e) => e.id === ai.primary) || live[0];
  const name = primary.label || ENGINE[primary.id] || primary.id;
  if (primary.limit) return { text: "En su límite", tone: "error", label: `${name} ha llegado a su límite de uso${ai.fallback && ai.fallback !== "none" ? "; sigue el respaldo" : "; tus bots esperan a que se renueve"}.` };
  const used = primary.id === "openai" ? planLimits?.primary?.usedPercent : null;
  if (Number.isFinite(used)) return { text: `${used} %`, tone: used >= 90 ? "error" : "quiet", label: `Piensan con ${name} · usado el ${used} % de su plan` };
  return { text: name, tone: "ok", label: `Piensan con ${name}` + (live.length > 1 ? ` · ${live.length} cuentas conectadas` : "") };
}

/** Apps y carpetas: which kinds of app are connected (state.connectors) and how many folders. */
export function appsStatus(connectors = [], folders = []) {
  const apps = connectors.filter((c) => c.connected && c.id !== "carpeta").map((c) => c.name || c.id);
  const n = folders.length;
  const folderWords = n ? `${n} ${n === 1 ? "carpeta" : "carpetas"}` : "ninguna carpeta";
  if (!apps.length) return { text: n ? folderWords : "Ninguna", tone: "quiet", label: `Ninguna app conectada · ${folderWords}` };
  return { text: String(apps.length), tone: "quiet", label: `${join(apps)} ${apps.length === 1 ? "conectado" : "conectados"} · ${folderWords}` };
}

/** Contactos y equipos: the mailbox the messages travel through, and how many people. */
export function peopleStatus(peers) {
  if (!peers?.me) return null;
  const n = (peers.contacts || []).filter((c) => c.status !== "known").length;
  const people = `${n} ${n === 1 ? "persona" : "personas"}`;
  const relay = peers.relay?.status;
  if (relay === "offline") return { text: "Sin buzón", tone: "error", label: `El buzón no responde: no llegan mensajes · ${people}` };
  if (relay === "off" || !relay) return { text: "Apagado", tone: "quiet", label: `Buzón apagado: no puedes hablar con nadie desde Colmena · ${people}` };
  if (relay === "connecting") return { text: "Conectando…", tone: "quiet", label: `Conectando con el buzón · ${people}` };
  return { text: String(n), tone: "ok", label: `Buzón activo · ${people}` };
}

/** Copias y cifrado: when the last copy was made (GET /api/backup) and whether the base is encrypted. */
export function backupStatus(backup, encryption = null, now = Date.now()) {
  if (!backup) return null;
  const enc = encryption?.encrypted ? " · base de datos cifrada" : "";
  if (backup.lastError) return { text: "Falló", tone: "error", label: "La última copia falló: " + backup.lastError };
  if (!backup.last) return { text: "Sin copias", tone: "quiet", label: (backup.hasPassword ? "Aún no hay ninguna copia" : "Sin copias de seguridad: pon una contraseña y haz la primera") + enc };
  const ago = agoWord(backup.last.at, now);
  const old = now - Date.parse(backup.last.at) > 14 * DAY;
  return { text: ago, tone: old ? "error" : "ok", label: `Última copia ${ago}${backup.schedule && backup.schedule !== "off" ? " · automáticas" : ""}${enc}` };
}

/** Actualizaciones (lib/updates.js): a new version waiting or what you have. */
export function updateStatus(u) {
  if (!u) return null;
  if (u.status === "ready") return { text: "Nueva", tone: "news", label: u.waiting ? `La ${u.version} se instala cuando el equipo termine` : `La ${u.version} está lista: reinicia Colmena para usarla` };
  if (u.status === "downloading") return { text: `${u.percent || 0} %`, tone: "quiet", label: `Descargando la ${u.version}` };
  if (u.status === "error") return { text: "Error", tone: "error", label: u.error || "No se pudo buscar la versión nueva" };
  return u.current ? { text: u.current, tone: "quiet", label: `Al día · Colmena ${u.current}` } : null;
}

/** Diagnóstico: how many things fail or need a look (GET /api/diagnostics). */
export function diagnosticsStatus(result) {
  const s = result?.summary;
  if (!s) return null;
  if (!(s.fail || s.warn)) return { text: "Todo bien", tone: "ok", label: "La última comprobación no encontró nada" };
  const n = (s.fail || 0) + (s.warn || 0);
  return s.fail
    ? { text: String(s.fail), tone: "error", label: `${s.fail} ${s.fail === 1 ? "cosa falla" : "cosas fallan"}` }
    : { text: String(n), tone: "quiet", label: `${n} ${n === 1 ? "cosa que revisar" : "cosas que revisar"}` };
}

/** Every section's status from what the screen has: {ia: {...}, apps: {...}…}, only those that say something. */
export function sectionTags({ ai, planLimits, connectors, folders, peers, backup, encryption, updates, diagnostics, paused, settings } = {}, now = Date.now()) {
  const tags = {
    ia: aiStatus(ai, planLimits),
    apps: connectors ? appsStatus(connectors, folders || []) : null,
    contactos: peopleStatus(peers),
    copias: backupStatus(backup, encryption, now),
    actualizaciones: updateStatus(updates),
    ayuda: diagnosticsStatus(diagnostics),
    permisos: paused ? { text: "En pausa", tone: "error", label: "Todo el equipo está en pausa: ningún bot trabaja" } : null,
    avisos: settings?.notifyMode === "off" ? { text: "Silencio", tone: "quiet", label: "Sin notificaciones ni sonido" } : settings?.quietHours ? { text: "Tranquilo", tone: "quiet", label: "Horario tranquilo: de 19:00 a 9:00 y los fines de semana" } : null,
  };
  return Object.fromEntries(Object.entries(tags).filter(([, v]) => v));
}
