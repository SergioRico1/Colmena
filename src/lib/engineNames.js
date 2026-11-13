// The names of the AI accounts Colmena thinks with (server/providers/catalog.mjs ENGINE_LABEL),
// for the few places that need one before the state arrives or for an engine it no longer lists.
export const ENGINE_NAMES = Object.freeze({
  openai: "ChatGPT", anthropic: "Claude", "opencode-go": "OpenCode Go",
  gemini: "Gemini", openrouter: "OpenRouter", deepseek: "DeepSeek", moonshot: "Kimi", custom: "Servidor propio",
});
/** The accounts connected with one API key (Ajustes › Cuentas de IA › «Conectar otra IA»). */
export const KEY_ENGINES = Object.freeze(["gemini", "openrouter", "deepseek", "moonshot", "custom"]);
