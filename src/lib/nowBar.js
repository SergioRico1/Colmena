// «Qué está haciendo ahora» (components/v2/chat/NowBar.jsx): who is at work in a
// conversation and what each one is doing, and how long for. Pure helpers.

/**
 * [{ botId, verb, detail, narration, since }] from the bots' activity (liveStore:
 * [{ botId, verb, detail }]) and the mission's running steps (their narration and start).
 * When nothing says who works yet, `fallbackBotId` does (the bot of a 1:1 chat).
 */
export function workingNow(activity = [], steps = [], fallbackBotId = null) {
  const running = steps.filter((s) => s.status === "running" && s.botId);
  const ids = [...new Set([...activity.map((a) => a.botId), ...running.map((s) => s.botId)].filter(Boolean))];
  const list = ids.map((botId) => {
    const act = activity.find((a) => a.botId === botId) || null;
    const step = running.find((s) => s.botId === botId) || null;
    return { botId, verb: act?.verb || null, detail: act?.detail || "", narration: step?.narration?.text || null, since: step?.startedAt || null };
  });
  return list.length || !fallbackBotId ? list : [{ botId: fallbackBotId, verb: null, detail: "", narration: null, since: null }];
}

/** «0:42», «12:05», «1:02:10» since `since` (an ISO date); "" without one. */
export function elapsedText(since, now = Date.now()) {
  const from = Date.parse(since || "");
  if (!Number.isFinite(from)) return "";
  const s = Math.max(0, Math.floor((now - from) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** How many lines the bar shows before «y 2 más». */
export const MAX_LINES = 2;
/** «y 2 más» (null when everyone fits). */
export const moreText = (count) => (count > MAX_LINES ? `y ${count - MAX_LINES} más` : null);
