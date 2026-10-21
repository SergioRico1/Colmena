// What a bot said while it worked, grouped with the tools each line announced (Parts.jsx).

/**
 * Each progress line with the tools it announced: tools belong to the latest line said
 * before them (the ones before the first line go with the first).
 */
export function trailGroups(lines = [], tools = []) {
  const index = new Map(tools.map((t, i) => [t.id, i]));
  const starts = lines.map((l) => Math.min(Infinity, ...(l.callIds || []).map((id) => index.get(id)).filter((n) => n != null)));
  return lines.map((line, k) => {
    const from = k === 0 ? 0 : starts[k];
    const next = starts.slice(k + 1).find((n) => Number.isFinite(n));
    return { line, tools: Number.isFinite(from) ? tools.slice(from, next ?? tools.length) : [] };
  });
}
