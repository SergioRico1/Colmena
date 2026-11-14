// «Correo (IMAP/SMTP)»: any mailbox with an app password (Gmail and Google Workspace with 2-Step
// Verification, iCloud, Yahoo, Fastmail…), so Gmail works without Colmena registering anything
// with Google. Built into Colmena and offered to the bots as one more MCP server (the hub's
// `transport: "mail"`): the same mcp_tools / mcp_call, the same red lines (a send always waits and
// is reviewed like any email), credentials per person in the vault.
//
// The network goes through a TCP seam: `tcp({host, port, tls})` → a socket {read(), write(),
// startTls(), close()}. On the desktop it is node:tls (nodeTcp below); in the cloud it is
// `connect()` from cloudflare:sockets (cloud/src/tcp.js), where port 25 is blocked: SMTP goes over
// 465 (TLS) or 587 (STARTTLS). One short connection per call: nothing stays open between turns.
import net from "node:net";
import tls from "node:tls";
import { randomBytes } from "node:crypto";

const TIMEOUT_MS = 30000;
const MAX_BODY = 60000;
const MAX_MESSAGE = 8 * 1024 * 1024;

// Known providers by the address's domain. Microsoft is refused on purpose: Exchange Online and
// Outlook.com turned basic authentication off for IMAP (they need OAuth), so a password cannot work.
export const PROVIDERS = {
  gmail: { name: "Gmail o Google Workspace", imap: { host: "imap.gmail.com", port: 993, tls: "on" }, smtp: { host: "smtp.gmail.com", port: 465, tls: "on" }, domains: ["gmail.com", "googlemail.com"], help: "https://myaccount.google.com/apppasswords" },
  icloud: { name: "iCloud", imap: { host: "imap.mail.me.com", port: 993, tls: "on" }, smtp: { host: "smtp.mail.me.com", port: 587, tls: "starttls" }, domains: ["icloud.com", "me.com", "mac.com"], help: "https://support.apple.com/102654" },
  yahoo: { name: "Yahoo", imap: { host: "imap.mail.yahoo.com", port: 993, tls: "on" }, smtp: { host: "smtp.mail.yahoo.com", port: 465, tls: "on" }, domains: ["yahoo.com", "yahoo.es", "ymail.com"], help: "https://help.yahoo.com/kb/SLN15241.html" },
  fastmail: { name: "Fastmail", imap: { host: "imap.fastmail.com", port: 993, tls: "on" }, smtp: { host: "smtp.fastmail.com", port: 465, tls: "on" }, domains: ["fastmail.com", "fastmail.fm"], help: "https://www.fastmail.help/hc/en-us/articles/360058752854" },
};
const MICROSOFT = /(^|\.)(outlook|hotmail|live|msn)\.[a-z.]+$/i;

