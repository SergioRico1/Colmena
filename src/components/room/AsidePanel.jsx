import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Quote, RotateCcw, X } from "lucide-react";
import { del, get, post } from "../../lib/api.js";
import { useStore } from "../../lib/store.jsx";
import { time } from "../../lib/format.js";
import { BotAvatar, ErrorLine, findBot } from "./common.jsx";
import Markdown from "./Markdown.jsx";
import WorkingDots from "./Dots.jsx";
import { ListenButton } from "../interaction/Voice.jsx";

// «Preguntar aparte» (OpenClaw Side chat): a side conversation about this room that never
// interrupts the bots nor enters the room — unless you choose «Pasarla a la sala». Up to 24
// turns, each answer knowing the earlier ones; a passage you selected in a message goes with
// the question («Sobre «…»: »). Starter questions while nothing has been asked.
const STARTERS = ["¿Qué ha cambiado desde la última vez?", "¿Por qué se ha parado?", "¿Qué falta para terminar?"];
const SNIPPET = 300;
const I = { size: 15, strokeWidth: 2.2, "aria-hidden": "true" };

// A passage chosen with «Preguntar aparte» before the tab was open waits here for it.
const waiting = new Map(); // missionId → text
const listeners = new Set();
export function askAsideAbout(missionId, text) {
  waiting.set(missionId, String(text || ""));
  for (const fn of listeners) fn(missionId);
}

