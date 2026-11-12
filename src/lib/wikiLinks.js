// «Notas» (docs/CONTRACT.md §16): the pure helpers of the screens, shared with the tests.
// Links as the server reads them (server/wiki.mjs parseLinks): `[[Título]]`, `[[Título|texto]]`,
// `[[carpeta/Título]]`, `[[Título#Apartado]]`, `![[Título]]`. Not links: code blocks and code
// spans, an escaped `\[[`, `[[#Apartado]]` and embedded files (`![[foto.png]]`).

const ATTACHMENT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic|pdf|mp3|wav|m4a|ogg|mp4|mov|webm|zip|docx?|xlsx?|pptx?|csv|canvas|excalidraw)$/i;
const LINK = /(!?)\[\[([^[\]\n|]{1,240})(?:\|([^[\]\n]{0,240}))?\]\]/g;
const oneLine = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/** The prefix of the `href` a note link becomes inside Markdown (Markdown.jsx draws it). */
export const NOTE_HREF = "#nota:";

/** Accents folded, lower case: how titles are compared. */
export const foldText = (text) => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** «Año 2024 · Acme, S.L.» → «ano-2024-acme-s-l» (the server's slug, for titles with Latin letters or digits). */
export const slugOf = (text) => foldText(String(text ?? "").trim()).replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");

/** `md` with fenced blocks and code spans turned into spaces (same length, same lines). */
export function maskCode(md) {
  let fence = null;
  const blank = (line) => " ".repeat(line.length);
  const text = String(md ?? "").split("\n").map((line) => {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence.ch && m[1].length >= fence.n && !line.slice(m[0].length).trim()) fence = null;
      return blank(line);
    }
    if (m) { fence = { ch: m[1][0], n: m[1].length }; return blank(line); }
    return line;
  }).join("\n");
  if (!text.includes("`")) return text;
  let out = "", i = 0;
  const none = new Set(); // run lengths with no closing run from here on
  while (i < text.length) {
    const tick = text.indexOf("`", i);
    if (tick < 0) { out += text.slice(i); break; }
    out += text.slice(i, tick);
    let n = 0;
    while (text[tick + n] === "`") n++;
    let close = -1;
    if (!none.has(n)) {
      let j = tick + n;
      while (j < text.length) {
        if (text[j] !== "`") { j++; continue; }
        let k = 0;
        while (text[j + k] === "`") k++;
        if (k === n) { close = j; break; }
        j += k;
      }
      if (close < 0) none.add(n);
    }
    if (close < 0) { out += text.slice(tick, tick + n); i = tick + n; continue; }
    out += text.slice(tick, close + n).replace(/[^\n]/g, " ");
    i = close + n;
  }
  return out;
}

/** What is between the brackets → {name, heading}: the last part of a path, without `.md` or `#Apartado`. */
export function targetName(raw) {
  let target = String(raw ?? "").split("|")[0].trim(), heading = null;
  const hash = target.indexOf("#");
  if (hash >= 0) { heading = target.slice(hash + 1).trim() || null; target = target.slice(0, hash).trim(); }
  return { name: oneLine(target.split("/").pop().replace(/\.(md|markdown)$/i, "")), heading };
}

/**
 * The note links of a Markdown text, where they are: [{start, end, raw, name, text, heading, embed}].
 * `raw` is what is written before the `|` (the key POST /api/wiki/resolve answers with).
 */
export function findLinks(md) {
  const source = String(md ?? "");
  if (!source.includes("[[")) return [];
  const text = maskCode(source), out = [];
  for (const m of text.matchAll(LINK)) {
    if (m.index > 0 && text[m.index - 1] === "\\") continue;
    const raw = m[2].trim();
    const { name, heading } = targetName(raw);
    if (!name || ATTACHMENT.test(raw.split("#")[0].trim())) continue;
    out.push({ start: m.index, end: m.index + m[0].length, raw, name, text: oneLine(m[3]) || name, heading, embed: !!m[1] });
  }
  return out;
}

