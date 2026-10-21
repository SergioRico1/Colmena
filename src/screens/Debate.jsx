import { useState } from "react";
import { css } from "../design/css/Debate.js";
import Sidebar from "../components/Sidebar.jsx";
import { useAction, useStore } from "../lib/store.jsx";
import { navigate } from "../lib/router.jsx";
import { post } from "../lib/api.js";
import { time } from "../lib/format.js";
import { BotAvatar, ErrorLine, StateCard, findBot, roomCss } from "../components/room/common.jsx";
import { useRoom } from "../components/room/useRoom.js";
import Markdown from "../components/room/Markdown.jsx";
import { svgSrc } from "../components/room/ArtifactPanel.jsx";
import { coordinatorName } from "../components/room/RoomParts.jsx";

// Debate — design/Debate.dc.html (Logic: choice A | B | C | AB).

const COUNT = ["Ninguna", "Una", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho"];
const DONE_DOT = (
  <span style={{ width: "24px", height: "24px", borderRadius: "50%", background: "#12131A", color: "#FFFFFF", display: "grid", placeItems: "center" }}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
  </span>
);

function Phase({ n, label, state }) {
  if (state === "done") return <li style={{ display: "flex", alignItems: "center", gap: "8px", color: "#4A4F5C" }}>{DONE_DOT}{label}</li>;
  if (state === "current") {
    return (
      <li aria-current="step" style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "700" }}>
        <span style={{ width: "24px", height: "24px", borderRadius: "50%", background: "#FFC93C", border: "2px solid #12131A", display: "grid", placeItems: "center", font: "700 12px/1 'Geist Mono', monospace" }}>{n}</span>
        {label}
      </li>
    );
  }
  return (
    <li style={{ display: "flex", alignItems: "center", gap: "8px", color: "#4A4F5C" }}>
      <span style={{ width: "24px", height: "24px", borderRadius: "50%", border: "2px dashed #A9AEBB", display: "grid", placeItems: "center", font: "700 12px/1 'Geist Mono', monospace" }}>{n}</span>
      {label}
    </li>
  );
}

