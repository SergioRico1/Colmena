import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, MessageCircleQuestion, X } from "lucide-react";
import { del, post } from "../../lib/api.js";
import { useStore } from "../../lib/store.jsx";
import { BotAvatar, ErrorLine, findBot, useDismiss } from "../room/common.jsx";
import Markdown from "../room/Markdown.jsx";
import { ListenButton } from "./Voice.jsx";
import { later } from "../../lib/undoToast.js";

// «Pregunta rápida» (OpenClaw /btw): ask about what is going on without interrupting.
// POST /api/missions/:id/aside answers with the mission's context and no tools; nothing is
// written to the room unless you choose «Pasarla a la sala». Card language of the room
// (white card, 2px ink border, yellow offset shadow); the panel scrolls on its own.

const LABEL = { font: "500 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" };
const sr = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" };

function AsideAnswer({ aside, bots, missionId, onDiscard }) {
  const { run } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [shared, setShared] = useState(aside.shared);
  const bot = findBot(bots, aside.botId);
  const share = async () => {
    setBusy(true);
    setError(null);
    try {
      await run(() => post(`/missions/${missionId}/aside/${aside.id}/share`));
      setShared(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px", background: "#F7F8FA", border: "1px solid #E6E8EE", borderRadius: "14px" }}>
      <p style={{ margin: "0", fontSize: "13px", lineHeight: "1.45", color: "#4A4F5C" }}><strong style={{ color: "#12131A" }}>{"Tú: "}</strong>{aside.question}</p>
      <div style={{ display: "grid", gridTemplateColumns: "26px 1fr", gap: "10px" }}>
        <BotAvatar bot={bot} size={26} />
        <div style={{ minWidth: "0", display: "flex", flexDirection: "column", gap: "4px" }}>
          <strong style={{ fontSize: "14px" }}>{bot.name}</strong>
          <Markdown text={aside.answer} size={14} />
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
        {shared ? (
          <span style={{ display: "flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 10px", background: "#E1F4EC", border: "1px solid #9ED4BC", borderRadius: "16px", fontSize: "12px", fontWeight: "600", color: "#0B5A3E" }}>
            <Check size={13} strokeWidth={2.6} aria-hidden="true" />
            {"En la sala"}
          </span>
        ) : (
          <button type="button" className="rm-focus" disabled={busy} onClick={share} style={{ height: "34px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "9px", cursor: busy ? "progress" : "pointer", fontSize: "13px", fontWeight: "600" }}>{"Pasarla a la sala"}</button>
        )}
        <button type="button" className="rm-focus" onClick={onDiscard} style={{ height: "34px", padding: "0 10px", background: "transparent", border: "0", borderRadius: "9px", cursor: "pointer", fontSize: "13px", color: "#2B2D36" }}>{shared ? "Cerrar" : "Descartar"}</button>
        <span style={{ flex: "1" }} />
        <ListenButton text={aside.answer} bot={bot} />
      </div>
      <ErrorLine>{error}</ErrorLine>
    </article>
  );
}

/**
 * Header button + floating panel. `mission` needs {id, botIds, mode, conversation, status};
 * `align` places the panel under the button ("right" | "left").
 */
export default function QuickQuestion({ mission, bots, align = "right", buttonStyle }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [asides, setAsides] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const members = [...new Set([...(mission?.mode === "equipo" ? ["atlas"] : []), ...(mission?.botIds || [])])].map((id) => findBot(bots, id));
  const [botId, setBotId] = useState(null);
  const ref = useDismiss(open, () => setOpen(false));
  const input = useRef(null);
  useEffect(() => {
    setAsides([]);
    setBotId(null);
    setError(null);
  }, [mission?.id]);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 30);
  }, [open]);
  if (!mission) return null;
  const target = botId ? findBot(bots, botId) : members[0];
  const working = ["running", "planning", "queued"].includes(mission.status);

  const ask = async (e) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const aside = await post(`/missions/${mission.id}/aside`, botId ? { text: body, botId } : { text: body });
      setAsides((all) => [aside, ...all]);
      setText("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  // Gone at once; the server forgets it after the five-second «Deshacer».
  const discard = (a) => {
    setAsides((all) => all.filter((x) => x.id !== a.id));
    later({ id: "aside:" + a.id, text: "Respuesta descartada", undone: () => setAsides((all) => (all.some((x) => x.id === a.id) ? all : [...all, a])),
      run: () => (a.shared ? null : del(`/missions/${mission.id}/aside/${a.id}`)) });
  };

  return (
    <span ref={ref} style={{ position: "relative", display: "flex" }}>
      <button type="button" className="rm-focus" aria-haspopup="dialog" aria-expanded={open ? "true" : "false"} onClick={() => setOpen(!open)}
        style={{ display: "flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 12px", background: open ? "#12131A" : "#FFFFFF", color: open ? "#FFFFFF" : "#12131A", border: "1px solid #DCE0E8", borderRadius: "10px", cursor: "pointer", fontSize: "14px", ...buttonStyle }}>
        <MessageCircleQuestion size={17} strokeWidth={2} aria-hidden="true" />
        {"Pregunta rápida"}
      </button>
      {open ? (
        <section role="dialog" aria-label="Pregunta rápida" style={{ position: "absolute", zIndex: 35, top: "calc(100% + 8px)", ...(align === "left" ? { left: "0" } : { right: "0" }), width: "min(440px, calc(100vw - 32px))", maxHeight: "min(640px, calc(100vh - 140px))", display: "flex", flexDirection: "column", background: "#FFFFFF", border: "2px solid #12131A", borderRadius: "16px", boxShadow: "6px 6px 0 #FFC93C", overflow: "hidden", color: "#12131A" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px", padding: "14px 10px 10px 16px", borderBottom: "1px solid #E6E8EE" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <strong style={{ font: "700 17px/1.1 'Bricolage Grotesque', sans-serif" }}>{"Pregunta rápida"}</strong>
              <span style={{ fontSize: "12px", lineHeight: "1.4", color: "#555A68" }}>{working ? `No interrumpe: ${target?.name || "el bot"} sigue con lo suyo y la pregunta no queda en la sala.` : "Pregunta lo que quieras sobre esta sala. No queda en la conversación salvo que la pases."}</span>
            </div>
            <button type="button" className="rm-focus" aria-label="Cerrar la pregunta rápida" onClick={() => setOpen(false)} style={{ width: "36px", height: "36px", flex: "none", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "9px", cursor: "pointer" }}>
              <X size={16} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
          <div style={{ flex: "1 1 auto", minHeight: "0", overflowY: "auto", overscrollBehavior: "contain", padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
            {members.length > 1 ? (
              <div role="group" aria-label="A quién preguntas" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
                <span style={LABEL}>{"Pregunta a"}</span>
                {members.map((b) => {
                  const on = (target?.id || null) === b.id;
                  return (
                    <button key={b.id} type="button" aria-pressed={on ? "true" : "false"} onClick={() => setBotId(b.id)} style={{ display: "flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 10px 0 4px", background: "#FFFFFF", border: on ? "2px solid #12131A" : "1px dashed #A9AEBB", borderRadius: "16px", cursor: "pointer", fontSize: "13px", fontWeight: on ? "600" : "400", color: on ? "#12131A" : "#555A68" }}>
                      <BotAvatar bot={b} size={22} />{b.name}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <form onSubmit={ask} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label style={{ display: "flex", alignItems: "flex-end", gap: "8px", padding: "6px 6px 6px 12px", background: "#FFFFFF", border: "1.5px solid #A9AEBB", borderRadius: "12px" }}>
                <span style={sr}>{"Tu pregunta al margen"}</span>
                <textarea ref={input} rows="1" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) ask(e); }} placeholder={`¿Qué quieres saber, sin interrumpir a ${target?.name || "nadie"}?`} style={{ flex: "1", minWidth: "0", resize: "none", border: "0", outline: "none", background: "transparent", fontSize: "14px", lineHeight: "1.45", padding: "6px 0", fieldSizing: "content", maxHeight: "140px" }} />
                <button type="submit" aria-label="Preguntar" disabled={busy || !text.trim()} aria-busy={busy ? "true" : undefined} style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", background: "#FFC93C", border: "2px solid #12131A", borderRadius: "10px", cursor: busy ? "progress" : "pointer" }}>
                  {busy ? <span aria-hidden="true" style={{ width: "14px", height: "14px", borderRadius: "50%", border: "2px solid #C9CCD6", borderTopColor: "#12131A", animation: "colmena-spin .8s linear infinite" }} /> : <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />}
                </button>
              </label>
              {busy ? <span role="status" style={{ fontSize: "12px", color: "#555A68" }}>{`${target?.name || "El bot"} está mirando la sala para responderte…`}</span> : null}
              <ErrorLine>{error}</ErrorLine>
            </form>
            {asides.map((a) => <AsideAnswer key={a.id} aside={a} bots={bots} missionId={mission.id} onDiscard={() => discard(a)} />)}
            {!asides.length && !busy ? <p style={{ margin: "0", fontSize: "13px", lineHeight: "1.5", color: "#555A68" }}>{"Por ejemplo: «¿Qué falta para terminar?», «¿De dónde sale esa cifra?» o «¿Qué ha decidido Atlas?»."}</p> : null}
          </div>
        </section>
      ) : null}
    </span>
  );
}
