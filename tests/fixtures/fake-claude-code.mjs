// A stand-in for Claude Code in «Código» tests: speaks stream-json in and out with the control
// protocol (initialize, PreToolUse hook, can_use_tool, interrupt) like the real CLI, and acts
// on a few words of the message: «escribe» writes nota.txt, «push» runs git push, «pregunta»
// asks a question. Without --input-format it answers a one-shot --print (commit messages).
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
if (!args.includes("--input-format")) {
  process.stdin.resume();
  process.stdin.on("end", () => { process.stdout.write("feat: add a note\n"); process.exit(0); });
  process.stdin.on("data", () => {});
} else {
  const session = value("--session-id") || value("--resume") || "s-fake";
  const out = (m) => process.stdout.write(JSON.stringify(m) + "\n");
  const waiting = new Map();
  const ask = (request) => new Promise((resolve) => {
    const id = randomUUID();
    waiting.set(id, resolve);
    out({ type: "control_request", request_id: id, request });
  });
  let n = 0;
  const assistant = (content) => out({ type: "assistant", uuid: "a-" + ++n, message: { id: "m" + n, role: "assistant", content }, parent_tool_use_id: null, session_id: session });
  const result = () => out({ type: "result", subtype: "success", is_error: false, session_id: session, result: "" });
  async function tool(name, input) {
    const id = "toolu_" + ++n;
    assistant([{ type: "tool_use", id, name, input }]);
    const hook = await ask({ subtype: "hook_callback", callback_id: "PreToolUse", tool_use_id: id, input: { hook_event_name: "PreToolUse", tool_name: name, tool_input: input, tool_use_id: id } });
    let decision = hook.hookSpecificOutput?.permissionDecision;
    let updated = hook.hookSpecificOutput?.updatedInput || input;
    if (decision !== "deny") {
      const prompt = await ask({ subtype: "can_use_tool", tool_name: name, input, tool_use_id: id });
      decision = prompt.behavior;
      updated = prompt.updatedInput || updated;
    }
    return { id, allowed: decision === "allow", input: updated };
  }
  let mode = "default";
  async function turn(text) {
    if (mode === "plan") {
      const t = await tool("ExitPlanMode", { plan: "# Plan\n\n1. Escribir la nota." });
      assistant([{ type: "text", text: t.allowed ? "Raro." : "Espero tu decisión." }]);
      return result();
    }
    out({ type: "stream_event", event: { type: "message_start", message: { usage: { input_tokens: 1200, cache_read_input_tokens: 800 } } }, parent_tool_use_id: null });
    if (/escribe/.test(text)) {
      const t = await tool("Write", { file_path: path.join(process.cwd(), "nota.txt"), content: "hola\n" });
      if (t.allowed) writeFileSync(t.input.file_path, t.input.content);
      out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: t.id, content: t.allowed ? "File created" : "denied", is_error: !t.allowed }] }, parent_tool_use_id: null });
      out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hecho" } }, parent_tool_use_id: null });
      assistant([{ type: "text", text: "He escrito la nota." }]);
    } else if (/push/.test(text)) {
      const t = await tool("Bash", { command: "git push origin main", description: "Subir la rama" });
      out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: t.id, content: t.allowed ? "pushed" : "denied", is_error: !t.allowed }] }, parent_tool_use_id: null });
      assistant([{ type: "text", text: t.allowed ? "Subido." : "No lo he subido." }]);
    } else if (/pregunta/.test(text)) {
      const q = { question: "¿Qué color?", header: "Color", multiSelect: false, options: [{ label: "Rojo", description: "" }, { label: "Azul", description: "" }] };
      const t = await tool("AskUserQuestion", { questions: [q] });
      assistant([{ type: "text", text: "Elegiste " + (t.input.answers?.["¿Qué color?"] || "nada") + "." }]);
    } else if (/Tu objetivo es|Sigue con el objetivo/.test(text)) {
      // «/goal»: «bloquea» blocks at once; otherwise the second turn says it is done.
      goals++;
      const mark = /(Tu objetivo es|Sigue con el objetivo): [^\n]*bloquea/.test(text) ? "[objetivo: bloqueado — falta la clave de la API]" : goals < 2 ? "[objetivo: sigue]" : "[objetivo: cumplido]";
      assistant([{ type: "text", text: "Vuelta " + goals + ".\n\n" + mark }]);
    } else {
      assistant([{ type: "text", text: "Vale." }]);
    }
    result();
  }
  let goals = 0;
  let chain = Promise.resolve();
  createInterface({ input: process.stdin }).on("line", (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.type === "control_request" && m.request?.subtype === "initialize") {
      out({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: { commands: [{ name: "review", description: "Review" }] } } });
      out({ type: "system", subtype: "init", session_id: session, model: value("--model"), cwd: process.cwd() });
    } else if (m.type === "control_request" && m.request?.subtype === "set_permission_mode") {
      mode = m.request.mode;
      out({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: {} } });
    } else if (m.type === "control_request" && m.request?.subtype === "interrupt") {
      out({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: {} } });
    } else if (m.type === "control_response") {
      const resolve = waiting.get(m.response.request_id);
      waiting.delete(m.response.request_id);
      resolve?.(m.response.response || {});
    } else if (m.type === "user") {
      const text = typeof m.message.content === "string" ? m.message.content : "";
      chain = chain.then(() => turn(text));
    }
  }).on("close", () => process.exit(0));
}
