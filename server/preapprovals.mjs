// «Aprobado por adelantado»: what a routine may do at its time with nobody there
// (docs/CONNECTIONS.md «Aprobado por adelantado»). A routine (an `automations` record) keeps
// `preapprovals: [{id, label, tool, toolkit, account, recipients?, command?, uses, createdAt,
// boundMission, usedCount, lastUsedAt}]`. An entry comes from an approval the routine itself
// asked for (its card, or «Añadir» on the routine page: never something it never asked for).
//
// A key is what an approval does, without what changes each time:
//   - apps_execute: the Composio action (upper-cased slug), its toolkit and account; for a send
//     or an action that reaches people, also everyone it goes to (lower-cased addresses). A later
//     one matches only when everyone it goes to was in the saved list (a subset).
//   - run_command: the exact program, arguments and folder.
// Never eligible: money (pay, buy, charge, refund, transfer, order…), questions, plans, skills,
// soul, reverts, keys, password vaults and browser sign-ins, anything in a step that read
// injection phrases, in a turn for another person (`peerErrand`) or in incognito.
// A match counts only inside a mission of that same routine. «Solo la próxima vez» (`next`)
// binds to the first mission that uses it and never matches in a later one.
//
// Pure: no runtime, no network. `takePreapproval` writes through the store it is given.
import { randomUUID } from "node:crypto";

export const PREAPPROVE_USES = Object.freeze(["next", "always"]);
export const PREAPPROVALS_MAX = 40;

const NEVER_KINDS = new Set(["question", "plan", "skill", "soul", "revert", "secret", "read"]);
const TOOLS = new Set(["apps_execute", "run_command"]);
// Money, by the words of the action's name (and the apps where every change is money).
const MONEY_WORDS = new Set(["PAY", "PAYOUT", "CHARGE", "REFUND", "TRANSFER", "PURCHASE", "ORDER", "BUY", "CHECKOUT", "SUBSCRIBE", "RESERVE", "BOOK", "DONATE", "WITHDRAW", "DEPOSIT", "TOPUP",
  "PAYMENT", "SUBSCRIPTION", "RESERVATION", "BOOKING", "DONATION", "WITHDRAWAL", "INVOICE"]);
const MONEY_TOOLKITS = new Set(["stripe", "paypal", "square", "shopify", "woocommerce", "bigcommerce", "amazon", "ebay", "etsy", "booking", "airbnb", "expedia", "uber", "doordash", "instacart", "wise", "revolut", "coinbase", "binance", "kraken", "venmo", "klarna", "adyen", "mollie", "braintree", "gumroad", "lemonsqueezy", "paddle", "chargebee", "recurly", "razorpay", "gocardless", "plaid"]);
// Password vaults and sign-ins, in an app or on the command line.
const VAULT_TOOLKITS = /1password|onepassword|bitwarden|lastpass|dashlane|keeper|keepass|vault|passbolt|nordpass|proton_?pass/i;
const VAULT_WORDS = new Set(["PASSWORD", "PASSWORDS", "SECRET", "SECRETS", "CREDENTIAL", "CREDENTIALS", "VAULT", "LOGIN", "SIGNIN", "OTP", "TOTP", "2FA", "MFA"]);
const VAULT_PROGRAMS = new Set(["op", "bw", "lpass", "keeper", "dcli", "keepassxc-cli", "vault", "security", "cmdkey", "pass", "gopass", "secret-tool", "credwiz", "rundll32"]);

