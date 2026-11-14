// A deterministic model for the deployed end-to-end tests (docs/CLOUD.md › Phase 3). It never
// reaches a real provider and costs nothing. It is switched on per workspace only when the
// Worker has the secret test flag (FAKE_MODEL_TOKEN) and an operator turns it on with that
// token (cloud/src/worker.js › /auth/dev/fake-model): normal workspaces never see it.
//
// What it does, from the last thing the person wrote:
//   [[plan:nora,tomas]]  the coordinator proposes a plan with those bots (default: Nora and Tomás);
//   [[app:SLUG]]         the bot proposes that action in the test app (FakeApps below);
//   [[slow:4000]]        it takes that long to answer (abortable), to test concurrency and eviction;
//   [[tool:NAME|{json}]] it calls that tool with those arguments (several: one after another), then
//                        answers with the last result (Phase 4: browser_* and run_command);
//   [[tool:NAME {json}]] the bot calls that tool with those arguments, then says what it got back;
//   anything else        «<Bot> (modelo de prueba): <the first words of what you wrote>».
import { randomUUID } from "node:crypto";

export const FAKE_MODEL = "colmena-prueba";
export const FAKE_MODELS = Object.freeze([
  { slug: FAKE_MODEL, label: "Modelo de prueba", families: ["luna", "sol", "astra"], utility: true, rank: 1 },
]);
const MAX_SLOW_MS = 120_000;

const textOf = (content) => typeof content === "string" ? content
  : Array.isArray(content) ? content.map((p) => (typeof p === "string" ? p : p?.text || "")).join(" ") : "";
/** The last thing a person said in this request (tool outputs and the bot's own words are not). */
export function lastUserText(input = []) {
  for (let i = input.length - 1; i >= 0; i--) {
    const item = input[i];
    if (item?.role === "user" && item.type !== "function_call_output") {
      const t = textOf(item.content);
      if (t.trim() && !/^\[Colmena\]|^Colmena se reinició/.test(t.trim())) return t;
    }
  }
  return "";
}
const outputsOf = (input = [], prefix) => input.filter((x) => x?.type === "function_call_output" && String(x.call_id || "").startsWith(prefix));
const botNameOf = (instructions) => /\bEres ([A-ZÁÉÍÓÚÑ][\p{L}]+)/u.exec(String(instructions || ""))?.[1] || "El bot";
const answer = (text) => ({ text, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] });
const call = (name, args, id) => ({ text: "", output: [{ type: "function_call", name, arguments: JSON.stringify(args), call_id: id }] });

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || Error("Cancelado."));
    const timer = setTimeout(() => { signal?.removeEventListener?.("abort", stop); resolve(); }, ms);
    const stop = () => { clearTimeout(timer); reject(signal.reason || Error("Cancelado.")); };
    signal?.addEventListener?.("abort", stop, { once: true });
  });
}

