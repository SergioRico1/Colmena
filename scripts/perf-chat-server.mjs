// The server behind scripts/perf-chat.cjs: the real app on the built bundle (dist/), with
// isolated data in a temporary folder, a long synthetic chat with Nora and a scripted model
// that streams a long answer slowly (no AI account). Prints one line «PERF_READY {json}».
// Usage: node scripts/perf-chat-server.mjs [--turns=240]
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import express from "express";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = path.join(root, "dist");
if (!existsSync(path.join(dist, "index.html"))) {
  console.error("No hay bundle: ejecuta «npm run build» antes.");
  process.exit(2);
}
const turns = Number((process.argv.find((a) => a.startsWith("--turns=")) || "--turns=240").split("=")[1]) || 240;
const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-perf-"));
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
// A long answer in 12-character pieces every 20 ms (~15 s), with Markdown the live view repairs.
const LONG = Array.from({ length: 24 }, (_, i) => `### Parte ${i + 1}\n\nUn párrafo con **negritas**, una \`palabra\` técnica y [un enlace](https://example.com/${i}). ` + "Texto que llega poco a poco para medir la escritura mientras se responde. ".repeat(3) + "\n\n- uno\n- dos\n- tres").join("\n\n");
async function respond({ onDelta = () => {}, onEvent = () => {}, signal }) {
  await sleep(300, signal);
  onEvent({ type: "response.created" });
  for (let i = 0; i < LONG.length; i += 12) {
    onDelta(LONG.slice(i, i + 12));
    await sleep(20, signal);
  }
  return reply(LONG);
}
const provider = { kind: "chatgpt", session, respond, status: () => ({ kind: "chatgpt", label: "Demo", connected: true }), models: async () => models, nativeSearchAvailable: () => false };
const runtime = new Runtime(store, provider, null, { narrate: false, speech: false, suggest: false, autoTitle: false, review: false, seed: true, recaps: false });

// The synthetic chat: `turns` questions and answers of realistic length, some with a work note.
const at = (i) => new Date(Date.now() - (turns * 3 - i) * 60000).toISOString();
const answer = (i) => [
  `Respuesta ${i}: aquí tienes lo que he encontrado sobre el punto ${i}.`,
  "",
  "1. **Primero**, lo que dice el documento: " + "una frase con contenido real para ocupar sitio. ".repeat(2),
  "2. **Después**, lo que falta por confirmar con el proveedor.",
  "3. Y una tabla:",
  "",
  "| Concepto | Importe |",
  "| --- | --- |",
  `| Stand | ${1000 + i} € |`,
  `| Viaje | ${300 + i} € |`,
  "",
  i % 5 === 0 ? "```js\nconst total = items.reduce((a, b) => a + b.importe, 0);\n```" : "¿Quieres que lo prepare como documento?",
].join("\n");
store.put("missions", { id: "perf", title: "Presupuesto de la feria", prompt: "pregunta 0", status: "completed", mode: "solo", botIds: ["nora"], conversation: true, thread: true, createdAt: at(0), updatedAt: at(turns * 3) });
for (let i = 0; i < turns; i++) {
  store.put("messages", { id: "u" + i, missionId: "perf", role: "user", kind: "message", text: `pregunta ${i}: ¿cómo va el presupuesto de la parte ${i}?`, at: at(i * 3) });
  if (i % 3 === 0) store.put("messages", { id: "p" + i, missionId: "perf", role: "assistant", kind: "progress", botId: "nora", stepId: "s" + i, text: "Miro el presupuesto anterior.", at: at(i * 3 + 1) });
  store.put("messages", { id: "a" + i, missionId: "perf", role: "assistant", kind: "message", botId: "nora", stepId: "s" + i, text: answer(i), at: at(i * 3 + 2) });
  store.put("steps", { id: "s" + i, missionId: "perf", key: "followup-s" + i, botId: "nora", kind: "followup", status: "completed", history: [], request: "pregunta " + i, startedAt: at(i * 3), completedAt: at(i * 3 + 2) });
}
store.patch("missions", "perf", { steps: Array.from({ length: turns }, (_, i) => "followup-s" + i) });

let origin = "";
const app = createApp({ store, runtime, session, scheduler: null, connections: null, getOrigin: () => origin });
// «dotfiles: allow»: a worktree under .claude/ is a dot folder, which send() would refuse.
const assets = express.static(dist, { index: false, dotfiles: "allow" });
app.use((req, res, next) => assets(req, res, next));
app.get("/{*path}", (_req, res) => res.sendFile(path.join(dist, "index.html"), { dotfiles: "allow" }));
const server = http.createServer(app);
server.listen(0, "127.0.0.1", () => {
  origin = "http://127.0.0.1:" + server.address().port;
  console.log("PERF_READY " + JSON.stringify({ origin, directory, pid: process.pid, turns, chat: "/chat/nora", newest: "a" + (turns - 1) }));
});
const stop = async () => {
  server.closeAllConnections?.();
  server.close();
  try { await runtime.shutdown(); } catch {}
  try { store.close(); } catch {}
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
// The benchmark closes our stdin when it is done (a kill on Windows skips the handlers above).
process.stdin.on("end", stop);
process.stdin.resume();
