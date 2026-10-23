import { useEffect, useRef, useState } from "react";
import Shell from "../components/v2/Shell.jsx";
import { BotPresence } from "../components/v2/Presence.jsx";
import NotFound from "./NotFound.jsx";
import { useBrowserFrames } from "../components/computer/useBrowserFrames.js";
import { useRoom } from "../components/room/useRoom.js";
import { findBot } from "../components/room/common.jsx";
import { useStore } from "../lib/store.jsx";
import { post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";

// Colmena 2.0 · El navegador de un bot (design/V2Ordenador.dc.html): what it sees, live; what
// it has done; and, at a red line, the honey card that waits for your OK. Publishing,
// sending or buying asks for a second press. You can take the controls at any time.

const INK = "#12131A";
const MUTED = "#5C606C";
const FAINT = "#6B6F7A";
const HONEY_GLOW = "0 0 0 1px rgba(255,201,60,.6), 0 0 0 7px rgba(255,201,60,.16), 0 30px 60px -30px rgba(201,138,0,.6)";
const hhmm = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

export default function OrdenadorV2({ params = {}, query = {} }) {
  const { bots, folders = [], ready } = useStore();
  const room = useRoom(params.id);
  const { mission: m, steps, pending } = room;
  const { frame, available, takeover } = useBrowserFrames(params.id);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [armed, setArmed] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (ready && !room.loading && !m) return <NotFound title="Este navegador ya no está abierto" text="El encargo terminó o se cerró. Lo que hizo el bot sigue en su sala y en el Archivo." />;
  if (!m) return <Shell active="hoy"><div /></Shell>;

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
  const giveBack = () => run("return", () => post("/computer/takeover", { missionId: m.id, action: "return", ...(frame?.botId ? { botId: frame.botId } : {}) }));
  const decide = (decision) => run(decision, async () => {
    await post(`/approvals/${encodeURIComponent(ask.id)}`, { decision, revision: ask.revision });
    setOutcome(decision === "approved" ? { text: "Hecho con tu OK · lo verás en la sala", bg: "#E1F4EC", fg: "#0B5A3E" } : { text: `No lo ha hecho. ${name} te deja el borrador listo.`, bg: INK, fg: "#FFFFFF" });
    setArmed(false);
  });
  // Red-line actions need a second press within 3 s (design: «Pulsa otra vez para publicar»).
  const confirm = () => {
    if (!armed) { setArmed(true); clearTimeout(timer.current); timer.current = setTimeout(() => setArmed(false), 3000); return; }
    clearTimeout(timer.current);
    decide("approved");
  };

  const status = ask ? "Se ha parado antes de una línea roja y te espera"
    : takeover ? "En pausa mientras tú controlas el navegador"
    : !frame ? (available === false ? "El navegador de los bots solo funciona en la app de escritorio" : `Cuando ${name} abra una página, la verás aquí en directo`)
    : active ? (frame.title ? "Está en «" + frame.title + "»" : "Navegando") : "Ha terminado";
  const badge = takeover ? { text: "Tú", bg: INK, fg: "#FFFFFF", anim: "none" } : ask ? { text: "En pausa", bg: "#FFF4D1", fg: "#8A5A00", anim: "none" } : { text: "En directo", bg: "#E1F4EC", fg: "#0B6B4A", anim: "halo 1.8s ease-out infinite" };

  const log = steps.filter((s) => s.botId === botId).flatMap((s) => s.activity || []).slice(-6);
  const items = log.map((l) => ({ text: l.text || [l.verb, l.detail].filter(Boolean).join(" · "), time: hhmm(l.at), done: true }));
  items.push(ask ? { text: `Quiere: ${ask.title || "hacer algo que necesita tu OK"}`, time: "ahora", now: true }
    : takeover ? { text: "Te ha dado el control", time: "ahora", now: false }
    : outcome ? { text: outcome.text, time: "ahora", done: true } : null);
  const touch = [...new Set([host, ...log.map((l) => hostOf(l.detail || "")).filter(Boolean)].filter(Boolean))].slice(0, 4);
  const myFolders = folders.filter((f) => !f.botIds?.length || f.botIds.includes(botId)).map((f) => "Archivos · " + f.label);

  return (
    <Shell active="hoy">
      <main style={{ padding: "28px clamp(20px, 3vw, 40px) 40px", display: "flex", flexDirection: "column", gap: "22px" }}>
        <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px" }}>
          <a href={`/encargo/${m.id}`} onClick={(e) => { e.preventDefault(); navigate(`/encargo/${m.id}`); }} style={{ display: "flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 14px 0 10px", borderRadius: "999px", background: "rgba(18,19,26,.05)", fontSize: "14px", fontWeight: 500, maxWidth: "280px", minWidth: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}><path d="M15 6l-6 6 6 6" /></svg>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</span>
          </a>
          <div style={{ flex: "1 1 360px", display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
            {bot ? <BotPresence bot={bot} size={40} state={ask ? "wait" : active && !takeover ? "work" : null} /> : null}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
              <h1 style={{ margin: 0, font: "600 26px/1.05 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{frame && active ? `${name} está usando el navegador` : `El navegador de ${name}`}</h1>
              <span role="status" style={{ fontSize: "14px", color: ask ? "#8A5A00" : MUTED }}>{status}</span>
            </div>
          </div>
          {frame ? (
            <button type="button" disabled={!!busy} onClick={takeover ? giveBack : take} style={{ height: "46px", padding: "0 20px", border: 0, borderRadius: "999px", cursor: busy ? "wait" : "pointer", fontSize: "15px", fontWeight: 600, background: takeover ? INK : "rgba(18,19,26,.06)", color: takeover ? "#FFFFFF" : INK }}>
              {takeover ? (busy === "return" ? "Devolviendo…" : `Devolver a ${name}`) : busy === "take" ? "Abriendo…" : "Tomar el control"}
            </button>
          ) : null}
        </header>
        {error ? <p role="alert" style={{ margin: 0, fontSize: "14px", color: "#B4231A" }}>{error}</p> : null}

        <div style={{ display: "flex", flexWrap: "wrap", gap: "22px", alignItems: "flex-start" }}>
          <section aria-label={"Lo que ve " + name} style={{ flex: "3 1 640px", minWidth: 0, display: "flex", flexDirection: "column", borderRadius: "22px", overflow: "hidden", background: "#FFFFFF", transition: "box-shadow .3s ease", boxShadow: takeover ? `0 0 0 3px ${INK}, 0 30px 70px -36px rgba(18,19,26,.45)` : "0 1px 2px rgba(18,19,26,.05), 0 30px 70px -36px rgba(18,19,26,.35)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", height: "48px", padding: "0 14px", background: "#F0F0EC", borderBottom: "1px solid rgba(18,19,26,.06)" }}>
              <span aria-hidden="true" style={{ display: "flex", gap: "6px" }}>
                {[0, 1, 2].map((i) => <span key={i} style={{ width: "10px", height: "10px", borderRadius: "50%", background: "rgba(18,19,26,.14)" }} />)}
              </span>
              <span title={frame?.url || ""} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "8px", height: "32px", padding: "0 12px", borderRadius: "10px", background: "#FFFFFF", font: "400 13px/1 'Geist Mono', monospace", color: "#3D404A", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={secure ? "#0B8A5F" : "#9A9DA6"} strokeWidth="2.4" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                {frame ? String(frame.url || "").replace(/^https?:\/\//, "") : "sin página abierta"}
              </span>
              {frame ? (
                <span style={{ display: "flex", alignItems: "center", gap: "6px", padding: "0 10px", height: "26px", borderRadius: "999px", fontSize: "12px", fontWeight: 600, background: badge.bg, color: badge.fg }}>
                  <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "50%", background: "currentColor", animation: badge.anim }} />
                  {badge.text}
                </span>
              ) : null}
            </div>
            <div style={{ position: "relative", minHeight: "560px", background: "#FAFAF8", display: "grid", placeItems: "center", overflow: "hidden" }}>
              {frame?.image ? (
                <img src={frame.image} alt={"Lo que ve " + name + ": " + (frame.title || host || "página web")} style={{ display: "block", width: "100%", height: "auto", maxHeight: "72vh", objectFit: "contain", filter: ask ? "saturate(.9)" : "none", transition: "filter .3s ease" }} />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", padding: "40px", textAlign: "center", color: MUTED }}>
                  {bot ? <BotPresence bot={bot} size={56} state={active ? "work" : null} /> : null}
                  <span style={{ maxWidth: "380px", fontSize: "16px", lineHeight: 1.5 }}>{available === false ? "El navegador de los bots solo funciona en la app de escritorio de Colmena." : `${name} no tiene ninguna página abierta ahora mismo.`}</span>
                </div>
              )}
              {takeover ? (
                <div role="status" style={{ position: "absolute", left: "50%", top: "18px", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px", borderRadius: "999px", background: INK, color: "#FFFFFF", fontSize: "14px", fontWeight: 500, animation: "rise .3s ease-out", whiteSpace: "nowrap" }}>
                  <span aria-hidden="true" style={{ width: "22px", height: "22px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,.4)", font: "600 8px/1 'Geist', sans-serif" }}>TÚ</span>
                  {`Tienes el control. ${name} espera y mira lo que haces.`}
                </div>
              ) : null}
              {ask && !takeover ? (
                <div role="dialog" aria-labelledby="perm-t" style={{ position: "absolute", left: "24px", right: "24px", bottom: "24px", padding: "22px 24px", borderRadius: "26px", background: "rgba(255,255,255,.96)", WebkitBackdropFilter: "blur(20px)", backdropFilter: "blur(20px)", boxShadow: HONEY_GLOW, display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "16px", animation: "rise .35s ease-out" }}>
                  <div style={{ flex: "1 1 360px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 600, color: "#8A5A00" }}>
                      <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#FFC93C", animation: "halo 1.8s ease-out infinite" }} />
                      {ask.redLine ? "Línea roja · necesita tu OK" : "Necesita tu OK"}
                    </span>
                    <h2 id="perm-t" style={{ margin: 0, font: "600 22px/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{`${name} quiere ${String(ask.title || "seguir").replace(/^./, (c) => c.toLowerCase())}`}</h2>
                    {ask.summary || ask.description ? <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: "#3D404A" }}>{ask.summary || ask.description}</p> : null}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    <button type="button" disabled={!!busy} onClick={() => decide("denied")} style={{ height: "50px", padding: "0 18px", border: 0, borderRadius: "999px", background: "transparent", cursor: "pointer", fontSize: "15px", fontWeight: 600, color: INK }}>Ahora no</button>
                    {frame ? <button type="button" disabled={!!busy} onClick={take} style={{ height: "50px", padding: "0 18px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "15px", fontWeight: 600, color: INK }}>Lo hago yo</button> : null}
                    <button type="button" disabled={!!busy} onClick={confirm} style={{ minWidth: "210px", height: "50px", padding: "0 22px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "15px", fontWeight: 600, transition: "all .2s ease", background: armed ? INK : "#FFC93C", color: armed ? "#FFFFFF" : INK }}>
                      {armed ? "Pulsa otra vez para confirmar" : "Sí, hazlo"}
                    </button>
                  </div>
                </div>
              ) : null}
              {outcome && !ask ? (
                <div role="status" style={{ position: "absolute", left: "24px", bottom: "24px", display: "flex", alignItems: "center", gap: "10px", padding: "12px 18px", borderRadius: "999px", fontSize: "14px", fontWeight: 500, animation: "rise .3s ease-out", background: outcome.bg, color: outcome.fg }}>{outcome.text}</div>
              ) : null}
            </div>
          </section>

          <aside style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: "18px" }}>
            <section aria-labelledby="steps-t" style={{ padding: "22px", borderRadius: "24px", background: "#FFFFFF", display: "flex", flexDirection: "column", gap: "4px" }}>
              <h2 id="steps-t" style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 500, color: FAINT }}>Lo que ha hecho</h2>
              {items.filter(Boolean).length ? items.filter(Boolean).map((st, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "22px 1fr auto", gap: "10px", alignItems: "start", padding: "8px 0" }}>
                  <span aria-hidden="true" style={{ width: "20px", height: "20px", marginTop: "1px", display: "grid", placeItems: "center", borderRadius: "50%", background: st.now ? "#FFC93C" : st.done ? "#0B8A5F" : "#A9ACB6" }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: st.done ? 1 : 0 }}><path d="m5 12 5 5 9-10" /></svg>
                  </span>
                  <span style={{ fontSize: "14px", lineHeight: 1.45, color: st.now || i === items.length - 1 ? INK : "#3D404A", fontWeight: st.now ? 600 : 400 }}>{st.text}</span>
                  <span style={{ font: "400 12px/1.6 'Geist Mono', monospace", color: "#8A8D96" }}>{st.time}</span>
                </div>
              )) : <span style={{ fontSize: "14px", color: FAINT }}>Aún no ha hecho nada en el navegador.</span>}
            </section>
            <section aria-labelledby="can-t" style={{ padding: "22px", borderRadius: "24px", background: "#FFFFFF", display: "flex", flexDirection: "column", gap: "12px" }}>
              <h2 id="can-t" style={{ margin: 0, fontSize: "13px", fontWeight: 500, color: FAINT }}>Lo que puede tocar</h2>
              <p style={{ margin: 0, fontSize: "15px", lineHeight: 1.55 }}>Solo su propio navegador, dentro de Colmena. Nunca escribe contraseñas: si una página la pide, te la pasa a ti.</p>
              {touch.length || myFolders.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {[...touch, ...myFolders].map((t) => <span key={t} style={{ padding: "7px 12px", borderRadius: "999px", background: "#F4F4F0", fontSize: "13px" }}>{t}</span>)}
                </div>
              ) : null}
              <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: MUTED }}>Siempre te pregunta antes de enviar, comprar, publicar o borrar.</p>
              <a href="/ajustes/apps#apps-conectadas" onClick={(e) => { e.preventDefault(); navigate("/ajustes/apps#apps-conectadas"); }} style={{ fontSize: "14px", fontWeight: 500, color: "#1F4FD1" }}>Cambiar en Ajustes</a>
            </section>
          </aside>
        </div>
      </main>
    </Shell>
  );
}
