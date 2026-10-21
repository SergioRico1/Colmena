// Provider usage limits (T3 Code usageLimits / UsageLimitRecoveryWorker, ideas only): which
// limit a 429 is, when it renews, and the Spanish line the person reads. A limit that renews
// within RATE_MAX_MS is a short rate limit and is simply retried; anything longer (the 5-hour
// or weekly window of a plan, an exhausted quota) pauses that engine until it renews.

export const PROVIDER_LIMIT_CODE = "COLMENA_PROVIDER_LIMITED";
/** A 429 that clears in under 90 s is a rate limit (retried in place), not a usage limit. */
export const RATE_MAX_MS = 90_000;
/** Unknown renewal: look again after this long (then the next attempt reports a new time). */
export const UNKNOWN_RESET_MS = 20 * 60_000;
const MAX_MS = 40 * 86400_000;

const ENGINE_NAME = { openai: "ChatGPT", anthropic: "Claude", "opencode-go": "OpenCode Go" };
export const engineName = (engine) => ENGINE_NAME[engine] || "La IA";

const headerOf = (headers, name) => {
  if (!headers) return null;
  const value = typeof headers.get === "function" ? headers.get(name) : headers[name] ?? headers[name.toLowerCase()];
  return value === undefined || value === null || value === "" ? null : String(value);
};

/** The response headers that describe limits, as a plain object kept on the error. */
export function limitHeaders(headers) {
  const out = {};
  if (!headers) return out;
  const entries = typeof headers.entries === "function" ? [...headers.entries()] : Object.entries(headers);
  for (const [k, v] of entries) {
    const name = String(k).toLowerCase();
    if (/^(retry-after(-ms)?|x-ratelimit-|anthropic-ratelimit-|x-codex-)/.test(name)) out[name] = String(v).slice(0, 200);
  }
  return out;
}

/** «6m0s», «1h2m3s», «250ms», «20s» → ms (OpenAI x-ratelimit-reset-* and gateway texts). */
export function durationMs(text) {
  const s = String(text || "").trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 1000;
  const re = /(\d+(?:\.\d+)?)\s*(ms|h|m|s)/g;
  let total = 0, found = false, m;
  while ((m = re.exec(s))) {
    found = true;
    total += Number(m[1]) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[m[2]];
  }
  return found ? total : null;
}

/** An epoch in seconds or milliseconds, or an ISO / HTTP date → ms since 1970. */
function instantOf(value) {
  if (value === null || value === undefined || value === "") return null;
  if (/^\d{9,13}(\.\d+)?$/.test(String(value).trim())) {
    const n = Number(value);
    return n < 1e12 ? n * 1000 : n;
  }
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}

/**
 * When the limit renews according to the response headers: Retry-After, Anthropic's
 * unified/requests/tokens resets, OpenAI's x-ratelimit-reset-*, and the ChatGPT plan windows
 * that are exhausted (x-codex-*-used-percent ≥ 100). The latest one wins: every exhausted
 * window must renew before work can go on.
 */