const escapeLabel = (text) => text.replace(/[\\[\]*_`<>]/g, "\\$&");
/** Markdown with every note link written as `[texto](#nota:<nombre>)`, which Markdown.jsx draws as a link to the note. */
export function linkifyNotes(md) {
  const source = String(md ?? "");
  const links = findLinks(source);
  if (!links.length) return source;
  let out = "", at = 0;
  for (const l of links) {
    out += source.slice(at, l.start) + `[${escapeLabel(l.text)}](${NOTE_HREF}${encodeURIComponent(l.raw)})`;
    at = l.end;
  }
  return out + source.slice(at);
}
/** A line of plain text (an excerpt, a search snippet) with its links as their words: «[[Acme|el cliente]]» → «el cliente». */
export const plainLinks = (text) => String(text ?? "").replace(/!?\[\[([^[\]\n|]{1,240})(?:\|([^[\]\n]{0,240}))?\]\]/g, (_, target, label) => (label || "").trim() || targetName(target).name || target);
/** The text of a note without a first heading that only repeats its title (Obsidian habit): the page already shows it. */
export function bodyWithoutTitle(body, title) {
  const m = /^\s*#\s+(.+?)\s*#*\s*(?:\n|$)/.exec(String(body ?? ""));
  return m && slugOf(m[1]) === slugOf(title) ? String(body).slice(m[0].length).replace(/^\n+/, "") : String(body ?? "");
}
/** The names a text links to, once each (what to ask the resolver for). */
export const linkTargets = (md) => [...new Set(findLinks(md).map((l) => l.raw))];
/** `#nota:Acme%20S.L.` → «Acme S.L.» (null when it is another kind of link). */
export function noteOfHref(href) {
  const s = String(href || "");
  if (!s.startsWith(NOTE_HREF)) return null;
  try { return decodeURIComponent(s.slice(NOTE_HREF.length)); } catch { return s.slice(NOTE_HREF.length); }
}
/** Where a note lives in the app. `key` is a slug, a title or an alias. */
export const noteUrl = (key, view = "") => `/biblioteca/notas/${encodeURIComponent(String(key ?? "").replace(/[/\\]/g, " ").trim())}${view ? "?ver=" + view : ""}`;

// ------------------------------------------------------------------ the editor's `[[` menu
/**
 * Is the caret inside an open `[[`? → {start (after the brackets), query}; null otherwise:
 * closed already, another line, after the `|` (that part is free text) or inside code.
 */
export function linkTrigger(text, caret) {
  const before = String(text ?? "").slice(0, caret);
  const open = before.lastIndexOf("[[");
  if (open < 0 || (open > 0 && before[open - 1] === "\\")) return null;
  const query = before.slice(open + 2);
  if (/[\]\n|[]/.test(query) || query.length > 120) return null;
  if (maskCode(before + "]]").slice(open, open + 2) !== "[[") return null;
  return { start: open + 2, query };
}
/**
 * What the menu offers for what is typed: titles (and aliases) that contain it, the ones that
 * start with it first; and «create new» when no page has exactly that name.
 */
export function linkOptions(pages, query, { limit = 8 } = {}) {
  const q = foldText(oneLine(query));
  const hits = [];
  for (const p of pages || []) {
    const names = [p.title, ...(p.aliases || [])];
    let best = -1, via = null;
    for (const [i, n] of names.entries()) {
      const at = foldText(n).indexOf(q);
      if (at < 0) continue;
      const score = (at === 0 ? 2 : 1) + (i === 0 ? 0.5 : 0);
      if (score > best) { best = score; via = i === 0 ? null : n; }
    }
    if (best >= 0) hits.push({ kind: "page", slug: p.slug, title: p.title, alias: via, folder: p.folder || "", score: best });
  }
  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "es"));
  const out = hits.slice(0, limit).map(({ score: _score, ...rest }) => rest);
  const name = oneLine(query);
  const slug = slugOf(name);
  const taken = (pages || []).some((p) => p.slug === slug || (p.aliases || []).some((a) => slugOf(a) === slug));
  if (name && slug && !taken && !/[#^]/.test(name)) out.push({ kind: "new", title: name });
  return out;
}
/** Puts the chosen title in place of what was typed after `[[` and closes it: {text, caret}. */
export function completeLink(text, caret, trigger, title) {
  const source = String(text ?? "");
  const rest = source.slice(caret);
  const closed = rest.startsWith("]]");
  const next = source.slice(0, trigger.start) + title + "]]" + (closed ? rest.slice(2) : rest);
  return { text: next, caret: trigger.start + title.length + 2 };
}

// ------------------------------------------------------------------ diff view model
/**
 * A unified patch («@@ -a,n +b,m @@») → what the diff view draws: rows with both line numbers,
 * and the counts. An empty patch means both texts are the same.
 */
export function diffModel(diff) {
  const patch = typeof diff === "string" ? diff : diff?.patch || "";
  const rows = [];
  let a = 0, b = 0, inHunk = false, added = 0, removed = 0;
  for (const line of String(patch).split("\n")) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) {
      a = Number(h[1]); b = Number(h[2]); inHunk = true;
      if (rows.length) rows.push({ type: "gap", a: null, b: null, text: "" });
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+")) { rows.push({ type: "add", a: null, b: b++, text: line.slice(1) }); added++; }
    else if (line.startsWith("-")) { rows.push({ type: "del", a: a++, b: null, text: line.slice(1) }); removed++; }
    else if (line.startsWith(" ")) rows.push({ type: "ctx", a: a++, b: b++, text: line.slice(1) });
  }
  const counts = { added: typeof diff === "object" && diff && Number.isFinite(diff.added) ? diff.added : added, removed: typeof diff === "object" && diff && Number.isFinite(diff.removed) ? diff.removed : removed };
  return { rows, ...counts, same: !rows.some((r) => r.type === "add" || r.type === "del"), truncated: !!(typeof diff === "object" && diff?.truncated) };
}
/** «3 líneas nuevas, 1 quitada». */
export function diffSummary({ added = 0, removed = 0 } = {}) {
  const parts = [];
  if (added) parts.push(added === 1 ? "1 línea nueva" : `${added} líneas nuevas`);
  if (removed) parts.push(removed === 1 ? "1 quitada" : `${removed} quitadas`);
  return parts.join(", ") || "Sin cambios";
}

// ------------------------------------------------------------------ graph layout
/**
 * Where each node of GET /api/wiki/graph goes, in a `width`×`height` box. Always the same
 * picture for the same data (no randomness, nothing moves afterwards):
 *   - with `focus`: that note in the middle and the rest in rings by how many links away;
 *   - without: a ring ordered by folder, the most linked notes pulled towards the middle.
 * → {nodes: [{id, title, exists, folder, degree, x, y, r, level}], edges: [{from, to, x1, y1, x2, y2}]}
 */
export function layoutGraph(graph, { focus = "", width = 720, height = 480 } = {}) {
  const nodes = [...(graph?.nodes || [])].sort((p, q) => String(p.id).localeCompare(String(q.id)));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (graph?.edges || []).filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const cx = width / 2, cy = height / 2, pad = 46;
  const round = (v) => Math.round(v * 10) / 10;
  const place = new Map();
  const level = new Map();
  const center = focus && ids.has(focus) ? focus : null;
  if (center) {
    const near = new Map(nodes.map((n) => [n.id, []]));
    for (const e of edges) { near.get(e.from).push(e.to); near.get(e.to).push(e.from); }
    level.set(center, 0);
    for (let queue = [center]; queue.length;) {
      const id = queue.shift();
      for (const next of [...near.get(id)].sort()) if (!level.has(next)) { level.set(next, level.get(id) + 1); queue.push(next); }
    }
    const far = Math.max(1, ...level.values());
    for (const n of nodes) if (!level.has(n.id)) level.set(n.id, far + 1);
    const rings = Math.max(...level.values());
    const step = Math.min(cx - pad, cy - pad) / Math.max(1, rings);
    for (let l = 0; l <= rings; l++) {
      const ring = nodes.filter((n) => level.get(n.id) === l);
      ring.forEach((n, i) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / ring.length + (l % 2 ? 0 : Math.PI / Math.max(1, ring.length));
        place.set(n.id, l === 0 ? [cx, cy] : [cx + Math.cos(angle) * step * l * ((cx - pad) / Math.min(cx - pad, cy - pad)), cy + Math.sin(angle) * step * l]);
      });
    }
  } else {
    const ring = [...nodes].sort((p, q) => String(p.folder || "").localeCompare(String(q.folder || "")) || String(p.id).localeCompare(String(q.id)));
    const top = Math.max(1, ...nodes.map((n) => n.degree || 0));
    ring.forEach((n, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, ring.length);
      const pull = ring.length < 3 ? 1 : 1 - 0.55 * ((n.degree || 0) / top);
      place.set(n.id, ring.length === 1 ? [cx, cy] : [cx + Math.cos(angle) * (cx - pad) * pull, cy + Math.sin(angle) * (cy - pad) * pull]);
    });
  }
  const radius = (n) => (n.id === center ? 11 : Math.min(10, 5 + Math.sqrt(n.degree || 0)));
  return {
    nodes: nodes.map((n) => ({ ...n, x: round(place.get(n.id)[0]), y: round(place.get(n.id)[1]), r: round(radius(n)), level: level.get(n.id) ?? null })),
    edges: edges.map((e) => ({ from: e.from, to: e.to, x1: round(place.get(e.from)[0]), y1: round(place.get(e.from)[1]), x2: round(place.get(e.to)[0]), y2: round(place.get(e.to)[1]) })),
  };
}

