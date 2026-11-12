// How Colmena says, in plain Spanish, what a bot wants to do in one of your apps
// («crear un evento en Google Calendar: «Renovar PlayStation Plus», 11 nov.»), from the
// prepared action (tool slug like GOOGLECALENDAR_CREATE_EVENT, toolkit and arguments).
import { personWords } from "./origin.mjs";
import { stepHistory } from "./histories.mjs";

const VERBS = [
  [/(?:^|_)(?:CREATE|NEW|INSERT)(?:_|$)/, "crear"], [/(?:^|_)(?:ADD|APPEND)(?:_|$)/, "añadir"],
  [/(?:^|_)(?:UPDATE|EDIT|PATCH|MODIFY|RENAME|SET)(?:_|$)/, "cambiar"], [/(?:^|_)(?:DELETE|REMOVE|TRASH|DESTROY|PURGE)(?:_|$)/, "borrar"],
  [/(?:^|_)SEND(?:_|$)/, "enviar"], [/(?:^|_)REPLY(?:_|$)/, "responder a"], [/(?:^|_)FORWARD(?:_|$)/, "reenviar"],
  [/(?:^|_)INVITE(?:_|$)/, "invitar a"], [/(?:^|_)SHARE(?:_|$)/, "compartir"], [/(?:^|_)(?:PUBLISH|POST|TWEET)(?:_|$)/, "publicar"],
  [/(?:^|_)MOVE(?:_|$)/, "mover"], [/(?:^|_)COPY(?:_|$)/, "copiar"], [/(?:^|_)UPLOAD(?:_|$)/, "subir"], [/(?:^|_)ARCHIVE(?:_|$)/, "archivar"],
  [/(?:^|_)(?:PAY|CHARGE|TRANSFER|PAYOUT)(?:_|$)/, "pagar"], [/(?:^|_)REFUND(?:_|$)/, "devolver"],
  [/(?:^|_)(?:LIST|GET|FETCH|SEARCH|FIND|READ|QUERY|LOOKUP)(?:_|$)/, "consultar"],
];
const OBJECTS = [
  [/EVENT/, "un evento"], [/DRAFT/, "un borrador"], [/(?:EMAIL|MAIL|MESSAGE)/, "un mensaje"], [/PAGE/, "una página"],
  [/(?:DOCUMENT|DOC)(?:_|$)/, "un documento"], [/(?:SPREADSHEET|SHEET)/, "una hoja"], [/(?:ROW|ROWS|VALUES|RECORD)/, "datos"],
  [/FOLDER/, "una carpeta"], [/FILE/, "un archivo"], [/TASK/, "una tarea"], [/ISSUE|TICKET/, "una incidencia"],
  [/CONTACT/, "un contacto"], [/DEAL/, "una oportunidad"], [/INVOICE/, "una factura"], [/PAYMENT/, "un pago"],
  [/COMMENT/, "un comentario"], [/NOTE/, "una nota"], [/LABEL/, "una etiqueta"], [/REMINDER/, "un recordatorio"],
];
// Reads speak of what is looked at, in plural («consultar tus correos en Gmail»).
const READ_OBJECTS = [[/EVENT|CALENDAR/, "tus eventos"], [/(?:EMAIL|MAIL|MESSAGE|THREAD)/, "tus correos"], [/(?:SPREADSHEET|SHEET|ROW|VALUES)/, "tus hojas"],
  [/FILE|FOLDER|DRIVE/, "tus archivos"], [/PAGE|DOCUMENT|DOC/, "tus documentos"], [/TASK|ISSUE|TICKET/, "tus tareas"], [/CONTACT/, "tus contactos"], [/PROFILE|USER/, "tu perfil"]];
const APPS = {
  gmail: "Gmail", googlecalendar: "Google Calendar", googlesheets: "Google Sheets", googledrive: "Google Drive", googledocs: "Google Docs",
  notion: "Notion", slack: "Slack", outlook: "Outlook", microsoft_outlook: "Outlook", dropbox: "Dropbox", hubspot: "HubSpot",
  linear: "Linear", atlassian: "Jira", jira: "Jira", trello: "Trello", asana: "Asana", airtable: "Airtable", stripe: "Stripe",
};
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export const appLabel = (toolkit) => APPS[String(toolkit || "").toLowerCase()] || (toolkit ? String(toolkit).charAt(0).toUpperCase() + String(toolkit).slice(1) : "la app");

