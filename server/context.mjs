// Context hygiene of a bot's step (OpenClaw/Hermes; thresholds and shapes after DeepSeek
// Harness compaction-basic, token-meter and tool-result-pruner — MIT, ideas only): the
// budget scales with the model's context window, old tool outputs keep their head and tail,
// and the middle of a long history becomes a summary while the person's own messages stay.

/** Sizes, in tokens unless they say chars. */
export const CONTEXT = Object.freeze({
  window: 272_000, // assumed when the model's window is unknown
  maxOutput: 32_000, // what one answer may take, when the model does not say
  outputCap: 64_000, // what the adapters ask for at most (anthropic.mjs, completions.mjs)
  headroom: 65_536, // room kept on top of the answer before compacting (DSH)
  threshold: 0.8, // compact at this share of the window at most
  retain: 0.16, // newest share of (window − answer) kept verbatim
  trim: 0.35, // old outputs are pruned from this share of the compaction point
  charsPerToken: 3, // Spanish JSON, on the pessimistic side
  keepRecent: 8, // entries whose outputs are never pruned
  tail: 6, // entries kept by compactHistory when no cut is given
  pruneAt: 8192, head: 4096, tailChars: 1024, // old-output pruner (chars)
  spillTokens: 12_500, // a tool output above this is saved to a file (spill.mjs)
  personChars: 4000, // each message of the person kept through a compaction
});

const positive = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : 0);

/**
 * Token budget of one model: compact at floor(min(W·0.8, W − output − 64 k)), keep the newest
 * 16 % of (W − output) verbatim, prune old outputs from 35 % of the compaction point. A small
 * window (local models) caps the answer and the headroom at a quarter of it each.
 */
export function contextBudget({ window, maxOutput } = {}) {
  const w = positive(window) || CONTEXT.window;
  const out = Math.min(positive(maxOutput) || CONTEXT.maxOutput, CONTEXT.outputCap, Math.floor(w / 4));
  const headroom = Math.min(CONTEXT.headroom, Math.floor(w / 4));
  const compactAt = Math.floor(Math.min(w * CONTEXT.threshold, w - out - headroom));
  return {
    window: w,
    maxOutput: out,
    compactAt,
    keep: Math.min(Math.floor((w - out) * CONTEXT.retain), Math.floor(compactAt / 2)),
    trimAt: Math.floor(compactAt * CONTEXT.trim),
    // Past the whole window a request cannot fit, whatever the estimate's error.
    hardLimit: w,
  };
}

// Size of a history as the model sees it: a screenshot counts as a small fixed cost, not as
// the hundreds of thousands of base64 characters it takes to carry it.
const IMAGE_COST = "x".repeat(4000);
export function contextSize(history) {
  return JSON.stringify(history, (k, v) => (k === "image_url" && typeof v === "string" && v.startsWith("data:") ? IMAGE_COST : v)).length;
}
/** Estimated tokens of a text or of history items (~3 characters per token). */
export function estimateTokens(value) {
  if (value === undefined || value === null) return 0;
  const chars = typeof value === "string" ? value.length : contextSize(value);
  return Math.ceil(chars / CONTEXT.charsPerToken);
}

// ------------------------------------------------------------------ notes and summaries
/** How the summary of a compaction starts (also how an earlier one is recognised). */
export const SUMMARY_HEAD = "[Resumen del trabajo hasta ahora — Colmena lo ha condensado para ahorrar contexto; los mensajes de la persona siguen literales arriba]\n\n";
// Items Colmena itself adds to a history with the person's shape ({role: "user"}): summaries,
// «[Colmena] …» nudges, the restart note, the mission's news. They are never kept as the
// person's words through a compaction: the summarizer reads (and merges) them instead.
const NOTE_PREFIXES = [
  "[Resumen del trabajo hasta ahora", "[Resumen de lo que hablamos antes", "[Colmena", "Colmena se reinició",
  "Actualización de la misión", "Llama a propose_plan", "No consigues avanzar",
];
const textOf = (item) => typeof item?.content === "string" ? item.content
  : Array.isArray(item?.content) ? String(item.content.find((p) => typeof p?.text === "string")?.text || "") : "";
export const isColmenaNote = (item) => item?.role === "user" && !item.type && NOTE_PREFIXES.some((p) => textOf(item).startsWith(p));
export const isSummary = (item) => item?.role === "user" && !item.type && textOf(item).startsWith("[Resumen del trabajo hasta ahora");
/** A message the person really wrote (or the request itself): kept literally through a compaction. */
export const isPersonMessage = (item) => item?.role === "user" && !item.type && !isColmenaNote(item);

