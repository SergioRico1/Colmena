// The emoji panel (as in Slack): search by Spanish name or word, «Frecuentes», one tab per group,
// a preview of the emoji under the pointer and your skin tone. Drawn with Blobmoji
// (./index.jsx). It opens next to the button that asked for it (`anchor`, an element), above or
// below where it fits, in a layer of its own so a scrolling list cannot clip it.
// Used for reactions (src/chat/Message.jsx) and to write an emoji (src/chat/Composer.jsx).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "../../components/Icon.js";
import { spriteStyle, useEmojiData } from "./index.jsx";
import "./emoji.css";

const RECENT_KEY = "colmena.emoji.recent";
const TONE_KEY = "colmena.emoji.tone";
const DEFAULT_RECENT = ["👍", "❤️", "😂", "🎉", "🙏", "👀", "✅", "🔥", "😊", "👏", "🙌", "💪", "😅", "🤔", "😍", "🚀", "👌", "💯"];
const TABS = { recent: "🕘", "smileys-emotion": "😀", "people-body": "👋", "animals-nature": "🐻", "food-drink": "🍔", "travel-places": "✈️", activities: "⚽", objects: "💡", symbols: "❤️", flags: "🏁" };
const TONES = ["✋", "✋🏻", "✋🏼", "✋🏽", "✋🏾", "✋🏿"];
const TONE_NAMES = ["Sin tono", "Tono de piel claro", "Tono de piel claro medio", "Tono de piel medio", "Tono de piel oscuro medio", "Tono de piel oscuro"];
const COLS = 9;
const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const read = (k, fallback) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/** Remembers an emoji you used (the first ones of «Frecuentes»). */
export function rememberEmoji(char) {
  const list = read(RECENT_KEY, []).filter((c) => c !== char);
  write(RECENT_KEY, [char, ...list].slice(0, 36));
}
/** «Frecuentes»: what you used last, then the usual ones. */
export function recentEmoji(n = 27) {
  return [...new Set([...read(RECENT_KEY, []), ...DEFAULT_RECENT])].slice(0, n);
}

function Cell({ d, entry, tone, onPick, onHover }) {
  const shown = tone && entry.skins ? entry.skins[tone - 1] : entry;
  return (
    <button type="button" className="emp-cell" aria-label={entry.label} onClick={() => onPick(shown.char)} onMouseEnter={() => onHover(entry, shown)} onFocus={() => onHover(entry, shown)}>
      <span className="emo" aria-hidden="true" style={spriteStyle(d, shown, 28)} />
    </button>
  );
}