function when(args) {
  const raw = args.start_date || args.start_datetime || args.start_time || args.start?.dateTime || args.start?.date || args.start || args.date || args.due_date || "";
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(raw));
  if (!m) return "";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` + (m[4] && !(m[4] === "00" && m[5] === "00") ? `, ${m[4]}:${m[5]}` : "");
}

/** {title, sentence}: «Crear un evento en Google Calendar» / «crear un evento en Google Calendar: «…», 11 nov.» */
export function describeAppAction(a, args = {}) {
  const tool = String(a.review?.tool || a.args?.tool || "").toUpperCase();
  const verb = VERBS.find(([re]) => re.test(tool))?.[1] || (a.kind === "read" ? "consultar" : "usar");
  const object = (verb === "consultar" ? READ_OBJECTS : OBJECTS).find(([re]) => re.test(tool))?.[1] || (verb === "consultar" ? "tus datos" : a.review?.name ? "«" + a.review.name + "»" : "algo");
  const app = appLabel(a.review?.toolkit);
  const name = [args.summary, args.title, args.name, args.subject, args.text].find((v) => typeof v === "string" && v.trim());
  const detail = [name ? "«" + String(name).trim().slice(0, 80) + "»" : "", when(args)].filter(Boolean).join(", ");
  const head = `${verb} ${object} en ${app}`;
  return { title: head.charAt(0).toUpperCase() + head.slice(1), sentence: head + (detail ? ": " + detail : "") + "." };
}

// ---- Your words in the chat count ------------------------------------------------------
const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
// Your words in a message, without the outside content wrapped in it. A message a routine or
// a trigger wrote (origin.mjs) counts only for the rule's own standing instruction, as a
// routine's prompt always did; what set it off (an email, a webhook body, a file) never asks
// for a send, wrapped or not.
const yours = (m) => fold(personWords(m));
const YES = /^\s*(?:(?:si|vale|ok|okay|okey|adelante|dale|claro|perfecto|de acuerdo|hazlo|venga)\b[\s,.!]*)+(?:(?:hazlo|adelante|por favor|porfa|claro|estas autorizad[oa]|te autorizo|autorizado|puedes|envialo|mandalo|enviala|mandala)\b[\s,.!]*)*$|^\s*(?:estas autorizad[oa]|te autorizo|autorizado|tienes permiso|envialo|mandalo|enviala|mandala)[\s,.!]*$/;
const NO = /^\s*(?:no|ahora no|mejor no|no lo hagas|no lo envies|cancela|para)[\s,.!]*$/;
/** «sí», «vale, hazlo», «estás autorizado»… (short, nothing else in the message). */
export const isYes = (text) => fold(text).length <= 60 && YES.test(fold(text));
/** «no», «ahora no», «no lo hagas»… */
export const isNo = (text) => fold(text).length <= 40 && NO.test(fold(text));
// «Envía», but also «pídele a Pablo…», «dile a Ana…», «pregúntale…»: asking someone for
// something by email is asking for the email to go out.
const SEND_VERB = /\b(?:envia|enviale|envialo|enviala|envialos|envie|enviar|enviame|enviamelo|enviamela|enviaselo|enviasela|mandame|mandamelo|mandamela|mandaselo|reenviame|reenviamelo|manda|mandale|mandales|mandalo|mandala|mandar|responde|respondele|responder|contesta|contestale|contestar|reenvia|reenviale|reenviar|escribe|escribele|escribeles|escribir|pide|pidele|pideles|pedir|pregunta|preguntale|preguntales|preguntar|dile|diles|avisa|avisale|avisales|avisar|recuerdale|recuerdales|solicita|solicitale|comunica|comunicale|informa|informale|reclama|reclamale)\b/;

/**
 * The names an address goes by in what the bot read in this step («Pablo Ferrán
 * <pferran@nubaria.es>»): you say «Pablo», the address says «pferran».
 */
export function namesFor(store, stepId, addresses = []) {
  const texts = (stepHistory(store, stepId) || []).filter((x) => x?.type === "function_call_output").map((x) => String(x.output || ""));
  const out = {};
  for (const address of addresses) {
    const a = String(address || "").trim().toLowerCase();
    if (!a) continue;
    const names = new Set();
    for (const t of texts) {
      const low = t.toLowerCase();
      for (let i = low.indexOf("<" + a + ">"); i >= 0 && names.size < 6; i = low.indexOf("<" + a + ">", i + 1)) {
        const m = /([\p{L}][\p{L}'. -]{1,60})\s*$/u.exec(t.slice(Math.max(0, i - 80), i).replace(/\\"/g, '"').split(/["{,:]/).pop() || "");
        if (m) names.add(m[1].trim());
      }
    }
    if (names.size) out[a] = [...names];
  }
  return out;
}

/**
 * Your words in this turn: every message you wrote since the bot last answered. A send asked
 * for and then pinned down in your answer to its question («pídele que lo mire» → «¿a quién?»
 * → «a Raúl») is one request; what you said before the bot's last answer is not.
 */
/** When the bot last answered in this mission (ISO), or "". What it did before, you have seen. */
export function answeredAt(store, missionId) {
  return store.where("messages", "missionId", missionId).filter((m) => m.role === "assistant" && (!m.kind || m.kind === "message") && typeof m.text === "string")
    .map((m) => String(m.at)).sort().at(-1) || "";
}

export function turnText(store, missionId) {
  const messages = store.where("messages", "missionId", missionId).filter((m) => typeof m.text === "string")
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const answered = messages.findLastIndex((m) => m.role === "assistant" && (!m.kind || m.kind === "message"));
  const mine = messages.slice(answered + 1).filter((m) => m.role === "user").slice(-3);
  return mine.map(yours).join("\n");
}

/** The bot's last answer before your words in this turn (what you are answering), or "". */
export function answeredText(store, missionId) {
  const messages = store.where("messages", "missionId", missionId).filter((m) => typeof m.text === "string")
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const answered = messages.findLastIndex((m) => m.role === "assistant" && (!m.kind || m.kind === "message"));
  return answered >= 0 ? messages[answered].text : "";
}

// «Sí, el martes», «vale», «acepta», «dile que no»: a decision about what the bot told you.
const DECIDES = /^(?:si|sip|vale|ok|okey|okay|de acuerdo|perfecto|claro|adelante|venga|genial|dale|hecho|confirma\w*|acepta\w*|rechaza\w*|declina\w*)\b/;
// What only acknowledges: «ok», «vale, gracias», «perfecto».
const ACK_WORDS = /\b(?:si|sip|vale|ok|okey|okay|de acuerdo|perfecto|claro|adelante|venga|genial|dale|hecho|gracias|muchas|mil|bien|muy|estupendo|entendido|anotado|visto|por favor|porfa)\b/g;
// The bot's last message offered to answer the email («¿Le confirmo…?», «¿Respondo que sí?»).
const OFFERS_REPLY = /¿[^?]*\b(?:respond|contest|confirm|envi|mand|dig|dec|acept|rechaz|declin|escrib)\w*[^?]*\?/;
// «Prepárame un borrador», «redacta una respuesta»: you want to see it first. A plain
// «envíalo» in the same words still sends.
const asksDraft = (text) => /\b(?:borrador\w*|draft|prepar\w+|redact\w+)\b/.test(text) && !/\b(?:envi|mand|reenvi)\w+/.test(text);
// One bare address («ana@x.es»): never «Raúl <x@evil.com>» or two in one field.
export const bareAddress = (r) => { const a = fold(r).trim(); return /^[^\s<>,;:"'()]+@[^\s<>,;:"'()@]+\.[a-z]{2,}$/.test(a) ? a : ""; };
// Words too common to name anyone («envía un correo…» does not name correo@…).
const COMMON = new Set(["correo", "correos", "email", "mail", "mensaje", "info", "hola", "gracias", "para", "por", "con", "que", "los", "las", "del", "una", "uno", "este", "esta", "sobre", "informe", "favor"]);

// «Déjalo», «lo miro yo», «sin responder»: you keep it for yourself.
const KEEPS = /\b(?:dejalo|dejala|dejadlo|no hace falta|lo miro yo|lo hablo yo|lo hago yo|lo llevo yo|me encargo yo|sin responder|sin contestar|no respondas|no contestes|no lo envies|no lo mandes|todavia no|aun no|espera|ahora no)\b/;

/**
 * Your words in this turn decide how to answer an email the bot just told you about
 * («Raúl propone el martes 10 o el jueves 12…» → «Sí, martes 10 a las 12:00»): a yes, a
 * choice or a send verb, without a question and without keeping it for yourself.
 */
export function decidesReply(store, missionId) {
  const text = turnText(store, missionId);
  if (!text || /\?/.test(text) || KEEPS.test(text) || isNo(text) || asksDraft(text)) return false;
  if (SEND_VERB.test(text)) return true;
  if (!DECIDES.test(text.trim())) return false;
  // «Ok, gracias» only acknowledges what the bot said. A bare yes is a reply when the bot
  // offered one («¿Le confirmo el martes?»); otherwise it must say something («sí, el martes»).
  const rest = text.replace(ACK_WORDS, " ").replace(/[^a-z0-9]+/g, " ").trim();
  return rest.length >= 3 || OFFERS_REPLY.test(fold(answeredText(store, missionId)).slice(-600));
}

/**
 * Whether a reply in a thread is the one your answer asked for: you decided about what the
 * bot's last message said, that message points at this thread (its Gmail link or id), and
 * the reply goes only to people already in the thread. Then, as with «envía», it needs no
 * second OK and leaves with 10 s to cancel.
 */
export function answersThread(store, missionId, { ids = [], addresses = [] } = {}, recipients = []) {
  if (!recipients.length || !ids.length || !decidesReply(store, missionId)) return false;
  const said = answeredText(store, missionId).toLowerCase();
  if (!ids.some((id) => said.includes(id.toLowerCase()))) return false;
  const party = new Set(addresses.map((a) => a.toLowerCase()));
  return recipients.every((r) => { const a = bareAddress(r); return !!a && party.has(a); });
}

/** Your words in this turn tell it to send («envíalo», «mándalo ya», «pídele…»). */
export function saysSend(store, missionId) {
  const text = turnText(store, missionId);
  return !!text && SEND_VERB.test(text) && !asksDraft(text) && !/\b(no|todavia no|aun no|nunca)\s+(lo |la )?(envies|mandes)\b/.test(text);
}

/** «Envíamelo», «mándamelo a mi correo»: you are sending it to yourself. */
export function asksForSelf(store, missionId) {
  return saysSend(store, missionId) && /\b(enviame\w*|mandame\w*|reenviame\w*|a mi correo|a mi email|a mi mail|a mi mism[oa])\b/.test(turnText(store, missionId));
}

/**
 * Whether you asked for this very email in this turn: a send verb and every recipient named
 * (the address, or its name part). Then the send needs no second OK; it still leaves with
 * 10 s to cancel. Anything a bot decided by itself, or read in a page or an email, keeps
 * waiting for you.
 */
export function explicitlyAsked(store, missionId, recipients = [], { names = {}, owners = null } = {}) {
  const text = turnText(store, missionId);
  if (!saysSend(store, missionId) || !recipients.length) return false;
  // Your words, without the addresses you wrote: «ana» inside ana@x.es names nobody else.
  const said = new Set(text.replace(/[^\s<>,;:"'()]+@[^\s<>,;:"'()]+/g, " ").split(/[^a-z0-9]+/).filter(Boolean));
  return recipients.every((r) => {
    const address = bareAddress(r);
    if (!address) return false;
    // The whole address, as you wrote it (not inside a longer one).
    const at = text.indexOf(address);
    if (at >= 0 && !/[a-z0-9._%+-]/.test(text[at - 1] || " ") && !/^(?:[a-z0-9@-]|\.[a-z0-9])/.test(text.slice(at + address.length))) return true;
    const words = [...address.split("@")[0].split(/[^a-z0-9]+/), ...(names[address] || []).flatMap((n) => fold(n).split(/[^a-z0-9]+/))];
    // A word of yours that is its name: not a verb or a common word, and not also the name
    // of someone else in what the bot read («Pablo» of two different addresses asks).
    return words.some((w) => {
      if (w.length < 3 || !said.has(w) || COMMON.has(w) || SEND_VERB.test(w)) return false;
      const who = owners?.get(w);
      return !who || (who.size === 1 && who.has(address));
    });
  });
}

/**
 * Every name word and local-part word in what the bot read in this step → the addresses it
 * goes by. A word with two addresses is ambiguous: an email signed «Pablo <x@otra.com>»
 * must not pass for the Pablo you meant.
 */
export function nameOwners(store, stepId) {
  const owners = new Map();
  const add = (w, address) => { if (w.length >= 3) (owners.get(w) || owners.set(w, new Set()).get(w)).add(address); };
  for (const x of stepHistory(store, stepId) || []) {
    if (x?.type !== "function_call_output") continue;
    const t = String(x.output || "").replace(/\\"/g, '"');
    for (const m of t.matchAll(/([\p{L}][\p{L}'. -]{1,60})?\s*<([^<>\s"]+@[^<>\s"]+)>/gu)) {
      const address = fold(m[2]);
      for (const w of address.split("@")[0].split(/[^a-z0-9]+/)) add(w, address);
      for (const w of fold(m[1] || "").split(/[^a-z0-9]+/)) add(w, address);
    }
  }
  return owners;
}

// What an app action does, in plain Spanish («Leer correos», «Crear evento en el calendario»), from its
// Composio slug: for cards, the status line and the activity of a step (never the raw name).
const APP_ACTIONS = [
  [/SEND_DRAFT/, "Enviar correo"], [/UPDATE_DRAFT/, "Cambiar borrador de correo"], [/(LIST|GET)_DRAFTS?$/, "Leer borradores"],
  [/(SEND|REPLY|FORWARD).*(EMAIL|MAIL|MESSAGE)|(EMAIL|MAIL).*(SEND|REPLY)/, "Enviar correo"],
  [/(DRAFT).*(EMAIL|MAIL)|(EMAIL|MAIL).*DRAFT/, "Preparar borrador de correo"],
  [/(FETCH|LIST|GET|READ|SEARCH).*(EMAIL|MAIL|MESSAGE|THREAD)|(EMAIL|MAIL).*(FETCH|LIST|GET|SEARCH)/, "Leer correos"],
  [/(CREATE|ADD|INSERT|QUICK).*EVENT|EVENT.*(CREATE|ADD)/, "Crear evento en el calendario"],
  [/(UPDATE|PATCH|MOVE).*EVENT/, "Cambiar un evento del calendario"],
  [/(DELETE|REMOVE).*EVENT/, "Borrar un evento del calendario"],
  [/(LIST|GET|FIND|SEARCH).*(EVENT|CALENDAR)|FREE.?BUSY/, "Consultar el calendario"],
  [/(APPEND|UPDATE|WRITE|INSERT|ADD).*(ROW|CELL|VALUE|SHEET|SPREADSHEET)/, "Escribir en una hoja de cálculo"],
  [/(GET|READ|LIST|BATCH_GET|SEARCH).*(ROW|CELL|VALUE|SHEET|SPREADSHEET)/, "Leer una hoja de cálculo"],
  [/(UPLOAD|CREATE|COPY).*(FILE|DOCUMENT|FOLDER)/, "Crear un archivo"],
  [/(DELETE|REMOVE|TRASH).*(FILE|DOCUMENT|FOLDER)/, "Borrar un archivo"],
  [/(DOWNLOAD|GET|READ|LIST|SEARCH|FIND).*(FILE|DOCUMENT|FOLDER|DRIVE)/, "Leer archivos"],
  [/(SEND|POST).*(MESSAGE|CHAT)|CHAT.*SEND/, "Enviar un mensaje al chat"],
  [/(LIST|GET|READ|FETCH|SEARCH).*(MESSAGE|CHANNEL|CHAT|CONVERSATION)/, "Leer mensajes del chat"],
  [/(CREATE|ADD).*(CONTACT|LEAD|DEAL|TASK|ISSUE|RECORD)/, "Crear un registro"],
  [/(UPDATE|PATCH|EDIT)/, "Actualizar datos"],
  [/(DELETE|REMOVE)/, "Borrar datos"],
  [/(PAY|TRANSFER|CHARGE|REFUND|INVOICE)/, "Mover dinero"],
  [/(LIST|GET|READ|FETCH|SEARCH|FIND)/, "Consultar datos"],
];
/** «Leer correos» for GMAIL_FETCH_EMAILS; null when nothing fits. */
export function appActionLabel(slug) {
  const s = String(slug || "").toUpperCase();
  for (const [re, label] of APP_ACTIONS) if (re.test(s)) return label;
  return null;
}
