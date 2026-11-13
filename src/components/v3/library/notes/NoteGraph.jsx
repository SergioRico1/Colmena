import { useMemo, useState } from "react";
import { useAction, useResource } from "../../../../lib/store.jsx";
import { navigate } from "../../../../lib/router.jsx";
import { layoutGraph, noteUrl } from "../../../../lib/wikiLinks.js";
import { CARD, ERROR, MUTED, filterChip } from "./parts.jsx";
import { createNote } from "./actions.js";

// Biblioteca › Notas, the map (GET /api/wiki/graph): which notes name which. A still drawing
// (nothing moves, so there is nothing to switch off under «reduce motion»): each note a dot,
// bigger the more it is linked; the ones still to be created, hollow. Every dot is a link (Tab
// reaches them, Enter opens the note) and the same notes are listed below as text. With a
// note in focus it sits in the middle and the rest in rings by how many links away.

const W = 720, H = 480, NODES = 120;
const clip = (s, n = 22) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export default function NoteGraph({ focus = "", title = "" }) {
  const [depth, setDepth] = useState(1);
  const { data, error, loading } = useResource(`/wiki/graph?nodes=${NODES}` + (focus ? `&focus=${encodeURIComponent(focus)}&depth=${depth}` : ""));
  const [hot, setHot] = useState(null);
  const act = useAction();
  const view = useMemo(() => layoutGraph(data, { focus, width: W, height: H }), [data, focus]);
  const open = (n) => (n.exists ? navigate(noteUrl(n.id)) : act.act(() => createNote(n.title)));
  const near = useMemo(() => {
    const m = new Map(view.nodes.map((n) => [n.id, []]));
    for (const e of view.edges) { m.get(e.from)?.push(e.to); m.get(e.to)?.push(e.from); }
    return m;
  }, [view]);
  const byId = useMemo(() => new Map(view.nodes.map((n) => [n.id, n])), [view]);
  // Every name fits only on a small map: on a big one, the focus, its neighbours and the dot under the pointer.
  const labelled = (n) => view.nodes.length <= 36 || n.id === focus || n.id === hot || (hot && near.get(hot)?.includes(n.id)) || (focus && n.level === 1 && view.nodes.length <= 80);
  const lit = (e) => !hot || e.from === hot || e.to === hot;

  return (
    <section aria-labelledby="map-t" style={{ ...CARD, display: "flex", flexDirection: "column", gap: "14px", padding: "22px clamp(16px, 3vw, 26px) 24px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <h2 id="map-t" style={{ margin: 0, font: "600 var(--t-heading)/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{focus ? `Alrededor de «${title || focus}»` : "Mapa de las notas"}</h2>
          <span style={MUTED}>{"Cada punto es una nota y cada línea, una que nombra a otra. Los puntos huecos están por crear."}</span>
        </div>
        {focus ? (
          <div role="group" aria-label="Hasta dónde mirar" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={MUTED}>{"Saltos"}</span>
            {[1, 2, 3].map((d) => <button key={d} type="button" aria-pressed={depth === d} onClick={() => setDepth(d)} style={{ ...filterChip(depth === d), background: depth === d ? "#12131A" : "var(--c-chip)", minWidth: "36px", justifyContent: "center" }}>{String(d)}</button>)}
          </div>
        ) : null}
      </div>
      {error ? <p role="alert" style={ERROR}>{error}</p> : null}
      {act.error ? <p role="alert" style={ERROR}>{act.error}</p> : null}
      {loading && !data ? <div style={{ height: "320px", borderRadius: "var(--r-lg)", background: "var(--c-hover)", animation: "shimmer 1.6s ease-in-out infinite" }} /> : null}
      {data && !view.nodes.length ? <p style={{ margin: 0, padding: "40px 0", textAlign: "center", fontSize: "var(--t-body)", color: "var(--c-text-3)" }}>{"Aún no hay notas que dibujar."}</p> : null}
      {view.nodes.length ? (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Mapa con ${view.nodes.length} notas y ${view.edges.length} enlaces`} style={{ width: "100%", height: "auto", maxHeight: "70vh", borderRadius: "var(--r-lg)", background: "var(--c-sunken)", boxShadow: "inset 0 0 0 1px rgb(var(--c-ink-rgb) / .05)" }} onMouseLeave={() => setHot(null)}>
            <g aria-hidden="true">
              {view.edges.map((e) => <line key={e.from + ">" + e.to} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="#12131A" strokeOpacity={lit(e) ? (hot ? 0.55 : 0.16) : 0.05} strokeWidth={hot && lit(e) ? 1.4 : 1} />)}
            </g>
            {view.nodes.map((n) => {
              const links = near.get(n.id)?.length || 0;
              const me = n.id === focus;
              const below = n.y < H - 34;
              return (
                <a key={n.id} href={noteUrl(n.exists ? n.id : n.title)} aria-label={`${n.title}${n.exists ? "" : " (por crear)"}, ${links === 1 ? "1 enlace" : links + " enlaces"}`} className="c-note-node"
                  onClick={(e) => { e.preventDefault(); open(n); }} onMouseEnter={() => setHot(n.id)} onFocus={() => setHot(n.id)} onBlur={() => setHot(null)} style={{ cursor: "pointer", outlineOffset: "3px" }}>
                  <circle cx={n.x} cy={n.y} r={Math.max(n.r, 12)} fill="transparent" />
                  <circle cx={n.x} cy={n.y} r={n.r} fill={!n.exists ? "#FFFFFF" : me ? "#1F4FD1" : "#12131A"} stroke={!n.exists ? "#5C606C" : hot === n.id ? "#1F4FD1" : "#FFFFFF"} strokeWidth={!n.exists ? 1.5 : 2} strokeDasharray={n.exists ? undefined : "3 2.5"} />
                  {labelled(n) ? <text x={n.x} y={below ? n.y + n.r + 14 : n.y - n.r - 7} textAnchor={n.x < 70 ? "start" : n.x > W - 70 ? "end" : "middle"} fontSize="12" fontWeight={me || hot === n.id ? 600 : 500} fill={n.exists ? "#12131A" : "#5C606C"} stroke="#FBFBF9" strokeWidth="3" paintOrder="stroke" style={{ pointerEvents: "none" }}>{clip(n.title)}</text> : null}
                </a>
              );
            })}
          </svg>
          {data.truncated ? <p style={MUTED}>{`Hay ${data.total?.nodes ?? "más"} notas: aquí salen las ${view.nodes.length} más enlazadas. Abre una nota y pulsa «Ver en el mapa» para ver sus alrededores.`}</p> : null}
          <details>
            <summary style={{ fontSize: "var(--t-ui)", color: "var(--c-accent-ink)", cursor: "pointer" }}>{"Ver lo mismo como lista"}</summary>
            <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px", fontSize: "var(--t-ui)" }}>
              {view.nodes.map((n) => (
                <li key={n.id} style={{ display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
                  <a href={noteUrl(n.exists ? n.id : n.title)} onClick={n.exists ? undefined : (e) => { e.preventDefault(); open(n); }} style={n.exists ? { color: "var(--c-accent-ink)", fontWeight: n.id === focus ? "600" : "400" } : { color: "var(--c-text-3)", textDecoration: "underline dashed", textUnderlineOffset: "3px" }}>{n.title}</a>
                  {!n.exists ? <span style={{ color: "var(--c-text-3)" }}>{"(por crear)"}</span> : null}
                  {near.get(n.id)?.length ? <span style={{ color: "var(--c-text-3)" }}>{"enlazada con " + near.get(n.id).map((id) => byId.get(id)?.title || id).slice(0, 6).join(", ") + (near.get(n.id).length > 6 ? "…" : "")}</span> : <span style={{ color: "var(--c-text-3)" }}>{"sin enlaces"}</span>}
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : null}
    </section>
  );
}