export function resetFromHeaders(headers, at = Date.now()) {
  if (!headers) return null;
  const times = [];
  const ms = Number(headerOf(headers, "retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) times.push(at + ms);
  const after = headerOf(headers, "retry-after");
  if (after) times.push(/^\d+(\.\d+)?$/.test(after.trim()) ? at + Number(after) * 1000 : instantOf(after));
  for (const name of ["anthropic-ratelimit-unified-reset", "anthropic-ratelimit-unified-5h-reset", "anthropic-ratelimit-unified-7d-reset", "anthropic-ratelimit-requests-reset", "anthropic-ratelimit-tokens-reset", "anthropic-ratelimit-input-tokens-reset", "anthropic-ratelimit-output-tokens-reset"]) {
    const status = headerOf(headers, name.replace(/-reset$/, "-status"));
    if (/-(5h|7d)-reset$/.test(name) && status && status !== "rejected") continue;
    const t = instantOf(headerOf(headers, name));
    if (t) times.push(t);
  }
  for (const name of ["x-ratelimit-reset-requests", "x-ratelimit-reset-tokens", "x-ratelimit-reset"]) {
    const raw = headerOf(headers, name);
    if (!raw) continue;
    const t = /^\d{9,13}$/.test(raw.trim()) ? instantOf(raw) : durationMs(raw) !== null ? at + durationMs(raw) : null;
    if (t) times.push(t);
  }
  for (const w of ["primary", "secondary"]) {
    const used = Number(headerOf(headers, `x-codex-${w}-used-percent`));
    const secs = Number(headerOf(headers, `x-codex-${w}-reset-after-seconds`));
    if (Number.isFinite(used) && used >= 100 && Number.isFinite(secs) && secs >= 0) times.push(at + secs * 1000);
  }
  const valid = times.filter((t) => Number.isFinite(t) && t > at - 60_000 && t < at + MAX_MS);
  return valid.length ? Math.max(...valid) : null;
}

/** «resets 3pm», «resets at 15:40» → the next time it is that hour (local time of this PC). */
function nextClock(hour, minute, meridiem, at) {
  let h = Number(hour);
  if (meridiem) h = (h % 12) + (/p/i.test(meridiem) ? 12 : 0);
  if (!(h >= 0 && h < 24) || !(minute >= 0 && minute < 60)) return null;
  const d = new Date(at);
  d.setHours(h, minute, 0, 0);
  if (d.getTime() <= at) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * When the limit renews according to the error body or message: ChatGPT's
 * {error:{type:"usage_limit_reached", resets_at, resets_in_seconds}}, Claude Code's
 * «Claude AI usage limit reached|<epoch>», «resets 3pm», «(reset after 1h2m3s)»,
 * «try again in 2 hours».
 */
export function resetFromText(detail, at = Date.now()) {
  const text = String(detail || "");
  if (!text) return null;
  try {
    const body = JSON.parse(text);
    const e = body?.error && typeof body.error === "object" ? body.error : body;
    const resetsAt = instantOf(e?.resets_at ?? e?.reset_at ?? e?.resetsAt);
    if (resetsAt) return resetsAt;
    const secs = Number(e?.resets_in_seconds ?? e?.reset_in_seconds ?? e?.retry_after);
    if (Number.isFinite(secs) && secs > 0) return at + secs * 1000;
  } catch {}
  let m = /"resets?_at"\s*:\s*"?(\d{9,13})/.exec(text) || /limit reached\|(\d{9,13})/i.exec(text);
  if (m) return instantOf(m[1]);
  m = /"resets?_in_seconds"\s*:\s*(\d+)/.exec(text);
  if (m) return at + Number(m[1]) * 1000;
  m = /reset(?:s)? after ((?:\d+\s*[hms]\s*)+)/i.exec(text) || /(?:try again|retry|resets?|renews?) in ((?:\d+\s*(?:h|m|s|ms)\b\s*)+)/i.exec(text);
  if (m && durationMs(m[1]) !== null) return at + durationMs(m[1]);
  m = /(?:try again|retry|resets?|renews?) in (\d+)\s*(hours?|minutes?|seconds?|days?)/i.exec(text);
  if (m) return at + Number(m[1]) * { h: 3_600_000, m: 60_000, s: 1000, d: 86_400_000 }[m[2][0].toLowerCase()];
  m = /resets?(?: at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (m && (m[2] || m[3])) return nextClock(m[1], Number(m[2] || 0), m[3], at);
  return null;
}

/** Which window ran out, in words: «de 5 horas», «semanal», or null when not said. */
function windowOf(error) {
  const h = error?.headers;
  const claim = headerOf(h, "anthropic-ratelimit-unified-representative-claim") || "";
  if (/five_hour|5h/.test(claim) || headerOf(h, "anthropic-ratelimit-unified-5h-status") === "rejected") return "de 5 horas";
  if (/seven_day|7d|week/.test(claim) || headerOf(h, "anthropic-ratelimit-unified-7d-status") === "rejected") return "semanal";
  for (const w of ["secondary", "primary"]) {
    if (Number(headerOf(h, `x-codex-${w}-used-percent`)) >= 100) {
      const minutes = Number(headerOf(h, `x-codex-${w}-window-minutes`));
      if (minutes >= 7 * 1440 - 60) return "semanal";
      if (minutes >= 1380 && minutes <= 1500) return "diario";
      if (minutes >= 60) return "de " + Math.round(minutes / 60) + " horas";
    }
  }
  const text = String(error?.detail || "") + " " + String(error?.message || "");
  if (/5[- ]?hour|five.hour|5h\b/i.test(text)) return "de 5 horas";
  if (/weekly|7[- ]?day|seven.day|semanal/i.test(text)) return "semanal";
  if (/daily|per day|diari/i.test(text)) return "diario";
  return null;
}

const USAGE_WORDS = /usage[_ ]limit|usage_not_included|limit reached|insufficient_quota|quota|exceeded your current|plan limit|hit your limit|out of (credits|usage)|monthly limit|weekly limit|subscription/i;

/**
 * {kind, window, resetsAt, label} for a provider error that is a limit, else null.
 * kind 'usage': the plan or quota ran out (the engine rests until resetsAt);
 * kind 'rate': a short per-minute limit that clears by itself (retry in place).
 */
export function usageLimitOf(error, { at = Date.now() } = {}) {
  if (!error || typeof error !== "object") return null;
  if (error.limit && typeof error.limit === "object" && error.limit.kind) return error.limit;
  const detail = String(error.detail || "");
  const said = detail + " " + String(error.providerCode || "") + " " + String(error.message || "");
  const is429 = error.status === 429 || /usage_limit_reached|rate_limit_exceeded|usage_not_included/.test(String(error.providerCode || ""));
  if (!is429 && !(error.status === 402 && USAGE_WORDS.test(said))) return null;
  const reset = resetFromHeaders(error.headers, at) ?? resetFromText(detail, at) ?? resetFromText(error.message, at);
  const words = USAGE_WORDS.test(said);
  const far = reset !== null && reset - at >= RATE_MAX_MS;
  const window = windowOf(error);
  const kind = words || far || window || error.status === 402 ? "usage" : "rate";
  const label = kind === "rate" ? "límite de peticiones por minuto" : window ? "límite " + window : "límite de uso";
  return { kind, window, label, resetsAt: reset ? new Date(reset).toISOString() : null };
}

/** «hoy a las 15:40», «mañana a las 9:05», «el jueves a las 10:00». */
export function whenText(iso, at = Date.now()) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return null;
  const d = new Date(t), now = new Date(at);
  const hm = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
  if (days <= 0) return t - at < 3_600_000 ? "en " + Math.max(1, Math.ceil((t - at) / 60_000)) + " min" : "hoy a las " + hm;
  if (days === 1) return "mañana a las " + hm;
  if (days < 7) return "el " + d.toLocaleDateString("es-ES", { weekday: "long" }) + " a las " + hm;
  return "el " + d.toLocaleDateString("es-ES", { day: "numeric", month: "long" }) + " a las " + hm;
}

/** The paused mission's line: what ran out, when it renews, and that it goes on by itself. */
export function limitMessage(engine, limit, at = Date.now()) {
  const when = limit?.resetsAt ? whenText(limit.resetsAt, at) : null;
  return `${engineName(engine)} ha llegado a su ${limit?.label || "límite de uso"}. ` +
    (when ? `Se renueva ${when} y el trabajo seguirá entonces por su cuenta. ` : "Se volverá a intentar por su cuenta dentro de un rato. ") +
    "Para seguir antes, elige otra IA en Ajustes › Inteligencia › «Si falla, usar».";
}

/** The error a limited call ends with (no fallback): pauses the mission until renewal. */
export function limitError(engine, limit, cause = null) {
  return Object.assign(Error(limitMessage(engine, limit)), { code: PROVIDER_LIMIT_CODE, engine, limit, cause, status: 429 });
}
