// What ChatGPT already knows about you, brought into Colmena's memory (OpenClaw: memory-wiki
// chatgpt-import.ts and the memory migration of src/commands/migrate). Read here, on this
// computer: the file is never changed or sent anywhere, only the lines you keep reach the
// memory. Two sources:
//  · the list from ChatGPT › Ajustes › Personalización › Memoria › Gestionar (copied and pasted);
//  · conversations.json from «Exportar datos»: only the active branch of each conversation,
//    the first 25 of your messages, and only sentences that state a preference or a fact about
//    you (at most 10 per conversation). Conversations about health, money, legal matters,
//    relationships or drugs are left out entirely (OpenClaw CHATGPT_RISK_RULES).
export const IMPORT_LIMITS = { fileBytes: 64 * 1024 * 1024, items: 120, perConversation: 10, userMessages: 25, minChars: 8, maxChars: 400 };

const clean = (s) => String(s || "").replace(/[​-‍⁠﻿]/g, "").replace(/\s+/g, " ").trim();
const fold = (s) => clean(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function dedupe(items) {
  const seen = new Set();
  return items.filter((it) => {
    const k = fold(it.text);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The pasted memory list: one memory per line (bullets, numbers and quotes are removed). */
export function parseMemoryText(text) {
  const items = String(text || "")
    .split(/\r?\n|(?<=\.)\s+(?=[-•*]\s)/)
    .map((line) => clean(line.replace(/^\s*(?:[-•*·]|\d+[.)])\s*/, "").replace(/^["'«“]+|["'»”]+$/g, "")))
    .filter((line) => line.length >= IMPORT_LIMITS.minChars && line.length <= IMPORT_LIMITS.maxChars)
    .filter((line) => !/^(memoria|memory|gestionar memoria|manage memory|borrar|delete)$/i.test(line))
    .map((text) => ({ text, from: "Memoria de ChatGPT" }));
  return dedupe(items).slice(0, IMPORT_LIMITS.items);
}

// Sensitive topics: the whole conversation stays out (it is not a durable preference).
const RISK = /\b(salud|m[eé]dic|enfermedad|diagn[oó]stic|terapia|psic[oó]log|ansiedad|depresi[oó]n|embaraz|medicaci|health|doctor|therapy|diagnos|abogad|demanda|juicio|denuncia|hacienda|impuesto|lawyer|lawsuit|tax|deuda|pr[eé]stamo|hipoteca|inversi[oó]n|cripto|n[oó]mina|salario|loan|debt|mortgage|salary|pareja|divorcio|novi[oa]|ruptura|relationship|divorce|boyfriend|girlfriend|droga|alcohol|cannabis|drug)/i;
// A sentence that tells something lasting about you.
const SIGNAL = /\b(prefiero|preferir[ií]a|me gusta|no me gusta|odio|siempre|nunca|suelo|evito|ll[aá]mame|me llamo|trabajo (?:en|como|para|con)|soy (?:de|un|una|el|la)|mi empresa|mi equipo|mi negocio|vivo en|uso|utilizo|escr[ií]beme|resp[oó]ndeme|i prefer|i like|i don'?t like|i always|i never|call me|my name is|i work|i live|i use|my company)\b/i;

function textOf(message) {
  const c = message?.content;
  if (!c) return "";
  if (Array.isArray(c.parts)) return c.parts.filter((p) => typeof p === "string").join("\n");
  if (typeof c.text === "string") return c.text;
  return "";
}

/** The messages of the branch that was last shown (current_node back to the root). */
function activeBranch(conv) {
  const map = conv?.mapping;
  if (!map || typeof map !== "object") return [];
  let node = conv.current_node && map[conv.current_node] ? conv.current_node : null;
  if (!node) {
    // No current node: the deepest leaf.
    node = Object.keys(map).find((k) => !(map[k].children || []).length) || null;
  }
  const out = [];
  const seen = new Set();
  while (node && map[node] && !seen.has(node)) {
    seen.add(node);
    if (map[node].message) out.push(map[node].message);
    node = map[node].parent;
  }
  return out.reverse();
}

/** conversations.json (an array, or an object with one) → candidate memories. */
export function parseConversations(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.conversations) ? json.conversations : null;
  if (!list) throw Error("No es el archivo conversations.json de la exportación de ChatGPT.");
  const items = [];
  let withheld = 0, used = 0;
  for (const conv of list) {
    if (!conv || !(conv.conversation_id || conv.id)) continue;
    const mine = activeBranch(conv).filter((m) => m?.author?.role === "user").slice(0, IMPORT_LIMITS.userMessages).map(textOf)
      // Pointers to images and files (asset JSON) are not text you wrote.
      .filter((t) => t && !(/^\s*\{/.test(t) && /asset_pointer|file-service|dalle/i.test(t)));
    if (!mine.length) continue;
    if (RISK.test(String(conv.title || "")) || mine.some((t) => RISK.test(t))) { withheld++; continue; }
    const found = [];
    for (const t of mine) {
      for (const sentence of t.split(/(?<=[.!?])\s+|\n+/)) {
        const s = clean(sentence);
        if (s.length < 15 || s.length > 300 || !SIGNAL.test(s) || /[?¿]$/.test(s)) continue;
        found.push({ text: "Dijo en ChatGPT: «" + s.replace(/[«»]/g, "\"") + "»", from: clean(conv.title) || "Conversación de ChatGPT" });
        if (found.length >= IMPORT_LIMITS.perConversation) break;
      }
      if (found.length >= IMPORT_LIMITS.perConversation) break;
    }
    if (found.length) used++;
    items.push(...found);
  }
  return { items: dedupe(items).slice(0, IMPORT_LIMITS.items), stats: { conversations: list.length, used, withheld } };
}