function Sketch({ proposal, bot, letter, svg }) {
  const [full, setFull] = useState(false);
  if (svg) {
    return (
      <div role="img" aria-label={`Boceto de la propuesta ${letter}`} style={{ position: "relative", aspectRatio: "16 / 10", background: "#F7F8FA", overflow: "hidden" }}>
        <img src={svgSrc(svg)} alt="" style={{ position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain" }} />
      </div>
    );
  }
  if (!proposal.text) return null;
  const tint = /^#[0-9a-f]{6}$/i.test(bot.color || "") ? bot.color + "1F" : "#EEF0F4";
  const long = String(proposal.text).length > 280 || String(proposal.text).split("\n").length > 6;
  return (
    <div style={{ position: "relative", background: tint, display: "flex", flexDirection: "column" }}>
      <div style={full || !long ? { padding: "18px", minHeight: "120px" } : { aspectRatio: "16 / 10", overflow: "hidden", padding: "18px", maskImage: "linear-gradient(#000 70%, transparent)", WebkitMaskImage: "linear-gradient(#000 70%, transparent)" }}>
        <Markdown text={proposal.text} size={15} />
      </div>
      {long ? (
      <button type="button" className="rm-focus" aria-expanded={full ? "true" : "false"} onClick={() => setFull(!full)} style={{ alignSelf: "flex-start", margin: "0 18px 12px", padding: "0", background: "transparent", border: "0", cursor: "pointer", fontSize: "13px", fontWeight: "600", color: "#1F4FD1" }}>
        {full ? "Ver menos" : `Leer la propuesta ${letter} entera`}
      </button>
      ) : null}
    </div>
  );
}

export default function Debate({ params }) {
  const id = params.id;
  const { bots } = useStore();
  const room = useRoom(id);
  const { mission, proposals, steps, messages } = room;
  const choose = useAction();
  const again = useAction();
  const letters = proposals.map((p, i) => (p.label && p.label.length <= 2 ? p.label.toUpperCase() : String.fromCharCode(65 + i)));
  const byLetter = Object.fromEntries(proposals.map((p, i) => [letters[i], p]));
  const initial = (mission?.chosenBotIds || []).map((b) => letters[proposals.findIndex((p) => p.botId === b)]).filter(Boolean);
  const [selected, setSelected] = useState(null); // null = what the server says
  const [recent, setRecent] = useState([]);
  const sel = selected ?? initial;
  const [hint, setHint] = useState(null);

  const pick = (letter) => {
    setSelected([letter]);
    setRecent((r) => [letter, ...r.filter((x) => x !== letter)].slice(0, 2));
    setHint(null);
  };
  const synthesis = mission?.debateSummary
    || [...steps].reverse().find((s) => s.kind === "synthesis" && s.text)?.text
    || [...messages].reverse().find((m) => m.role === "assistant" && (m.botId || "atlas") === "atlas" && m.kind !== "plan" && m.text)?.text
    || mission?.threadSummary
    || null;
  const nameOf = (l) => findBot(bots, byLetter[l]?.botId)?.name || l;
  // A combination is offered only with a reason: the two you looked at last, or the two
  // proposals Atlas names in its summary. Never an arbitrary «A + B».
  const named = synthesis ? letters.filter((l) => { const t = synthesis.toLowerCase(); return t.includes(nameOf(l).toLowerCase()) || t.includes("propuesta " + l.toLowerCase()); }) : [];
  const base = recent.length >= 2 ? recent : named.length >= 2 ? named.slice(0, 2) : null;
  const pair = base ? [...base].sort() : [];
  const pairOn = !!base && sel.length === 2 && pair.every((l) => sel.includes(l));
  const pickPair = () => { if (base) { setSelected(pair); setHint(null); } };
  const summary = sel.length === 2
    ? `Has elegido combinar las propuestas ${sel[0]} y ${sel[1]}. ${nameOf(sel[0])} y ${nameOf(sel[1])} harán la versión final.`
    : sel.length === 1
      ? `Has elegido la propuesta ${sel[0]}. ${nameOf(sel[0])} prepara la versión final.`
      : "Elige una propuesta o combínalas.";

  const deciding = mission?.status === "awaiting_choice";
  const decided = !deciding && (mission?.chosenBotIds || []).length > 0;
  const confirm = () => {
    if (!sel.length) return setHint("Elige una propuesta o combina dos antes de seguir.");
    choose.act(async () => {
      await post(`/missions/${id}/choose`, { botIds: sel.map((l) => byLetter[l].botId) });
      navigate(`/sala/${id}/directo`);
    });
  };
  const anotherRound = () => again.act(() => post(`/missions/${id}/messages`, { text: "Pedid otra ronda de propuestas teniendo en cuenta las críticas." }));

  const atlas = findBot(bots, "atlas");
  const hasCritiques = proposals.some((p) => (p.critiques || []).length);
  const phase1 = proposals.length ? "done" : "current";
  const phase2 = !proposals.length ? "pending" : hasCritiques || deciding || decided ? "done" : "current";
  const phase3 = decided ? "done" : deciding ? "current" : "pending";

  let body = null;
  if (room.loading) body = <StateCard title="Abriendo el debate…" />;
  else if (!mission) body = <StateCard tone="error" title="No encuentro este debate" text={room.error || "Puede que se haya borrado o que el enlace no sea correcto."} href="/" cta="Volver al inicio" />;

  return (
    <>
      <style>{css + roomCss}</style>
      <div style={{ minHeight: "100vh", display: "flex", flexWrap: "wrap", background: "#EEF0F4" }}>
        <Sidebar variant="compact" activeRoom={id} />
        <main style={{ flex: "999 1 560px", minWidth: "0", display: "flex", flexDirection: "column" }}>
          {body || (
            <>
              <header style={{ minHeight: "68px", padding: "10px clamp(16px, 3vw, 28px)", background: "#FFFFFF", borderBottom: "1px solid #DCE0E8", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: "0" }}>
                  <h1 style={{ margin: "0", font: "700 21px/1.1 'Bricolage Grotesque', sans-serif" }}>
                    <span style={{ color: "#8C91A0" }}>{"#"}</span>
                    {" " + (mission.room || "sala")}
                  </h1>
                  <p style={{ margin: "0", fontSize: "13px", color: "#555A68" }}>{`Debate · ${mission.title || mission.prompt || ""}`}</p>
                </div>
                <a href={`/sala/${id}`} style={{ display: "flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 14px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "10px", fontSize: "14px" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M4 5h11v8H8l-4 3z" /><path d="M15 9h5v8l-3-2h-6v-2" /></svg>
                  {"Ver la conversación"}
                </a>
              </header>
              <div style={{ flex: "1", padding: "24px clamp(16px, 3vw, 32px) 32px", display: "flex", flexDirection: "column", gap: "22px" }}>
                <ol aria-label="Fases del debate" style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", fontSize: "14px" }}>
                  <Phase n="1" state={phase1} label={proposals.length ? `${COUNT[proposals.length] || proposals.length} ${proposals.length === 1 ? "propuesta" : "propuestas"}` : "Propuestas"} />
                  <li aria-hidden="true" style={{ width: "28px", height: "2px", background: phase2 === "pending" ? "#A9AEBB" : "#12131A" }} />
                  <Phase n="2" state={phase2} label="Se critican entre ellos" />
                  <li aria-hidden="true" style={{ width: "28px", height: "2px", background: phase3 === "pending" ? "#A9AEBB" : "#12131A" }} />
                  <Phase n="3" state={phase3} label="Tú eliges" />
                </ol>

                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px 18px", padding: "16px 18px", background: "#FFFFFF", border: "2px solid #12131A", borderRadius: "16px", boxShadow: "6px 6px 0 #FFC93C" }}>
                  <BotAvatar bot={atlas} size={40} />
                  <div style={{ flex: "1 1 360px", display: "flex", flexDirection: "column", gap: "4px" }}>
                    <strong style={{ fontSize: "16px" }}>{`${coordinatorName(bots)} resume el debate`}</strong>
                    {synthesis ? (
                      <Markdown text={synthesis} size={15} style={{ color: "#2B2D36", lineHeight: "1.5" }} />
                    ) : (
                      <span style={{ fontSize: "15px", lineHeight: "1.5", color: "#2B2D36" }}>
                        {proposals.length ? "Aún no ha escrito el resumen. Puedes elegir ya leyendo las propuestas." : "Los bots están preparando sus propuestas. Aparecerán aquí en cuanto terminen."}
                      </span>
                    )}
                  </div>
                  {proposals.length >= 2 && !decided && base ? (
                    <button type="button" className="rm-focus" onClick={pickPair} aria-pressed={pairOn ? "true" : "false"} style={{ minHeight: "46px", padding: "0 18px", borderRadius: "12px", cursor: "pointer", fontWeight: "700", fontSize: "14px", background: pairOn ? "#12131A" : "#FFC93C", color: pairOn ? "#FFFFFF" : "#12131A", border: "2px solid #12131A" }}>
                      {pairOn ? "Combinación elegida" : `Combinar ${pair[0]} + ${pair[1]}`}
                    </button>
                  ) : null}
                  {!proposals.length && ["running", "planning"].includes(mission.status) ? (
                    <a href={`/sala/${id}/directo`} style={{ display: "flex", alignItems: "center", minHeight: "46px", padding: "0 18px", borderRadius: "12px", fontWeight: "700", fontSize: "14px", background: "#FFC93C", border: "2px solid #12131A" }}>{"Verlos en directo"}</a>
                  ) : null}
                </div>

                {proposals.length ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: "18px", alignItems: "start" }}>
                    {proposals.map((p, i) => {
                      const letter = letters[i];
                      const bot = findBot(bots, p.botId);
                      const on = sel.includes(letter);
                      const exact = sel.length === 1 && sel[0] === letter;
                      const svg = /<svg[\s\S]*<\/svg>/i.exec(p.text || "")?.[0] ?? null;
                      return (
                        <article key={p.botId || i} style={{ background: "#FFFFFF", borderRadius: "18px", overflow: "hidden", display: "flex", flexDirection: "column", border: on ? "2px solid #12131A" : "1px solid #DCE0E8", boxShadow: on ? "6px 6px 0 #FFC93C" : "none" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "14px 16px" }}>
                            <BotAvatar bot={bot} size={30} />
                            <span style={{ flex: "1", fontSize: "14px" }}>
                              <strong>{`Propuesta ${letter}`}</strong>
                              {` · ${bot.name}`}
                            </span>
                          </div>
                          <Sketch proposal={p} bot={bot} letter={letter} svg={svg} />
                          <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
                            {/* «La idea» only when it adds something: not when it repeats the sketch above. */}
                            {p.summary && !String(p.text || "").trim().startsWith(String(p.summary).trim().slice(0, 60)) ? (
                              <p style={{ margin: "0", fontSize: "14px", lineHeight: "1.5" }}>
                                <strong>{"La idea:"}</strong>
                                {" " + p.summary}
                              </p>
                            ) : null}
                            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                              <span style={{ font: "600 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}>{"Críticas"}</span>
                              {(p.critiques || []).length === 0 ? <span style={{ fontSize: "14px", color: "#555A68" }}>{"Nadie la ha criticado todavía."}</span> : null}
                              {(p.critiques || []).map((c, j) => {
                                const critic = findBot(bots, c.botId);
                                return (
                                  <div key={j} style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: "8px", fontSize: "14px", lineHeight: "1.45" }}>
                                    <BotAvatar bot={critic} size={22} />
                                    <span>
                                      <strong>{`${critic.name}:`}</strong>
                                      {" " + c.text}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            {!decided ? (
                              <button type="button" className="rm-focus" onClick={() => pick(letter)} aria-pressed={exact ? "true" : "false"} style={{ height: "44px", borderRadius: "12px", cursor: "pointer", fontWeight: "700", fontSize: "14px", background: exact ? "#12131A" : "#FFFFFF", color: exact ? "#FFFFFF" : "#12131A", border: "2px solid #12131A" }}>
                                {exact ? "Elegida" : `Elegir ${letter}`}
                              </button>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : null}

                {proposals.length ? (
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "14px", padding: "16px 18px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "16px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <p style={{ margin: "0", fontSize: "15px" }}>
                        {decided ? `Elegiste ${sel.length === 2 ? `combinar ${sel[0]} y ${sel[1]}` : `la propuesta ${sel[0] || ""}`}${mission.updatedAt ? ` · ${time(mission.updatedAt)}` : ""}. El equipo ya trabaja en la versión final.` : summary}
                      </p>
                      <ErrorLine>{hint || choose.error || again.error}</ErrorLine>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {decided ? (
                        <a href={`/sala/${id}/directo`} style={{ display: "flex", alignItems: "center", height: "46px", padding: "0 20px", background: "#FFC93C", border: "2px solid #12131A", borderRadius: "12px", fontWeight: "700", fontSize: "14px" }}>{"Ir a la sala"}</a>
                      ) : (
                        <>
                          <button type="button" className="rm-focus" disabled={again.busy} onClick={anotherRound} style={{ height: "46px", padding: "0 16px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "12px", cursor: "pointer", fontSize: "14px" }}>{"Pedir otra ronda"}</button>
                          <button type="button" className="rm-focus" disabled={choose.busy} onClick={confirm} style={{ display: "flex", alignItems: "center", height: "46px", padding: "0 20px", background: "#FFC93C", border: "2px solid #12131A", borderRadius: "12px", cursor: "pointer", fontWeight: "700", fontSize: "14px" }}>{"Confirmar y seguir"}</button>
                        </>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </main>
      </div>
    </>
  );
}