export default function AsidePanel({ mission }) {
  const { bots } = useStore();
  const members = [...new Set([...(mission?.mode === "equipo" ? ["atlas"] : []), ...(mission?.botIds || [])])].map((id) => findBot(bots, id));
  const [botId, setBotId] = useState(null);
  const [turns, setTurns] = useState([]); // stored asides + local {pending|failed}
  const [text, setText] = useState("");
  const [selection, setSelection] = useState("");
  const [error, setError] = useState(null);
  const input = useRef(null);
  const end = useRef(null);
  const target = botId ? findBot(bots, botId) : members[0];

  useEffect(() => {
    let alive = true;
    get(`/missions/${encodeURIComponent(mission.id)}/aside`).then((list) => { if (alive) setTurns(list.map((a) => ({ ...a, status: "answered" }))); }, () => {});
    return () => { alive = false; };
  }, [mission.id]);
  // A passage handed over by the selection toolbar: quote it and focus the box.
  const take = useCallback((missionId) => {
    if (missionId !== mission.id || !waiting.has(missionId)) return;
    const passage = waiting.get(missionId);
    waiting.delete(missionId);
    setSelection(passage);
    const snippet = passage.replace(/\s+/g, " ").trim().slice(0, SNIPPET);
    setText((t) => (t.trim() ? t : `Sobre «${snippet}${passage.length > SNIPPET ? "…" : ""}»: `));
    requestAnimationFrame(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  }, [mission.id]);
  useEffect(() => {
    take(mission.id);
    listeners.add(take);
    return () => listeners.delete(take);
  }, [take, mission.id]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [turns.length]);

  const ask = async (question, { retryOf = null } = {}) => {
    const q = String(question || "").trim();
    if (!q) return;
    const localId = "local-" + Date.now();
    const passage = retryOf?.selection ?? selection;
    setTurns((all) => [...all.filter((t) => t.id !== retryOf?.id), { id: localId, question: q, selection: passage || null, botId: target?.id, status: "pending", startedAt: Date.now() }]);
    setText("");
    setSelection("");
    setError(null);
    try {
      const a = await post(`/missions/${encodeURIComponent(mission.id)}/aside`, { text: q, thread: true, ...(botId ? { botId } : {}), ...(passage ? { selection: passage } : {}) });
      setTurns((all) => all.map((t) => (t.id === localId ? { ...a, status: "answered" } : t)));
    } catch (e) {
      setTurns((all) => all.map((t) => (t.id === localId ? { ...t, status: "failed", error: e.message } : t)));
    }
  };
  const share = async (t) => {
    try {
      await post(`/missions/${encodeURIComponent(mission.id)}/aside/${t.id}/share`);
      setTurns((all) => all.map((x) => (x.id === t.id ? { ...x, shared: true } : x)));
    } catch (e) {
      setError(e.message);
    }
  };
  const discard = (t) => {
    setTurns((all) => all.filter((x) => x.id !== t.id));
    if (t.status === "answered" && !t.shared) del(`/missions/${encodeURIComponent(mission.id)}/aside/${t.id}`).catch(() => {});
  };
  const pending = turns.some((t) => t.status === "pending");
  const answered = turns.some((t) => t.status === "answered");

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      <div style={{ padding: "12px 16px 8px", display: "flex", flexDirection: "column", gap: "8px", borderBottom: "1px solid #E6E8EE" }}>
        <p style={{ margin: 0, fontSize: "12px", lineHeight: "1.45", color: "#555A68" }}>No interrumpe a nadie ni queda en la sala, salvo que la pases. Responde con lo que ya se sabe de esta conversación.</p>
        {members.length > 1 ? (
          <div role="group" aria-label="A quién preguntas" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
            {members.map((b) => {
              const on = target?.id === b.id;
              return (
                <button key={b.id} type="button" className="rm-focus" aria-pressed={on ? "true" : "false"} onClick={() => setBotId(b.id)}
                  style={{ display: "flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 10px 0 4px", background: "#FFFFFF", border: on ? "2px solid #12131A" : "1px dashed #A9AEBB", borderRadius: "15px", cursor: "pointer", fontSize: "12px", fontWeight: on ? "600" : "400", color: on ? "#12131A" : "#555A68" }}>
                  <BotAvatar bot={b} size={20} />{b.name}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <div aria-live="polite" style={{ flex: "1", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "14px" }}>
        {!turns.length ? <p style={{ margin: 0, fontSize: "13px", lineHeight: "1.5", color: "#4A4F5C" }}>{`Pregúntale a ${target?.name || "un bot"} lo que quieras sobre esta conversación.`}</p> : null}
        {turns.map((t) => {
          const bot = findBot(bots, t.botId || target?.id);
          return (
            <article key={t.id} className="c-enter" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ alignSelf: "flex-end", maxWidth: "88%", padding: "8px 12px", background: "#12131A", color: "#FFFFFF", borderRadius: "14px 14px 4px 14px", fontSize: "14px", lineHeight: "1.45", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{t.question}</div>
              {t.selection ? <span style={{ alignSelf: "flex-end", display: "inline-flex", alignItems: "center", gap: "4px", maxWidth: "88%", fontSize: "11px", color: "#555A68" }}><Quote {...I} size={11} />con el texto que seleccionaste</span> : null}
              <div style={{ display: "grid", gridTemplateColumns: "26px 1fr", gap: "10px" }}>
                <BotAvatar bot={bot} size={26} />
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
                  {t.status === "pending" ? (
                    <span role="status" style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#4A4F5C" }}><WorkingDots />{`${bot.name} está mirando la conversación…`}</span>
                  ) : t.status === "failed" ? (
                    <span role="alert" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "13px", color: "#B4372A" }}>
                      {t.error || "No ha podido responder."}
                      <button type="button" className="rm-focus" onClick={() => ask(t.question, { retryOf: t })} style={{ display: "inline-flex", alignItems: "center", gap: "4px", height: "28px", padding: "0 10px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "8px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}><RotateCcw {...I} size={12} />Reintentar</button>
                    </span>
                  ) : (
                    <>
                      <Markdown text={t.answer} size={14} />
                      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px" }}>
                        <span style={{ fontSize: "11px", color: "#555A68", marginRight: "6px" }}>{t.at ? "a las " + time(t.at) : ""}</span>
                        {t.shared ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", height: "28px", padding: "0 8px", background: "#E1F4EC", borderRadius: "14px", fontSize: "12px", fontWeight: "600", color: "#0B5A3E" }}><Check {...I} size={12} />En la sala</span>
                        ) : (
                          <button type="button" className="rm-focus" onClick={() => share(t)} style={{ height: "28px", padding: "0 10px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "8px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>Pasarla a la sala</button>
                        )}
                        <ListenButton text={t.answer} bot={bot} compact style={{ width: "28px", height: "28px" }} />
                        <button type="button" className="rm-focus" onClick={() => discard(t)} aria-label="Descartar" title="Descartar" style={{ width: "28px", height: "28px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "8px", cursor: "pointer", color: "#555A68" }}><X {...I} size={13} /></button>
                      </span>
                    </>
                  )}
                </div>
              </div>
            </article>
          );
        })}
        <span ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (!pending) ask(text); }} style={{ position: "sticky", bottom: 0, padding: "10px 14px 14px", background: "#F7F8FA", borderTop: "1px solid #E6E8EE", display: "flex", flexDirection: "column", gap: "8px" }}>
        {!answered && !pending ? (
          <div role="group" aria-label="Preguntas para empezar" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {STARTERS.map((q) => <button key={q} type="button" className="rm-focus" onClick={() => ask(q)} style={{ height: "28px", padding: "0 10px", background: "#FFFFFF", border: "1px dashed #A9AEBB", borderRadius: "14px", cursor: "pointer", fontSize: "12px" }}>{q}</button>)}
          </div>
        ) : null}
        {selection ? (
          <span className="c-pop" style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 6px 6px 10px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "10px", fontSize: "12px", color: "#4A4F5C" }}>
            <Quote {...I} size={13} style={{ flex: "none" }} />
            <span style={{ flex: "1", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selection}</span>
            <button type="button" className="rm-focus" onClick={() => setSelection("")} aria-label="Quitar el texto seleccionado" style={{ width: "24px", height: "24px", display: "grid", placeItems: "center", background: "transparent", border: "0", cursor: "pointer" }}><X {...I} size={12} /></button>
          </span>
        ) : null}
        <label style={{ display: "flex", alignItems: "flex-end", gap: "8px", padding: "6px 6px 6px 12px", background: "#FFFFFF", border: "2px solid #12131A", borderRadius: "14px" }}>
          <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>Tu pregunta aparte</span>
          <textarea ref={input} rows="1" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} disabled={pending}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!pending) ask(text); } }}
            placeholder={`Pregúntale a ${target?.name || "un bot"}, sin interrumpir…`}
            style={{ flex: "1", minWidth: 0, resize: "none", border: "0", outline: "none", background: "transparent", fontSize: "14px", lineHeight: "1.45", padding: "6px 0", fieldSizing: "content", maxHeight: "140px" }} />
          <button type="submit" aria-label="Preguntar" disabled={pending || !text.trim()} style={{ width: "38px", height: "38px", flex: "none", display: "grid", placeItems: "center", background: "#FFC93C", border: "2px solid #12131A", borderRadius: "10px", cursor: "pointer", opacity: pending || !text.trim() ? 0.55 : 1 }}><ArrowUp {...I} size={16} strokeWidth={2.4} /></button>
        </label>
        <ErrorLine>{error}</ErrorLine>
      </form>
    </div>
  );
}
