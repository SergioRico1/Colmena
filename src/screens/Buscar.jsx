// «Buscar» (/buscar?q=…): full-text search over the messages you may read in team messaging
// (GET /api/chat/search, server/cloud/chat.mjs › search and parseQuery). Filters: from:@persona,
// in:#canal, has:file|link|pin, before:/after:/on: AAAA-MM-DD, during: AAAA-MM (and their
// Spanish names). Each result opens the message in its channel, or its thread.
import { cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatCircleText, Hash, LockSimple, Search, Paperclip, Pin } from "../components/Icon.js";
import { navigate } from "../lib/router.jsx";
import { chat, fileUrl } from "../chat/api.js";
import { channelTitle, mergeGhosts, nameOf, useChat } from "../chat/store.js";
import { Avatar, ChatPage, Empty, sizeOf, whenOf } from "../chat/ui.jsx";
import { MessageText } from "../chat/format.jsx";
import "../chat/people.css";

const FILTER = /^(from|de|in|en|has|tiene|before|antes|after|despues|después|on|el|during|durante):/i;
const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The plain words of a query (filters out), folded as the server folds them. */
function termsOf(q) {
  const out = new Set();
  for (const raw of String(q || "").match(/(?:[a-z]+:)?(?:"[^"]*"|<[^>]*>|\S+)/gi) || []) {
    if (FILTER.test(raw)) continue;
    for (const w of fold(raw.replace(/^"|"$/g, "")).split(/[^\p{L}\p{N}]+/u)) if (w.length >= 2) out.add(w);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** A string with the words that start with a term wrapped in <mark> (accents and case ignored). */
function markString(str, terms, key) {
  let folded = "";
  const at = []; // folded index → [start, end) in str
  let i = 0;
  for (const ch of str) {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) { folded += f[k]; at.push([i, i + ch.length]); }
    i += ch.length;
  }
  const ranges = [];
  for (const t of terms) {
    for (let x = folded.indexOf(t); x !== -1; x = folded.indexOf(t, x + t.length)) {
      if (x > 0 && /[\p{L}\p{N}]/u.test(folded[x - 1])) continue;
      ranges.push([at[x][0], at[x + t.length - 1][1]]);
    }
  }
  if (!ranges.length) return str;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) { const last = merged[merged.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]); }
  const out = [];
  let from = 0;
  merged.forEach(([a, b], n) => {
    if (a > from) out.push(str.slice(from, a));
    out.push(<mark key={key + "m" + n} className="ch-mark">{str.slice(a, b)}</mark>);
    from = b;
  });
  if (from < str.length) out.push(str.slice(from));
  return out;
}
/** The same React tree with the text inside it marked (React escapes everything, as before). */
function markTree(node, terms, key = "k") {
  if (typeof node === "string") return markString(node, terms, key);
  if (Array.isArray(node)) return node.map((n, i) => markTree(n, terms, key + "." + i));
  if (isValidElement(node) && node.props?.children != null) return cloneElement(node, undefined, markTree(node.props.children, terms, key + "c"));
  return node;
}
function Highlighted({ text, terms }) {
  // MessageText has no hooks: called as a function, its tree can be marked before React draws it.
  const tree = MessageText({ text });
  return terms.length ? markTree(tree, terms) : tree;
}

const HELP = [
  { insert: "from:@", label: "from:@persona", title: "Mensajes de alguien" },
  { insert: "in:#", label: "in:#canal", title: "En un canal (o in:@persona para un mensaje directo)" },
  { insert: "has:file ", label: "has:file", title: "Con archivos" },
  { insert: "has:link ", label: "has:link", title: "Con enlaces" },
  { insert: "has:pin ", label: "has:pin", title: "Fijados" },
  { insert: "before:", label: "before:2026-01-31", title: "Antes de un día" },
  { insert: "after:", label: "after:", title: "Después de un día" },
  { insert: "on:", label: "on:", title: "Un día concreto" },
  { insert: "during:", label: "during:2026-03", title: "Durante un mes o un año" },
];

