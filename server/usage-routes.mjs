// Ajustes › Uso (T3 Code's usage page, ideas only): what each bot and each chat or room spent,
// how much of the input came from the model's prompt cache, and the limits of each plan.
//   GET /api/usage/overview?days=30
//     {from, to, days, total: {tokens, input, cached, output, reasoning, calls, cachePercent},
//      perDay: [{date, tokens, input, cached, output}], bots: [{botId, …totals}],
//      chats: [{missionId, title, kind: chat|room, botIds, …totals}], models: [{model, …totals}],
//      purposes: [{purpose: step|side, …totals}], month: {monthTokens, limitTokens, percent},
//      plans: {openai: {primary, secondary, at} | null, engines: [{id, label, connected, limit, resting}]}}
// Only reads: the «usage» records written by server/usage.mjs and the provider layer's limits.
import { usageSummary } from "./usage.mjs";

const dayOf = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const empty = () => ({ tokens: 0, input: 0, cached: 0, output: 0, reasoning: 0, calls: 0 });
const add = (into, u) => {
  into.tokens += u.tokens || 0;
  into.input += u.input || 0;
  into.cached += u.cached || 0;
  into.output += u.output || 0;
  into.reasoning += u.reasoning || 0;
  into.calls += 1;
  return into;
};
/** Share of the input that the prompt cache served, 0–100 (null with no input measured). */
export const cachePercent = (t) => (t.input > 0 ? Math.round((Math.min(t.cached, t.input) / t.input) * 100) : null);
const finish = (t) => ({ ...t, cachePercent: cachePercent(t) });
const top = (map, n = 50) => [...map.values()].map(finish).sort((a, b) => b.tokens - a.tokens).slice(0, n);

export function usageOverview(store, { days = 30, now = new Date(), provider = null, planLimits = null } = {}) {
  const span = Math.max(1, Math.min(90, Math.round(Number(days) || 30)));
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (span - 1));
  const keys = Array.from({ length: span }, (_, i) => dayOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
  const perDay = new Map(keys.map((k) => [k, { date: k, ...empty() }]));
  const bots = new Map(), chats = new Map(), models = new Map(), purposes = new Map();
  const total = empty();
  for (const u of store.list("usage")) {
    if (!u.at || Date.parse(u.at) < start.getTime()) continue;
    const day = perDay.get(dayOf(u.at));
    if (!day) continue;
    add(day, u);
    add(total, u);
    const bot = u.botId || "atlas";
    if (!bots.has(bot)) bots.set(bot, { botId: bot, ...empty() });
    add(bots.get(bot), u);
    if (u.missionId) {
      if (!chats.has(u.missionId)) chats.set(u.missionId, { missionId: u.missionId, ...empty() });
      add(chats.get(u.missionId), u);
    }
    const model = u.model || "";
    if (!models.has(model)) models.set(model, { model, ...empty() });
    add(models.get(model), u);
    const purpose = u.purpose === "side" ? "side" : "step";
    if (!purposes.has(purpose)) purposes.set(purpose, { purpose, ...empty() });
    add(purposes.get(purpose), u);
  }
  const chatList = top(chats, 40).map((c) => {
    const m = store.get("missions", c.missionId);
    return {
      ...c,
      // An incognito chat keeps its words to itself: only its cost shows.
      title: !m ? "Borrada" : m.incognito ? "Chat de incógnito" : m.conversation ? m.title || "Conversación" : "#" + (m.room || m.title || "sala"),
      kind: m ? (m.conversation ? "chat" : "room") : "gone",
      botIds: m?.botIds || [],
      incognito: !!m?.incognito,
    };
  });
  const engines = (() => { try { return provider?.engines?.() || []; } catch { return []; } })();
  return {
    from: keys[0], to: keys.at(-1), days: span,
    total: finish(total),
    perDay: [...perDay.values()].map(({ date, tokens, input, cached, output }) => ({ date, tokens, input, cached, output })),
    bots: top(bots), chats: chatList, models: top(models, 20), purposes: top(purposes),
    month: usageSummary(store),
    plans: {
      openai: planLimits || null,
      engines: engines.map((e) => ({ id: e.id, label: e.label, connected: !!e.connected, detail: e.detail || null, limit: e.limit || null, resting: !!e.resting })),
    },
  };
}

export function registerUsageRoutes(app, { store, runtime }) {
  app.get("/api/usage/overview", (req, res) => {
    res.json(usageOverview(store, { days: req.query.days, provider: runtime?.provider, planLimits: runtime?.planLimits || null }));
  });
}