/** One answer of the fake model for a Responses-shaped request. */
export async function fakeRespond({ instructions = "", input = [], tools = [], signal = null, onDelta = () => {} } = {}) {
  const said = lastUserText(input);
  const slow = /\[\[slow:(\d{1,6})\]\]/.exec(said);
  if (slow) await sleep(Math.min(MAX_SLOW_MS, Number(slow[1])), signal);
  const names = new Set(tools.map((t) => t?.name).filter(Boolean));
  let result;
  if (names.has("propose_plan")) {
    const bots = (/\[\[plan:([a-z0-9_,-]+)\]\]/i.exec(said)?.[1] || "nora,tomas").split(",").filter(Boolean).slice(0, 4);
    result = outputsOf(input, "fake-plan").length ? answer("Plan en marcha: " + bots.join(" y ") + ".")
      : call("propose_plan", { summary: "Reparto de prueba", assignments: bots.map((botId, i) => ({ botId, task: "Parte " + (i + 1) + " de prueba" })) }, "fake-plan-" + randomUUID().slice(0, 8));
  } else if (/\[\[tool:[a-z_]{3,40}\|/.test(said)) {
    // [[tool:NAME|{json}]] … one call each, in order (Phase 4: the browser and run_command), then an
    // answer that quotes the last result so a test can read it.
    const steps = [...said.matchAll(/\[\[tool:([a-z_]{3,40})\|(\{.*?\})\]\]/g)].map((m) => ({ name: m[1], args: m[2] }));
    const done = outputsOf(input, "fake-tool");
    const next = steps[done.length];
    if (next && (names.has(next.name) || names.has("use_tool"))) {
      let args = {};
      try { args = JSON.parse(next.args); } catch {}
      // A long tool list hides some behind use_tool (server/tool-search.mjs): the same call, through it.
      result = names.has(next.name) ? call(next.name, args, "fake-tool-" + done.length + "-" + randomUUID().slice(0, 8))
        : call("use_tool", { name: next.name, arguments: args }, "fake-tool-" + done.length + "-" + randomUUID().slice(0, 8));
    } else {
      const last = done.length ? textOf(done.at(-1).output) || String(done.at(-1).output || "") : "";
      // Earlier results too, shortly (a test can tell which step failed).
      const before = done.slice(0, -1).map((d) => (textOf(d.output) || String(d.output || "")).replace(/\s+/g, " ").slice(0, 160));
      result = answer(botNameOf(instructions) + " (modelo de prueba): " + (next ? "no tengo la herramienta " + next.name + "." : "resultado: " + last.replace(/\s+/g, " ").slice(0, 600) + (before.length ? " · antes: " + before.join(" · ") : "")));
    }
  } else {
    const app = /\[\[app:([A-Z0-9_]{3,80})\]\]/.exec(said)?.[1];
    const done = outputsOf(input, "fake-app");
    // [[tool:NAME {json}]]: the bot calls that tool once (Phase 5: folders on the person's computer).
    const tool = /\[\[tool:([a-z_]{3,40})(?:\s+(\{.*?\}))?\]\]/s.exec(said);
    const toolDone = outputsOf(input, "fake-tool");
    let toolArgs = null;
    try { toolArgs = tool ? JSON.parse(tool[2] || "{}") : null; } catch { toolArgs = null; }
    if (tool && toolArgs && names.has(tool[1]) && !toolDone.length)
      result = call(tool[1], toolArgs, "fake-tool-" + randomUUID().slice(0, 8));
    else if (tool && toolDone.length) {
      const out = textOf(toolDone.at(-1).output) || String(toolDone.at(-1).output || "");
      // The tool's JSON (inside the external-content marks, when there are any), said in a sentence.
      let said = null;
      try {
        const json = JSON.parse(/---\s*(\{[\s\S]*\})\s*<<</.exec(out)?.[1] || out);
        said = json.error ? "no he podido: " + json.error
          : typeof json.content === "string" ? "he leído «" + (json.name || "el archivo") + "»: " + json.content
          : Array.isArray(json.entries) ? "en «" + (json.folder || "la carpeta") + "» hay " + json.entries.map((e) => e.name).join(", ") + "."
          : Array.isArray(json.folders) ? "carpetas: " + json.folders.map((f) => f.label).join(", ") + "." : null;
      } catch {}
      result = answer(botNameOf(instructions) + " (modelo de prueba): " + (said || out).replace(/\s+/g, " ").slice(0, 1500));
    } else if (tool && !names.has(tool[1]))
      result = answer(botNameOf(instructions) + " (modelo de prueba): no tengo la herramienta " + tool[1] + ".");
    else if (app && names.has("apps_execute") && !done.length)
      result = call("apps_execute", { tool: app, account: "Prueba", arguments_json: JSON.stringify({ event_id: "evt-prueba", recipient_email: "equipo@example.com" }) }, "fake-app-" + randomUUID().slice(0, 8));
    else if (app && done.length) {
      const out = textOf(done.at(-1).output) || String(done.at(-1).output || "");
      result = answer(botNameOf(instructions) + " (modelo de prueba): " + (/"ok"\s*:\s*true/.test(out) ? "hecho, " + app + "." : /waiting|pendiente|espera/i.test(out) ? "queda pendiente de tu OK: " + app + "." : "no se pudo: " + out.slice(0, 120)));
    } else {
      const clean = said.replace(/\[\[[^\]]*\]\]/g, "").replace(/\[Ahora:[^\]]*\]/g, "").replace(/<@[^>]+>/g, "").replace(/\s+/g, " ").trim();
      result = answer(botNameOf(instructions) + " (modelo de prueba): " + (clean.slice(0, 120) || "listo."));
    }
  }
  if (result.text) onDelta(result.text);
  return { ...result, model: FAKE_MODEL, usage: { input_tokens: Math.ceil(JSON.stringify(input).length / 4), output_tokens: Math.ceil((result.text || "x").length / 4) } };
}

