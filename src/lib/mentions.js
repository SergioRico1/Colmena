// «@» mentions of bots in conversations with people (server/peers/bots.mjs): whose bot each
// one is. Two people can each have a «Vera» in the same conversation, so a mention always
// carries its owner: the one picked with «@» says it; one written by hand is yours.
// Accents and case out, one character for one (so positions found in the folded text are the
// same in the original).
const fold = (s) => Array.from(String(s || ""), (ch) => {
  const f = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return f.length === ch.length ? f : ch;
}).join("");
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pattern = (name, flags = "u") => new RegExp("(^|[^\\p{L}\\p{N}])@" + escape(fold(name)) + "(?![\\p{L}\\p{N}])", flags);

/** Whether «@Nombre» is in `text` (accents and case do not matter, «@Veranito» is not «@Vera»). */
export const mentions = (text, name) => !!name && pattern(name).test(fold(text));

/**
 * The bots a message is for: the ones picked with «@» whose name is still in the text, then
 * your own bots written by hand («@Vera» with no pick is your Vera, never someone else's).
 * picks: [{owner, bot, name, …}] · myBots: [{id, name, …}] · me: your address.
 */
export function resolveMentions(text, picks = [], myBots = [], me = null) {
  const out = [];
  for (const p of picks) if (mentions(text, p.name) && !out.some((x) => x.owner === p.owner && x.bot === p.bot)) out.push(p);
  const named = new Set(out.map((x) => fold(x.name)));
  for (const b of myBots) {
    if (named.has(fold(b.name)) || !mentions(text, b.name)) continue;
    out.push({ owner: me, bot: b.id, name: b.name, color: b.color, shape: b.shape, mine: true });
  }
  return out;
}

/**
 * `text` cut into plain parts and mentions, for drawing each «@Nombre» as a pill with its
 * owner. `named`: [{name, …}] in the order they were picked; two «@Vera» go to the first and
 * then the second Vera named.
 */
export function mentionSegments(text, named = []) {
  if (!named.length) return [{ text }];
  const folded = fold(text);
  const hits = [];
  const used = new Map();
  for (const m of named) {
    const re = pattern(m.name, "gu");
    let hit;
    while ((hit = re.exec(folded))) {
      const start = hit.index + hit[1].length;
      if (!hits.some((h) => h.start === start)) hits.push({ start, end: start + 1 + fold(m.name).length, key: fold(m.name) });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const out = [];
  let at = 0;
  for (const h of hits) {
    const same = named.filter((m) => fold(m.name) === h.key);
    const n = used.get(h.key) || 0;
    used.set(h.key, n + 1);
    if (h.start > at) out.push({ text: text.slice(at, h.start) });
    out.push({ mention: same[Math.min(n, same.length - 1)], text: text.slice(h.start, h.end) });
    at = h.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
