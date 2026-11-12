import { useState } from "react";
import Shell from "../components/v2/Shell.jsx";
import { BotPresence } from "../components/v2/Presence.jsx";
import { BotDot } from "../components/v3/TrabajoHeader.jsx";
import NotFound from "./NotFound.jsx";
import { useBrowserFrames } from "../components/computer/useBrowserFrames.js";
import { ReturnNote, WatchedView, returnBody } from "../components/computer/takeover.jsx";
import { useRoom } from "../components/room/useRoom.js";
import { findBot } from "../components/room/common.jsx";
import { useStore } from "../lib/store.jsx";
import { post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { useExpert } from "../lib/expert.js";
import { approvalCard } from "../lib/approvalCard.js";
import HoldButton from "../components/HoldButton.jsx";

// Colmena 3 · Trabajo › una tarea › el navegador de un bot (design/V3Ordenador.dc.html): what
// it sees, live; at a red line the honey card that waits for your OK (publishing, sending or
// buying asks for a second press); what it has done; and what it may touch. You can take
// the controls at any time and give them back. While you only watch, a click or a key on the
// view asks «¿Quieres tomar el control?» (it never reaches the page); with «Devolver el
// control» you can leave the bot a one-line note (components/computer/takeover.jsx).

const INK = "#12131A";
const MUTED = "#4A4D57";
const FAINT = "#5C606C";
const hhmm = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
const lower = (s) => String(s || "").replace(/^./, (c) => c.toLowerCase());
const go = (href) => (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); navigate(href); };
const pill = { height: "28px", padding: "0 10px", display: "inline-flex", alignItems: "center", borderRadius: "999px", background: "#F1F1EC", fontSize: "12.5px" };

