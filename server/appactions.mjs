// How Colmena says, in plain Spanish, what a bot wants to do in one of your apps
// («crear un evento en Google Calendar: «Renovar PlayStation Plus», 11 nov.»), from the
// prepared action (tool slug like GOOGLECALENDAR_CREATE_EVENT, toolkit and arguments).

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
  const step = stepId ? store.get("steps", stepId) : null;
  const texts = (step?.history || []).filter((x) => x?.type === "function_call_output").map((x) => String(x.output || ""));
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
 * Whether you asked for this very email in your last message in the mission: a send verb
 * and every recipient named (the address, or its name part). Then the send needs no
 * second OK; it still leaves with 10 s to cancel. Anything a bot decided by itself, or
 * read in a page or an email, keeps waiting for you.
 */
/** Your last message in the chat tells it to send («envíalo», «mándalo ya»). */
export function saysSend(store, missionId) {
  const last = store.where("messages", "missionId", missionId).filter((m) => m.role === "user" && typeof m.text === "string")
    .sort((a, b) => String(a.at).localeCompare(String(b.at))).at(-1);
  return !!last && SEND_VERB.test(fold(last.text)) && !/\b(no|todavia no|aun no|nunca)\s+(lo |la )?(envies|mandes)\b/.test(fold(last.text));
}

/** «Envíamelo», «mándamelo a mi correo»: you are sending it to yourself. */
export function asksForSelf(store, missionId) {
  const last = store.where("messages", "missionId", missionId).filter((m) => m.role === "user" && typeof m.text === "string")
    .sort((a, b) => String(a.at).localeCompare(String(b.at))).at(-1);
  return saysSend(store, missionId) && /\b(enviame\w*|mandame\w*|reenviame\w*|a mi correo|a mi email|a mi mail|a mi mism[oa])\b/.test(fold(last?.text));
}

export function explicitlyAsked(store, missionId, recipients = [], { names = {} } = {}) {
  const last = store.where("messages", "missionId", missionId).filter((m) => m.role === "user" && typeof m.text === "string")
    .sort((a, b) => String(a.at).localeCompare(String(b.at))).at(-1);
  if (!last) return false;
  const text = fold(last.text);
  if (!SEND_VERB.test(text) || !recipients.length) return false;
  return recipients.every((r) => {
    const address = fold(r).trim();
    if (!address) return false;
    if (text.includes(address)) return true;
    const local = address.split("@")[0];
    const words = [...local.split(/[._+-]/), ...(names[address] || []).flatMap((n) => fold(n).split(/[^a-z0-9]+/))];
    return words.filter((w) => w.length >= 3).some((w) => new RegExp("(?:^|[^a-z0-9])" + w + "(?:$|[^a-z0-9])").test(text));
  });
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
