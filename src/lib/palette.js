// The pure part of the Ctrl+K palette (src/screens/CommandPalette.jsx), kept apart so it can
// be tested: what the query asks for and T3 Code's ranking (CommandPalette.logic.ts, ideas only).

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** «> nuevo» → {actionsOnly: true, query: "nuevo"}; anything else searches everything. */
export function parseQuery(text) {
  const t = String(text || "");
  const m = /^\s*>\s*/.exec(t);
  return m ? { actionsOnly: true, query: t.slice(m[0].length).trim() } : { actionsOnly: false, query: t.trim() };
}

/**
 * Every word of the query must appear in the item's terms; an exact term scores 3, a term
 * that starts with the query 2, one that contains it 1, and earlier terms (the title) weigh
 * more. Ties keep the original order (recent first). Returns the items that match.
 */
export function rank(items, query, termsOf = (x) => x.terms || [x.label]) {
  const q = fold(query);
  if (!q) return items;
  const words = q.split(/\s+/).filter(Boolean);
  const out = [];
  items.forEach((item, order) => {
    const terms = termsOf(item).map(fold).filter(Boolean);
    const all = terms.join(" ");
    if (!words.every((w) => all.includes(w))) return;
    let best = 0;
    terms.forEach((t, i) => {
      const r = t === q ? 3 : t.startsWith(q) ? 2 : t.includes(q) ? 1 : words.some((w) => t.includes(w)) ? 0.5 : 0;
      if (r) best = Math.max(best, 1000 - i * 100 + r);
    });
    out.push({ item, score: best || 1, order });
  });
  return out.sort((a, b) => b.score - a.score || a.order - b.order).map((x) => x.item);
}
