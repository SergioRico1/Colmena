import { id, now } from "./store.mjs";

// Usage accounting per call plus a monthly aggregate so the limit check is O(1).
export const LIMIT_CODE = "COLMENA_MONTHLY_LIMIT";

export function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

export function tokensOf(usage) {
  if (!usage || typeof usage !== "object") return { input: 0, output: 0, total: 0, cached: 0, reasoning: 0 };
  const input = Number(usage.input_tokens ?? usage.prompt_tokens) || 0;
  const output = Number(usage.output_tokens ?? usage.completion_tokens) || 0;
  const total = Number(usage.total_tokens) || input + output;
  // Prompt cache hits and hidden reasoning: what makes a round fast (or slow).
  const cached = Number(usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens) || 0;
  const reasoning = Number(usage.output_tokens_details?.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens) || 0;
  return { input, output, total, cached, reasoning };
}

/** Records one provider call. `tokens` may be a number or a Responses `usage` object. */
export function record(store, { missionId = null, botId = null, stepId = null, tokens, usage, ms = null, model = null, effort = null, transport = null, timing = null, purpose = null, tools = null } = {}) {
  const t =
    typeof tokens === "number"
      ? { input: 0, output: 0, total: Math.max(0, tokens), cached: 0, reasoning: 0 }
      : tokensOf(tokens || usage);
  if (!t.total) return null;
  const month = monthKey();
  const entry = store.put("usage", {
    id: id(),
    missionId,
    botId,
    ...(stepId ? { stepId } : {}),
    month,
    tokens: t.total,
    input: t.input,
    output: t.output,
    cached: t.cached,
    reasoning: t.reasoning,
    ...(ms != null ? { ms: Math.round(ms) } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    // sse | ws | ws-continued: how the request travelled (diagnostics of the warm sockets).
    ...(transport ? { transport } : {}),
    // Speed diagnostics: first event / first word after the request left (ms), what the call
    // was for (a bot's step, or a side task: title, narration…) and how many tools went with it.
    ...(timing?.firstEventMs != null ? { firstEventMs: Math.round(timing.firstEventMs) } : {}),
    ...(timing?.firstTokenMs != null ? { firstTokenMs: Math.round(timing.firstTokenMs) } : {}),
    ...(purpose ? { purpose } : {}),
    ...(tools != null ? { tools } : {}),
    at: now(),
  });
  const aggregate = store.get("usageMonths", month) || { id: month, tokens: 0, warned80: false };
  store.put("usageMonths", { ...aggregate, tokens: aggregate.tokens + t.total, updatedAt: now() });
  return entry;
}

/** What one bot turn cost: tokens and how much of the input came from the prompt cache. */
export function stepUsage(store, stepId) {
  const rows = store.list("usage").filter((u) => u.stepId === stepId);
  const input = rows.reduce((n, u) => n + (u.input || 0), 0);
  const cached = rows.reduce((n, u) => n + (u.cached || 0), 0);
  return { tokens: rows.reduce((n, u) => n + (u.tokens || 0), 0), calls: rows.length, cachedPercent: input ? Math.round((cached / input) * 100) : null };
}

export function monthTokens(store, month = monthKey()) {
  return store.get("usageMonths", month)?.tokens || 0;
}

export function usageSummary(store) {
  const limits = store.get("settings", "main")?.limits || {};
  const used = monthTokens(store);
  const limit = Number(limits.monthlyTokens) > 0 ? Number(limits.monthlyTokens) : null;
  return {
    monthTokens: used,
    limitTokens: limit,
    percent: limit ? Math.min(100, Math.round((used / limit) * 100)) : null,
  };
}

/** Throws before a provider call when the workspace monthly cap is reached and pausing is on. */
export function checkLimit(store) {
  const limits = store.get("settings", "main")?.limits;
  if (!limits || !(Number(limits.monthlyTokens) > 0) || !limits.pauseAtLimit) return;
  if (monthTokens(store) >= Number(limits.monthlyTokens)) {
    const error = Error("Se ha alcanzado el límite mensual del espacio.");
    error.code = LIMIT_CODE;
    throw error;
  }
}

/** Returns true once per month when usage crosses 80 % and the warning is enabled. */
export function crossedWarning(store) {
  const limits = store.get("settings", "main")?.limits;
  if (!limits?.warnAt80 || !(Number(limits.monthlyTokens) > 0)) return false;
  const month = monthKey();
  const aggregate = store.get("usageMonths", month);
  if (!aggregate || aggregate.warned80) return false;
  if (aggregate.tokens < Number(limits.monthlyTokens) * 0.8) return false;
  store.patch("usageMonths", month, { warned80: true });
  return true;
}

// ── «Uso de los últimos 30 días» (OpenClaw usage dashboard): per day, per bot and per room,
// with a CSV export. Days are local calendar days of this computer.
const dayOf = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function usageHistory(store, { days = 30, now = new Date() } = {}) {
  const span = Math.max(1, Math.min(90, Math.round(days)));
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (span - 1));
  const keys = Array.from({ length: span }, (_, i) => dayOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
  const byDay = new Map(keys.map((k) => [k, { date: k, tokens: 0, calls: 0 }]));
  const byBot = new Map();
  const byRoom = new Map();
  const rows = [];
  let total = 0, calls = 0;
  for (const u of store.list("usage")) {
    if (!u.at || Date.parse(u.at) < start.getTime()) continue;
    const day = byDay.get(dayOf(u.at));
    if (!day) continue;
    const tokens = u.tokens || 0;
    day.tokens += tokens; day.calls += 1; total += tokens; calls += 1;
    const bot = u.botId || "atlas";
    const b = byBot.get(bot) || { botId: bot, tokens: 0, calls: 0 };
    b.tokens += tokens; b.calls += 1; byBot.set(bot, b);
    if (u.missionId) {
      const r = byRoom.get(u.missionId) || { missionId: u.missionId, tokens: 0, calls: 0 };
      r.tokens += tokens; r.calls += 1; byRoom.set(u.missionId, r);
    }
    rows.push({ date: day.date, botId: bot, missionId: u.missionId || null, tokens, model: u.model || "" });
  }
  const top = (map) => [...map.values()].sort((a, b) => b.tokens - a.tokens);
  return { from: keys[0], to: keys.at(-1), total, calls, days: [...byDay.values()], bots: top(byBot), rooms: top(byRoom), rows };
}

/** One CSV cell: quoted, and a leading = + - @ (a spreadsheet formula) neutralised with '. */
export function csvCell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\n\r,]/.test(s) || s !== String(value ?? "") ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Day × bot × room × model, tokens and calls; «;» separated (what Excel in Spanish opens). */
export function usageCsv(history, { botName = (id) => id, roomName = (id) => id } = {}) {
  const groups = new Map();
  for (const r of history.rows) {
    const key = [r.date, r.botId, r.missionId || "", r.model].join("\u0000");
    const g = groups.get(key) || { ...r, tokens: 0, calls: 0 };
    g.tokens += r.tokens; g.calls += 1; groups.set(key, g);
  }
  const lines = [["Fecha", "Bot", "Sala o conversación", "Modelo", "Tokens", "Llamadas"].join(";")];
  for (const g of [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || b.tokens - a.tokens))
    lines.push([g.date, botName(g.botId), g.missionId ? roomName(g.missionId) : "", g.model, g.tokens, g.calls].map(csvCell).join(";"));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
