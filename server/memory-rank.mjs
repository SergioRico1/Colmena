// Local lexical ranking for the memory archive (memory.mjs): no embedding service and no
// model call. Spanish text is folded (accents, case), stop words are dropped and each word is
// cut to a light stem (plural, gender, «-mente»); a query word also matches a longer or
// shorter form that starts the same («trimestre» ↔ «trimestral», «factura» ↔ «facturar»).
// Ranking is Okapi BM25 over the archived entries.

const STOP = new Set((
  "a al algo algun alguna alguno algunas algunos ante antes aqui asi aun aunque bien cada casi como con contra cual cuales cuando " +
  "de del desde donde dos durante e el ella ellas ello ellos en entre era eran eres es esa esas ese eso esos esta estaba estan estar " +
  "estas este esto estos estoy fue fueron ha habia hace hacer hacia han has hasta hay haz hazme he hola hoy la las le les lo los luego " +
  "mas me mi mis mucho muy nada ni nos nosotros nuestra nuestro o os otra otras otro otros para pero poco por porque puede pueden " +
  "puedes puedo que quien quienes quiero se sea ser si sido sin sobre solo son soy su sus tal tambien tan te tengo ti tiene tienen " +
  "toda todas todo todos tu tus un una unas uno unos va vamos van vas ver vez voy y ya yo dime dame favor gracias necesito sabes " +
  "the and for with you"
).split(" "));
const NEGATION = new Set(["no", "nunca", "jamas", "tampoco", "ni"]);

export const foldText = (text) => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const wordsOf = (text) => foldText(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Light Spanish stem: «facturas» → «factur», «reuniones» → «reunion», «rápidamente» → «rapid». Numbers stay whole. */
export function stem(word) {
  let w = word;
  if (/^\d/.test(w)) return w;
  if (w.length > 7 && w.endsWith("mente")) w = w.slice(0, -5);
  if (w.length > 4 && w.endsWith("es")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s")) w = w.slice(0, -1);
  if (w.length > 4 && /[aeo]$/.test(w)) w = w.slice(0, -1);
  return w;
}

/** Content stems of a text, in order (stop words out; numbers kept, other words from 3 letters). */
export function terms(text) {
  const out = [];
  for (const w of wordsOf(text)) {
    if (STOP.has(w)) continue;
    if (/^\d/.test(w) ? false : w.length < 3) continue;
    out.push(stem(w));
  }
  return out;
}

const K1 = 1.2, B = 0.75, PREFIX_MIN = 5, PREFIX_WEIGHT = 0.7, MAX_QUERY_TERMS = 64;

/** BM25 index over `docs` = [{id, text, …}] (the documents are kept by reference in `docs`). */
export function buildIndex(docs) {
  const df = new Map();
  let total = 0;
  const entries = docs.map((doc) => {
    const tf = new Map();
    const list = terms(doc.text);
    for (const t of list) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    total += list.length;
    return { doc, tf, length: list.length };
  });
  return { entries, df, vocabulary: [...df.keys()], average: entries.length ? total / entries.length || 1 : 1 };
}

/**
 * Entries of the index that are about `query`, best first: [{doc, score, matched}].
 * An entry counts when two different words of the request appear in it, or one when the
 * request has at most two words that mean something, or one that is rare in the archive (a
 * name). `accept(doc)` filters before scoring. Entries far below the best one are dropped.
 */
export function rank(index, query, { accept = null, floor = 0.45 } = {}) {
  const wanted = [...new Set(terms(String(query || "").slice(0, 4000)))].slice(0, MAX_QUERY_TERMS);
  const n = index.entries.length;
  if (!wanted.length || !n) return [];
  const idf = (t) => { const d = index.df.get(t) || 0; return Math.log(1 + (n - d + 0.5) / (d + 0.5)); };
  const rare = Math.max(1, Math.floor(n * 0.02));
  // For each word of the request: the index terms it matches, with their weight.
  const matches = wanted.map((q) => {
    const list = [];
    if (index.df.has(q)) list.push([q, 1]);
    if (q.length >= PREFIX_MIN && !/^\d/.test(q))
      for (const t of index.vocabulary)
        if (t !== q && t.length >= PREFIX_MIN && (t.startsWith(q) || q.startsWith(t))) list.push([t, PREFIX_WEIGHT]);
    return { q, list, rare: q.length >= 4 && (index.df.get(q) || 0) > 0 && index.df.get(q) <= rare };
  }).filter((m) => m.list.length);
  if (!matches.length) return [];
  const out = [];
  for (const entry of index.entries) {
    if (accept && !accept(entry.doc)) continue;
    let score = 0, matched = 0, rareHit = false;
    for (const m of matches) {
      let best = 0;
      for (const [t, weight] of m.list) {
        const tf = entry.tf.get(t);
        if (!tf) continue;
        const s = weight * idf(t) * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * entry.length / index.average));
        if (s > best) best = s;
        if (weight === 1 && m.rare) rareHit = true;
      }
      if (best > 0) { score += best; matched++; }
    }
    if (!matched) continue;
    if (matched < 2 && wanted.length > 2 && !rareHit) continue;
    out.push({ doc: entry.doc, score, matched });
  }
  out.sort((a, b) => b.score - a.score || String(a.doc.id).localeCompare(String(b.doc.id)));
  const top = out[0]?.score || 0;
  return out.filter((x) => x.score >= top * floor);
}

/**
 * Conservative «same subject, different value» check between two facts: most of their words
 * are the same and what differs is one or two words on each side («cierra el 31 de diciembre»
 * / «cierra el 30 de junio»), or the words are the same and only one of them is negated. A
 * fact that only adds detail to the other is not a contradiction.
 */
export function contradicts(a, b) {
  const A = new Set(terms(a)), B2 = new Set(terms(b));
  if (!A.size || !B2.size) return false;
  let shared = 0;
  for (const t of A) if (B2.has(t)) shared++;
  const onlyA = A.size - shared, onlyB = B2.size - shared;
  const negated = (text) => wordsOf(text).some((w) => NEGATION.has(w));
  if (!onlyA && !onlyB) return shared >= 2 && negated(a) !== negated(b);
  if (negated(a) !== negated(b)) return false;
  return shared >= 2 && onlyA >= 1 && onlyB >= 1 && onlyA <= 2 && onlyB <= 2 && shared / (shared + onlyA + onlyB) >= 0.4;
}
