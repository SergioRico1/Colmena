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

export const ENGINES = Object.freeze(["openai", "anthropic", "opencode-go", "gemini", "openrouter", "deepseek", "moonshot", "custom"]);
export const ENGINE_LABEL = Object.freeze({ openai: "ChatGPT", anthropic: "Claude", "opencode-go": "OpenCode Go", gemini: "Gemini", openrouter: "OpenRouter", deepseek: "DeepSeek", moonshot: "Kimi", custom: "Servidor propio" });
/** Engines connected with one API key over OpenAI-compatible Chat Completions (providers/compatible.mjs). */
export const KEY_ENGINES = Object.freeze(["gemini", "openrouter", "deepseek", "moonshot", "custom"]);
/** Engines whose models come from the account itself (its /models list), not from this file. */
export const DYNAMIC_ENGINES = Object.freeze(["openrouter", "custom"]);

export const ANTHROPIC_API = "https://api.anthropic.com";
export const OPENCODE_GO_API = "https://opencode.ai/zen/go/v1";
export const OPENCODE_GO_ANTHROPIC_API = "https://opencode.ai/zen/go";

const claude = (id, label, extra) => ({
  provider: "anthropic", id, ref: "anthropic/" + id, label, api: "anthropic-messages", baseUrl: ANTHROPIC_API,
  input: ["text", "image"], pdf: true, context: 1_000_000, maxTokens: 128_000, thinking: "adaptive", search: "web_search_20260209", ...extra,
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

export const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/openai";
export const OPENROUTER_API = "https://openrouter.ai/api/v1";
export const DEEPSEEK_API = "https://api.deepseek.com";
export const MOONSHOT_API = "https://api.moonshot.ai/v1";

const compatible = (provider, baseUrl) => (id, label, extra) => ({
  provider, id, ref: provider + "/" + id, label, api: "openai-completions", baseUrl,
  input: ["text"], pdf: false, context: 1_000_000, maxTokens: 65_536, thinking: "effort", search: null, families: [], rank: 0, ...extra,
});

// Gemini over Google's OpenAI-compatible endpoint (aistudio.google.com/docs/openai, checked
// 2026-11-13): streaming, function calling, images and reasoning_effort work there; PDFs are not
// documented on that route, so they are not sent. «Automático» keeps every family on 3.8 Flash
// (it runs on the free tier; Gemini 4 Carbon and Argon are paid only) and side tasks on 3.5
// Flash-Lite; Carbon and Argon are there to pick.
const gemini = compatible("gemini", GEMINI_API);
export const GEMINI_MODELS = Object.freeze([
  gemini("gemini-3.8-flash", "Gemini 3.8 Flash", { families: ["luna", "sol", "astra"], rank: 38, input: ["text", "image"], cost: [0.75, 3.75] }),
  gemini("gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite", { utility: true, rank: 35, input: ["text", "image"], cost: [0.25, 1.25] }),
  gemini("gemini-4-argon", "Gemini 4 Argon", { rank: 41, input: ["text", "image"], cost: [1, 5] }),
  gemini("gemini-4-carbon", "Gemini 4 Carbon", { rank: 42, input: ["text", "image"], cost: [2, 10] }),
]);

// DeepSeek's own API (api-docs.deepseek.com, 2026-11-13): «deepseek-flash» (V4.1 Flash, sees
// images) for everything, as on OpenCode Go; V4 Pro (text only) to pick.
const deepseek = compatible("deepseek", DEEPSEEK_API);
export const DEEPSEEK_MODELS = Object.freeze([
  deepseek("deepseek-flash", "DeepSeek V4.1 Flash", { families: ["luna", "sol", "astra"], utility: true, rank: 41, input: ["text", "image"], maxTokens: 384_000, cost: [0.3, 1.2], efforts: ["low", "high", "max"] }),
  deepseek("deepseek-v4-pro", "DeepSeek V4 Pro", { rank: 40, maxTokens: 384_000, cost: [1.32, 3.96], efforts: ["low", "high", "max"] }),
]);

// Kimi (platform.kimi.ai, 2026-11-13): K3.1 Pro for complex work and coordination, its
// high-speed twin for everyday work and side tasks, K3 to pick. All see images (data URLs only).
const kimi = compatible("moonshot", MOONSHOT_API);
export const MOONSHOT_MODELS = Object.freeze([
  kimi("kimi-k3.1-pro", "Kimi K3.1 Pro", { families: ["sol", "astra"], rank: 31, input: ["text", "image"], maxTokens: 131_072, efforts: ["low", "high", "max"] }),
  kimi("kimi-k3.1-pro-highspeed", "Kimi K3.1 Pro Highspeed", { families: ["luna"], utility: true, rank: 31, input: ["text", "image"], maxTokens: 131_072, efforts: ["low", "high", "max"] }),
  kimi("kimi-k3", "Kimi K3", { rank: 30, input: ["text", "image"], maxTokens: 131_072, efforts: ["low", "high", "max"] }),
]);

/** OpenRouter's own router: it picks a model for each request («Automático»). */
export const OPENROUTER_AUTO = "openrouter/auto";

export const CATALOG = Object.freeze({ anthropic: ANTHROPIC_MODELS, "opencode-go": OPENCODE_GO_MODELS, gemini: GEMINI_MODELS, deepseek: DEEPSEEK_MODELS, moonshot: MOONSHOT_MODELS });

// OpenRouter and «Servidor propio» list what the account offers; the hub keeps the models the
// person chose here (setDynamicModels) so every module reads them like a catalogue entry.
const dynamic = new Map();
const dynamicEntry = (engine, m) => ({
  provider: engine, id: m.id, ref: engine + "/" + m.id, label: m.label || m.id, api: "openai-completions", baseUrl: null,
  input: m.vision ? ["text", "image"] : ["text"], pdf: !!m.pdf, context: Number(m.context) > 0 ? Number(m.context) : 128_000,
  maxTokens: Number(m.maxTokens) > 0 ? Math.min(Number(m.maxTokens), 64_000) : 16_384, thinking: m.reasoning ? "effort" : "none", search: null,
  families: Array.isArray(m.families) ? m.families : [], utility: !!m.utility, rank: Number(m.rank) || 0, cost: Array.isArray(m.cost) ? m.cost : null, tools: m.tools !== false,
});
/** The chosen models of an account whose list is its own (OpenRouter, Servidor propio). */
export function setDynamicModels(engine, list = []) {
  if (!DYNAMIC_ENGINES.includes(engine)) return;
  dynamic.set(engine, (Array.isArray(list) ? list : []).filter((m) => m && typeof m.id === "string" && m.id).map((m) => dynamicEntry(engine, m)));
}
/** A catalogue list, static or the account's own. */
export const catalogOf = (engine) => CATALOG[engine] || dynamic.get(engine) || [];

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
  return catalogOf(engine).find((m) => m.id === id) || null;
}

/**
 * Can this model look at images? ChatGPT models (bare slugs) can; a catalogue model says so in
 * `input`; an unknown model of another engine is treated as text only. Callers that build
 * messages drop images for text-only models and leave a note.
 */
export function supportsVision(ref) {
  const { engine } = parseRef(ref);
  if (engine === "openai") return true;
  return !!modelEntry(ref)?.input?.includes("image");
}
/** Can this model take a PDF as a file (not as extracted text)? Same rules as supportsVision. */
export function supportsPdf(ref) {
  const { engine } = parseRef(ref);
  if (engine === "openai") return true;
  return !!modelEntry(ref)?.pdf;
}

/** Shape of a catalogue model in the lists the rest of Colmena reads ({slug, label, …}). */
export const listEntry = (m) => ({ slug: m.ref, label: m.label, engine: m.provider, families: m.families, utility: !!m.utility, rank: m.rank, input: m.input, pdf: !!m.pdf });
