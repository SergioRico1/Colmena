// Keys, tokens and passwords pasted into a message you sent (DeepSeek Harness ui-secret-mask,
// simplified): found in one linear pass, drawn masked (first characters, then •) until you
// ask to see them. Pure, so the tests and the people chats share it.
//
// Two ways to be one: a known format anywhere (sk-…, ghp_…, AKIA…, xox…-, a JWT, a private key
// block, the password of an address), or a long enough value right after a word that names
// it («contraseña: …», «el token es …», «api key = …»). Every run is a character class that
// ends where the class ends, so nothing backtracks.

const RUN = "(?![A-Za-z0-9_-])";
const FORMATS = [
  ["anthropic", "sk-ant-[A-Za-z0-9_-]{20,}" + RUN],
  ["openai", "sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}" + RUN],
  ["stripe", "[sr]k_(?:live|test)_[A-Za-z0-9]{16,}" + RUN],
  ["github", "(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})" + RUN],
  ["gitlab", "glpat-[A-Za-z0-9_-]{20,}" + RUN],
  ["aws", "(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Za-z])"],
  ["slack", "xox[abposre]-[A-Za-z0-9-]{10,}" + RUN],
  ["google", "AIza[0-9A-Za-z_-]{35}" + RUN],
  ["huggingface", "hf_[A-Za-z0-9]{30,}" + RUN],
  ["npm", "npm_[A-Za-z0-9]{36}" + RUN],
  ["jwt", "eyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}" + RUN],
  ["privatekey", "-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----[\\s\\S]{1,10000}?-----END [A-Z ]{0,40}PRIVATE KEY-----"],
];
// A format starts where no key character comes before it.
const FORMAT_RE = new RegExp("(?<![A-Za-z0-9_-])(?:" + FORMATS.map(([kind, source]) => `(?<${kind}>${source})`).join("|") + ")", "g");
// «https://ana:s3creto@host»: only the password part.
const ADDRESS_RE = /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s/:@]{1,64}:([^\s/@]{1,128})@([^\s/:?#]{1,253})/gi;
const PASSWORD_WORDS = /^(?:contraseñas?|password|passwd|pwd|pass|clave|claves|pin)$/i;
const WORD_RE = /(?<![\p{L}\d_])(contraseñas?|passwords?|passwd|pwd|pass|clave|claves|token|tokens|secret[oa]?|api[ _-]?keys?|apikey|llave|bearer)(?![\p{L}\d_])/giu;
const FILLER = /^[\p{Ll}]{1,10}$/u; // «es», «del», «wifi»: words between the name and the value

export const SUGGEST = {
  anthropic: { name: "ANTHROPIC_API_KEY", hosts: ["api.anthropic.com"] },
  openai: { name: "OPENAI_API_KEY", hosts: ["api.openai.com"] },
  stripe: { name: "STRIPE_SECRET_KEY", hosts: ["api.stripe.com"] },
  github: { name: "GITHUB_TOKEN", hosts: ["api.github.com"] },
  gitlab: { name: "GITLAB_TOKEN", hosts: ["gitlab.com"] },
  aws: { name: "AWS_ACCESS_KEY_ID", hosts: ["amazonaws.com"] },
  slack: { name: "SLACK_TOKEN", hosts: ["slack.com"] },
  google: { name: "GOOGLE_API_KEY", hosts: ["googleapis.com"] },
  huggingface: { name: "HF_TOKEN", hosts: ["huggingface.co"] },
  npm: { name: "NPM_TOKEN", hosts: ["registry.npmjs.org"] },
  jwt: { name: "API_TOKEN", hosts: [] },
  token: { name: "API_TOKEN", hosts: [] },
  password: { name: "PASSWORD", hosts: [] },
  address: { name: "PASSWORD", hosts: [] },
};

/** Bits per character: a random token has many, a word few. */
export function entropy(value) {
  const s = String(value || "");
  if (!s) return 0;
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  let bits = 0;
  for (const n of counts.values()) bits -= (n / s.length) * Math.log2(n / s.length);
  return bits;
}

function strongEnough(value, password) {
  const v = value;
  if (v.length > 512 || /^https?:/i.test(v) || /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v)) return false;
  const digit = /\d/.test(v), upper = /[A-Z]/.test(v), lower = /[a-z]/.test(v), symbol = /[^A-Za-z0-9]/.test(v);
  if (password) return v.length >= 6 && (digit || symbol || (upper && lower)) && (upper || lower || symbol);
  return v.length >= 16 && (upper || lower) && digit && entropy(v) >= 3;
}

/** The value after a word that names a secret, on the same line: [start, end] or null. */
function valueAfter(text, from, password) {
  const lineEnd = text.indexOf("\n", from);
  const stop = Math.min(lineEnd < 0 ? text.length : lineEnd, from + 120);
  const tokens = /[^\s"'`«»]+/g;
  tokens.lastIndex = from;
  for (let i = 0; i < 5; i++) {
    const m = tokens.exec(text);
    if (!m || m.index >= stop) return null;
    let start = m.index, end = m.index + m[0].length;
    while (start < end && ":=".includes(text[start])) start++;
    while (end > start && ".,;:)".includes(text[end - 1])) end--;
    if (start === end) continue;
    const value = text.slice(start, end);
    if (strongEnough(value, password)) return [start, end];
    if (!FILLER.test(value)) return null;
  }
  return null;
}

/**
 * Secrets in `text`: [{start, end, kind, value}], in order and never overlapping. `kind` is
 * a format («openai», «github»…), «password», «token» or «address» (an address's password).
 */
export function findSecrets(text) {
  const s = String(text || "");
  if (s.length < 6) return [];
  const found = [];
  FORMAT_RE.lastIndex = 0;
  for (let m; (m = FORMAT_RE.exec(s)); ) {
    const kind = Object.keys(m.groups).find((k) => m.groups[k] !== undefined);
    found.push({ start: m.index, end: m.index + m[0].length, kind });
  }
  ADDRESS_RE.lastIndex = 0;
  for (let m; (m = ADDRESS_RE.exec(s)); ) {
    const start = m.index + m[0].length - 1 - m[2].length - m[1].length;
    if (m[1].length >= 3) found.push({ start, end: start + m[1].length, kind: "address", host: m[2] });
  }
  WORD_RE.lastIndex = 0;
  for (let m; (m = WORD_RE.exec(s)); ) {
    const password = PASSWORD_WORDS.test(m[1]);
    const at = valueAfter(s, m.index + m[0].length, password);
    if (at) found.push({ start: at[0], end: at[1], kind: password ? "password" : "token" });
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  for (const f of found) {
    if (out.length && f.start < out.at(-1).end) continue;
    out.push({ ...f, value: s.slice(f.start, f.end) });
  }
  return out;
}

/** «sk-proj-•••••…»: the first 8 characters (never more than half), the rest as •. */
export function maskSecret(value, { visible = 8, max = 32 } = {}) {
  const v = String(value || "");
  const keep = Math.min(visible, Math.floor(v.length / 2));
  return v.slice(0, keep) + "•".repeat(Math.max(1, Math.min(v.length - keep, max)));
}

/** The text cut into plain pieces and secrets: [{text} | {text, secret}]. */
export function secretSegments(text) {
  const s = String(text || "");
  const found = findSecrets(s);
  if (!found.length) return [{ text: s }];
  const out = [];
  let at = 0;
  for (const f of found) {
    if (f.start > at) out.push({ text: s.slice(at, f.start) });
    out.push({ text: f.value, secret: f });
    at = f.end;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}

/** What «Guardar en llaves» proposes: a name and the sites where it may be used. */
export function suggestKey(secret) {
  const base = SUGGEST[secret?.kind] || SUGGEST.token;
  return { name: base.name, hosts: secret?.host ? [secret.host] : base.hosts, savable: secret?.kind !== "privatekey" && !/[\r\n]/.test(secret?.value || "") };
}
