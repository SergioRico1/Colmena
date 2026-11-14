// The server behind scripts/chat-shift.cjs: the real app in dev mode (Vite middleware), with
// isolated data in a temporary folder, a short 1:1 chat with Nora and a scripted model that
// thinks for a moment, then writes a medium answer piece by piece (no AI account). A room
// with two bots is seeded too. Prints one line «SHIFT_READY {json}».
// Usage: node scripts/chat-shift-server.mjs [--think=1600] [--port=0]
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const flag = (name, def) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.split("=").slice(1).join("=") : def; };
const think = Number(flag("think", 1600));
const port = Number(flag("port", 0));
const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-shift-"));
const store = new Store(directory);
store.patch("settings", "main", { model: "gpt-5", learning: false, onboarded: true, userName: "Demo", suggestions: false });
const models = [{ slug: "gpt-5", display_name: "GPT-5" }];
const session = {
  models,
  status: () => ({ email: "demo@colmena.test", label: "Demo", canInfer: true }),
  listModels: async () => models,
  start: async () => ({}), closePending() {}, logout: async () => ({}), on() {}, emit() {},
};
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener?.("abort", () => { clearTimeout(t); reject(signal.reason); }, { once: true });
});
const reply = (text) => ({ text, usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] });
// A medium answer (a heading-free paragraph, a list, a closing line) in 10-character pieces every 70 ms.
const ANSWER = [
  "Sí: tienes **dos cosas pendientes** para esta semana.",
  "",
  "- Revisar el presupuesto de la feria antes del jueves.",
  "- Contestar a Marta sobre las fechas del viaje.",
  "",
  "Si quieres, preparo un borrador para Marta y te lo dejo aquí para que lo revises.",
].join("\n");
async function respond({ onDelta = () => {}, onEvent = () => {}, signal }) {
  await sleep(think, signal);
  onEvent({ type: "response.created" });
  for (let i = 0; i < ANSWER.length; i += 10) {
    onDelta(ANSWER.slice(i, i + 10));
    await sleep(70, signal);
  }
  return reply(ANSWER);
}
const provider = { kind: "chatgpt", session, respond, status: () => ({ kind: "chatgpt", label: "Demo", connected: true }), models: async () => models, nativeSearchAvailable: () => false };
const runtime = new Runtime(store, provider, null, { narrate: false, speech: false, suggest: false, autoTitle: false, review: false, seed: true, recaps: false });

// The chat: a few earlier turns, so there are previous messages to watch.
const at = (min) => new Date(Date.now() - min * 60000).toISOString();
const turns = [
  ["¿Qué tengo hoy en la agenda?", "Tienes tres cosas:\n\n- A las 10:00, llamada con el proveedor de la feria.\n- A las 12:30, comida con Marta.\n- A las 17:00, revisar el presupuesto del trimestre.\n\nNada se solapa; entre la comida y la revisión tienes la tarde libre."],
  ["¿Y el correo del banco?", "Es el extracto de octubre. No pide nada: solo confirma el cargo de la cuota del local y dos transferencias que ya conocías."],
  ["Buenos días, ¿qué tal?", "Buenos días. Todo en orden: no hay nada urgente esperando."],
  ["¿Me resumes el correo de Marta?", "Marta pregunta si podéis mover el viaje a la semana del 24 y si el hotel sigue reservado. No pide nada más."],
  ["Gracias", "De nada. Si quieres, le contesto yo con las fechas."],
];
store.put("missions", { id: "shift", title: "Chat con Nora", prompt: turns[0][0], status: "completed", mode: "solo", botIds: ["nora"], conversation: true, thread: true, createdAt: at(40), updatedAt: at(10) });
turns.forEach(([q, a], i) => {
  store.put("messages", { id: "u" + i, missionId: "shift", role: "user", kind: "message", text: q, at: at(40 - i * 6) });
  store.put("messages", { id: "a" + i, missionId: "shift", role: "assistant", kind: "message", botId: "nora", stepId: "s" + i, text: a, at: at(39 - i * 6) });
  store.put("steps", { id: "s" + i, missionId: "shift", key: "followup-s" + i, botId: "nora", kind: "followup", status: "completed", history: [], request: q, startedAt: at(40 - i * 6), completedAt: at(39 - i * 6) });
});
store.patch("missions", "shift", { steps: turns.map((_, i) => "followup-s" + i) });
// A room with two bots, with the same earlier turns (alternating who answered).
store.put("missions", { id: "shift-room", title: "Pruebas", prompt: turns[0][0], status: "completed", mode: "solo", room: "pruebas", botIds: ["nora", "tomas"], createdAt: at(40), updatedAt: at(10) });
turns.forEach(([q, a], i) => {
  const bot = i % 2 ? "tomas" : "nora";
  store.put("messages", { id: "ru" + i, missionId: "shift-room", role: "user", kind: "message", text: q, at: at(40 - i * 6) });
  store.put("messages", { id: "ra" + i, missionId: "shift-room", role: "assistant", kind: "message", botId: bot, stepId: "rs" + i, text: a, at: at(39 - i * 6) });
  store.put("steps", { id: "rs" + i, missionId: "shift-room", key: "followup-rs" + i, botId: bot, kind: "followup", status: "completed", history: [], request: q, startedAt: at(40 - i * 6), completedAt: at(39 - i * 6) });
});
store.patch("missions", "shift-room", { steps: turns.map((_, i) => "followup-rs" + i) });

let origin = "";
const app = createApp({ store, runtime, session, scheduler: null, connections: null, getOrigin: () => origin });
const server = http.createServer(app);
const { createServer } = await import("vite");
const vite = await createServer({ root, server: { middlewareMode: true, hmr: { server } }, appType: "spa", logLevel: "error" });
app.use(vite.middlewares);
server.listen(port, "127.0.0.1", () => {
  origin = "http://127.0.0.1:" + server.address().port;
  console.log("SHIFT_READY " + JSON.stringify({ origin, directory, pid: process.pid, chat: "/chat/nora", missionId: "shift", room: "/sala/shift-room" }));
});
const stop = async () => {
  server.closeAllConnections?.();
  server.close();
  try { await vite.close(); } catch {}
  try { await runtime.shutdown(); } catch {}
  try { store.close(); } catch {}
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
// The measurement closes our stdin when it is done (a kill on Windows skips the handlers above).
process.stdin.on("end", stop);
process.stdin.resume();
