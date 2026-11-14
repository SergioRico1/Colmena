// Link previews of team messages (docs/CLOUD.md › Phase 2 › Messages), fetched by the server with
// SSRF protection: only http(s) on the default ports, no credentials in the URL, no host that is or
// resolves to a private, loopback, link-local, shared or multicast address (checked for every
// redirect hop, at most 3), a time limit and a size limit, HTML only. Uses `fetch`, so it runs in
// workerd and in Node; `resolve(host)` → [addresses] is DNS over HTTPS by default.

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 4000;
const MAX_REDIRECTS = 3;

/** IPv4 dotted quad → its four numbers, or null. */
function v4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const n = m.slice(1).map(Number);
  return n.every((x) => x <= 255) ? n : null;
}
/** A private, loopback, link-local, CGNAT, documentation, benchmark, multicast or reserved address. */
export function privateAddress(address) {
  const a = String(address || "").toLowerCase().replace(/^\[|\]$/g, "");
  const q = v4(a);
  if (q) {
    const [x, y] = q;
    return x === 0 || x === 10 || x === 127 || x >= 224 || (x === 100 && y >= 64 && y <= 127) || (x === 169 && y === 254) ||
      (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 192 && y === 0 && q[2] === 0) ||
      (x === 192 && y === 0 && q[2] === 2) || (x === 198 && (y === 18 || y === 19)) || (x === 198 && y === 51 && q[2] === 100) || (x === 203 && y === 0 && q[2] === 113);
  }
  if (!a.includes(":")) return false;
  if (a === "::" || a === "::1") return true;
  // IPv4-mapped / -compatible: judge the IPv4 inside.
  const mapped = /^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) return privateAddress(mapped[1]);
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(a)) {
    const [hi, lo] = a.slice(7).split(":").map((h) => parseInt(h, 16));
    return privateAddress([hi >> 8, hi & 255, lo >> 8, lo & 255].join("."));
  }
  const first = parseInt(a.split(":")[0] || "0", 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || a.startsWith("64:ff9b:") || a.startsWith("2001:db8:") || a.startsWith("100::");
}

/** DNS over HTTPS (Cloudflare's resolver): every A and AAAA address of `host`. */
export async function dohResolve(host, { fetchImpl = fetch, timeoutMs = 2000 } = {}) {
  const out = [];
  for (const type of ["A", "AAAA"]) {
    const r = await fetchImpl("https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent(host) + "&type=" + type, { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw Error("dns " + r.status);
    const data = await r.json();
    for (const answer of data.Answer || []) if (answer.type === 1 || answer.type === 28) out.push(String(answer.data));
  }
  return out;
}

/** The URL if a preview may be fetched from it (scheme, port, credentials, literal addresses), else null. */
export function previewable(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  if (url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) return null;
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".") && !host.includes(":")) return null;
  if ((v4(host) || host.startsWith("[")) && privateAddress(host)) return null;
  return url;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
const decode = (s) => String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ENTITIES[e.toLowerCase()] ?? m;
});
const clean = (s, max) => decode(s).replace(/\s+/g, " ").trim().slice(0, max);

/** Title, description and site name from an HTML head (Open Graph first, then <title> / meta description). */
export function parsePreview(html, url) {
  const head = String(html).slice(0, MAX_BYTES);
  const meta = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const key = /\b(?:property|name)\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase();
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (key && content && !(key in meta)) meta[key] = content[1] ?? content[2] ?? content[3] ?? "";
  }
  const title = clean(meta["og:title"] || meta["twitter:title"] || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] || "", 200);
  const description = clean(meta["og:description"] || meta["twitter:description"] || meta.description || "", 300);
  const site = clean(meta["og:site_name"] || "", 80) || new URL(url).hostname.replace(/^www\./, "");
  if (!title && !description) return null;
  return { url: String(url), title, description, site };
}

async function readLimited(response, max) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.byteLength;
    if (size >= max) { try { await reader.cancel(); } catch {} break; }
  }
  const all = new Uint8Array(Math.min(size, max));
  let at = 0;
  for (const p of parts) { const take = Math.min(p.byteLength, all.byteLength - at); all.set(p.subarray(0, take), at); at += take; if (at >= all.byteLength) break; }
  return new TextDecoder("utf-8", { fatal: false }).decode(all);
}

/**
 * The preview of `raw` ({url, title, description, site}) or null. Never throws for a bad page.
 * `resolve(host)` → addresses (default DNS over HTTPS); `fetchImpl` for tests.
 */
export async function fetchPreview(raw, { fetchImpl = fetch, resolve = (host) => dohResolve(host, { fetchImpl }), timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES } = {}) {
  let url = previewable(raw);
  if (!url) return null;
  const deadline = AbortSignal.timeout(timeoutMs);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const host = url.hostname.replace(/^\[|\]$/g, "");
      if (!v4(host) && !host.includes(":")) {
        const addresses = await resolve(host);
        if (!addresses.length || addresses.some(privateAddress)) return null;
      }
      const response = await fetchImpl(url.href, { redirect: "manual", signal: deadline, headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "ColmenaBot/1.0 (link preview)" } });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get("Location");
        try { await response.body?.cancel(); } catch {}
        url = next ? previewable(new URL(next, url).href) : null;
        if (!url) return null;
        continue;
      }
      if (!response.ok) return null;
      const type = response.headers.get("Content-Type") || "";
      if (!/text\/html|application\/xhtml\+xml/i.test(type)) { try { await response.body?.cancel(); } catch {} return null; }
      const length = Number(response.headers.get("Content-Length") || 0);
      if (length > maxBytes * 8) { try { await response.body?.cancel(); } catch {} return null; }
      return parsePreview(await readLimited(response, maxBytes), url);
    }
  } catch {
    return null;
  }
  return null;
}

/** The first previewable link of a message's stored text (Slack-style `<url|label>` or a bare URL). */
export function firstLink(text) {
  const s = String(text || "");
  const marked = /<(https?:\/\/[^|>\s]+)(?:\|[^>]*)?>/i.exec(s)?.[1];
  const bare = /(?:^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/i.exec(s.replace(/<[^>]*>/g, " "))?.[1];
  const found = marked || bare;
  return found && previewable(found) ? found.replace(/&amp;/g, "&") : null;
}
