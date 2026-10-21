// A stand-in for the Claude Code CLI in tests: speaks --input-format/--output-format
// stream-json and calls the tools of the --mcp-config server like the real CLI does.
import { createInterface } from "node:readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const args = process.argv.slice(2);
if (args[0] === "auth") {
  process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "persona@example.com" }));
  process.exit(0);
}
const value = (flag) => args[args.indexOf(flag) + 1];
const config = JSON.parse(value("--mcp-config"));
const server = config.mcpServers.colmena;
const model = value("--model");
const out = (e) => process.stdout.write(JSON.stringify(e) + "\n");
let client = null;
async function mcp() {
  if (client) return client;
  client = new Client({ name: "fake-claude", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } }));
  return client;
}
out({ type: "system", subtype: "init", model, tools: [], session_id: "s1" });
let n = 0;
const say = (text) => {
  const id = "msg_" + ++n;
  out({ type: "stream_event", event: { type: "message_start", message: { id } }, parent_tool_use_id: null });
  out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }, parent_tool_use_id: null });
  out({ type: "assistant", message: { id, content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 3 } }, parent_tool_use_id: null });
};
const queue = [];
let busy = false;
async function turn(text) {
  if (/usa echo/.test(text)) {
    const tools = (await (await mcp()).listTools()).tools.map((t) => t.name);
    const id = "msg_" + ++n;
    out({ type: "assistant", message: { id, content: [{ type: "text", text: "Voy." }, { type: "tool_use", id: "toolu_A", name: "mcp__colmena__echo", input: { text: "hola" } }], usage: { input_tokens: 20, output_tokens: 5 } }, parent_tool_use_id: null });
    const result = await (await mcp()).callTool({ name: "echo", arguments: { text: "hola" } });
    say("eco: " + result.content.map((c) => c.text).join("") + " (" + tools.join(",") + ")");
  } else say("ok: " + text.slice(0, 40));
  out({ type: "result", subtype: "success", is_error: false, result: "", usage: {} });
}
createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  const text = (Array.isArray(msg.message.content) ? msg.message.content : [{ text: msg.message.content }]).map((c) => c.text).join("");
  queue.push(text);
  const pump = async () => { if (busy) return; busy = true; while (queue.length) await turn(queue.shift()); busy = false; };
  pump();
});