// ------------------------------------------------------------------ old-output pruner
const PRUNE_TAG = "[… recortado por Colmena:";
const SPILLED = /\[Colmena guardó la salida completa[^«]*«([^»]+)»/;
// Never split a surrogate pair at a cut.
const headOf = (text, n) => (n > 0 && /[\uD800-\uDBFF]/.test(text[n - 1] || "") ? text.slice(0, n - 1) : text.slice(0, n));
const tailOf = (text, n) => {
  if (n <= 0) return "";
  const at = text.length - n;
  return /[\uDC00-\uDFFF]/.test(text[at] || "") ? text.slice(at + 1) : text.slice(at);
};
export { headOf, tailOf };

/**
 * An old tool output keeps its first 4096 and last 1024 characters around a marker, so the
 * bot still sees what it was (and where the whole thing is, when it was spilled to a file)
 * without running the tool again. Unchanged when short or already pruned.
 */
export function pruneOutput(output, { limit = CONTEXT.pruneAt, head = CONTEXT.head, tail = CONTEXT.tailChars } = {}) {
  if (typeof output !== "string" || output.length <= limit || output.includes(PRUNE_TAG)) return output;
  const spilled = SPILLED.exec(output)?.[1] || null;
  const start = headOf(output, head), end = tailOf(output, tail);
  const cut = output.length - start.length - end.length;
  const marker = `\n\n${PRUNE_TAG} ${cut} caracteres del centro de este resultado antiguo` +
    (spilled ? `; la salida completa está en «${spilled}»: léela con read_file si la necesitas` : "; si necesitas esa parte, vuelve a pedirla") + " …]\n\n";
  return start + marker + end;
}
export const isPruned = (output) => typeof output === "string" && output.includes(PRUNE_TAG);

/**
 * Old tool outputs (outside the last `keepRecent` entries, longer than `limit` characters)
 * are pruned to their head and tail. Only once the history passes `minSize` characters, and
 * then all of them at once: the history stays append-only round after round, so the prompt
 * cache keeps serving it (pruning a little every round would make the model re-read the
 * latest results each time). Same array if nothing changes.
 */
export function trimHistory(history, { keepRecent = CONTEXT.keepRecent, limit = CONTEXT.pruneAt, minSize = contextBudget().trimAt * CONTEXT.charsPerToken, target = minSize / 2 } = {}) {
  if (!Array.isArray(history)) return history;
  if (minSize > 0 && contextSize(history) <= minSize) return history;
  const pass = (from, keep) => {
    const cut = from.length - keep;
    let changed = false;
    const next = from.map((item, i) => {
      if (i >= cut || item?.type !== "function_call_output") return item;
      const output = pruneOutput(item.output, { limit });
      if (output === item.output) return item;
      changed = true;
      return { ...item, output };
    });
    return changed ? next : from;
  };
  let next = pass(history, keepRecent);
  // Leave room to grow (`target`, half the threshold) so the next prune is many rounds away;
  // the last two entries always stay whole.
  for (let keep = keepRecent - 2; target > 0 && keep >= 2 && contextSize(next) > target; keep -= 2) next = pass(next, keep);
  return next;
}

// ------------------------------------------------------------------ compaction
/**
 * Positions where a history may be cut into [summarized | kept]: no function call is
 * separated from its output and no reasoning item from what follows it. 1..length.
 */
export function safeCuts(history) {
  const n = history.length;
  const calls = new Map();
  history.forEach((x, i) => { if (x?.type === "function_call") calls.set(x.call_id, i); });
  // blocked[i]: cutting before i would split a call (at c < i) from its output (at j ≥ i).
  const delta = new Array(n + 2).fill(0);
  history.forEach((x, j) => {
    if (x?.type !== "function_call_output") return;
    const c = calls.get(x.call_id);
    if (c === undefined || c >= j) return;
    delta[c + 1] += 1;
    delta[j + 1] -= 1;
  });
  const ok = [];
  let open = 0;
  for (let i = 1; i <= n; i++) {
    open += delta[i];
    if (open === 0 && history[i - 1]?.type !== "reasoning") ok.push(i);
  }
  return ok;
}

/**
 * Where to cut for a compaction that keeps about `keepTokens` of the newest entries verbatim
 * (0: as little as possible — a provider-confirmed overflow). Null when nothing before the cut
 * would be summarized.
 */
export function compactCut(history, keepTokens = 0) {
  if (!Array.isArray(history) || history.length < 2) return null;
  let desired = history.length, kept = 0;
  while (desired > 1 && keepTokens > 0) {
    const cost = estimateTokens(history[desired - 1]);
    if (kept + cost > keepTokens) break;
    kept += cost;
    desired -= 1;
  }
  const cuts = safeCuts(history).filter((i) => i > 1);
  // The nearest safe cut that keeps at least the wanted tail, else the nearest after it.
  const cut = [...cuts].reverse().find((i) => i <= desired) ?? cuts.find((i) => i > desired) ?? null;
  return cut && cut > 1 ? cut : null;
}

/**
 * Replaces history[1..cut) with a summary: the first message and the person's messages stay
 * literal (Colmena's own notes and an earlier summary do not: the summarizer merged them);
 * history[cut..] stays as it is. Without `cut`, the last `tail` entries are kept (moved to a
 * safe cut, so no output loses its call).
 */
export function compactHistory(history, summary, { tail = CONTEXT.tail, cut = null } = {}) {
  const first = history[0];
  let at = cut;
  if (!Number.isInteger(at)) {
    const desired = Math.max(1, history.length - tail);
    const cuts = safeCuts(history);
    at = [...cuts].reverse().find((i) => i <= desired) ?? cuts.find((i) => i > desired) ?? history.length;
  }
  at = Math.max(1, Math.min(history.length, at));
  const person = history.slice(1, at)
    .filter(isPersonMessage)
    .map((x) => ({ role: "user", content: typeof x.content === "string" ? x.content.slice(0, CONTEXT.personChars) : x.content }));
  return [first, ...person, { role: "user", content: SUMMARY_HEAD + summary }, ...history.slice(at)];
}