export const MAIL_TOOLS = [
  { name: "list_folders", title: "Ver carpetas", description: "Lista las carpetas (y etiquetas de Gmail) del buzón.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "search_messages", title: "Buscar correos", description: "Busca correos. query: texto a buscar (en Gmail, la misma sintaxis del buscador de Gmail: from:, subject:, newer_than:7d…); folder: carpeta (por defecto la bandeja de entrada); limit: hasta 25; unread_only: solo sin leer. Devuelve id, de, para, asunto, fecha y si está leído.", inputSchema: { type: "object", properties: { query: { type: "string" }, folder: { type: "string" }, limit: { type: "number" }, unread_only: { type: "boolean" } }, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "read_message", title: "Leer un correo", description: "Lee un correo entero por su id (de search_messages) sin marcarlo como leído: cabeceras, texto y nombres de adjuntos.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "create_draft", title: "Preparar un borrador", description: "Guarda un borrador en la carpeta Borradores (no sale de tu cuenta). to y cc: listas de direcciones; reply_to_id: el id del correo al que responde, para que quede en su conversación.", inputSchema: { type: "object", properties: { to: { type: "array", items: { type: "string" } }, cc: { type: "array", items: { type: "string" } }, subject: { type: "string" }, body: { type: "string" }, reply_to_id: { type: "string" } }, required: ["to", "subject", "body"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: "send_message", title: "Enviar un correo", description: "Envía un correo. Siempre espera a que la persona lo revise y lo apruebe. to, cc y bcc: listas de direcciones; reply_to_id: el id del correo al que responde.", inputSchema: { type: "object", properties: { to: { type: "array", items: { type: "string" } }, cc: { type: "array", items: { type: "string" } }, bcc: { type: "array", items: { type: "string" } }, subject: { type: "string" }, body: { type: "string" }, reply_to_id: { type: "string" } }, required: ["to", "subject", "body"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
  { name: "move_message", title: "Mover un correo", description: "Mueve un correo a otra carpeta (archivar, por ejemplo). No borra.", inputSchema: { type: "object", properties: { id: { type: "string" }, folder: { type: "string" } }, required: ["id", "folder"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: "add_label", title: "Etiquetar un correo", description: "Pone una etiqueta de Gmail a un correo (solo Gmail).", inputSchema: { type: "object", properties: { id: { type: "string" }, label: { type: "string" } }, required: ["id", "label"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: "mark_read", title: "Marcar como leído", description: "Marca un correo como leído (read: true) o sin leer (read: false).", inputSchema: { type: "object", properties: { id: { type: "string" }, read: { type: "boolean" } }, required: ["id", "read"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
];

// ------------------------------------------------------------------ the TCP seam (desktop)

/** A pull socket over a Node stream: read() → Buffer | null (closed). */
function streamSocket(stream) {
  const queue = [];
  let waiting = null, ended = false, failure = null;
  const wake = () => { if (waiting) { const w = waiting; waiting = null; w(); } };
  stream.on("data", (c) => { queue.push(c); wake(); });
  stream.on("end", () => { ended = true; wake(); });
  stream.on("close", () => { ended = true; wake(); });
  stream.on("error", (e) => { failure = e; ended = true; wake(); });
  return {
    async read() {
      while (!queue.length && !ended) await new Promise((r) => { waiting = r; });
      if (queue.length) return queue.shift();
      if (failure) throw failure;
      return null;
    },
    write: (data) => new Promise((resolve, reject) => stream.write(data, (e) => (e ? reject(e) : resolve()))),
    close() { try { stream.destroy(); } catch {} },
    raw: stream,
  };
}

/** node:tls / node:net. `tls: "off"` (plain) only for tests against a fake server on this computer. */
export function nodeTcp({ allowPlain = false } = {}) {
  return ({ host, port, tls: mode = "on" }) => new Promise((resolve, reject) => {
    if (mode === "off" && !allowPlain) return reject(Error("El correo tiene que ir cifrado (TLS)."));
    const opts = { host, port, servername: net.isIP(host) ? undefined : host, timeout: TIMEOUT_MS };
    const s = mode === "on" ? tls.connect(opts) : net.connect(opts);
    const ready = mode === "on" ? "secureConnect" : "connect";
    const why = { ECONNREFUSED: "no acepta conexiones en ese puerto", ENOTFOUND: "ese servidor no existe", EAI_AGAIN: "no se encuentra ese servidor", ETIMEDOUT: "no responde", ECONNRESET: "cortó la conexión" };
    const fail = (e) => reject(Error("No se pudo conectar con " + host + ":" + port + ": " + (why[e?.code] || (/tiempo/.test(e?.message) ? "no responde" : "revisa el servidor y el puerto") + ".")));
    s.once("error", fail);
    s.once("timeout", () => { s.destroy(); fail(Error("tiempo agotado")); });
    s.once(ready, () => {
      s.off("error", fail);
      s.setTimeout(0);
      const sock = streamSocket(s);
      sock.startTls = () => new Promise((ok, ko) => {
        s.removeAllListeners("data");
        const t = tls.connect({ socket: s, servername: net.isIP(host) ? undefined : host }, () => ok(streamSocket(t)));
        t.once("error", (e) => ko(Error("No se pudo cifrar la conexión: " + e.message)));
      });
      resolve(sock);
    });
  });
}

// ------------------------------------------------------------------ a line reader

class Lines {
  constructor(sock) { this.sock = sock; this.buf = Buffer.alloc(0); }
  async fill() {
    const chunk = await this.sock.read();
    if (!chunk) throw Error("El servidor de correo cerró la conexión.");
    this.buf = Buffer.concat([this.buf, Buffer.from(chunk)]);
    if (this.buf.length > MAX_MESSAGE * 2) throw Error("Respuesta demasiado grande.");
  }
  async line() {
    for (;;) {
      const i = this.buf.indexOf("\r\n");
      if (i >= 0) { const l = this.buf.subarray(0, i).toString("utf8"); this.buf = this.buf.subarray(i + 2); return l; }
      await this.fill();
    }
  }
  async bytes(n) {
    while (this.buf.length < n) await this.fill();
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }
}

const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => { const t = setTimeout(() => rej(Error(what + ": tiempo agotado.")), ms); t.unref?.(); })]);

// ------------------------------------------------------------------ IMAP

const quote = (s) => '"' + String(s).replace(/[\\"]/g, (c) => "\\" + c).replace(/[\r\n]/g, " ") + '"';

class Imap {
  constructor(sock) { this.sock = sock; this.lines = new Lines(sock); this.n = 0; this.caps = new Set(); }
  async greet() { const l = await this.lines.line(); if (!/^\* (OK|PREAUTH)/i.test(l)) throw Error("El servidor IMAP no respondió como se esperaba."); }
  /** One command: its untagged responses (literals inline as {text}) and the tagged result. */
  async cmd(command, { literal = null } = {}) {
    const tag = "C" + ++this.n;
    await this.sock.write(tag + " " + command + "\r\n");
    const untagged = [];
    for (;;) {
      let line = await this.lines.line();
      const parts = [];
      // A line ending in {n} carries n bytes of literal, then goes on.
      for (let m = /\{(\d+)\}$/.exec(line); m; m = /\{(\d+)\}$/.exec(line)) {
        const data = await this.lines.bytes(Number(m[1]));
        parts.push({ text: line.slice(0, m.index), literal: data });
        line = await this.lines.line();
      }
      if (line.startsWith("+")) {
        if (literal == null) throw Error("El servidor IMAP pidió datos inesperados.");
        await this.sock.write(Buffer.concat([Buffer.from(literal), Buffer.from("\r\n")]));
        literal = null;
        continue;
      }
      if (line.startsWith(tag + " ")) {
        const status = line.slice(tag.length + 1);
        if (!/^OK/i.test(status)) throw Object.assign(Error(status.replace(/^(NO|BAD)\s*(\[[^\]]*\]\s*)?/i, "").slice(0, 200) || "El servidor IMAP no aceptó la orden."), { imap: status });
        return { untagged, status };
      }
      untagged.push(parts.length ? { parts, tail: line } : { text: line });
    }
  }
  async login(user, pass) {
    await this.cmd("LOGIN " + quote(user) + " " + quote(pass)).catch((e) => {
      throw Error(/AUTHENTICATIONFAILED|invalid|credentials|password|login/i.test(e.imap || e.message) ? "El correo o la contraseña de aplicación no son correctos." : "No se pudo entrar: " + e.message);
    });
    const caps = await this.cmd("CAPABILITY");
    for (const u of caps.untagged) if (/^\* CAPABILITY /i.test(u.text || "")) for (const c of u.text.slice(13).split(/\s+/)) this.caps.add(c.toUpperCase());
  }
  get gmail() { return this.caps.has("X-GM-EXT-1"); }
  async folders() {
    const out = [];
    for (const u of (await this.cmd('LIST "" "*"')).untagged) {
      const m = /^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (.+)$/i.exec(u.text || (u.parts ? u.parts[0].text + u.parts[0].literal.toString() : ""));
      if (!m) continue;
      const name = m[2].startsWith('"') ? m[2].slice(1, -1).replace(/\\(.)/g, "$1") : m[2];
      const flags = m[1].split(/\s+/).filter(Boolean).map((f) => f.toLowerCase());
      if (flags.includes("\\noselect")) continue;
      const use = ["\\drafts", "\\sent", "\\trash", "\\junk", "\\all", "\\archive", "\\flagged", "\\important"].find((f) => flags.includes(f)) || (/^inbox$/i.test(name) ? "\\inbox" : null);
      out.push({ name, use: use ? use.slice(1) : null });
    }
    return out;
  }
  async special(use, fallbacks) {
    const list = await this.folders();
    return list.find((f) => f.use === use)?.name || list.find((f) => fallbacks.some((n) => n.toLowerCase() === f.name.toLowerCase()))?.name || null;
  }
}

function parseFetch(untagged) {
  const out = [];
  for (const u of untagged) {
    const head = u.parts ? u.parts[0].text : u.text || "";
    const m = /^\* \d+ FETCH \((.*)$/i.exec(head);
    if (!m) continue;
    const meta = u.parts ? u.parts.map((p) => p.text).join(" ") + " " + u.tail : head;
    const uid = Number(/UID (\d+)/i.exec(meta)?.[1]);
    const flags = (/FLAGS \(([^)]*)\)/i.exec(meta)?.[1] || "").split(/\s+/).filter(Boolean);
    const thread = /X-GM-THRID (\d+)/i.exec(meta)?.[1] || null;
    const labels = /X-GM-LABELS \(([^)]*)\)/i.exec(meta)?.[1] || "";
    const literal = u.parts ? Buffer.concat(u.parts.map((p) => p.literal)) : Buffer.alloc(0);
    if (uid) out.push({ uid, flags, thread, labels, data: literal });
  }
  return out;
}

// ------------------------------------------------------------------ MIME (enough to read and write)

const decoder = (charset) => { try { return new TextDecoder(String(charset || "utf-8").toLowerCase().replace(/^(us-ascii|ascii)$/, "utf-8")); } catch { return new TextDecoder("utf-8"); } };
function qp(s) {
  const bytes = [];
  const t = s.replace(/=\r?\n/g, "");
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "=" && /^[0-9A-F]{2}$/i.test(t.slice(i + 1, i + 3))) { bytes.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(t.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes);
}
/** «=?UTF-8?B?…?=» in a header → text. */
export function decodeWords(s) {
  return String(s || "").replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=(\s+(?==\?))?/gi, (_, cs, enc, text) => {
    const buf = enc.toUpperCase() === "B" ? Buffer.from(text, "base64") : qp(text.replace(/_/g, " "));
    return decoder(cs).decode(buf);
  });
}
function headers(raw) {
  const h = {};
  for (const line of raw.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) { const k = line.slice(0, i).trim().toLowerCase(); h[k] = h[k] ? h[k] + ", " + line.slice(i + 1).trim() : line.slice(i + 1).trim(); }
  }
  return h;
}
const param = (value, name) => new RegExp(name + '\\s*=\\s*"?([^";]+)"?', "i").exec(value || "")?.[1] || null;
/** {text, attachments} of a message: the first text/plain part, else text/html without tags. */
export function parseMime(buf, depth = 0) {
  const s = Buffer.from(buf).toString("latin1");
  const cut = s.search(/\r?\n\r?\n/);
  const head = headers(cut >= 0 ? s.slice(0, cut) : s);
  const body = cut >= 0 ? s.slice(cut).replace(/^\r?\n\r?\n/, "") : "";
  const type = (head["content-type"] || "text/plain").toLowerCase();
  const out = { headers: head, text: "", html: "", attachments: [] };
  const disposition = head["content-disposition"] || "";
  const filename = decodeWords(param(disposition, "filename") || param(head["content-type"], "name") || "");
  if (type.startsWith("multipart/") && depth < 6) {
    const boundary = param(head["content-type"], "boundary");
    if (boundary) {
      for (const part of body.split("--" + boundary).slice(1)) {
        if (part.startsWith("--")) break;
        const p = parseMime(Buffer.from(part.replace(/^\r?\n/, ""), "latin1"), depth + 1);
        if (!out.text && p.text) out.text = p.text;
        if (!out.html && p.html) out.html = p.html;
        out.attachments.push(...p.attachments);
      }
    }
    return out;
  }
  if (/^attachment/i.test(disposition) || (filename && !type.startsWith("text/"))) { out.attachments.push(filename || "adjunto"); return out; }
  const enc = (head["content-transfer-encoding"] || "").toLowerCase();
  const bytes = enc === "base64" ? Buffer.from(body.replace(/\s+/g, ""), "base64") : enc === "quoted-printable" ? qp(body) : Buffer.from(body, "latin1");
  const text = decoder(param(head["content-type"], "charset")).decode(bytes);
  if (type.startsWith("text/html")) out.html = text; else if (type.startsWith("text/")) out.text = text;
  return out;
}
const stripHtml = (h) => String(h).replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim();

const ADDRESS = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
const cleanList = (v) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;]/) : []).map((x) => String(x).trim()).filter(Boolean).map((x) => (/<([^>]+)>/.exec(x)?.[1] || x).trim());
function checkAddresses(list, what) {
  const bad = list.find((a) => !ADDRESS.test(a));
  if (bad) throw Error("«" + bad + "» no es una dirección de correo válida (" + what + ").");
  return list;
}
const encodeWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : "=?UTF-8?B?" + Buffer.from(s, "utf8").toString("base64") + "?=");
const wrap76 = (b64) => b64.replace(/.{1,76}/g, "$&\r\n");

/** An RFC 5322 message (text/plain, UTF-8, base64). Bcc never goes in the headers. */
export function composeMessage({ from, fromName = null, to, cc = [], subject, body, inReplyTo = null, references = null, draft = false, now = new Date() }) {
  const domain = String(from).split("@")[1] || "colmena.invalid";
  const lines = [
    "From: " + (fromName ? encodeWord(fromName) + " <" + from + ">" : from),
    "To: " + to.join(", "),
    ...(cc.length ? ["Cc: " + cc.join(", ")] : []),
    "Subject: " + encodeWord(String(subject || "").replace(/[\r\n]+/g, " ")),
    "Date: " + now.toUTCString().replace("GMT", "+0000"),
    "Message-ID: <" + randomBytes(12).toString("hex") + "@" + domain + ">",
    ...(inReplyTo ? ["In-Reply-To: " + inReplyTo, "References: " + [references, inReplyTo].filter(Boolean).join(" ")] : []),
    ...(draft ? ["X-Colmena-Draft: 1"] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  return lines.join("\r\n") + "\r\n\r\n" + wrap76(Buffer.from(String(body || ""), "utf8").toString("base64"));
}

// ------------------------------------------------------------------ SMTP

class Smtp {
  constructor(sock) { this.sock = sock; this.lines = new Lines(sock); }
  async reply() {
    let line, text = [];
    do { line = await this.lines.line(); text.push(line.slice(4)); } while (/^\d{3}-/.test(line));
    return { code: Number(line.slice(0, 3)), text: text.join(" ") };
  }
  async expect(command, ok) {
    if (command != null) await this.sock.write(command + "\r\n");
    const r = await this.reply();
    if (!ok.includes(r.code)) throw Object.assign(Error(r.text.slice(0, 200) || "El servidor de envío no aceptó el correo."), { smtp: r.code });
    return r;
  }
}

// ------------------------------------------------------------------ the connector

const idOf = (folder, uid) => Buffer.from(folder, "utf8").toString("base64url") + "." + uid;
function fromId(id) {
  const m = /^([A-Za-z0-9_-]+)\.(\d+)$/.exec(String(id || ""));
  if (!m) throw Error("Ese id de correo no es válido: usa el de search_messages.");
  return { folder: Buffer.from(m[1], "base64url").toString("utf8"), uid: Number(m[2]) };
}

/** Which provider an address belongs to (or null), and a plain refusal for Microsoft. */
export function providerFor(email) {
  const domain = String(email || "").split("@")[1]?.toLowerCase() || "";
  if (MICROSOFT.test(domain)) throw Error("Outlook, Hotmail y Microsoft 365 ya no dejan entrar con contraseña por IMAP (exigen OAuth). Conecta Outlook con Composio.");
  return Object.entries(PROVIDERS).find(([, p]) => p.domains.includes(domain))?.[0] || null;
}

/** The settings to keep: known provider or the hosts given, checked. */
export function mailSettings({ email, password, provider = null, imap = null, smtp = null, name = null }, { allowPlain = false } = {}) {
  const address = String(email || "").trim().toLowerCase();
  if (!ADDRESS.test(address)) throw Error("Escribe una dirección de correo válida.");
  const pass = String(password || "").replace(/\s+/g, "");
  if (pass.length < 6 || pass.length > 200) throw Error("Pega la contraseña de aplicación (16 letras en Gmail).");
  const key = provider && PROVIDERS[provider] ? provider : providerFor(address);
  const host = (h, what) => {
    if (!h?.host) throw Error("Falta el servidor " + what + ". Elige tu proveedor o escribe sus datos.");
    const port = Number(h.port);
    const mode = ["on", "starttls"].includes(h.tls) || (allowPlain && h.tls === "off") ? h.tls : port === 587 || port === 143 ? "starttls" : "on";
    if (!/^[a-z0-9.-]{3,253}$/i.test(h.host) || !(port > 0 && port < 65536) || port === 25) throw Error("El servidor " + what + " no es válido" + (port === 25 ? " (el puerto 25 no se puede usar: usa 465 o 587)" : "") + ".");
    return { host: h.host.toLowerCase(), port, tls: mode };
  };
  const preset = key ? PROVIDERS[key] : null;
  return { email: address, password: pass, name: name ? String(name).slice(0, 80) : null, provider: key, imap: host(imap?.host ? imap : preset?.imap, "IMAP"), smtp: host(smtp?.host ? smtp : preset?.smtp, "de envío (SMTP)") };
}

export class MailConnector {
  /** `settings` from mailSettings; `tcp` the seam. */
  constructor(settings, { tcp }) { this.s = settings; this.tcp = tcp; }

  async withImap(fn) {
    let sock = await this.tcp({ host: this.s.imap.host, port: this.s.imap.port, tls: this.s.imap.tls === "starttls" ? "off" : this.s.imap.tls });
    const imap = new Imap(sock);
    try {
      return await withTimeout((async () => {
        await imap.greet();
        if (this.s.imap.tls === "starttls") {
          await imap.cmd("STARTTLS");
          sock = await sock.startTls();
          imap.sock = sock; imap.lines = new Lines(sock);
        }
        await imap.login(this.s.email, this.s.password);
        const out = await fn(imap);
        await imap.cmd("LOGOUT").catch(() => {});
        return out;
      })(), TIMEOUT_MS * 2, "El buzón no respondió");
    } finally { sock.close(); }
  }

  async withSmtp(fn) {
    let sock = await this.tcp({ host: this.s.smtp.host, port: this.s.smtp.port, tls: this.s.smtp.tls === "starttls" ? "off" : this.s.smtp.tls });
    const smtp = new Smtp(sock);
    try {
      return await withTimeout((async () => {
        await smtp.expect(null, [220]);
        await smtp.expect("EHLO colmena.local", [250]);
        if (this.s.smtp.tls === "starttls") {
          await smtp.expect("STARTTLS", [220]);
          sock = await sock.startTls();
          smtp.sock = sock; smtp.lines = new Lines(sock);
          await smtp.expect("EHLO colmena.local", [250]);
        }
        const auth = Buffer.from("\0" + this.s.email + "\0" + this.s.password, "utf8").toString("base64");
        await smtp.expect("AUTH PLAIN " + auth, [235]).catch((e) => { throw Error(e.smtp === 535 || e.smtp === 534 ? "El servidor de envío no aceptó la contraseña de aplicación." : "No se pudo entrar en el servidor de envío: " + e.message); });
        const out = await fn(smtp);
        await smtp.expect("QUIT", [221]).catch(() => {});
        return out;
      })(), TIMEOUT_MS * 2, "El servidor de envío no respondió");
    } finally { sock.close(); }
  }

  /** «Probar»: entra en IMAP y en SMTP sin enviar nada. */
  async test() {
    const folders = await this.withImap((imap) => imap.folders());
    await this.withSmtp(async () => {});
    return { ok: true, folders: folders.length };
  }

  async listTools() { return { tools: MAIL_TOOLS }; }

  async callTool({ name, arguments: args = {} }) {
    try {
      const data = await this.run(name, args || {});
      return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: undefined };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error.message }] };
    }
  }

  async run(name, a) {
    switch (name) {
      case "list_folders": return { folders: await this.withImap((imap) => imap.folders()) };
      case "search_messages": return this.search(a);
      case "read_message": return this.read(a.id);
      case "create_draft": return this.draft(a);
      case "send_message": return this.send(a);
      case "move_message": return this.move(a.id, a.folder);
      case "add_label": return this.label(a.id, a.label);
      case "mark_read": return this.markRead(a.id, a.read !== false);
      default: throw Error("«" + name + "» no es una herramienta del correo.");
    }
  }

  async search({ query = "", folder = "", limit = 10, unread_only = false }) {
    const n = Math.max(1, Math.min(25, Number(limit) || 10));
    return this.withImap(async (imap) => {
      const box = folder || "INBOX";
      await imap.cmd("EXAMINE " + quote(box));
      const terms = [];
      if (unread_only) terms.push("UNSEEN");
      const q = String(query || "").trim().slice(0, 300);
      if (q) terms.push(imap.gmail ? "X-GM-RAW " + quote(q) : "TEXT " + quote(q));
      const r = await imap.cmd("UID SEARCH " + (terms.join(" ") || "ALL"));
      const uids = r.untagged.flatMap((u) => (/^\* SEARCH(.*)$/i.exec(u.text || "")?.[1] || "").trim().split(/\s+/)).filter(Boolean).map(Number).sort((x, y) => y - x).slice(0, n);
      if (!uids.length) return { folder: box, messages: [] };
      const extra = imap.gmail ? " X-GM-THRID X-GM-LABELS" : "";
      const f = await imap.cmd("UID FETCH " + uids.join(",") + " (UID FLAGS" + extra + " BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE)])");
      const messages = parseFetch(f.untagged).sort((x, y) => y.uid - x.uid).map((m) => {
        const h = headers(m.data.toString("latin1"));
        return { id: idOf(box, m.uid), from: decodeWords(h.from), to: decodeWords(h.to), ...(h.cc ? { cc: decodeWords(h.cc) } : {}), subject: decodeWords(h.subject), date: h.date || null, read: m.flags.includes("\\Seen"), ...(m.thread ? { thread: m.thread } : {}) };
      });
      return { folder: box, messages };
    });
  }

  async read(id) {
    const { folder, uid } = fromId(id);
    return this.withImap(async (imap) => {
      await imap.cmd("EXAMINE " + quote(folder));
      const f = parseFetch((await imap.cmd("UID FETCH " + uid + " (UID FLAGS BODY.PEEK[])")).untagged)[0];
      if (!f) throw Error("Ese correo ya no está en «" + folder + "».");
      const m = parseMime(f.data);
      const text = (m.text || stripHtml(m.html)).replace(/\r\n/g, "\n");
      const h = m.headers;
      return {
        id, folder, from: decodeWords(h.from), to: decodeWords(h.to), ...(h.cc ? { cc: decodeWords(h.cc) } : {}), subject: decodeWords(h.subject), date: h.date || null,
        message_id: h["message-id"] || null, body: text.length > MAX_BODY ? text.slice(0, MAX_BODY) + "\n[…recortado]" : text, attachments: m.attachments,
      };
    });
  }

  /** The headers a reply needs from the message it answers. */
  async replyHeaders(imap, id) {
    if (!id) return {};
    const { folder, uid } = fromId(id);
    await imap.cmd("EXAMINE " + quote(folder));
    const f = parseFetch((await imap.cmd("UID FETCH " + uid + " (UID BODY.PEEK[HEADER.FIELDS (MESSAGE-ID REFERENCES)])")).untagged)[0];
    const h = f ? headers(f.data.toString("latin1")) : {};
    return { inReplyTo: h["message-id"] || null, references: h.references || null };
  }

  async draft(a) {
    const to = checkAddresses(cleanList(a.to), "para"), cc = checkAddresses(cleanList(a.cc), "copia");
    return this.withImap(async (imap) => {
      const reply = await this.replyHeaders(imap, a.reply_to_id);
      const box = await imap.special("drafts", ["[Gmail]/Drafts", "[Gmail]/Borradores", "Drafts", "Borradores", "INBOX.Drafts"]);
      if (!box) throw Error("No encuentro la carpeta de borradores de este buzón.");
      const raw = composeMessage({ from: this.s.email, fromName: this.s.name, to, cc, subject: a.subject, body: a.body, draft: true, ...reply });
      const bytes = Buffer.from(raw, "utf8");
      await imap.cmd("APPEND " + quote(box) + " (\\Draft \\Seen) {" + bytes.length + "}", { literal: bytes });
      return { saved: true, folder: box, to, cc, subject: a.subject, aviso: "Borrador guardado en «" + box + "». No ha salido de tu cuenta." };
    });
  }

  async send(a) {
    const to = checkAddresses(cleanList(a.to), "para"), cc = checkAddresses(cleanList(a.cc), "copia"), bcc = checkAddresses(cleanList(a.bcc), "copia oculta");
    if (!to.length) throw Error("Falta a quién va el correo.");
    let reply = {};
    if (a.reply_to_id) reply = await this.withImap((imap) => this.replyHeaders(imap, a.reply_to_id));
    const raw = composeMessage({ from: this.s.email, fromName: this.s.name, to, cc, subject: a.subject, body: a.body, ...reply });
    await this.withSmtp(async (smtp) => {
      await smtp.expect("MAIL FROM:<" + this.s.email + ">", [250]);
      for (const r of [...to, ...cc, ...bcc]) await smtp.expect("RCPT TO:<" + r + ">", [250, 251]);
      await smtp.expect("DATA", [354]);
      await smtp.sock.write(raw.replace(/\r\n\./g, "\r\n..") + "\r\n.\r\n");
      await smtp.expect(null, [250]);
    });
    // Gmail keeps a copy in «Enviados» by itself; elsewhere Colmena saves it there.
    if (this.s.provider !== "gmail") {
      await this.withImap(async (imap) => {
        const box = await imap.special("sent", ["Sent", "Enviados", "INBOX.Sent", "Sent Messages"]);
        if (box) { const b = Buffer.from(raw, "utf8"); await imap.cmd("APPEND " + quote(box) + " (\\Seen) {" + b.length + "}", { literal: b }); }
      }).catch(() => {});
    }
    return { sent: true, to, cc, bcc, subject: a.subject };
  }

  async move(id, folder) {
    const { folder: from, uid } = fromId(id);
    const target = String(folder || "").trim();
    if (!target) throw Error("Falta la carpeta de destino.");
    return this.withImap(async (imap) => {
      await imap.cmd("SELECT " + quote(from));
      if (imap.caps.has("MOVE")) await imap.cmd("UID MOVE " + uid + " " + quote(target));
      else { await imap.cmd("UID COPY " + uid + " " + quote(target)); await imap.cmd("UID STORE " + uid + " +FLAGS.SILENT (\\Deleted)"); if (imap.caps.has("UIDPLUS")) await imap.cmd("UID EXPUNGE " + uid); }
      return { moved: true, folder: target };
    });
  }

  async label(id, label) {
    const { folder, uid } = fromId(id);
    return this.withImap(async (imap) => {
      if (!imap.gmail) throw Error("Las etiquetas solo existen en Gmail: usa move_message.");
      await imap.cmd("SELECT " + quote(folder));
      await imap.cmd("UID STORE " + uid + " +X-GM-LABELS (" + quote(String(label).slice(0, 100)) + ")");
      return { labeled: true, label };
    });
  }

  async markRead(id, read) {
    const { folder, uid } = fromId(id);
    return this.withImap(async (imap) => {
      await imap.cmd("SELECT " + quote(folder));
      await imap.cmd("UID STORE " + uid + " " + (read ? "+" : "-") + "FLAGS.SILENT (\\Seen)");
      return { read };
    });
  }
}