function channelLabel(c, channels) {
  if (c.kind === "dm" || c.kind === "group") {
    const ch = channels.get(c.id);
    return { icon: ChatCircleText, text: ch ? channelTitle(ch) : "Mensaje directo" };
  }
  return { icon: c.kind === "private" ? LockSimple : Hash, text: c.name || channels.get(c.id)?.name || "canal" };
}
const linkOf = (r) => "/canal/" + encodeURIComponent(r.channel.id) + (r.message.threadId ? "?hilo=" + encodeURIComponent(r.message.threadId) : "?m=" + encodeURIComponent(r.message.id));

export default function Buscar({ query = {} }) {
  const s = useChat();
  const q = String(query.q || "");
  const [text, setText] = useState(q);
  const [seen, setSeen] = useState(q);
  const [res, setRes] = useState({ status: "idle", results: [], next: null, unknown: [], error: null, more: false });
  const input = useRef(null);
  const ask = useRef(0);

  // The address changed (back, a link): the field follows it.
  if (seen !== q) { setSeen(q); setText(q); }

  const run = useCallback(async (value, before = null) => {
    const id = ++ask.current;
    setRes((r) => (before ? { ...r, more: true, error: null } : { status: "loading", results: [], next: null, unknown: [], error: null, more: false }));
    try {
      const out = await chat.get("/search?q=" + encodeURIComponent(value) + (before != null ? "&before=" + encodeURIComponent(before) : ""));
      if (id !== ask.current) return;
      mergeGhosts(out.ghosts);
      setRes((r) => ({
        status: "done",
        results: before ? [...r.results, ...(out.results || [])] : out.results || [],
        next: out.next ?? null, unknown: out.unknown || [], error: null, more: false,
      }));
    } catch (error) {
      if (id !== ask.current) return;
      setRes((r) => (before ? { ...r, more: false, error: error.message || "No se pudo buscar." } : { ...r, status: "error", error: error.message || "No se pudo buscar.", more: false }));
    }
  }, []);

  useEffect(() => {
    if (!q.trim()) { ask.current++; setRes({ status: "idle", results: [], next: null, unknown: [], error: null, more: false }); return; }
    run(q.trim());
  }, [q, run]);

  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);

  const submit = (e) => {
    e?.preventDefault();
    const v = text.trim();
    if (v === q.trim() && v) { run(v); return; }
    navigate(v ? "/buscar?q=" + encodeURIComponent(v) : "/buscar", { replace: true });
  };
  const insert = (token) => {
    const v = text.replace(/\s+$/, "");
    const next = (v ? v + " " : "") + token;
    setText(next);
    requestAnimationFrame(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(next.length, next.length); } });
  };
  const searchFor = (v) => { setText(v); navigate("/buscar?q=" + encodeURIComponent(v), { replace: true }); };

  const terms = useMemo(() => termsOf(q), [q]);
  const examples = useMemo(() => {
    const out = [];
    const pub = [...s.channels.values()].find((c) => c.kind === "public" && c.name);
    if (pub) out.push(["in:#" + pub.name + " has:pin", "Lo fijado en #" + pub.name]);
    out.push(["has:file during:" + new Date().toISOString().slice(0, 7), "Archivos de este mes"]);
    if (s.me?.email) out.push(["from:@" + s.me.email + " has:link", "Enlaces que has compartido"]);
    return out;
  }, [s.channels, s.me?.email]);

  const openRow = (e, r) => {
    if (e.target.closest("a,button,input,textarea,select,label") || window.getSelection()?.toString()) return;
    navigate(linkOf(r));
  };

  return (
    <ChatPage title="Buscar" active="buscar">
      <div className="ch-section sr-section">
        <form className="sr-form" role="search" onSubmit={submit}>
          <div className="sr-field">
            <Search size={18} aria-hidden="true" />
            <input ref={input} className="ch-input sr-input" type="search" value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Busca mensajes y archivos" aria-label="Buscar mensajes" enterKeyHint="search" autoComplete="off" spellCheck={false} />
          </div>
          <button type="submit" className="ch-btn is-primary sr-submit">Buscar</button>
        </form>
        <div className="sr-help">
          <span className="sr-help-label">Filtros</span>
          <div className="sr-help-chips r-scroll-x">
            {HELP.map((h) => <button key={h.label} type="button" className="sr-token" title={h.title} onClick={() => insert(h.insert)}>{h.label}</button>)}
          </div>
        </div>
        <p className="ch-hint sr-help-es">En español también: de:, en:, tiene:archivo|enlace|fijado, antes:, despues:, el:, durante:.</p>

        {res.status === "idle" ? (
          <div className="sr-idle">
            <h2 className="ch-section-title">Prueba con</h2>
            <ul className="sr-examples">
              {examples.map(([v, label]) => (
                <li key={v}><button type="button" className="sr-example" onClick={() => searchFor(v)}><span>{label}</span><code>{v}</code></button></li>
              ))}
            </ul>
          </div>
        ) : null}

        {res.status === "loading" ? <p className="sr-state" role="status">Buscando…</p> : null}

        {res.status === "error" ? (
          <div className="ch-error sr-error" role="alert">
            <span>{res.error}</span>
            <button type="button" className="ch-btn" onClick={() => run(q.trim())}>Reintentar</button>
          </div>
        ) : null}

        {res.status === "done" && res.unknown.length ? (
          <p className="sr-unknown" role="status">No hemos entendido {res.unknown.length === 1 ? "este filtro" : "estos filtros"}: {res.unknown.map((u, i) => <code key={u + i}>{u}</code>)}. Comprueba el nombre de la persona o del canal.</p>
        ) : null}

        {res.status === "done" && !res.results.length ? (
          <Empty title="Sin resultados">
            {res.unknown.length ? "Corrige los filtros que no hemos entendido y vuelve a buscar." : "Prueba con menos palabras, otra forma de escribirlas o quita algún filtro."}
          </Empty>
        ) : null}

        {res.results.length ? (
          <>
            <p className="sr-count" role="status">{res.next ? `Los ${res.results.length} más recientes` : res.results.length === 1 ? "1 resultado" : `${res.results.length} resultados`}</p>
            <ol className="sr-list">
              {res.results.map((r) => {
                const m = r.message;
                const where = channelLabel(r.channel, s.channels);
                const WhereIcon = where.icon;
                const author = m.botName || nameOf(m.author, s);
                return (
                  <li key={m.id} className="sr-item" onClick={(e) => openRow(e, r)}>
                    <Avatar id={m.author} size={32} presence={false} />
                    <div className="sr-main">
                      <div className="sr-head">
                        <span className="sr-author ch-ellipsis">{author}</span>
                        {m.botName ? <span className="sr-via ch-ellipsis">vía {nameOf(m.author, s)}</span> : null}
                        <time className="sr-time" dateTime={new Date(m.at).toISOString()}>{whenOf(m.at)}</time>
                      </div>
                      <a className="sr-where" href={linkOf(r)}>
                        <WhereIcon size={13} aria-hidden="true" />
                        <span className="ch-ellipsis">{where.text}</span>
                        {m.threadId ? <span className="sr-thread">en un hilo</span> : null}
                        {m.pinned ? <span className="sr-pin"><Pin size={12} />Fijado</span> : null}
                        <span className="sr-sr-only">: abrir el mensaje</span>
                      </a>
                      {m.text ? <div className="sr-text"><Highlighted text={m.text} terms={terms} /></div> : null}
                      {m.files?.length ? (
                        <div className="sr-files">
                          {m.files.map((f) => (
                            <a key={f.id} className="ch-chip sr-file" href={fileUrl(f.id)} target="_blank" rel="noopener noreferrer">
                              <Paperclip size={12} aria-hidden="true" />
                              <span className="ch-ellipsis">{terms.length ? markString(f.name || "archivo", terms, f.id) : f.name || "archivo"}</span>
                              {f.size ? <span className="sr-file-size">{sizeOf(f.size)}</span> : null}
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
            {res.error ? <p className="ch-error" role="alert">{res.error}</p> : null}
            {res.next != null ? (
              <div className="sr-more">
                <button type="button" className="ch-btn" disabled={res.more} onClick={() => run(q.trim(), res.next)}>{res.more ? "Cargando…" : "Más resultados"}</button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </ChatPage>
  );
}
