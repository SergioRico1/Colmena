// What you said you want (or do not want) to hear about, as the bots and the watcher use it.
//
// A memory written after a bot read outside content stays «por revisar» (an email must not
// plant memories). But when the memory only repeats what you yourself wrote in that chat
// («No quiero que me notifiques de ningún correo más de Marketplace»), it is yours: it counts.
// A «don't tell me about X» preference is also a hard rule for the watcher (watch.mjs): the
// items that match never reach the model.

const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
// Words that say nothing about the subject of a preference.
const GENERIC = new Set(("quiere quieres quiero recibir avisos aviso avises notifique notifiques notificar notificaciones informe informes informar " +
  "resumen resumenes ningun ninguno ninguna correo correos email emails mensaje mensajes sobre incluidos incluidas incluido " +
  "nunca mas tampoco persona prefiere ademas cualquier todos todas desde hasta").split(" "));
const words = (text) => [...new Set(fold(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !GENERIC.has(w)))];
const stem = (w) => w.replace(/(es|s)$/, "");

/** «No quiere recibir avisos de…», «no le avises de…»: a preference to hear nothing about something. */
export const isMute = (text) => {
  const t = fold(text);
  return /\bno (quiere|quiero|le|me)\b[^.]{0,40}\b(avis|notific|inform|resum|recib)/.test(t) || /\bsin avisos?\b/.test(t);
};

/** Everything you wrote in a mission, folded. */
function yourWords(store, missionId) {
  if (!missionId) return "";
  return store.where("messages", "missionId", missionId).filter((m) => m.role === "user").map((m) => fold(m.text)).join(" \n ");
}

/** The subject words of `text` that you also used in that mission. */
export function wordsYouSaid(store, missionId, text) {
  const said = yourWords(store, missionId);
  return words(text).filter((w) => said.includes(stem(w)));
}

/**
 * Whether a memory only repeats what you said there: most of its subject words are yours,
 * or, for a «don't tell me about X», X is.
 */
export function saidByYou(store, missionId, text) {
  const all = words(text);
  if (!all.length) return false;
  const yours = wordsYouSaid(store, missionId, text);
  return yours.length / all.length >= 0.6 || (isMute(text) && yours.length > 0);
}

/** A memory the bots may rely on: confirmed, or a «por revisar» one that is your own words. */
export const trusted = (store, m) => !!m && m.active !== false && (!m.review || saidByYou(store, m.missionId, m.text));

/**
 * The watcher's view of your wishes: `lines` for its instructions and `mute`, the words that
 * drop an item before the model sees it (only words you said yourself).
 */
export function watchPreferences(store) {
  const prefs = store.list("memories").filter((m) => m.target === "user" && m.active !== false && trusted(store, m));
  const about = prefs.filter((m) => /avis|notific|resum|inform|correo|reunion|agenda|mensaje/.test(fold(m.text)));
  const mute = new Set();
  for (const m of about.filter((x) => isMute(x.text)))
    for (const w of m.review ? wordsYouSaid(store, m.missionId, m.text) : words(m.text)) mute.add(stem(w));
  return { lines: about.map((m) => m.text).slice(0, 12), mute: [...mute].filter((w) => w.length >= 5) };
}

// Serious for your account, whatever you muted (as Codex keeps them): a penalty, a suspension or
// block, money held back, a breach of policy or a deadline to appeal. Never a buyer's message,
// an order or a routine notice.
const SERIOUS = /(penaliza|sancion|suspend|bloque|desactiva|cierre de (tu |la )?cuenta|cuenta (restringida|limitada|cerrada)|restriccion|retenid|retencion de (pagos|fondos)|fondos retenidos|incumpl|infraccion|apelar|apelacion|ultimo aviso|plazo para (responder|regularizar|corregir))/;

/** True when an item is about something you asked not to hear about (and is not serious). */
export const muted = (item, mute = []) => {
  if (!mute.length) return false;
  const text = fold([item?.de, item?.titulo, item?.asunto, item?.fuente, item?.cuenta].filter(Boolean).join(" "));
  if (!mute.some((w) => text.includes(w))) return false;
  return !SERIOUS.test(fold([item?.titulo, item?.asunto, item?.texto].filter(Boolean).join(" ")));
};
