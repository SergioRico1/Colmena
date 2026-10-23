// A stand-in for `codex --enable realtime_conversation app-server` in «Hablar» tests: the
// JSON-RPC of the real one (Codex 0.145, realtime v3 over WebRTC), with a scripted call.
// FAKE_RT chooses the script: «chat» (default) says hello, hands a request to the Codex
// thread, which reads the memory and asks for an on-screen confirmation; «refuse» answers
// `thread/realtime/start` with the error a login without ChatGPT gets. FAKE_RT_REPORT is a
// file where it writes what it was given (arguments, thread and realtime parameters, replies).
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";

if (process.argv.includes("login")) {
  process.stdout.write("Logged in using ChatGPT\n");
  process.exit(0);
}
const out = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const notify = (method, params) => out({ method, params });
const report = { argv: process.argv.slice(2), replies: {}, decisions: [] };
const save = () => { if (process.env.FAKE_RT_REPORT) writeFileSync(process.env.FAKE_RT_REPORT, JSON.stringify(report, null, 2)); };
let nextId = 5000;
const waiting = new Map();
const ask = (method, params) => new Promise((resolve) => { const id = nextId++; waiting.set(id, resolve); out({ id, method, params }); });
const later = (ms) => new Promise((r) => setTimeout(r, ms));
const threadId = "th-voz";
const VOICES = { v1: ["juniper", "maple", "spruce", "ember", "vale", "breeze", "arbor", "sol", "cove"], v2: ["alloy", "marin"], defaultV1: "cove", defaultV2: "marin" };

async function call() {
  await later(30);
  // The person starts first, the bot's short reply finishes before the person's sentence does.
  notify("thread/realtime/transcript/delta", { threadId, role: "user", delta: " Hola" });
  await later(10);
  notify("thread/realtime/transcript/delta", { threadId, role: "assistant", delta: " Hola," });
  notify("thread/realtime/transcript/done", { threadId, role: "assistant", text: " Hola, te oigo." });
  await later(10);
  notify("thread/realtime/transcript/done", { threadId, role: "user", text: " Hola, ¿me oyes?" });
  await later(20);
  // A request for private data goes to the Codex thread, which uses the dynamic tools.
  notify("thread/realtime/transcript/delta", { threadId, role: "user", delta: " Mira" });
  notify("thread/realtime/itemAdded", { threadId, item: { type: "handoff_request", handoff_id: "h1", input_transcript: "Mira mi café favorito y escríbele a Ana" } });
  notify("turn/started", { threadId, turn: { id: "t1", status: "inProgress" } });
  report.decisions.push((await ask("item/commandExecution/requestApproval", { threadId, turnId: "t1", itemId: "c1", command: "dir" })).decision);
  report.replies.memory = await ask("item/tool/call", { threadId, turnId: "t1", callId: "x1", tool: "consultar_memoria", arguments: { consulta: "café favorito" } });
  report.replies.unknown = await ask("item/tool/call", { threadId, turnId: "t1", callId: "x2", tool: "shell", arguments: { command: "del *" } });
  report.replies.confirm = await ask("item/tool/call", { threadId, turnId: "t1", callId: "x3", tool: "pedir_confirmacion", arguments: { accion: "Enviar un correo a Ana", detalle: "Envía un correo a Ana diciendo que llego tarde" } });
  save();
  notify("turn/completed", { threadId, turn: { id: "t1", status: "completed", items: [] } });
  notify("thread/realtime/transcript/done", { threadId, role: "user", text: " Mira mi café favorito y escríbele a Ana" });
  notify("thread/realtime/transcript/delta", { threadId, role: "assistant", delta: " Tu café" });
  notify("thread/realtime/transcript/done", { threadId, role: "assistant", text: " Tu café favorito es el cortado. El correo a Ana está en pantalla." });
}

createInterface({ input: process.stdin }).on("line", (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.id !== undefined && !m.method) { const r = waiting.get(m.id); waiting.delete(m.id); r?.(m.result ?? m.error ?? {}); return; }
  const reply = (result) => out({ id: m.id, result });
  switch (m.method) {
    case "initialize": return reply({ userAgent: "fake-realtime", codexHome: "." });
    case "initialized": return;
    case "thread/realtime/listVoices": return reply({ voices: VOICES });
    case "thread/start": report.threadStart = m.params; save(); return reply({ thread: { id: threadId } });
    case "thread/realtime/start":
      report.realtimeStart = m.params;
      save();
      reply({});
      if (process.env.FAKE_RT === "refuse") return notify("thread/realtime/error", { threadId, message: "realtime conversation requires API key auth" });
      notify("thread/realtime/started", { threadId, realtimeSessionId: threadId, version: "v3" });
      notify("thread/realtime/sdp", { threadId, sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=fake\r\n" });
      void call();
      return;
    case "thread/realtime/appendSpeech": (report.spoken ||= []).push(m.params.text); save(); return reply({});
    case "thread/realtime/stop":
      report.stopped = true;
      save();
      reply({});
      notify("thread/realtime/closed", { threadId, reason: "requested" });
      return;
    default: return out({ id: m.id, error: { code: -32601, message: "unknown " + m.method } });
  }
});
process.stdin.on("end", () => process.exit(0));