/** The provider surface the runtime reads, all of it the fake model. */
export function fakeHub() {
  const engines = [{ id: "openai", label: "Modelo de prueba", connected: true, detail: "Solo para pruebas", resting: false, limit: null }];
  return {
    fake: true,
    kind: "fake",
    primary: "openai",
    local: null,
    session: null,
    accounts: null,
    status: () => ({ kind: "fake", label: "Modelo de prueba", connected: true }),
    connected: () => true,
    engineFor: () => "openai",
    engines: () => engines,
    config: () => ({ id: "fake" }),
    models: async () => FAKE_MODELS,
    modelsFor: () => FAKE_MODELS,
    providerFor: () => ({ respond: fakeRespond }),
    resolveModel: (m) => m,
    modelLimits: () => ({ window: 200_000, maxOutput: 8_000 }),
    supportsVision: () => false,
    supportsPdf: () => false,
    equivalent: () => FAKE_MODEL,
    resting: () => false,
    limitOf: () => null,
    limits: () => ({}),
    markLimited: () => null,
    clearLimit: () => {},
    rest: () => {},
    fallbackFor: () => null,
    fallbackProvider: () => null,
    nativeSearchAvailable: () => false,
    warm: async () => false,
    respond: ({ fallback: _f, ...params }) => fakeRespond(params).then((r) => ({ ...r, engine: "openai" })),
    generateImage: async () => { throw Object.assign(Error("El modelo de prueba no crea imágenes."), { status: 400 }); },
    close() {},
  };
}

// ------------------------------------------------------------ the test app (Composio's shape)
/**
 * A Composio-shaped hub (server/connections.mjs › Connections#call) with one connected account,
 * «Prueba», whose actions do nothing outside: `commit` records the effect in memory and answers
 * ok. Red lines are judged by the real Connections code from the action's name (a DELETE or a
 * SEND asks), so approvals, delegation and pre-approvals run their real paths.
 */
export function fakeApps({ effects = [] } = {}) {
  const proposals = new Map();
  return {
    effects,
    async dispatch(_profile, op, args = {}) {
      if (op === "accounts") return { items: [{ id: "acc-prueba", alias: "Prueba", toolkit: "googlecalendar", status: "ACTIVE" }], next_cursor: null };
      if (op === "search") return { items: [] };
      if (op === "prepare") {
        let json = {};
        try { json = JSON.parse(args.arguments_json || "{}"); } catch {}
        const tool = String(args.tool || "").toUpperCase();
        const proposal = "p-" + randomUUID();
        const toolkit = tool.split("_")[0].toLowerCase();
        proposals.set(proposal, { tool, json });
        return { proposal, tool, toolkit, account: "Prueba · acc-prueba", account_alias: "Prueba", arguments: json, name: tool.replace(/_/g, " ").toLowerCase() };
      }
      if (op === "commit") {
        const p = proposals.get(args.proposal);
        proposals.delete(args.proposal);
        effects.push({ tool: p?.tool || null, at: new Date().toISOString() });
        return { ok: true, data: { id: "efecto-" + effects.length } };
      }
      if (op === "discard") { proposals.delete(args.proposal); return { ok: true }; }
      return { ok: true, items: [] };
    },
  };
}
