import { useState } from "react";
import Markdown from "../../../room/Markdown.jsx";
import NoteDiff from "../../../wiki/NoteDiff.jsx";
import RowBoundary from "../../../RowBoundary.jsx";
import { useAction, useResource } from "../../../../lib/store.jsx";
import { post } from "../../../../lib/api.js";
import { navigate } from "../../../../lib/router.jsx";
import { VERSION_REASON, noteUrl } from "../../../../lib/wikiLinks.js";
import { whenShort } from "../Files.jsx";
import { Back, CARD, CHIP, DARK, ERROR, MUTED, PILL, Who, filterChip } from "./parts.jsx";
import { C } from "../../../../lib/theme.js";

// Biblioteca › Notas, the history of a note (?ver=historial): every saved version with who,
// when and why; the chosen one as it read or as what restoring it would change; «Volver a
// esta versión» writes it as a new version (nothing is lost: the current one stays in the list).

const delta = (n) => (!n ? "" : n > 0 ? `+${n} caracteres` : `−${-n} caracteres`);

export default function NoteHistory({ page, bots = [], version = null, onRestored }) {
  const base = `/wiki/pages/${encodeURIComponent(page.slug)}/versions`;
  const list = useResource(base);
  const versions = list.data?.versions || [];
  const chosen = version || (versions[0] ? String(versions[0].revision) : null);
  const one = useResource(chosen ? `${base}/${encodeURIComponent(chosen)}` : null);
  const [mode, setMode] = useState("diff");
  const act = useAction();
  const v = one.data;
  const restore = async () => {
    const next = await act.act(() => post(`${base}/${encodeURIComponent(chosen)}/restore`, { revision: page.revision }));
    if (next?.slug) { onRestored?.(next); navigate(noteUrl(next.slug), { force: true }); }
  };
  return (
    <>
      <Back href={noteUrl(page.slug)} label={page.title} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "flex-start" }}>
        <nav aria-label="Versiones de la nota" style={{ ...CARD, flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <h2 style={{ margin: 0, padding: "14px 20px 8px", fontSize: "var(--t-meta)", fontWeight: "600", color: "var(--c-text-3)" }}>{versions.length ? `Versiones · ${versions.length}` : "Versiones"}</h2>
          {list.error ? <p role="alert" style={{ ...ERROR, padding: "0 20px 14px" }}>{list.error}</p> : null}
          {list.loading && !list.data ? <div style={{ height: "120px", animation: "shimmer 1.6s ease-in-out infinite" }} /> : null}
          {versions.map((x, i) => {
            const on = String(x.revision) === String(chosen) || x.id === chosen;
            return (
              <RowBoundary key={x.id} label="No se ha podido mostrar esta versión" resetKey={x.id}>
                <a href={noteUrl(page.slug, "historial") + "&v=" + x.revision} aria-current={on ? "true" : undefined} style={{ display: "flex", flexDirection: "column", gap: "3px", minHeight: "56px", padding: "10px 20px", borderTop: "1px solid rgb(var(--c-ink-rgb) / .05)", background: on ? "var(--c-hover)" : "transparent", color: "var(--c-text)", textDecoration: "none" }}>
                  <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px", fontSize: "var(--t-ui)", fontWeight: on ? "600" : "500" }}>
                    <Who by={x.by} bots={bots} />
                    <span style={{ fontWeight: "400", color: "var(--c-text-3)" }}>{whenShort(x.at, true)}</span>
                    {i === 0 ? <span style={CHIP}>{"La de ahora"}</span> : null}
                  </span>
                  <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{[VERSION_REASON[x.reason] || "Cambio en el texto", x.reason === "rename" ? `«${x.title}»` : null, delta(x.delta), x.external ? "con texto de fuera" : null].filter(Boolean).join(" · ")}</span>
                </a>
              </RowBoundary>
            );
          })}
          {!list.loading && !versions.length && !list.error ? <p style={{ ...MUTED, padding: "0 20px 16px" }}>{"Esta nota todavía no tiene versiones guardadas."}</p> : null}
          <p style={{ ...MUTED, fontSize: "var(--t-meta)", padding: "12px 20px 16px", borderTop: "1px solid rgb(var(--c-ink-rgb) / .05)" }}>{"Se guardan todas las del último mes; de las anteriores, la última de cada día."}</p>
        </nav>
        <section aria-labelledby="ver-t" style={{ ...CARD, flex: "999 1 480px", minWidth: 0, display: "flex", flexDirection: "column", gap: "16px", padding: "24px clamp(18px, 3vw, 30px) 26px" }}>
          {one.error ? <p role="alert" style={ERROR}>{one.error}</p> : null}
          {!v && one.loading ? <div style={{ height: "240px", animation: "shimmer 1.6s ease-in-out infinite" }} /> : null}
          {v ? (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <h2 id="ver-t" style={{ margin: 0, font: "600 var(--t-heading)/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.025em", overflowWrap: "anywhere" }}>{v.title}</h2>
                  <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: "6px", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}><Who by={v.by} bots={bots} />{" · " + whenShort(v.at, true) + (v.current ? " · es la de ahora" : "")}</span>
                </div>
                <div role="group" aria-label="Qué ver de esta versión" style={{ display: "flex", gap: "6px" }}>
                  <button type="button" aria-pressed={mode === "diff"} onClick={() => setMode("diff")} style={{ ...filterChip(mode === "diff"), background: mode === "diff" ? C.text : "var(--c-chip)" }}>{"Qué cambiaría"}</button>
                  <button type="button" aria-pressed={mode === "text"} onClick={() => setMode("text")} style={{ ...filterChip(mode === "text"), background: mode === "text" ? C.text : "var(--c-chip)" }}>{"Cómo era"}</button>
                </div>
              </div>
              {mode === "diff"
                ? <NoteDiff diff={v.diff} label="De la nota de ahora a esta versión" empty={v.current ? "Esta es la nota tal como está ahora." : "Dice lo mismo que la nota de ahora."} />
                : v.body.trim() ? <RowBoundary label="No se ha podido mostrar esta versión" resetKey={v.id}><Markdown text={v.body} size={15} /></RowBoundary> : <p style={MUTED}>{"En esta versión la nota estaba vacía."}</p>}
              {act.error ? <p role="alert" style={ERROR}>{act.error}</p> : null}
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                {!v.current && diffChanges(v) ? <button type="button" disabled={act.busy} onClick={restore} style={DARK}>{"Volver a esta versión"}</button> : null}
                <a href={noteUrl(page.slug)} style={PILL}>{"Volver a la nota"}</a>
                {!v.current && diffChanges(v) ? <span style={MUTED}>{"La de ahora no se pierde: queda en el historial."}</span> : null}
              </div>
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}
const diffChanges = (v) => !!(v.diff?.added || v.diff?.removed);
