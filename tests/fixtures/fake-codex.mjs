// A stand-in for `codex app-server` in «Código» tests: JSON-RPC over stdio like the real one.
// Words in the message choose what it does: «escribe» changes nota.txt (asking for the file
// change), «push» runs git push (asking for the command), «plan» mode answers with a plan.
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const out = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const notify = (method, params) => out({ method, params });
let nextId = 1000;
const waiting = new Map();
const ask = (method, params) => new Promise((resolve) => { const id = nextId++; waiting.set(id, resolve); out({ id, method, params }); });
let thread = null, n = 0, cwd = process.cwd();
// The thread outlives the process (like Codex's own sessions): its turn count is kept on disk.
const ledger = path.join(os.tmpdir(), "fake-codex-" + Buffer.from(process.cwd()).toString("hex").slice(-40) + ".json");
let turns = 0;
const loadTurns = () => { try { turns = JSON.parse(readFileSync(ledger, "utf8")).turns; } catch { turns = 0; } };
const saveTurns = () => { try { writeFileSync(ledger, JSON.stringify({ turns })); } catch {} };

async function turn(id, params) {
  const turnId = "turn-" + ++n;
  out({ id, result: { turn: { id: turnId, items: [], status: "inProgress" } } });
  notify("turn/started", { threadId: thread, turn: { id: turnId, status: "inProgress" } });
  const text = params.input?.[0]?.text || "";
  const plan = params.collaborationMode?.mode === "plan";
  notify("thread/tokenUsage/updated", { threadId: thread, turnId, tokenUsage: { last: { inputTokens: 5000 }, total: { inputTokens: 5000 }, modelContextWindow: 272000 } });
  if (plan) {
    notify("item/completed", { threadId: thread, turnId, item: { type: "plan", id: "plan-" + n, text: "# Plan\n\n1. Escribir la nota." } });
  } else if (/^Contexto de esta tarea/.test(text)) {
    // After an engine switch: says what history it got (the tests read it back).
    const persona = (text.match(/^\[Persona\]$/gm) || []).length;
    notify("item/completed", { threadId: thread, turnId, item: { type: "agentMessage", id: "m" + n, text: `Codex recibió el contexto: ${persona} mensajes tuyos; nuevo: ${text.split("Mensaje nuevo:\n")[1] || ""}`, phase: "final_answer" } });
  } else if (/escribe/.test(text)) {
    const file = path.join(params.cwd || cwd, "nota.txt");
    const item = { type: "fileChange", id: "fc-" + n, status: "inProgress", changes: [{ path: file, kind: { type: "add" }, diff: "+hola" }] };
    notify("item/started", { threadId: thread, turnId, item });
    const r = await ask("item/fileChange/requestApproval", { threadId: thread, turnId, itemId: item.id, startedAtMs: Date.now() });
    if (r.decision === "accept") writeFileSync(file, "hola\n");
    notify("item/completed", { threadId: thread, turnId, item: { ...item, status: r.decision === "accept" ? "completed" : "declined" } });
    notify("item/agentMessage/delta", { threadId: thread, turnId, itemId: "m" + n, delta: "Hecho" });
    notify("item/completed", { threadId: thread, turnId, item: { type: "agentMessage", id: "m" + n, text: "He escrito la nota.", phase: "final_answer" } });
  } else if (/push/.test(text)) {
    const item = { type: "commandExecution", id: "cmd-" + n, command: '"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "git push origin main"', commandActions: [{ type: "unknown", command: "git push origin main" }], status: "inProgress" };
    notify("item/started", { threadId: thread, turnId, item });
    const r = await ask("item/commandExecution/requestApproval", { threadId: thread, turnId, itemId: item.id, command: item.command, startedAtMs: Date.now() });
    notify("item/completed", { threadId: thread, turnId, item: { ...item, status: r.decision === "accept" ? "completed" : "declined", exitCode: r.decision === "accept" ? 0 : null, aggregatedOutput: "" } });
    notify("item/completed", { threadId: thread, turnId, item: { type: "agentMessage", id: "m" + n, text: r.decision === "accept" ? "Subido." : "No lo he subido.", phase: "final_answer" } });
  } else {
    notify("item/completed", { threadId: thread, turnId, item: { type: "agentMessage", id: "m" + n, text: "Vale (" + turns + " turnos antes).", phase: "final_answer" } });
  }
  turns++;
  saveTurns();
  notify("turn/completed", { threadId: thread, turn: { id: turnId, status: "completed", items: [] } });
}

createInterface({ input: process.stdin }).on("line", (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.id !== undefined && !m.method) { const r = waiting.get(m.id); waiting.delete(m.id); r?.(m.result || {}); return; }
  if (m.method === "initialize") return out({ id: m.id, result: { userAgent: "fake", codexHome: "." } });
  if (m.method === "initialized") return;
  if (m.method === "thread/start") { thread = "th-1"; turns = 0; saveTurns(); cwd = m.params.cwd || cwd; return out({ id: m.id, result: { thread: { id: thread }, model: m.params.model } }); }
  if (m.method === "thread/resume") { thread = m.params.threadId; loadTurns(); return out({ id: m.id, result: { thread: { id: thread } } }); }
  if (m.method === "thread/rollback") { turns -= m.params.numTurns; saveTurns(); return out({ id: m.id, result: { thread: { id: thread } } }); }
  if (m.method === "turn/start") return void turn(m.id, m.params);
  if (m.method === "turn/interrupt" || m.method === "turn/steer") return out({ id: m.id, result: {} });
  if (m.method === "model/list") return out({ id: m.id, result: { data: [{ id: "gpt-test", displayName: "GPT Test", isDefault: true, hidden: false, supportedReasoningEfforts: [{ reasoningEffort: "low" }], defaultReasoningEffort: "low", description: "" }] } });
  out({ id: m.id, error: { code: -32601, message: "unknown " + m.method } });
}).on("close", () => process.exit(0));
