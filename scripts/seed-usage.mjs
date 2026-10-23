// QA only: fills an isolated data folder with 30 days of «usage» records (Ajustes › Uso).
// Usage: COLMENA_DATA_DIR=.local/qa-data node scripts/seed-usage.mjs
// Refuses to run without COLMENA_DATA_DIR, so it never touches your real Colmena.
import path from "node:path";
import { Store, id } from "../server/store.mjs";

const dir = process.env.COLMENA_DATA_DIR;
if (!dir) { console.error("Pon COLMENA_DATA_DIR (p. ej. .local/qa-data): este script no toca tus datos reales."); process.exit(1); }
const store = new Store(path.resolve(dir));
const bots = store.list("bots").map((b) => b.id);
const missions = store.list("missions").map((m) => ({ id: m.id, bot: m.botIds?.[0] || bots[0] }));
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
let n = 0;
for (const u of store.list("usage")) if (u.seeded) { store.remove("usage", u.id); }
for (let day = 29; day >= 0; day--) {
  const calls = Math.round(4 + rand() * (day < 6 ? 26 : 14));
  for (let i = 0; i < calls; i++) {
    const m = missions[Math.floor(rand() * missions.length)];
    const side = rand() < 0.25;
    const input = Math.round((side ? 1500 : 9000) + rand() * (side ? 2000 : 40000));
    const cached = Math.round(input * (side ? 0.1 : 0.35 + rand() * 0.55));
    const output = Math.round((side ? 60 : 500) + rand() * (side ? 200 : 3000));
    const at = new Date(Date.now() - day * 864e5 - rand() * 8 * 36e5).toISOString();
    store.put("usage", { id: id(), missionId: m?.id || null, botId: m?.bot || bots[0], month: at.slice(0, 7), tokens: input + output, input, output, cached, reasoning: 0, model: rand() < 0.6 ? "gpt-5.5" : "gpt-5.5-mini", purpose: side ? "side" : "step", at, seeded: true });
    n++;
  }
}
// The monthly aggregate (usage.mjs monthTokens) is what «Este mes» and the limit read.
const months = new Map();
for (const u of store.list("usage")) months.set(u.month, (months.get(u.month) || 0) + (u.tokens || 0));
for (const [month, tokens] of months) store.put("usageMonths", { ...(store.get("usageMonths", month) || { id: month, warned80: false }), tokens, updatedAt: new Date().toISOString() });
console.log(`${n} registros de uso en ${dir}`);
