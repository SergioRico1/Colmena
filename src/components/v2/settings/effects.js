// Ajustes · what an action will do, said before you do it. Pure: every sentence is built from the
// state the screen already has, so it can be tested and never promises what the app cannot do.
import { ENGINE_NAMES } from "../../../lib/engineNames.js";

const ENGINE = { ...ENGINE_NAMES, local: "el modelo de este ordenador" };
const join = (list) => (list.length < 2 ? list.join("") : list.slice(0, -1).join(", ") + " y " + list.at(-1));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** «Hacer que lo olviden todo»: how many go, what stays, and the ten seconds to undo it. */
export function forgetAllText(active = 0, archived = 0) {
  const n = active + archived;
  return {
    title: `¿Olvidar ${plural(n, "recuerdo", "recuerdos")}?`,
    body: `Todos tus bots olvidan lo que saben de ti${archived ? ` (también ${plural(archived, "recuerdo archivado", "recuerdos archivados")})` : ""}. Tus chats, tus archivos y tu perfil se quedan. Tendrás 10 segundos para deshacerlo; después no se puede recuperar.`,
    action: `Olvidar ${plural(n, "recuerdo", "recuerdos")}`,
  };
}

/**
 * Disconnecting an AI account: what stops. `engines` is ai.engines; `bots` the team (a bot with
 * its own `engine` uses that one).
 */
export function disconnectAiText({ id, engines = [], primary = null, fallback = null, bots = [] }) {
  const name = engines.find((e) => e.id === id)?.label || ENGINE[id] || id;
  const others = engines.filter((e) => e.connected && e.id !== id);
  const own = bots.filter((b) => b.engine === id).map((b) => b.name);
  const whose = own.length ? ` ${join(own)} ${own.length === 1 ? "la usa por su cuenta y pasará" : "la usan por su cuenta y pasarán"} a la del equipo.` : "";
  if (!others.length) return `Es tu única cuenta: tus bots dejan de pensar hasta que conectes otra. Lo que estén haciendo se para y se conserva.${whose}`;
  if (id === primary) {
    const next = others.find((e) => e.id === fallback) || others[0];
    return `Es la principal: tus bots pasarán a pensar con ${next.label || ENGINE[next.id]}.${whose}`;
  }
  if (id === fallback) return `Es tu respaldo: si ${ENGINE[primary] || "la principal"} llega a su límite, tus bots pararán y te avisarán.${whose}`;
  return `Tus bots siguen con ${ENGINE[primary] || "la principal"}; ${name} deja de estar disponible para ellos.${whose}`;
}

/** Disconnecting an app account: which bots stop reading or changing it. */
export function disconnectAppText(label, users = []) {
  const who = users.map((b) => b.name);
  return who.length
    ? `${join(who)} ${who.length === 1 ? "deja" : "dejan"} de poder usar ${label}. Lo que ya trajeron a Colmena se queda. Tendrás 10 segundos para deshacerlo.`
    : `Ningún bot la usa ahora. Lo que ya trajeron a Colmena se queda. Tendrás 10 segundos para deshacerlo.`;
}

/** «Olvidar la contraseña» of the backups (DELETE /api/backup/password): automatic copies stop. */
export function forgetBackupPasswordText(v = {}) {
  const n = v.backups?.length || 0;
  return {
    title: "¿Olvidar la contraseña de las copias?",
    body: `No se podrán hacer más copias${v.schedule && v.schedule !== "off" ? " y las automáticas se apagan" : ""}.${n ? ` ${n === 1 ? "La copia que ya tienes sigue" : `Las ${n} copias que ya tienes siguen`} en su carpeta y se abren con la contraseña de siempre.` : ""} Colmena no la guarda en ningún otro sitio: no se puede deshacer.`,
    action: "Olvidar la contraseña",
  };
}

// What a bot may do with one kind of app (bot.tools[kind], Autonomía › Qué app usa cada bot).
export const ACCESS_LEVELS = [
  ["none", "No", "No la ve."],
  ["lee", "Lee", "Lee y busca sin preguntarte."],
  ["escribe", "Escribe", "Además prepara y cambia cosas, con tu OK."],
];
/** Which kind of app (bot.tools, Autonomía › Qué app usa cada bot) a connected toolkit is. */
export const KIND_OF = { gmail: "correo", outlook: "correo", googlecalendar: "calendario", outlookcalendar: "calendario", googledrive: "carpeta", dropbox: "carpeta", onedrive: "carpeta", box: "carpeta", googlesheets: "hojas", excel: "hojas", slack: "chat", microsoftteams: "chat", teams: "chat", holded: "erp", quickbooks: "erp", xero: "erp" };
/** What a kind of app is, in words («tu correo»), for the after-connect step. */
export const KIND_WORDS = { correo: "tu correo", calendario: "tu calendario", carpeta: "tus archivos", hojas: "tus hojas de cálculo", chat: "tus mensajes", erp: "tu contabilidad" };

/**
 * The access each bot starts with after connecting an app of `kind`: what it already had, or —
 * when no bot has any access to that kind yet — reading for every bot (reading never changes
 * anything; writing stays a choice you make).
 */
export function suggestedAccess(bots = [], kind) {
  const have = bots.some((b) => (b.tools?.[kind] || "none") !== "none");
  return Object.fromEntries(bots.map((b) => [b.id, have ? b.tools?.[kind] || "none" : "lee"]));
}