export default function EmojiPicker({ anchor, onPick, onClose, title = "Emoji" }) {
  const d = useEmojiData();
  const box = useRef(null);
  const body = useRef(null);
  const search = useRef(null);
  const [query, setQuery] = useState("");
  const [tone, setTone] = useState(() => Math.max(0, Math.min(5, Number(read(TONE_KEY, 0)) || 0)));
  const [toneOpen, setToneOpen] = useState(false);
  const [hover, setHover] = useState(null); // {entry, shown}
  const [active, setActive] = useState("recent");
  const [place, setPlace] = useState(null);

  // Where it opens: under the button when it fits, else above; never off the screen.
  useLayoutEffect(() => {
    const at = () => {
      const r = anchor?.getBoundingClientRect?.();
      const w = Math.min(360, window.innerWidth - 16), h = Math.min(430, window.innerHeight - 16);
      if (!r) return setPlace({ left: (window.innerWidth - w) / 2, top: (window.innerHeight - h) / 2, w, h });
      const below = r.bottom + 6 + h <= window.innerHeight - 8;
      const top = below ? r.bottom + 6 : Math.max(8, r.top - 6 - h);
      const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
      setPlace({ left, top, w, h });
    };
    at();
    window.addEventListener("resize", at);
    return () => window.removeEventListener("resize", at);
  }, [anchor]);
  const placed = place != null;
  useEffect(() => { if (placed) search.current?.focus({ preventScroll: true }); }, [placed]);
  useEffect(() => {
    const down = (e) => { if (box.current && !box.current.contains(e.target) && !anchor?.contains?.(e.target)) onClose(); };
    const key = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); anchor?.focus?.(); } };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key, true); };
  }, [anchor, onClose]);

  const groups = useMemo(() => {
    if (!d) return [];
    const seen = new Set();
    const recent = recentEmoji().map((c) => d.byKey.get(c.replace(/\uFE0F/g, ""))).filter((e) => e && !seen.has(e.char) && seen.add(e.char));
    return [
      { key: "recent", label: "Frecuentes", items: recent },
      ...d.sheets.filter((s) => TABS[s.key]).map((s) => ({ key: s.key, label: s.label, items: d.picker.filter((e) => d.sheets[e.sheet].key === s.key) })),
    ];
  }, [d]);
  const found = useMemo(() => {
    const q = fold(query.trim());
    if (!q || !d) return null;
    const words = q.split(/\s+/);
    const score = (e) => {
      const name = fold(e.label), tags = fold(e.tags);
      if (!words.every((w) => name.includes(w) || tags.includes(w))) return -1;
      return (name.startsWith(q) ? 3 : 0) + (name.split(/\s+/).some((x) => x.startsWith(words[0])) ? 2 : 0) + (tags.split(" ").includes(words[0]) ? 1 : 0);
    };
    // What you (or most people) use comes first: «corazón» finds ❤️ before 💘.
    const usual = new Map(recentEmoji(36).map((c, i) => [c.replace(/\uFE0F/g, ""), 36 - i]));
    return d.picker.map((e) => [e, score(e)]).map(([e, sc]) => [e, sc < 0 ? sc : sc + (usual.has(e.char.replace(/\uFE0F/g, "")) ? 4 + usual.get(e.char.replace(/\uFE0F/g, "")) / 36 : 0)]).filter(([, s]) => s >= 0).sort((a, b) => b[1] - a[1]).slice(0, 180).map(([e]) => e);
  }, [query, d]);

  const pick = (char) => { rememberEmoji(char); onPick(char); };
  const chooseTone = (t) => { setTone(t); write(TONE_KEY, t); setToneOpen(false); };
  const jump = (key) => {
    setQuery("");
    setActive(key);
    requestAnimationFrame(() => body.current?.querySelector(`[data-group="${key}"]`)?.scrollIntoView({ block: "start" }));
  };
  // The tab follows the scroll.
  const onScroll = () => {
    if (found) return;
    const top = body.current.getBoundingClientRect().top;
    let current = "recent";
    for (const el of body.current.querySelectorAll("[data-group]")) if (el.getBoundingClientRect().top - top <= 24) current = el.dataset.group;
    if (current !== active) setActive(current);
  };
  const onSearchKey = (e) => {
    if (e.key === "Enter" && found?.length) { e.preventDefault(); const f = found[0]; pick(tone && f.skins ? f.skins[tone - 1].char : f.char); }
    if (e.key === "ArrowDown") { e.preventDefault(); body.current?.querySelector(".emp-cell")?.focus(); }
  };
  // Arrows move between cells, nine to a row.
  const onGridKey = (e) => {
    const cells = [...body.current.querySelectorAll(".emp-cell")];
    const i = cells.indexOf(document.activeElement);
    if (i < 0) return;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS }[e.key];
    if (!step) return;
    e.preventDefault();
    if (i + step < 0) return search.current?.focus();
    cells[Math.min(cells.length - 1, i + step)]?.focus();
  };

  if (!place) return null;
  const preview = hover || (d ? { entry: groups[0]?.items[0], shown: groups[0]?.items[0] } : null);
  return createPortal(
    <div ref={box} className="emp" role="dialog" aria-label={title} style={{ left: place.left + "px", top: place.top + "px", width: place.w + "px", height: place.h + "px" }}>
      <div className="emp-top">
        <label className="emp-search">
          <Search size={16} aria-hidden="true" />
          <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} placeholder="Buscar emoji" aria-label="Buscar emoji" spellCheck={false} />
          {query ? <button type="button" className="emp-clear" onClick={() => { setQuery(""); search.current?.focus(); }} aria-label="Borrar la búsqueda"><X size={14} /></button> : null}
        </label>
        <div className="emp-tone">
          <button type="button" className="emp-tone-btn" aria-label={"Tono de piel: " + TONE_NAMES[tone]} aria-expanded={toneOpen} onClick={() => setToneOpen(!toneOpen)}>
            {d ? <EmojiSprite d={d} char={TONES[tone]} size={22} /> : null}
          </button>
          {toneOpen ? (
            <div className="emp-tones" role="group" aria-label="Tono de piel">
              {TONES.map((c, t) => <button key={t} type="button" className="emp-tone-btn" aria-pressed={tone === t} aria-label={TONE_NAMES[t]} onClick={() => chooseTone(t)}>{d ? <EmojiSprite d={d} char={c} size={22} /> : null}</button>)}
            </div>
          ) : null}
        </div>
      </div>
      {!found ? (
        <div className="emp-tabs" role="tablist" aria-label="Categorías">
          {groups.map((g) => (
            <button key={g.key} type="button" role="tab" aria-selected={active === g.key} className="emp-tab" title={g.label} aria-label={g.label} onClick={() => jump(g.key)}>
              {d ? <EmojiSprite d={d} char={TABS[g.key]} size={20} /> : null}
            </button>
          ))}
        </div>
      ) : null}
      <div ref={body} className="emp-body" onScroll={onScroll} onKeyDown={onGridKey}>
        {!d ? <p className="emp-empty">Cargando emojis…</p>
          : found ? (
            found.length ? <div className="emp-grid">{found.map((e) => <Cell key={e.char} d={d} entry={e} tone={tone} onPick={pick} onHover={(entry, shown) => setHover({ entry, shown })} />)}</div>
              : <p className="emp-empty">No hay emojis para «{query.trim()}».</p>
          ) : groups.map((g) => (
            <section key={g.key} data-group={g.key} className="emp-group" style={{ containIntrinsicSize: `auto ${Math.ceil(g.items.length / COLS) * 36 + 28}px` }}>
              <h3 className="emp-group-title">{g.label}</h3>
              <div className="emp-grid">{g.items.map((e) => <Cell key={e.char} d={d} entry={e} tone={tone} onPick={pick} onHover={(entry, shown) => setHover({ entry, shown })} />)}</div>
            </section>
          ))}
      </div>
      <div className="emp-foot" aria-live="polite">
        {preview?.entry ? (
          <>
            <span className="emo" aria-hidden="true" style={spriteStyle(d, (tone && preview.entry.skins ? preview.entry.skins[tone - 1] : preview.shown) || preview.entry, 32)} />
            <span className="emp-name">{preview.entry.label}</span>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function EmojiSprite({ d, char, size }) {
  const entry = d.byKey.get(char.replace(/\uFE0F/g, ""));
  return entry ? <span className="emo" aria-hidden="true" style={spriteStyle(d, entry, size)} /> : <span aria-hidden="true">{char}</span>;
}
