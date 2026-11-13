import { useState } from "react";
import Shell from "../components/v2/Shell.jsx";
import { BotMark } from "../components/v2/chat/Mark.jsx";
import NotFound from "./NotFound.jsx";
import { useRoom } from "../components/room/useRoom.js";
import { useStore } from "../lib/store.jsx";
import { post } from "../lib/api.js";
import { findBot } from "../components/room/common.jsx";
import { svgSrc } from "../components/room/ArtifactPanel.jsx";
import { plain } from "../components/room/Markdown.jsx";
import { cancel, schedule, useUndoable } from "../lib/undoable.js";
import { coordinatorOf } from "../lib/bots.js";

// Colmena 3 · «Elegir propuesta» (design/V3Propuestas.dc.html): each bot's idea as a card with
// what the others think, Atlas's advice on top («Seguir su consejo»); «Elegir la A» takes one,
// «Combinar» marks two to join (with an optional note). The choice waits 10 s with «Deshacer».
// The card art is the board's: two shapes and the headline over a soft colour (or the bot's SVG).
const ART = [
  { bg: "#F3EEDC", a: "#0B8A5F", b: "#FFC93C", ax: "58%", ay: "18px", ar: "50%", ink: "#12131A" },
  { bg: "#DCE8F7", a: "#FFFFFF", b: "#FF7A1A", ax: "18%", ay: "22px", ar: "18px", ink: "#12131A" },
  { bg: "#1E2230", a: "#7B4DFF", b: "#F3EEDC", ax: "40%", ay: "30px", ar: "40% 40% 20% 20%", ink: "#FFFFFF" },
  { bg: "#E3F4EC", a: "#2F6BFF", b: "#FF5CA8", ax: "52%", ay: "26px", ar: "24%", ink: "#12131A" },
];
const COUNT = ["", "Una idea", "Dos ideas", "Tres ideas", "Cuatro ideas", "Cinco ideas"];
const firstLine = (t) => plain(String(t || "")).split(/\n|(?<=[.!?])\s/).map((x) => x.replace(/^#+\s*/, "").trim()).find(Boolean) || "";
const shorten = (t, n) => (t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t);

export default function DebateV2({ params = {} }) {
  const id = params.id;
  const { bots, ready } = useStore();
  const coord = coordinatorOf(bots);
  const room = useRoom(id);
  const { mission, proposals, steps, messages } = room;
  const [marked, setMarked] = useState([]);
  const [chosen, setChosen] = useState(null); // letters decided here (one, or two combined)
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(null);
  const [error, setError] = useState(null);
  const key = "debate:" + id;
  const undo = useUndoable(key);
  if (ready && !room.loading && !mission) return <NotFound active="chats" />;
  if (!mission) return <Shell active="chats"><div /></Shell>;

  const letters = proposals.map((p, i) => (p.label && p.label.length <= 2 ? p.label.toUpperCase() : String.fromCharCode(65 + i)));
  const nameOf = (l) => findBot(bots, proposals[letters.indexOf(l)]?.botId)?.name || l;
  const synthesis = mission.debateSummary || [...steps].reverse().find((s) => s.kind === "synthesis" && s.text)?.text || null;
  const advised = synthesis ? letters.filter((l) => { const t = synthesis.toLowerCase(); return t.includes("propuesta " + l.toLowerCase()) || t.includes("la " + l.toLowerCase() + " ") || t.includes(nameOf(l).toLowerCase()); }).slice(0, 2) : [];
  const deciding = mission.status === "awaiting_choice";
  const decidedBefore = !deciding && (mission.chosenBotIds || []).length > 0;
  const roomName = "#" + (mission.room || mission.title || "sala");
  const first = messages.find((m) => m.role === "user");

  const decide = (picked) => {
    if (!picked.length || undo.waiting) return;
    setError(null);
    setChosen(picked);
    const ids = picked.map((l) => proposals[letters.indexOf(l)].botId);
    const extra = picked.length === 2 && note.trim() ? note.trim() : null;
    schedule(key, async () => {
      try {
        await post(`/missions/${id}/choose`, { botIds: ids });
        if (extra) await post(`/missions/${id}/messages`, { text: `De la combinación: ${extra}` });
      } catch (e) { setChosen(null); setError(e.message); }
    });
  };
  const back = () => { cancel(key); setChosen(null); setMarked([]); };
  const mark = (l) => {
    if (chosen || !deciding) return;
    setMarked((s) => (s.includes(l) ? s.filter((x) => x !== l) : [...s, l].slice(-2)));
  };

  let barText = deciding ? "Elige una, o marca dos con «Combinar»." : decidedBefore ? "Ya elegiste. El equipo sigue en la sala." : "Los bots aún están preparando sus propuestas.";
  if (marked.length === 1) barText = `Marca otra para combinarla con la ${marked[0]}.`;
  if (marked.length === 2) barText = `Combinar la ${marked[0]} y la ${marked[1]}: ${coord} te preguntará qué tomas de cada una.`;
  if (chosen) {
    barText = chosen.length === 1
      ? `Elegiste la ${chosen[0]}. ${coord} avisa a ${nameOf(chosen[0])} para prepararla.`
      : `Combinas la ${chosen[0]} y la ${chosen[1]}. ${nameOf(chosen[0])} y ${nameOf(chosen[1])} se ponen juntos con ello.`;
    if (undo.waiting) barText += ` Se confirma en ${undo.secs} s.`;
  }
  const atlasLead = advised.length ? `${coord} recomienda la ${advised.join(" y la ")}:` : `${coord} te resume:`;

  return (
    <Shell active="chats">
      <main style={{ maxWidth: "1140px", margin: "0 auto", padding: "36px clamp(20px, 4vw, 52px) 40px", display: "flex", flexDirection: "column", gap: "26px" }}>
        <nav aria-label="Miga" style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>
          <a href="/chats" style={{ color: "var(--c-text-3)" }}>{"Chats"}</a>
          <span aria-hidden="true">{"›"}</span>
          <a href={`/sala/${id}`} style={{ color: "var(--c-text-3)" }}>{roomName}</a>
          <span aria-hidden="true">{"›"}</span>
          <span style={{ color: "var(--c-text)", fontWeight: 500 }}>{"Elegir propuesta"}</span>
        </nav>

        <header style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <h1 style={{ margin: 0, font: "600 var(--t-display-m)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.04em" }}>{proposals.length ? `${COUNT[proposals.length] || proposals.length + " ideas"} para «${mission.title}»` : mission.title}</h1>
          <p style={{ margin: 0, maxWidth: "760px", fontSize: "var(--t-read)", lineHeight: "1.5", color: "var(--c-text-2)" }}>
            {first ? `Pediste «${shorten(String(first.text).replace(/\s+/g, " "), 140)}». ` : ""}{`Cada bot propuso una idea, los demás la criticaron y ${coord} te resume. Elige una, o marca dos para combinarlas.`}
          </p>
        </header>

        {synthesis ? (
          <section aria-label={"Recomendación de " + coord} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px 24px", padding: "22px 24px", borderRadius: "var(--r-2xl)", background: "var(--c-btn)", color: "var(--c-btn-text)" }}>
            <span aria-hidden="true" style={{ flex: "none", width: "34px", height: "34px", background: "var(--c-card)", clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)" }} />
            <p style={{ flex: "1 1 420px", margin: 0, fontSize: "var(--t-read)", lineHeight: "1.55", color: "#E6E7EC" }}><strong style={{ color: "#FFFFFF", fontWeight: 600 }}>{atlasLead}</strong>{" " + shorten(plain(synthesis).replace(/\s+/g, " "), 420)}</p>
            {advised.length && deciding && !chosen ? <button type="button" onClick={() => (advised.length === 1 ? decide(advised) : setMarked(advised))} style={{ height: "44px", padding: "0 20px", border: 0, borderRadius: "var(--r-pill)", background: "var(--c-card)", color: "var(--c-text)", fontSize: "var(--t-body)", fontWeight: 600, cursor: "pointer" }}>{"Seguir su consejo"}</button> : null}
          </section>
        ) : null}

        {!proposals.length ? (
          <p style={{ margin: 0, padding: "22px 24px", borderRadius: "var(--r-2xl)", background: "var(--c-card)", fontSize: "var(--t-body)", color: "var(--c-text-2)" }}>{"Los bots están preparando sus propuestas. Aparecerán aquí en cuanto terminen."}</p>
        ) : (
          <div role="group" aria-label="Propuestas" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: "14px" }}>
            {proposals.map((p, i) => {
              const l = letters[i];
              const b = findBot(bots, p.botId);
              const art = ART[i % ART.length];
              const isChosen = (chosen || []).includes(l) || (decidedBefore && (mission.chosenBotIds || []).includes(p.botId));
              const isMarked = marked.includes(l);
              const svg = /<svg[\s\S]*<\/svg>/i.exec(p.text || "")?.[0] ?? null;
              const headline = firstLine(p.summary || p.text);
              const rest = plain(String(p.text || "")).replace(headline, "").trim();
              const body = rest.length >= 40 ? rest : plain(String(p.text || p.summary || "")).trim();
              const full = open === l;
              const tag = advised.includes(l) ? "recomendada" : (b?.role || "propuesta").toLowerCase();
              return (
                <article key={l} style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-2xl)", background: "var(--c-card)", overflow: "hidden", boxShadow: `0 0 0 2px ${isChosen ? "#12131A" : isMarked ? "#1F4FD1" : "transparent"}, 0 18px 40px -30px rgba(18,19,26,.4)`, transition: "box-shadow .2s ease" }}>
                  <div aria-hidden="true" style={{ position: "relative", height: "190px", background: svg ? "var(--c-card)" : art.bg, overflow: "hidden" }}>
                    {svg ? <img src={svgSrc(svg)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} /> : <>
                      <span style={{ position: "absolute", left: art.ax, top: art.ay, width: "120px", height: "120px", borderRadius: art.ar, background: art.a }} />
                      <span style={{ position: "absolute", right: "22px", bottom: "18px", width: "70px", height: "70px", borderRadius: "var(--r-circle)", background: art.b }} />
                      <span style={{ position: "absolute", left: "20px", bottom: "18px", maxWidth: "70%", font: "700 var(--t-heading)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", color: art.ink, display: "-webkit-box", WebkitLineClamp: "3", WebkitBoxOrient: "vertical", overflow: "hidden" }}>{shorten(headline, 70)}</span>
                    </>}
                  </div>
                  <div style={{ flex: "1", display: "flex", flexDirection: "column", gap: "12px", padding: "18px 20px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ width: "28px", height: "28px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-meta)", fontWeight: 700 }}>{l}</span>
                      <BotMark bot={b} size={16} />
                      <span style={{ fontSize: "var(--t-ui)", fontWeight: 600 }}>{b?.name || "Un bot"}</span>
                      <span style={{ marginLeft: "auto", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{tag}</span>
                    </div>
                    {body ? <p style={{ margin: 0, fontSize: "var(--t-body)", lineHeight: "1.5", color: "var(--c-text-2)", ...(full ? {} : { display: "-webkit-box", WebkitLineClamp: "4", WebkitBoxOrient: "vertical", overflow: "hidden" }) }}>{body}</p> : null}
                    {body.length > 260 ? <button type="button" onClick={() => setOpen(full ? null : l)} style={{ alignSelf: "flex-start", padding: 0, border: 0, background: "transparent", cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: 500, color: "var(--c-accent-ink)" }}>{full ? "Ver menos" : "Leerla entera"}</button> : null}
                    {(p.critiques || []).length ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px", paddingTop: "10px", borderTop: "1px solid rgb(var(--c-ink-rgb) / .07)" }}>
                        <span style={{ fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text-3)" }}>{"Lo que opinan los demás"}</span>
                        {p.critiques.map((c, j) => <span key={j} style={{ fontSize: "var(--t-ui)", lineHeight: "1.45", color: "var(--c-text-2)" }}><strong style={{ fontWeight: 600, color: "var(--c-text)" }}>{(findBot(bots, c.botId)?.name || "Un bot") + ":"}</strong>{" " + shorten(plain(c.text), 220)}</span>)}
                      </div>
                    ) : null}
                    <span style={{ flex: "1" }} />
                    {deciding && !(chosen && !isChosen) ? (
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button type="button" disabled={!!chosen} onClick={() => decide([l])} style={{ flex: "1", height: "42px", border: 0, borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-body)", fontWeight: 600, cursor: chosen ? "default" : "pointer", opacity: chosen && !isChosen ? 0.4 : 1 }}>{isChosen ? (chosen?.length === 2 ? "Combinada" : "Elegida") : `Elegir la ${l}`}</button>
                        {chosen ? null : (
                          <label style={{ height: "42px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "8px", border: "1px solid rgb(var(--c-ink-rgb) / .14)", borderRadius: "var(--r-pill)", fontSize: "var(--t-ui)", cursor: "pointer" }}>
                            <input type="checkbox" checked={isMarked} onChange={() => mark(l)} style={{ width: "16px", height: "16px", accentColor: "var(--c-text)" }} />{"Combinar"}
                          </label>
                        )}
                      </div>
                    ) : isChosen ? <span style={{ fontSize: "var(--t-ui)", fontWeight: 600, color: "var(--c-ok-ink)" }}>{"✓ La elegiste"}</span> : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div style={{ position: "sticky", bottom: "16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", padding: "14px 14px 14px 22px", borderRadius: "var(--r-xl)", background: "var(--c-card)", boxShadow: "0 2px 4px rgba(18,19,26,.06), 0 20px 40px -20px rgba(18,19,26,.35)" }}>
          <span role="status" style={{ flex: "1 1 300px", fontSize: "var(--t-body)" }}>{barText}</span>
          {!chosen && marked.length === 2 && deciding ? <>
            <label style={{ flex: "1 1 240px", display: "flex" }}>
              <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Qué tomas de cada una"}</span>
              <input className="c-quiet" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="¿Qué tomas de cada una? (opcional)" style={{ flex: "1", minWidth: 0, height: "44px", padding: "0 16px", border: "1px solid rgb(var(--c-ink-rgb) / .1)", borderRadius: "var(--r-pill)", background: "var(--c-hover)", fontSize: "var(--t-body)" }} />
            </label>
            <button type="button" onClick={() => decide(marked)} style={{ height: "44px", padding: "0 20px", border: 0, borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-body)", fontWeight: 600, cursor: "pointer" }}>{"Combinarlas"}</button>
          </> : null}
          {chosen ? <>
            {undo.waiting ? <button type="button" onClick={back} style={{ height: "44px", padding: "0 18px", border: "1px solid rgb(var(--c-ink-rgb) / .16)", borderRadius: "var(--r-pill)", background: "var(--c-card)", fontSize: "var(--t-body)", cursor: "pointer" }}>{"Deshacer"}</button> : null}
            <a href={`/sala/${id}`} style={{ height: "44px", padding: "0 18px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-body)", fontWeight: 600 }}>{"Volver a la sala"}</a>
          </> : decidedBefore ? <a href={`/sala/${id}`} style={{ height: "44px", padding: "0 18px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-body)", fontWeight: 600 }}>{"Volver a la sala"}</a> : null}
        </div>
        {error ? <p role="alert" style={{ margin: 0, color: "var(--c-error)" }}>{error}</p> : null}
      </main>
    </Shell>
  );
}