// ------------------------------------------------------------------ import preview
const plural = (n, one, many) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
/**
 * The answer of POST /api/wiki/import (preview or applied) → what the dialog shows: the
 * headline, the groups with their rows and whether there is anything to bring.
 */
export function importModel(plan) {
  const c = plan?.counts || {};
  const row = (kind) => (x) => ({ kind, path: x.path, title: x.title, folder: x.folder || "", note: x.renamed ? `Ya había otra con ese nombre: se llamará «${x.slug}»` : "" });
  const why = (kind) => (x) => ({ kind, path: x.path, title: x.path, folder: "", note: x.reason || "" });
  const groups = [
    { id: "create", title: "Notas nuevas", count: c.create || 0, rows: (plan?.create || []).map(row("create")) },
    { id: "update", title: "Ya las tienes y cambian", hint: "Su texto pasa a ser el que traes; el de ahora queda en su historial.", count: c.update || 0, rows: (plan?.update || []).map(row("update")) },
    { id: "same", title: "Ya las tienes, iguales", count: c.same || 0, rows: (plan?.same || []).map(row("same")) },
    { id: "skipped", title: "No se traen", count: (c.skipped || 0) + (c.rejected || 0), rows: [...(plan?.skipped || []).map(why("skipped")), ...(plan?.rejected || []).map(why("rejected"))] },
  ].filter((g) => g.count || g.rows.length);
  const changes = (c.create || 0) + (c.update || 0);
  const notes = [];
  if (c.attachments) notes.push(c.attachments === 1 ? "1 archivo que no es una nota (una imagen u otra cosa) no se trae." : `${c.attachments} archivos que no son notas (imágenes y demás) no se traen.`);
  if (c.embeds) notes.push(`${plural(c.embeds, "imagen incrustada se queda", "imágenes incrustadas se quedan")} como texto.`);
  if (c.ignored) notes.push(`${plural(c.ignored, "archivo de carpetas ocultas", "archivos de carpetas ocultas")} (como .obsidian) no cuenta.`);
  if (c.missing) notes.push(`${plural(c.missing, "enlace seguirá", "enlaces seguirán")} «por crear».`);
  if (plan?.truncated) notes.push("Las listas son largas: aquí ves solo una parte.");
  const headline = plan?.applied
    ? [c.create ? plural(c.create, "nota nueva", "notas nuevas") : null, c.update ? plural(c.update, "actualizada", "actualizadas") : null].filter(Boolean).join(" y ") || "No había nada que traer"
    : changes
      ? [c.create ? plural(c.create, "nota nueva", "notas nuevas") : null, c.update ? plural(c.update, "cambia", "cambian") : null, c.same ? plural(c.same, "ya está igual", "ya están iguales") : null].filter(Boolean).join(" · ")
      : c.same ? "Ya tienes todas estas notas, iguales" : "Aquí no hay notas que traer";
  return { applied: !!plan?.applied, planId: plan?.planId || null, canApply: !plan?.applied && changes > 0, changes, headline, groups, notes };
}

// ------------------------------------------------------------------ small words
/** Who last changed a page, in words: «Tú» or the bot's name. */
export const byName = (by) => (!by || by.kind === "person" ? "Tú" : by.name || "Un bot");
export const VERSION_REASON = { create: "Nota nueva", edit: "Cambio en el texto", rename: "Cambio de nombre", restore: "Vuelta a una versión anterior", import: "Traída de fuera" };
/** What a bot asks to do with a note (approval.wiki), as a title: «Crear la nota «Acme»». */
export function noteAskTitle(wiki) {
  if (!wiki) return "";
  const t = `«${wiki.title || "sin título"}»`;
  if (wiki.create || wiki.action === "create") return `Crear la nota ${t}`;
  if (wiki.action === "append") return `Añadir texto a la nota ${t}`;
  if (wiki.action === "section") return wiki.section ? `Cambiar «${wiki.section}» en la nota ${t}` : `Cambiar un apartado de la nota ${t}`;
  return `Cambiar la nota ${t}`;
}
