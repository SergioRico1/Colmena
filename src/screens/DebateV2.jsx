import { useState } from "react";
import Shell from "../components/v2/Shell.jsx";
import { BotPresence, gloss, shapeOf } from "../components/v2/Presence.jsx";
import NotFound from "./NotFound.jsx";
import { useRoom } from "../components/room/useRoom.js";
import { useStore } from "../lib/store.jsx";
import { post } from "../lib/api.js";
import { findBot } from "../components/room/common.jsx";
import { svgSrc } from "../components/room/ArtifactPanel.jsx";
import Markdown, { plain } from "../components/room/Markdown.jsx";
import { cancel, schedule, useUndoable } from "../lib/undoable.js";

// Colmena 2.0 · 31 «Elegir entre propuestas» (design/V2Debate.dc.html): each bot's idea as a
// card with what the others think, Atlas's advice on top («Seguir su consejo»), one or two to
// choose (two are combined, with an optional note). The choice waits 10 s with «Deshacer».
const ART = [
  "linear-gradient(135deg, #FFF4D1, #FFE6F1)",
  "radial-gradient(circle at 30% 40%, #FF5CA8 0 18%, rgba(255,92,168,0) 18.5%), radial-gradient(circle at 62% 58%, #FFC93C 0 14%, rgba(255,201,60,0) 14.5%), linear-gradient(160deg, #7B4DFF, #2F6BFF)",
  "repeating-linear-gradient(90deg, #EAF0FF 0 18px, #FFFFFF 18px 36px)",
  "linear-gradient(160deg, #E1F4EC, #FFF4D1)",
];
const DARK_ART = new Set([1]);
const firstLine = (t) => plain(String(t || "")).split(/\n|(?<=[.!?])\s/).map((x) => x.replace(/^#+\s*/, "").trim()).find(Boolean) || "";

export default function DebateV2({ params = {} }) {
  const id = params.id;
  const { bots, ready } = useStore();
  const room = useRoom(id);
  const { mission, proposals, steps, messages } = room;
  const [sel, setSel] = useState([]);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(null);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const key = "debate:" + id;
  const undo = useUndoable(key);
  if (ready && !room.loading && !mission) return <NotFound active="conversaciones" />;
  if (!mission) return <Shell active="conversaciones"><div /></Shell>;

  const letters = proposals.map((p, i) => (p.label && p.label.length <= 2 ? p.label.toUpperCase() : String.fromCharCode(65 + i)));
  const nameOf = (i) => findBot(bots, proposals[i]?.botId)?.name || letters[i];
  const synthesis = mission.debateSummary || [...steps].reverse().find((s) => s.kind === "synthesis" && s.text)?.text || null;
  const advised = synthesis ? letters.filter((l, i) => { const t = synthesis.toLowerCase(); return t.includes("propuesta " + l.toLowerCase()) || t.includes(nameOf(i).toLowerCase()); }).slice(0, 2) : [];
  const deciding = mission.status === "awaiting_choice";
  const decidedBefore = !deciding && (mission.chosenBotIds || []).length > 0;
  const toggle = (l) => {
    if (undo.waiting || done) return;
    setSel((s) => (s.includes(l) ? s.filter((x) => x !== l) : s.length < 2 ? [...s, l] : s));
  };
  const decide = () => {
    if (!sel.length) return;
    setError(null);
    const chosen = sel.map((l) => proposals[letters.indexOf(l)].botId);
    const text = sel.length === 1
      ? `Elegiste la ${sel[0]}. Atlas avisa a la sala y ${nameOf(letters.indexOf(sel[0]))} la termina.`
      : `Combinas ${sel[0]} y ${sel[1]}${note.trim() ? ` («${note.trim()}»)` : ""}. ${nameOf(letters.indexOf(sel[0]))} y ${nameOf(letters.indexOf(sel[1]))} se ponen juntos con ello.`;
    setDone(text);
    schedule(key, async () => {
      try {
        await post(`/missions/${id}/choose`, { botIds: chosen });
        if (sel.length === 2 && note.trim()) await post(`/missions/${id}/messages`, { text: `De la combinación: ${note.trim()}` });
      } catch (e) { setDone(null); setError(e.message); }
    });
  };
  const back = () => { cancel(key); setDone(null); };
  const n = sel.length;
  const first = messages.find((m) => m.role === "user");

  return (
    <Shell active="conversaciones">
      <main style={{ maxWidth: "1280px", margin: "0 auto", padding: "44px clamp(20px, 4vw, 48px) 40px", display: "flex", flexDirection: "column", gap: "30px" }}>
        <header style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <a href={`/sala/${id}`} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "6px", height: "34px", padding: "0 14px 0 10px", borderRadius: "999px", background: "rgba(18,19,26,.05)", fontSize: "14px", fontWeight: "500" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
            {"#" + (mission.room || mission.title)}
          </a>
          <h1 style={{ margin: "0", font: "600 clamp(40px, 5.6vw, 68px)/0.98 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.05em" }}>{proposals.length ? `${["", "Una idea", "Dos ideas", "Tres ideas", "Cuatro ideas"][proposals.length] || proposals.length + " ideas"} para «${mission.title}»` : mission.title}</h1>
          <p style={{ margin: "0", maxWidth: "720px", fontSize: "17px", lineHeight: "1.5", color: "#5C606C" }}>
            {first ? `Pediste «${String(first.text).replace(/\s+/g, " ").slice(0, 140)}». ` : ""}{"Cada bot propuso una idea, los demás la criticaron y Atlas te resume. Elige una, o dos para combinarlas."}
          </p>
        </header>

        {synthesis ? (
          <section aria-label="Resumen de Atlas" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "18px 24px", padding: "24px 28px", borderRadius: "28px", background: "#12131A", color: "#FFFFFF" }}>
            <BotPresence bot={findBot(bots, "atlas")} size={44} state="rest" />
            <div style={{ flex: "1 1 420px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#A9ACB6" }}>{"Lo que recomienda Atlas"}</span>
              <div style={{ fontSize: "18px", lineHeight: "1.5", color: "#FFFFFF" }}><Markdown text={synthesis} size={16} style={{ fontSize: "18px", color: "#FFFFFF" }} /></div>
            </div>
            {advised.length && deciding ? <button type="button" onClick={() => setSel(advised)} style={{ height: "48px", padding: "0 20px", border: "0", borderRadius: "999px", background: "#FFFFFF", color: "#12131A", cursor: "pointer", fontSize: "15px", fontWeight: "600" }}>{"Seguir su consejo"}</button> : null}
          </section>
        ) : null}

        {!proposals.length ? (
          <p style={{ margin: 0, padding: "26px 28px", background: "rgba(255,255,255,.55)", borderRadius: "26px", fontSize: "16px", color: "#5C606C" }}>{"Los bots están preparando sus propuestas. Aparecerán aquí en cuanto terminen."}</p>
        ) : (
          <div role="group" aria-label="Propuestas" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", gap: "20px", alignItems: "start" }}>
            {proposals.map((p, i) => {
              const l = letters[i];
              const on = sel.includes(l) || (decidedBefore && (mission.chosenBotIds || []).includes(p.botId));
              const b = findBot(bots, p.botId);
              const disabled = !on && n >= 2;
              const svg = /<svg[\s\S]*<\/svg>/i.exec(p.text || "")?.[0] ?? null;
              const headline = firstLine(p.summary || p.text);
              const body = plain(String(p.text || "")).replace(headline, "").trim();
              const full = open === l;
              return (
                <article key={l} style={{ display: "flex", flexDirection: "column", background: "#FFFFFF", borderRadius: "30px", overflow: "hidden", transition: "box-shadow .25s ease, transform .25s ease", boxShadow: on ? "0 0 0 2px #12131A, 0 30px 60px -30px rgba(18,19,26,.45)" : "0 1px 2px rgba(18,19,26,.05), 0 20px 50px -32px rgba(18,19,26,.3)", transform: on ? "translateY(-4px)" : "none" }}>
                  <div aria-hidden="true" style={{ position: "relative", height: "210px", background: svg ? "#FFFFFF" : ART[i % ART.length] }}>
                    {svg ? <img src={svgSrc(svg)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} /> : null}
                    <span style={{ position: "absolute", left: "18px", top: "16px", padding: "6px 12px", borderRadius: "999px", background: "rgba(255,255,255,.85)", WebkitBackdropFilter: "blur(10px)", backdropFilter: "blur(10px)", font: "600 13px/1 'Geist', sans-serif" }}>{"Propuesta " + l}</span>
                    {svg ? null : <span style={{ position: "absolute", left: "18px", right: "18px", bottom: "18px", font: "700 24px/1.05 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", color: DARK_ART.has(i % ART.length) ? "#FFFFFF" : "#12131A", display: "-webkit-box", WebkitLineClamp: "3", WebkitBoxOrient: "vertical", overflow: "hidden" }}>{headline}</span>}
                  </div>
                  <div style={{ padding: "22px 24px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span aria-hidden="true" style={{ width: "22px", height: "22px", background: gloss(b?.color), clipPath: shapeOf(b).clip, borderRadius: shapeOf(b).radius }} />
                      <strong style={{ fontSize: "15px", fontWeight: "600" }}>{b?.name || "Un bot"}</strong>
                      <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{"· " + (b?.role || "propuesta").toLowerCase()}</span>
                    </div>
                    {body ? <p style={{ margin: "0", fontSize: "15px", lineHeight: "1.55", color: "#3D404A", ...(full ? {} : { display: "-webkit-box", WebkitLineClamp: "5", WebkitBoxOrient: "vertical", overflow: "hidden" }) }}>{body}</p> : null}
                    {body.length > 300 ? <button type="button" onClick={() => setOpen(full ? null : l)} style={{ alignSelf: "flex-start", padding: 0, border: 0, background: "transparent", cursor: "pointer", fontSize: "14px", fontWeight: 600, color: "#1F4FD1" }}>{full ? "Ver menos" : "Leerla entera"}</button> : null}
                    {(p.critiques || []).length ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingTop: "4px", borderTop: "1px solid rgba(18,19,26,.06)" }}>
                        <span style={{ paddingTop: "10px", fontSize: "12px", fontWeight: "500", color: "#6B6F7A" }}>{"Lo que opinan los demás"}</span>
                        {p.critiques.map((c, j) => {
                          const cb = findBot(bots, c.botId);
                          return (
                            <div key={j} style={{ display: "grid", gridTemplateColumns: "16px 1fr", gap: "10px", fontSize: "14px", lineHeight: "1.45" }}>
                              <span aria-hidden="true" style={{ width: "14px", height: "14px", marginTop: "3px", background: gloss(cb?.color), clipPath: shapeOf(cb).clip, borderRadius: shapeOf(cb).radius }} />
                              <span><strong style={{ fontWeight: "600" }}>{(cb?.name || "Un bot") + ":"}</strong>{" " + plain(c.text).slice(0, 220)}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {deciding ? (
                      <button type="button" role="checkbox" aria-checked={on ? "true" : "false"} disabled={disabled || undo.waiting} onClick={() => toggle(l)}
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", height: "50px", border: "0", borderRadius: "999px", cursor: disabled ? "default" : "pointer", fontSize: "15px", fontWeight: "600", transition: "all .2s ease", background: on ? "#12131A" : disabled ? "rgba(18,19,26,.04)" : "rgba(18,19,26,.06)", color: on ? "#FFFFFF" : disabled ? "#A3A6AE" : "#12131A" }}>
                        <span aria-hidden="true" style={{ width: "20px", height: "20px", display: "grid", placeItems: "center", borderRadius: "6px", background: on ? "#FFC93C" : "transparent", boxShadow: on ? "none" : "inset 0 0 0 1.5px currentColor" }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#12131A" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: on ? 1 : 0 }}><path d="m5 12 5 5 9-10" /></svg>
                        </span>
                        {on ? "Elegida" : disabled ? "Ya tienes dos" : n === 1 ? "Combinar con esta" : "Elegir esta"}
                      </button>
                    ) : on ? <span style={{ fontSize: "14px", fontWeight: 600, color: "#0B6B4A" }}>{"La elegiste"}</span> : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {deciding && n && !done ? (
          <div style={{ position: "sticky", bottom: "20px", zIndex: "5", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 18px", padding: "12px 12px 12px 26px", borderRadius: "999px", background: "rgba(255,255,255,.92)", WebkitBackdropFilter: "blur(20px)", backdropFilter: "blur(20px)", boxShadow: "0 30px 60px -24px rgba(18,19,26,.4), 0 0 0 1px rgba(18,19,26,.05)", animation: "rise .3s ease-out" }}>
            <span role="status" style={{ flex: "1 1 260px", fontSize: "15px", color: "#3D404A" }}>{n === 1 ? `Has elegido la ${sel[0]}. ${nameOf(letters.indexOf(sel[0]))} la terminará y la llevará a la sala.` : `Combinar ${sel[0]} y ${sel[1]}.`}</span>
            {n === 2 ? (
              <label style={{ flex: "2 1 280px", display: "flex" }}>
                <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Qué tomas de cada una"}</span>
                <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="¿Qué tomas de cada una? (opcional)" style={{ flex: "1", minWidth: "0", height: "46px", padding: "0 18px", border: "0", borderRadius: "999px", outline: "none", background: "#F4F4F0", fontSize: "15px" }} />
              </label>
            ) : null}
            <button type="button" onClick={decide} style={{ height: "50px", padding: "0 24px", border: "0", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: "pointer", fontSize: "15px", fontWeight: "600" }}>{n === 1 ? `Quedarme con la ${sel[0]}` : "Combinar"}</button>
          </div>
        ) : null}

        {done ? (
          <div role="status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px 20px", padding: "22px 26px", borderRadius: "28px", background: "#E1F4EC", animation: "rise .35s ease-out" }}>
            <span aria-hidden="true" style={{ width: "30px", height: "30px", display: "grid", placeItems: "center", borderRadius: "50%", background: "#0B8A5F", animation: "pop .4s ease-out" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
            </span>
            <span style={{ flex: "1 1 300px", fontSize: "16px", lineHeight: "1.5", color: "#0B5A3E" }}>{done}{undo.waiting ? ` · se confirma en ${undo.secs} s` : ""}</span>
            {undo.waiting ? <button type="button" onClick={back} style={{ height: "42px", padding: "0 18px", border: "0", borderRadius: "999px", background: "#FFFFFF", cursor: "pointer", fontSize: "14px", fontWeight: "600" }}>{"Deshacer"}</button> : null}
            <a href={`/sala/${id}`} style={{ display: "flex", alignItems: "center", height: "42px", padding: "0 18px", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "14px", fontWeight: "600" }}>{"Volver a la sala"}</a>
          </div>
        ) : null}
        {error ? <p role="alert" style={{ margin: 0, color: "#B4372A" }}>{error}</p> : null}
      </main>
    </Shell>
  );
}
