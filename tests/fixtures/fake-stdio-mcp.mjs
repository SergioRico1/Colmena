// A stand-in for Google's open-source Analytics MCP server in tests: MCP over stdio (official SDK),
// one read-only tool that says which credential file it was given (never a real Google call).
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "fake-analytics", version: "1.0.0" });
server.registerTool("get_account_summaries", { description: "Cuentas de Analytics", annotations: { readOnlyHint: true } }, async () => {
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const adc = JSON.parse(readFileSync(file, "utf8"));
  return { content: [{ type: "text", text: JSON.stringify({ accounts: ["Demo"], credential: adc.type, refresh: adc.refresh_token, project: process.env.GOOGLE_CLOUD_PROJECT || null, file }) }] };
});
await server.connect(new StdioServerTransport());