const singular = (t) => (t.length > 3 && t.endsWith("S") && !t.endsWith("SS") ? t.slice(0, -1) : t);
const tokensOf = (slug, toolkit) => {
  let name = String(slug || "").toUpperCase();
  const app = String(toolkit || "").toUpperCase();
  while (app && name.startsWith(app + "_")) name = name.slice(app.length + 1);
  return name.split(/[^A-Z0-9]+/).filter(Boolean).map(singular);
};
const programBase = (program) => String(program || "").trim().split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|com|cmd|bat)$/i, "");
const EMAIL = /[^\s<>,;"']+@[^\s<>,;"']+/;
/** Everyone an action goes to: lower-cased addresses of its recipients and guests. */
export function recipientsOf(args = {}, review = null) {
  const out = new Set();
  const add = (v) => {
    if (Array.isArray(v)) return v.forEach(add);
    if (v && typeof v === "object") return add(v.email ?? v.address ?? null);
    if (typeof v !== "string") return;
    for (const part of v.split(/[,;]/)) {
      const m = part.match(EMAIL);
      if (m) out.add(m[0].toLowerCase());
    }
  };
  for (const k of ["recipient_email", "extra_recipients", "to", "cc", "bcc", "attendees", "attendee_emails", "guests", "emails", "email"]) add(args?.[k]);
  if (review?.draft) { add(review.draft.to); add(review.draft.cc); }
  return [...out].sort();
}

/** The app action an approval runs: {slug, toolkit, account, args, review}. */
const appOf = (a) => {
  const review = a.review || {};
  let args = review.arguments;
  if (!args && typeof a.args?.arguments_json === "string") { try { args = JSON.parse(a.args.arguments_json); } catch { args = {}; } }
  return {
    slug: String(review.tool || a.args?.tool || "").toUpperCase(),
    toolkit: String(review.toolkit || a.args?.toolkit || "").toLowerCase() || null,
    account: String(review.account || review.account_id || a.args?.account || "").trim() || null,
    args: args || {}, review,
  };
};

/** The key of an approval, or null when nothing about it can be saved. */
export function keyOf(a) {
  if (!a || !TOOLS.has(a.tool)) return null;
  if (a.tool === "apps_execute") {
    const app = appOf(a);
    if (!app.slug) return null;
    const recipients = recipientsOf(app.args, app.review);
    return { tool: "apps_execute", slug: app.slug, toolkit: app.toolkit, account: app.account, ...(recipients.length || a.kind === "send" ? { recipients } : {}) };
  }
  const program = String(a.args?.program || "").trim();
  if (!program) return null;
  return { tool: "run_command", command: { program, args: (a.args?.args || []).map(String), folderId: a.args?.folderId ?? null } };
}
/** The same key in one string (dedupe). */
export const keyId = (k) => (k ? JSON.stringify(k.tool === "apps_execute" ? [k.tool, k.slug, k.toolkit, k.account, k.recipients || null] : [k.tool, k.command.program, k.command.args, k.command.folderId]) : "");

/**
 * Whether an approval may be approved ahead in its routine: {ok, reason}. `mission` is the
 * approval's mission; `flagged` whether its step read injection phrases.
 */
export function eligibility(a, { mission = null, flagged = false } = {}) {
  const no = (reason) => ({ ok: false, reason });
  if (!a) return no("No existe.");
  if (!mission?.automationId) return no("Solo se puede dejar aprobado lo que pide una rutina.");
  if (mission.incognito) return no("En un chat de incógnito no se deja nada aprobado.");
  if (mission.peerErrand) return no("Es un encargo de otra persona: siempre te pregunta.");
  if (flagged) return no("Ese paso leyó contenido que intenta dar instrucciones: decide tú cada vez.");
  if (NEVER_KINDS.has(a.kind) || !TOOLS.has(a.tool)) return no("Esto no se puede dejar aprobado por adelantado.");
  const key = keyOf(a);
  if (!key) return no("Esto no se puede dejar aprobado por adelantado.");
  if (key.tool === "apps_execute") {
    const tokens = tokensOf(key.slug, key.toolkit);
    if (tokens.some((t) => MONEY_WORDS.has(t)) || MONEY_TOOLKITS.has(key.toolkit || "")) return no("Pagar, comprar o mover dinero siempre te pregunta.");
    if (VAULT_TOOLKITS.test(key.toolkit || "") || tokens.some((t) => VAULT_WORDS.has(t)) || tokens.includes("SIGN") && tokens.includes("IN")) return no("Las contraseñas y los inicios de sesión siempre te preguntan.");
  } else {
    const base = programBase(key.command.program);
    if (VAULT_PROGRAMS.has(base)) return no("Las contraseñas y los inicios de sesión siempre te preguntan.");
  }
  return { ok: true, reason: null, key };
}

/** «Enviar correo en Gmail · ventas@…», «Ejecutar «npm run informe»»: how an entry reads. */
export function labelOf(a, key = keyOf(a)) {
  if (!key) return String(a?.title || "Una acción").slice(0, 160);
  if (key.tool === "run_command") return ("Ejecutar «" + [key.command.program, ...key.command.args].join(" ") + "»").slice(0, 200);
  const name = a.review?.name || a.title || key.slug;
  const where = [a.review?.toolkit ? String(a.review.toolkit).replace(/^\w/, (c) => c.toUpperCase()) : null, a.review?.account_alias || key.account].filter(Boolean).join(" · ");
  return (String(name) + (where ? " en " + where : "")).slice(0, 200);
}

/** A new entry from an eligible approval. */
export function entryFrom(a, { uses, at = new Date().toISOString(), id = randomUUID() } = {}) {
  if (!PREAPPROVE_USES.includes(uses)) throw Error("Elige «Solo la próxima vez» o «Siempre».");
  const key = keyOf(a);
  if (!key) throw Error("Esto no se puede dejar aprobado por adelantado.");
  return {
    id, label: labelOf(a, key), tool: key.tool,
    toolkit: key.tool === "apps_execute" ? key.toolkit : null,
    account: key.tool === "apps_execute" ? key.account : null,
    slug: key.tool === "apps_execute" ? key.slug : null,
    ...(key.recipients ? { recipients: key.recipients } : {}),
    ...(key.command ? { command: key.command } : {}),
    uses, createdAt: at, boundMission: null, usedCount: 0, lastUsedAt: null, fromApproval: a.id || null,
  };
}

/** The key a saved entry stands for. */
export const entryKey = (e) => (e.tool === "run_command" ? { tool: e.tool, command: e.command } : { tool: e.tool, slug: e.slug, toolkit: e.toolkit, account: e.account, ...(e.recipients ? { recipients: e.recipients } : {}) });
/** The list with `entry` added: one live entry per key (a spent «next» one stays as history). */
export function withEntry(list = [], entry) {
  const id = keyId(entryKey(entry));
  const kept = list.filter((x) => (x.uses === "next" && x.boundMission) || keyId(entryKey(x)) !== id);
  if (kept.length >= PREAPPROVALS_MAX) throw Object.assign(Error("Esta rutina ya tiene demasiadas cosas aprobadas por adelantado. Quita alguna antes."), { status: 409 });
  return [...kept, entry];
}

/** Whether a saved entry covers this key in this mission. */
export function matches(entry, key, missionId) {
  if (!entry || !key || entry.tool !== key.tool) return false;
  if (entry.uses === "next" && entry.boundMission && entry.boundMission !== missionId) return false;
  if (key.tool === "run_command") {
    const c = entry.command || {};
    return c.program === key.command.program && (c.folderId ?? null) === (key.command.folderId ?? null)
      && Array.isArray(c.args) && c.args.length === key.command.args.length && c.args.every((x, i) => x === key.command.args[i]);
  }
  if (entry.slug !== key.slug || (entry.toolkit || null) !== (key.toolkit || null) || (entry.account || null) !== (key.account || null)) return false;
  // Everyone it goes to must have been in the saved list (a subset: fewer people is fine).
  const saved = new Set(entry.recipients || []);
  return (key.recipients || []).every((r) => saved.has(r));
}

/** The first entry of `automation` that covers approval `a` in `mission` (eligibility included), or null. */
export function findPreapproval(automation, a, { mission, flagged = false } = {}) {
  if (!automation?.preapprovals?.length || mission?.automationId !== automation.id) return null;
  const e = eligibility(a, { mission, flagged });
  if (!e.ok) return null;
  return automation.preapprovals.find((entry) => matches(entry, e.key, mission.id)) || null;
}

/** «Aprobado por adelantado en la rutina «<nombre>»». */
export const preapprovedResolution = (name) => "Aprobado por adelantado en la rutina «" + String(name || "sin nombre").slice(0, 120) + "»";

/**
 * Uses a saved entry for approval-like `a` in `mission` when one covers it: bumps its use,
 * binds a «next» one to this mission and says so in the chat. Returns {entry, resolution} or
 * null. `step` is checked for injection flags through `flagged`.
 */
export function takePreapproval(store, a, { mission, flagged = false, botId = null } = {}) {
  const automation = mission?.automationId ? store.get("automations", mission.automationId) : null;
  const entry = findPreapproval(automation, a, { mission, flagged });
  if (!entry) return null;
  const at = new Date().toISOString();
  store.patch("automations", automation.id, (old) => ({
    preapprovals: (old.preapprovals || []).map((x) => (x.id === entry.id ? { ...x, usedCount: (x.usedCount || 0) + 1, lastUsedAt: at, ...(x.uses === "next" && !x.boundMission ? { boundMission: mission.id } : {}) } : x)),
  }));
  const resolution = preapprovedResolution(automation.name);
  store.put("messages", { id: randomUUID(), missionId: mission.id, role: "system", botId, kind: "activity", text: "«" + entry.label + "»: " + resolution.charAt(0).toLowerCase() + resolution.slice(1) + ".", at });
  return { entry, resolution };
}

/** An entry as the routine page shows it: «Usada» once a «next» one was spent. */
export function entryView(entry) {
  return {
    id: entry.id, label: entry.label, tool: entry.tool, toolkit: entry.toolkit || null, account: entry.account || null,
    recipients: entry.recipients || null, command: entry.command ? [entry.command.program, ...(entry.command.args || [])].join(" ") : null,
    uses: entry.uses, spent: entry.uses === "next" && !!entry.boundMission, usedCount: entry.usedCount || 0, lastUsedAt: entry.lastUsedAt || null, createdAt: entry.createdAt || null,
  };
}

/**
 * What «Añadir» offers: the eligible actions this routine asked for in past runs (its
 * missions' approvals), one per key, the newest first, without what is already saved.
 */
export function candidatesFor(store, automation, { flagged = () => false } = {}) {
  const saved = new Set((automation.preapprovals || []).filter((e) => !(e.uses === "next" && e.boundMission)).map((e) => keyId(entryKey(e))));
  const missions = store.where("missions", "automationId", automation.id);
  const seen = new Set();
  const out = [];
  const approvals = missions.flatMap((m) => store.where("approvals", "missionId", m.id).map((a) => ({ a, m })))
    .sort((x, y) => String(y.a.createdAt || "").localeCompare(String(x.a.createdAt || "")));
  for (const { a, m } of approvals) {
    const e = eligibility(a, { mission: m, flagged: flagged(a.stepId || stepOf(a)) });
    if (!e.ok) continue;
    const k = keyId(e.key);
    if (seen.has(k) || saved.has(k)) continue;
    seen.add(k);
    out.push({ approvalId: a.id, label: labelOf(a, e.key), recipients: e.key.recipients || null, command: e.key.command ? [e.key.command.program, ...e.key.command.args].join(" ") : null, at: a.createdAt || null });
    if (out.length >= 20) break;
  }
  return out;
}
/** An app approval's id is «<step id>:<call id>»: its step when the record does not say. */
export const stepOf = (a) => a?.stepId || (typeof a?.id === "string" && a.id.includes(":") ? a.id.slice(0, a.id.lastIndexOf(":")) : null);