export default function OrdenadorV2({ params = {}, query = {} }) {
  const { bots, folders = [], ready } = useStore();
  const [expert] = useExpert();
  const room = useRoom(params.id);
  const { mission: m, steps, pending } = room;
  const { frame, available, takeover } = useBrowserFrames(params.id);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [note, setNote] = useState("");

  if (ready && !room.loading && !m) return <NotFound title="Este navegador ya no está abierto" text="La tarea terminó o se cerró. Lo que hizo el bot sigue en su sala y en la Biblioteca." />;
  if (!m) return <Shell active="trabajo"><div /></Shell>;

  const running = steps.find((s) => s.status === "running") || null;
  const botId = frame?.botId || query.bot || running?.botId || m.botIds?.[0];
  const bot = findBot(bots, botId);
  const name = bot?.name || "El bot";
  const ask = pending.find((a) => (a.computer || a.redLine) && (!a.botId || a.botId === botId)) || null;
  const host = frame ? hostOf(frame.url) : "";
  const secure = frame ? /^https:/.test(frame.url || "") : false;
  const active = ["running", "planning", "queued"].includes(m.status);

  const run = async (key, fn) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const take = () => run("take", () => post("/computer/takeover", { missionId: m.id, action: "take", ...(frame?.botId ? { botId: frame.botId } : {}) }));
  const giveBack = () => run("return", async () => { await post("/computer/takeover", returnBody(m.id, frame?.botId, note)); setNote(""); });
  const decide = (decision) => run(decision, async () => {
    await post(`/approvals/${encodeURIComponent(ask.id)}`, { decision, revision: ask.revision });
    setOutcome(decision === "approved" ? { text: `Hecho con tu OK a las ${hhmm(new Date().toISOString())}. ${name} lo deja anotado en la tarea.`, ok: true } : { text: `No lo ha hecho. ${name} te deja el borrador listo.`, ok: false });
  });
  // The same verbs as every other approval (lib/approvalCard.js): a red line is held to approve.
  const card = ask ? approvalCard(ask, { botName: bot?.name, undo: false }) : null;
  const denyLabel = card?.secondary.find((s) => s.id === "deny")?.label || "No permitir";

  const status = outcome?.ok ? "Terminado · " + lower(outcome.text.split(".")[0])
    : ask ? `En ${m.title} · espera tu OK para seguir`
    : takeover ? `Tienes el control · ${name} mira`
    : !frame ? (available === false ? "El navegador de los bots solo funciona en la app de escritorio" : `Cuando ${name} abra una página, la verás aquí en directo`)
    : active ? (frame.title ? `En «${frame.title}»` : "Navegando") : "Ha terminado";
  const live = takeover ? { text: "TÚ", bg: "#E3EBFF", fg: "#1F4FD1" } : ask ? { text: "EN PAUSA", bg: "#FFF1C7", fg: "#8A5A00" } : { text: "EN VIVO", bg: "#FBE9EA", fg: "#B4232A" };

  const log = steps.filter((s) => s.botId === botId).flatMap((s) => s.activity || []).slice(-8);
  const items = log.map((l) => ({ text: l.text || [l.verb, l.detail].filter(Boolean).join(" · "), time: hhmm(l.at) }));
  if (ask) items.push({ text: "Se paró antes de «" + (ask.title || "seguir") + "» y te avisó", time: "ahora", now: true });
  else if (takeover) items.push({ text: "Te ha dado el control", time: "ahora" });
  const touch = [...new Set([host, ...log.map((l) => hostOf(l.detail || "")).filter(Boolean)].filter(Boolean))].slice(0, 4);
  const myFolders = folders.filter((f) => !f.botIds?.length || f.botIds.includes(botId)).map((f) => "Carpeta " + f.label);
  const tools = expert ? (running?.tools || []).slice(-5) : [];

  return (
    <Shell active="trabajo">
      <main style={{ maxWidth: "1180px", margin: "0 auto", padding: "32px clamp(20px, 4vw, 44px) 48px", display: "flex", flexDirection: "column", gap: "20px" }}>
        <nav aria-label="Miga" style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: FAINT, minWidth: 0 }}>
          <a href="/trabajo" onClick={go("/trabajo")} style={{ color: FAINT }}>Trabajo</a><span aria-hidden="true">›</span>
          <a href={`/encargo/${m.id}`} onClick={go(`/encargo/${m.id}`)} style={{ color: FAINT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "360px" }}>{m.title}</a><span aria-hidden="true">›</span>
          <span style={{ color: INK, fontWeight: 500, whiteSpace: "nowrap" }}>{"Navegador de " + name}</span>
        </nav>

        <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px" }}>
          {bot ? <BotDot bot={bot} size={34} work={active && !takeover && !ask} /> : null}
          <div style={{ flex: "1 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
            <h1 style={{ margin: 0, font: "600 34px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{frame && active ? `${name} está usando su navegador` : `El navegador de ${name}`}</h1>
            <span role="status" style={{ fontSize: "14.5px", color: ask ? "#8A5A00" : MUTED }}>{status}</span>
          </div>
          {frame ? (
            <button type="button" disabled={!!busy} onClick={takeover ? giveBack : take} style={{ height: "44px", padding: "0 20px", border: 0, borderRadius: "999px", background: takeover ? INK : "#FFFFFF", color: takeover ? "#FFFFFF" : INK, fontSize: "15px", fontWeight: 600, cursor: busy ? "wait" : "pointer", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.16)" }}>
              {takeover ? (busy === "return" ? "Devolviendo…" : "Devolver el control") : busy === "take" ? "Abriendo…" : "Tomar el control"}
            </button>
          ) : null}
        </header>
        {takeover && frame ? (
          <ReturnNote name={name} value={note} onChange={setNote} onSubmit={giveBack} disabled={busy === "return"}
            style={{ padding: "14px 18px", borderRadius: "20px", background: "#FFFFFF" }}
            inputStyle={{ height: "44px", border: 0, borderRadius: "999px", background: "#F6F6F3", fontSize: "15px", padding: "0 18px" }} />
        ) : null}
        {error ? <p role="alert" style={{ margin: 0, fontSize: "14px", color: "#B4232A" }}>{error}</p> : null}

        <div style={{ display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "flex-start" }}>
          <section aria-label="Vista en vivo" style={{ flex: "999 1 560px", minWidth: 0, display: "flex", flexDirection: "column", borderRadius: "20px", background: "#FFFFFF", overflow: "hidden", transition: "box-shadow .3s ease", boxShadow: `0 0 0 3px ${takeover ? "#1F4FD1" : "transparent"}, 0 30px 60px -34px rgba(18,19,26,.5)` }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", height: "46px", padding: "0 14px", background: "#EDEEF0" }}>
              <span aria-hidden="true" style={{ display: "flex", gap: "6px" }}>{[0, 1, 2].map((i) => <span key={i} style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#C9CBD3" }} />)}</span>
              <span title={frame?.url || ""} style={{ flex: 1, minWidth: 0, height: "30px", display: "flex", alignItems: "center", gap: "8px", padding: "0 12px", borderRadius: "8px", background: "#FFFFFF", font: "400 13px/1 'Geist Mono', monospace", color: "#3D404A", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={secure ? "#0B6B4A" : "#9A9DA6"} strokeWidth="2.4" aria-hidden="true" style={{ flex: "none" }}><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>
                {frame ? String(frame.url || "").replace(/^https?:\/\//, "") : "sin página abierta"}
              </span>
              {frame ? (
                <span style={{ flex: "none", height: "24px", padding: "0 10px", display: "inline-flex", alignItems: "center", gap: "6px", borderRadius: "999px", background: live.bg, color: live.fg, fontSize: "12px", fontWeight: 600 }}>
                  <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "50%", background: "currentColor", animation: ask ? "none" : "breathe 1.4s ease-in-out infinite" }} />
                  {live.text}
                </span>
              ) : null}
            </div>
            <WatchedView watching={!!frame?.image && !takeover} name={name} busy={!!busy} onTake={take}
              takeStyle={{ height: "42px", padding: "0 18px", border: 0, borderRadius: "999px", background: INK, color: "#FFFFFF", fontSize: "14.5px", fontWeight: 600, cursor: "pointer" }}
              quietStyle={{ height: "42px", padding: "0 16px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", background: "#FFFFFF", fontSize: "14.5px", cursor: "pointer" }}
              style={{ minHeight: "440px", background: "#FBFBFA", display: "grid", placeItems: "center", overflow: "hidden" }}>
              {frame?.image ? (
                <img src={frame.image} alt={"Lo que ve " + name + ": " + (frame.title || host || "página web")} style={{ display: "block", width: "100%", height: "auto", maxHeight: "72vh", objectFit: "contain" }} />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", padding: "40px", textAlign: "center", color: FAINT }}>
                  {bot ? <BotPresence bot={bot} size={52} state={active ? "work" : "rest"} /> : null}
                  <span style={{ maxWidth: "380px", fontSize: "15.5px", lineHeight: 1.5 }}>{available === false ? "El navegador de los bots solo funciona en la app de escritorio de Colmena." : `${name} no tiene ninguna página abierta ahora mismo.`}</span>
                </div>
              )}
              {takeover ? <div role="status" style={{ position: "absolute", left: "16px", bottom: "16px", padding: "8px 14px", borderRadius: "999px", background: INK, color: "#FFFFFF", fontSize: "13px", animation: "rise .3s ease-out" }}>{`Tienes el control. ${name} espera y mira lo que haces.`}</div> : null}
            </WatchedView>
          </section>

          <aside style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: "14px" }}>
            {ask && !outcome ? (
              <div role="region" aria-labelledby="perm-t" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "20px", borderRadius: "20px", background: "#FFFFFF", boxShadow: "0 0 0 2px #FFC93C", animation: "rise .35s ease-out" }}>
                <span style={{ alignSelf: "flex-start", height: "26px", padding: "0 10px", display: "inline-flex", alignItems: "center", borderRadius: "999px", background: "#FFC93C", fontSize: "12.5px", fontWeight: 600 }}>{ask.redLine ? "Línea roja · necesita tu OK" : "Necesita tu OK"}</span>
                <h2 id="perm-t" style={{ margin: 0, fontSize: "18px", fontWeight: 600, lineHeight: 1.3 }}>{`${name} quiere ${lower(ask.title || "seguir")}`}</h2>
                {ask.summary || ask.description ? <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: MUTED }}>{ask.summary || ask.description}</p> : null}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {card.primary?.hold
                    ? <HoldButton disabled={!!busy} onConfirm={() => decide("approved")} plainLabel={card.primary.plain} style={{ height: "42px", padding: "0 18px", border: 0, borderRadius: "999px", background: INK, color: "#FFFFFF", fontSize: "14.5px", fontWeight: 600, cursor: "pointer" }}>{card.primary.label}</HoldButton>
                    : <button type="button" disabled={!!busy} onClick={() => decide("approved")} style={{ height: "42px", padding: "0 18px", border: 0, borderRadius: "999px", background: INK, color: "#FFFFFF", fontSize: "14.5px", fontWeight: 600, cursor: "pointer" }}>{"Aprobar"}</button>}
                  {frame ? <button type="button" disabled={!!busy} onClick={take} style={{ height: "42px", padding: "0 16px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", background: "#FFFFFF", fontSize: "14.5px", cursor: "pointer" }}>Lo hago yo</button> : null}
                  <button type="button" disabled={!!busy} onClick={() => decide("denied")} style={{ height: "42px", padding: "0 12px", border: 0, background: "transparent", fontSize: "14.5px", color: MUTED, cursor: "pointer" }}>{denyLabel}</button>
                </div>
              </div>
            ) : null}
            {outcome ? <div role="status" style={{ padding: "18px 20px", borderRadius: "20px", background: outcome.ok ? "#E3F4EC" : "#F1F1EC", color: outcome.ok ? "#0B6B4A" : INK, fontSize: "14.5px", fontWeight: 500, lineHeight: 1.45 }}>{outcome.text}</div> : null}

            <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "16px 18px", borderRadius: "20px", background: "#FFFFFF" }}>
              <h2 style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: 600 }}>Lo que ha hecho</h2>
              {items.length ? items.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: "10px", padding: "5px 0", fontSize: "14px", lineHeight: 1.4 }}>
                  <span style={{ flex: "none", width: "42px", color: FAINT, fontVariantNumeric: "tabular-nums" }}>{s.time}</span>
                  <span style={{ minWidth: 0, overflowWrap: "anywhere", fontWeight: s.now ? 600 : 400 }}>{s.text}</span>
                </div>
              )) : <span style={{ fontSize: "14px", color: FAINT }}>Aún no ha hecho nada en el navegador.</span>}
              {tools.length ? (
                <div aria-label="Herramientas" style={{ display: "flex", flexDirection: "column", gap: "3px", marginTop: "8px", padding: "10px 12px", borderRadius: "12px", background: "#F6F6F3", font: "400 12px/1.5 'Geist Mono', monospace", color: "#3D404A" }}>
                  {tools.map((t) => <span key={t.id} style={{ display: "flex", gap: "10px" }}><span style={{ color: INK, fontWeight: 500 }}>{t.name}</span><span style={{ color: t.status === "error" ? "#B4232A" : FAINT }}>{t.error || t.status}</span></span>)}
                </div>
              ) : null}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "16px 18px", borderRadius: "20px", background: "#FFFFFF" }}>
              <h2 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>Lo que puede tocar</h2>
              <p style={{ margin: 0, fontSize: "13.5px", lineHeight: 1.5, color: MUTED }}>Solo su propio navegador, dentro de Colmena. Nunca escribe contraseñas: si una página la pide, te la pasa a ti. Antes de enviar, comprar, publicar o borrar, siempre te pregunta.</p>
              {touch.length || myFolders.length ? <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>{[...touch, ...myFolders].map((t) => <span key={t} style={pill}>{t}</span>)}</div> : null}
              <a href="/ajustes/permisos" onClick={go("/ajustes/permisos")} style={{ fontSize: "13.5px", color: "#1F4FD1" }}>Cambiar en Permisos</a>
            </div>
          </aside>
        </div>
      </main>
    </Shell>
  );
}
