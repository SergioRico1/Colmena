// Model catalogue of the providers Colmena can think with besides ChatGPT (OpenClaw
// extensions/<provider>/openclaw.plugin.json `modelCatalog`, same ids, routes and prices).
// Each model says which wire protocol it speaks (OpenClaw `api`), so one provider can mix
// routes: OpenCode Go serves most models over Chat Completions, one over Responses and one
// over Anthropic Messages.
//
// `families` maps a model onto Colmena's families (models.mjs): Luna (everyday, writing),
// Sol (complex work, code, analysis), Astra (coordination and the hardest work). `utility`
// marks the cheap model for side tasks (titles, narration, recaps, reviews; OpenClaw
// `defaultUtilityModel`). `rank` orders versions inside a family (higher wins).

export const ENGINES = Object.freeze(["openai", "anthropic", "opencode-go"]);
export const ENGINE_LABEL = Object.freeze({ openai: "ChatGPT", anthropic: "Claude", "opencode-go": "OpenCode Go" });

export const ANTHROPIC_API = "https://api.anthropic.com";
export const OPENCODE_GO_API = "https://opencode.ai/zen/go/v1";
export const OPENCODE_GO_ANTHROPIC_API = "https://opencode.ai/zen/go";

const claude = (id, label, extra) => ({
  provider: "anthropic", id, ref: "anthropic/" + id, label, api: "anthropic-messages", baseUrl: ANTHROPIC_API,
  input: ["text", "image"], context: 1_000_000, maxTokens: 128_000, thinking: "adaptive", search: "web_search_20260209", ...extra,
});

/** Claude (OpenClaw anthropic manifest, cached 2026-10). */
export const ANTHROPIC_MODELS = Object.freeze([
  claude("claude-opus-5-5", "Claude Opus 5.5", { families: ["sol", "astra"], rank: 55, cost: [4, 20], efforts: ["low", "medium", "high", "xhigh", "max"] }),
  claude("claude-sonnet-5-5", "Claude Sonnet 5.5", { families: ["luna"], rank: 55, cost: [2, 10], efforts: ["low", "medium", "high", "xhigh", "max"] }),
  claude("claude-haiku-5-5", "Claude Haiku 5.5", { families: [], utility: true, rank: 55, cost: [0.1, 0.5], search: "web_search_20250305", efforts: ["low", "medium", "high", "xhigh", "max"] }),
  claude("claude-fable-5-1", "Claude Fable 5.1", { families: [], rank: 51, cost: [10, 50], efforts: ["low", "medium", "high", "xhigh", "max"] }),
  claude("claude-opus-5", "Claude Opus 5", { families: [], rank: 50, cost: [5, 25], efforts: ["low", "medium", "high", "xhigh", "max"] }),
  claude("claude-sonnet-5", "Claude Sonnet 5", { families: [], rank: 50, cost: [2, 10], efforts: ["low", "medium", "high", "xhigh", "max"] }),
]);

const go = (id, label, extra) => ({
  provider: "opencode-go", id, ref: "opencode-go/" + id, label, api: "openai-completions", baseUrl: OPENCODE_GO_API,
  input: ["text"], context: 262_144, maxTokens: 32_768, thinking: "fixed", search: null, ...extra,
});

/** OpenCode Go (OpenClaw extensions/opencode-go manifest; default model deepseek-v4-pro). */
// The user's choice (2026-10-20): every family thinks with DeepSeek V4.1 Flash, the best of
// the plan for Colmena; Muse Spark 1.3 is the alternative to pin in Ajustes. Ids, routes and
// prices from OpenCode's catalogue (models.opencode.ai, provider «opencode-go»).
export const OPENCODE_GO_MODELS = Object.freeze([
  go("deepseek-v4.1-flash", "DeepSeek V4.1 Flash", { families: ["luna", "sol", "astra"], utility: true, rank: 41, input: ["text", "image"], context: 1_000_000, maxTokens: 384_000, cost: [0.15, 0.6], efforts: ["low", "high", "max"] }),
  go("muse-spark-1.3-contributor", "Muse Spark 1.3", { families: [], rank: 13, api: "openai-responses", input: ["text", "image"], context: 1_048_576, maxTokens: 131_072, cost: [0.1, 0.2], thinking: "effort" }),
]);
/**
 * OpenCode routes every request by conversation and refuses one without it (OpenClaw
 * session-affinity.ts): the bot and mission's cache key, or a fresh id for a loose call.
 */
export const opencodeSession = (cacheKey) => ({ "x-opencode-session": String(cacheKey || "colmena-" + crypto.randomUUID()).slice(0, 128) });

/** The cheap model a pasted OpenCode key is checked with (one token). */
export const OPENCODE_GO_CHECK_MODEL = "deepseek-v4.1-flash";

export const CATALOG = Object.freeze({ anthropic: ANTHROPIC_MODELS, "opencode-go": OPENCODE_GO_MODELS });

/** «anthropic/claude-opus-5-5» → {engine, id}; bare ChatGPT slugs → engine 'openai'. */
export function parseRef(ref) {
  const text = String(ref || "");
  const slash = text.indexOf("/");
  const engine = slash > 0 ? text.slice(0, slash) : "";
  if (ENGINES.includes(engine) && engine !== "openai") return { engine, id: text.slice(slash + 1) };
  return { engine: "openai", id: text };
}

/** Catalogue entry of a model ref, or null (ChatGPT models come from the session instead). */
export function modelEntry(ref) {
  const { engine, id } = parseRef(ref);
  return (CATALOG[engine] || []).find((m) => m.id === id) || null;
}

/** Shape of a catalogue model in the lists the rest of Colmena reads ({slug, label, …}). */
export const listEntry = (m) => ({ slug: m.ref, label: m.label, engine: m.provider, families: m.families, utility: !!m.utility, rank: m.rank, input: m.input });
