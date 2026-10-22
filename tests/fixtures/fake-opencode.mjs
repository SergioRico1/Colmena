// A stand-in for `opencode serve` in «Código» tests: the same HTTP API and event stream (the
// parts Colmena uses), Basic auth with OPENCODE_SERVER_PASSWORD. «escribe» writes nota.txt
// (asking for the edit), «push» runs git push (asking for the command).
import http from "node:http";
import { writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]);
const auth = "Basic " + Buffer.from("opencode:" + process.env.OPENCODE_SERVER_PASSWORD).toString("base64");
const clients = new Set();
const sessions = new Map();
const waiting = new Map();
let n = 0;
const send = (type, properties) => { for (const res of clients) res.write("data: " + JSON.stringify({ id: "evt_" + ++n, type, properties }) + "\n\n"); };
const ask = (sessionID, permission, patterns, metadata) => new Promise((resolve) => {
  const id = "per_" + ++n;
  waiting.set(id, resolve);
  send("permission.asked", { id, sessionID, permission, patterns, metadata, always: [], tool: { messageID: "msg_x", callID: "call_" + n } });
});

async function prompt(sessionID, text, agent, variant) {
  const dir = process.cwd();
  send("session.status", { sessionID, status: { type: "busy" } });
  const msg = "msg_a" + ++n;
  send("message.updated", { sessionID, info: { id: msg, role: "assistant", sessionID } });
  const part = (p) => send("message.part.updated", { sessionID, part: { sessionID, messageID: msg, ...p }, time: Date.now() });
  if (agent === "plan") {
    part({ id: "prt_t" + n, type: "text", text: "Plan: 1. escribir la nota.", time: { start: 1, end: 2 } });
  } else if (/escribe/.test(text)) {
    const file = path.join(dir, "nota.txt");
    const call = "call_w" + ++n;
    part({ id: "prt_w", type: "tool", tool: "write", callID: call, state: { status: "pending", input: {} } });
    part({ id: "prt_w", type: "tool", tool: "write", callID: call, state: { status: "running", input: { filePath: file, content: "hola" } } });
    const r = await ask(sessionID, "edit", ["nota.txt"], { filepath: file });
    if (r.reply !== "reject") writeFileSync(file, "hola\n");
    part({ id: "prt_w", type: "tool", tool: "write", callID: call, state: { status: r.reply === "reject" ? "error" : "completed", input: { filePath: file }, output: "", error: r.reply === "reject" ? "rejected" : undefined } });
    send("message.part.delta", { sessionID, messageID: msg, partID: "prt_t" + n, field: "text", delta: "He" });
    part({ id: "prt_t" + n, type: "text", text: "He escrito la nota.", time: { start: 1, end: 2 } });
    part({ id: "prt_s" + n, type: "step-finish", tokens: { input: 900, output: 10, reasoning: 0, cache: { read: 100, write: 0 } } });
  } else if (/variante/.test(text)) {
    part({ id: "prt_t" + n, type: "text", text: "Variante: " + (variant || "ninguna"), time: { start: 1, end: 2 } });
  } else if (/push/.test(text)) {
    const call = "call_b" + ++n;
    part({ id: "prt_b", type: "tool", tool: "bash", callID: call, state: { status: "running", input: { command: "git push origin main", description: "Subir" } } });
    const r = await ask(sessionID, "bash", ["git push origin main"], { command: "git push origin main" });
    part({ id: "prt_b", type: "tool", tool: "bash", callID: call, state: { status: r.reply === "reject" ? "error" : "completed", input: { command: "git push origin main" }, output: "", error: "rejected" } });
    part({ id: "prt_t" + n, type: "text", text: r.reply === "reject" ? "No lo he subido." : "Subido.", time: { start: 1, end: 2 } });
  } else {
    part({ id: "prt_t" + n, type: "text", text: "Vale.", time: { start: 1, end: 2 } });
  }
  send("session.status", { sessionID, status: { type: "idle" } });
}

const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
http.createServer((req, res) => {
  if (req.headers.authorization !== auth) return json(res, 401, { error: "auth" });
  const url = new URL(req.url, "http://x");
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    const data = body ? JSON.parse(body) : {};
    const p = url.pathname;
    if (p === "/global/health") return json(res, 200, { healthy: true });
    if (p === "/event") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      clients.add(res);
      res.on("close", () => clients.delete(res));
      res.write("data: " + JSON.stringify({ type: "server.connected", properties: {} }) + "\n\n");
      return;
    }
    if (p === "/provider") return json(res, 200, { all: [{ id: "opencode", models: { "deepseek-v4.1-flash-free": { variants: { low: {}, high: {}, max: {} } } } }] });
    if (p === "/session" && req.method === "POST") { const id = "ses_" + ++n; sessions.set(id, data); return json(res, 200, { id }); }
    let m = /^\/session\/([^/]+)$/.exec(p);
    if (m && req.method === "GET") return sessions.has(m[1]) ? json(res, 200, { id: m[1] }) : json(res, 404, {});
    m = /^\/session\/([^/]+)\/prompt_async$/.exec(p);
    if (m) { const sid = m[1]; json(res, 200, true); setTimeout(() => prompt(sid, data.parts?.[0]?.text || "", data.agent, data.variant), 20); return; }
    m = /^\/session\/([^/]+)\/(abort|summarize)$/.exec(p);
    if (m) return json(res, 200, true);
    m = /^\/permission\/([^/]+)\/reply$/.exec(p);
    if (m) { waiting.get(m[1])?.(data); waiting.delete(m[1]); return json(res, 200, true); }
    json(res, 404, {});
  });
}).listen(port, "127.0.0.1");
