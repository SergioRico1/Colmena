import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { css } from "../design/V2Bienvenida.jsx";
import { gloss, shapeOf } from "../components/v2/Presence.jsx";
import { WindowDots } from "../components/v2/Rail.jsx";
import { useRoom } from "../components/room/useRoom.js";
import { B, ROLES, APP_TASK } from "./Bienvenida.jsx";
import { useStore } from "../lib/store.jsx";
import { patch, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import ProviderMark from "../components/v2/ProviderMark.jsx";

// Colmena 2.0 · Bienvenida (design/V2Bienvenida.dc.html): six dark, cinematic steps.
// Wake up → give it a brain (your ChatGPT account, the real sign-in) → Atlas asks what you do
// → your team flies in → what you use every day → a first real task, run live.

const DIM = "#C9CBD3";
const FAINT = "#A9ACB6";
const HONEY = "#FFC93C";
const ATLAS_LINE = "Hola, soy Atlas. Voy a reunir a tu equipo. ¿A qué te dedicas?";
const DAY_APPS = [["correo", "Correo", "Leer y preparar borradores"], ["calendario", "Calendario", "Ver tu agenda y proponer huecos"]];
const guessRole = (t) => (/compra|factur|contab|finan|banco|tesorer/i.test(t) ? "finanzas" : /diseñ|marca|gráfic|ilustra/i.test(t) ? "diseno"
  : /program|código|software|desarroll/i.test(t) ? "programacion" : /market|redes|campañ|comunica/i.test(t) ? "marketing"
  : /legal|abogad|contrat|jur[ií]d/i.test(t) ? "legal" : /rr\.? ?hh|recursos humanos|personas|selecci/i.test(t) ? "personas"
  : /operaci|log[ií]st|almac|proveed/i.test(t) ? "operaciones" : "otra");

function Shape({ bot, size, style = null }) {
  const s = shapeOf(bot);
  return <span aria-hidden="true" style={{ display: "block", width: size + "px", height: size + "px", background: gloss(bot?.color || HONEY), clipPath: s.clip, borderRadius: s.radius, ...style }} />;
}
const big = (bg = HONEY, fg = "#12131A") => ({ height: "62px", padding: "0 38px", border: 0, borderRadius: "999px", background: bg, color: fg, cursor: "pointer", fontSize: "18px", fontWeight: 600, boxShadow: bg === HONEY ? "0 20px 50px -14px rgba(255,201,60,.7)" : "none" });

export default function BienvenidaV2({ query = {} }) {
  const { bots = [], settings = {}, provider, authError } = useStore();
  const connected = !!provider?.connected;
  const [step, setStep] = useState(() => Math.max(0, Math.min(5, Number(query.paso) || 0)));
  const [waiting, setWaiting] = useState(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState("");
  const [role, setRole] = useState("finanzas");
  const [roleText, setRoleText] = useState("");
  const [apps, setApps] = useState(["correo", "calendario"]);
  const [typed, setTyped] = useState(0);
  const [missionId, setMissionId] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  useLayoutEffect(() => {
    document.documentElement.dataset.v2 = "1";
    return () => { delete document.documentElement.dataset.v2; };
  }, []);
  useEffect(() => { if (connected || authError) setWaiting(null); }, [connected, authError]);
  // Atlas types his question, one letter at a time (at once with reduced motion).
  useEffect(() => {
    if (step !== 2) return undefined;
    if (matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) { setTyped(ATLAS_LINE.length); return undefined; }
    setTyped(0);
    const t = setInterval(() => setTyped((n) => (n >= ATLAS_LINE.length ? (clearInterval(t), n) : n + 1)), 38);
    return () => clearInterval(t);
  }, [step]);

  const cur = ROLES.find((r) => r.id === role) || ROLES.at(-1);
  const team = useMemo(() => cur.team.map(([id, help]) => {
    const real = bots.find((b) => b.id === id);
    return { ...B[id], ...(real ? { name: real.name, color: real.color, shape: real.shape } : {}), help: id === "atlas" ? "Coordina y reparte" : help };
  }), [cur, bots]);
  const task = [...apps.filter((a) => APP_TASK[a]).slice(0, 1).map((a) => APP_TASK[a]), ...cur.tasks][0];

  const run = async (k, fn) => {
    if (busy) return;
    setBusy(k);
    setError(null);
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const login = () => run("login", async () => {
    const r = await post("/auth/start");
    if (r?.url) { window.open(r.url, "_blank", "noopener"); setWaiting({ url: r.url }); }
  });
  const useKey = () => run("key", async () => { await post("/auth/apikey", { key: key.trim() }); setKey(""); setKeyOpen(false); });
  const saveTeam = (chosen = apps) => run("team", async () => {
    await post("/onboarding", { role, team: team.map((b) => b.id), apps: chosen });
    setStep(5);
  });
  const startTask = () => run("task", async () => {
    const m = await post("/missions", { prompt: task, mode: "equipo", botIds: team.map((b) => b.id).filter((id) => bots.some((x) => x.id === id && x.enabled !== false)), safety: "preguntar" });
    setMissionId(m?.id || m?.mission?.id || null);
  });
  const later = () => run("later", async () => { await patch("/settings", { onboarded: true }); navigate("/"); });
  const enter = () => {
    if (!missionId) { try { sessionStorage.setItem("colmena:draft", JSON.stringify({ text: task, mode: "equipo" })); } catch { /* private mode */ } }
    navigate(missionId ? `/encargo/${missionId}` : "/");
  };

  const dark = step === 1 && !connected;
  const bg = dark ? "radial-gradient(60% 50% at 50% 38%, rgba(160,165,180,.12), rgba(160,165,180,0) 70%), #0C0D11" : "radial-gradient(60% 50% at 50% 38%, rgba(255,201,60,.14), rgba(255,201,60,0) 70%), #12131A";
  const cells = useMemo(() => {
    const ax = [[0, 0], [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1], [2, 0], [2, -1], [2, -2], [1, -2], [0, -2], [-1, -1], [-2, 0], [-2, 1], [-2, 2], [-1, 2], [0, 2], [1, 1]];
    return ax.map(([q, r], i) => {
      const x = 42 * 0.75 * q, y = 37 * (r + q / 2), ang = (i * 137.5 * Math.PI) / 180, dist = 420 + (i % 5) * 60;
      return { l: 120 - 21 + x, t: 120 - 18.5 + y, x: Math.round(Math.cos(ang) * dist), y: Math.round(Math.sin(ang) * dist), r: ((i * 47) % 180) - 90, d: (0.05 * i).toFixed(2) };
    });
  }, []);
  const sparks = Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2, d = 260 + (i % 3) * 70; return { x: Math.round(Math.cos(a) * d), y: Math.round(Math.sin(a) * d), r: i * 40, d: (0.05 * (i % 4)).toFixed(2) }; });
  const desktop = typeof window !== "undefined" && !!window.colmenaWindow;

  return (
    <>
      <style>{css}</style>
      <div style={{ position: "relative", height: "100vh", overflow: "auto", background: "#12131A" }}>
        <div style={{ position: "relative", minHeight: "100%", overflow: "hidden", color: "#FFFFFF", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "70px 24px 110px", transition: "background 1.2s ease", background: bg }}>
          <span aria-hidden="true" style={{ position: "absolute", left: "50%", top: "42%", width: "1100px", height: "1100px", transform: "translate(-50%, -50%)", borderRadius: "50%", pointerEvents: "none", transition: "opacity 1.2s ease", background: "radial-gradient(circle, rgba(255,201,60,.22) 0%, rgba(255,201,60,0) 60%)", opacity: dark ? 0 : 1 }} />
          {desktop ? <div style={{ position: "absolute", left: "28px", top: "18px", zIndex: 5 }}><WindowDots dark /></div> : null}
          {desktop ? <div aria-hidden="true" style={{ position: "fixed", top: 0, left: "120px", right: 0, height: "26px", WebkitAppRegion: "drag" }} /> : null}

          {step === 0 ? (
            <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: "40px", textAlign: "center" }}>
              <div aria-hidden="true" style={{ position: "relative", width: "240px", height: "240px" }}>
                {cells.map((c, i) => (
                  <span key={i} style={{ position: "absolute", left: c.l + "px", top: c.t + "px", width: "42px", height: "37px", background: "radial-gradient(circle at 32% 26%, rgba(255,255,255,.55), rgba(255,255,255,0) 54%), #FFC93C", clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)", opacity: 0, animation: `fly 1.1s cubic-bezier(.2,.8,.2,1) ${c.d}s forwards, fade .5s ease-in 1.9s reverse forwards`, "--x": c.x + "px", "--y": c.y + "px", "--r": c.r + "deg" }} />
                ))}
                <img src="/colmena-icon.png" alt="" width="240" height="240" style={{ position: "absolute", inset: 0, width: "240px", height: "240px", opacity: 0, animation: "zoomout 1s cubic-bezier(.2,.8,.2,1) 1.9s forwards, drift 6s ease-in-out 3s infinite", filter: "drop-shadow(0 0 60px rgba(255,201,60,.5))" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "22px", opacity: 0, animation: "rise .9s ease-out 2.6s forwards" }}>
                <h1 style={{ margin: 0, font: "600 clamp(72px, 11vw, 150px)/0.85 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.07em" }}>Hola.</h1>
                <p style={{ margin: 0, maxWidth: "560px", fontSize: "22px", lineHeight: 1.45, color: DIM }}>Esto es Colmena: un equipo de bots que trabaja contigo, como compañeros. Vamos a despertarlo.</p>
                <button type="button" autoFocus onClick={() => setStep(1)} style={big()}>Empezar</button>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div style={{ position: "relative", width: "min(680px, 100%)", display: "flex", flexDirection: "column", alignItems: "center", gap: "34px", textAlign: "center", animation: "fade .6s ease-out" }}>
              <div aria-hidden="true" style={{ position: "relative", width: "220px", height: "220px" }}>
                {waiting ? (
                  <>
                    <span style={{ position: "absolute", inset: "-34px", borderRadius: "50%", animation: "spin 2.4s linear infinite" }}><span style={{ position: "absolute", left: "50%", top: 0, width: "12px", height: "12px", marginLeft: "-6px", borderRadius: "50%", background: HONEY, boxShadow: "0 0 18px #FFC93C" }} /></span>
                    <span style={{ position: "absolute", inset: "-34px", borderRadius: "50%", animation: "spin 2.4s linear infinite reverse" }}><span style={{ position: "absolute", left: "50%", bottom: 0, width: "8px", height: "8px", marginLeft: "-4px", borderRadius: "50%", background: "rgba(255,201,60,.6)" }} /></span>
                  </>
                ) : null}
                {connected ? (
                  <>
                    <span style={{ position: "absolute", left: "50%", top: "50%", width: "220px", height: "220px", borderRadius: "50%", border: "2px solid rgba(255,201,60,.8)", animation: "shock 1.6s cubic-bezier(.2,.8,.2,1) forwards" }} />
                    <span style={{ position: "absolute", left: "50%", top: "50%", width: "220px", height: "220px", borderRadius: "50%", border: "2px solid rgba(255,201,60,.5)", animation: "shock 1.9s cubic-bezier(.2,.8,.2,1) .25s forwards", opacity: 0 }} />
                    {sparks.map((c, i) => <span key={i} style={{ position: "absolute", left: "50%", top: "50%", width: "22px", height: "19px", margin: "-10px 0 0 -11px", background: HONEY, clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)", animation: `burst 1.4s cubic-bezier(.2,.8,.2,1) ${c.d}s forwards`, "--x": c.x + "px", "--y": c.y + "px", "--r": c.r + "deg" }} />)}
                  </>
                ) : null}
                <img src="/colmena-icon.png" alt="" width="220" height="220" style={{ position: "relative", display: "block", width: "220px", height: "220px", transition: "filter .8s ease", filter: connected ? "none" : "grayscale(1) brightness(.5)", animation: connected ? "wake 1.6s cubic-bezier(.2,.8,.2,1) forwards" : waiting ? "breathe 1.6s ease-in-out infinite" : "breathe 4s ease-in-out infinite" }} />
              </div>
              {!connected && !waiting ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "26px", animation: "rise .5s ease-out" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <h1 style={{ margin: 0, font: "600 clamp(44px, 6vw, 72px)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.05em" }}>Le falta el cerebro.</h1>
                    <p style={{ margin: 0, fontSize: "20px", lineHeight: 1.5, color: DIM }}>Tus bots piensan con tu cuenta de ChatGPT. Conéctala una vez y despiertan todos. Usa tu plan: no pagas nada más.</p>
                  </div>
                  <button type="button" disabled={!!busy} onClick={login} style={{ display: "flex", alignItems: "center", gap: "14px", height: "66px", padding: "0 34px 0 26px", border: 0, borderRadius: "999px", background: "#FFFFFF", color: "#12131A", cursor: "pointer", fontSize: "19px", fontWeight: 600, boxShadow: "0 24px 60px -18px rgba(255,255,255,.35)" }}>
                    <ProviderMark engine="openai" tile={false} size={22} />
                    Continuar con ChatGPT
                  </button>
                  <p style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: FAINT }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                    Se abre la página oficial en tu navegador. Colmena nunca ve tu contraseña.
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "4px 18px", fontSize: "14px" }}>
                    <button type="button" onClick={() => setKeyOpen((x) => !x)} style={{ height: "36px", padding: "0 6px", border: 0, background: "transparent", cursor: "pointer", color: DIM, textDecoration: "underline", textUnderlineOffset: "4px" }}>Usar una clave de API</button>
                    <button type="button" onClick={() => navigate("/ajustes/ia")} style={{ height: "36px", padding: "0 6px", border: 0, background: "transparent", cursor: "pointer", color: DIM, textDecoration: "underline", textUnderlineOffset: "4px" }}>Usar un modelo en este ordenador</button>
                    <button type="button" onClick={() => setStep(2)} style={{ height: "36px", padding: "0 6px", border: 0, background: "transparent", cursor: "pointer", color: FAINT }}>Más tarde</button>
                  </div>
                  {keyOpen ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "min(460px, 100%)", padding: "6px 6px 6px 18px", borderRadius: "999px", background: "rgba(255,255,255,.08)", animation: "rise .3s ease-out" }}>
                      <input type="password" aria-label="Tu clave de API" autoFocus value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && key.trim().length >= 20) useKey(); }} placeholder="Pega tu clave de API" style={{ flex: 1, minWidth: 0, height: "44px", border: 0, outline: "none", background: "transparent", color: "#FFFFFF", font: "400 15px/1 'Geist Mono', monospace" }} />
                      <button type="button" disabled={key.trim().length < 20 || !!busy} onClick={useKey} style={{ height: "44px", padding: "0 18px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "14px", fontWeight: 600, background: key.trim().length >= 20 ? HONEY : "rgba(255,255,255,.25)", color: "#12131A" }}>Conectar</button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {waiting && !connected ? (
                <div role="status" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "22px", animation: "rise .5s ease-out" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <h1 style={{ margin: 0, font: "600 clamp(36px, 5vw, 56px)/1.05 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.045em" }}>Inicia sesión en tu navegador…</h1>
                    <p style={{ margin: 0, fontSize: "18px", lineHeight: 1.5, color: DIM }}>Te esperamos aquí. Cuando termines, vuelve a esta ventana.</p>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button type="button" onClick={() => window.open(waiting.url, "_blank", "noopener")} style={{ height: "48px", padding: "0 20px", border: 0, borderRadius: "999px", background: "rgba(255,255,255,.1)", color: "#FFFFFF", cursor: "pointer", fontSize: "15px", fontWeight: 600 }}>Abrir otra vez la página</button>
                    <button type="button" onClick={() => run("cancel", () => post("/auth/cancel")).then(() => setWaiting(null))} style={{ height: "48px", padding: "0 18px", border: 0, borderRadius: "999px", background: "transparent", color: DIM, cursor: "pointer", fontSize: "15px", fontWeight: 600 }}>Cancelar</button>
                  </div>
                </div>
              ) : null}
              {connected ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "24px" }}>
                  <h1 style={{ margin: 0, font: "600 clamp(72px, 11vw, 140px)/0.85 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.07em", opacity: 0, animation: "zoomout .9s cubic-bezier(.2,.8,.2,1) .7s forwards" }}>Ya piensa.</h1>
                  <span style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 18px 10px 12px", borderRadius: "999px", background: "rgba(255,255,255,.08)", fontSize: "15px", opacity: 0, animation: "rise .6s ease-out 1.2s forwards" }}>
                    <span aria-hidden="true" style={{ width: "22px", height: "22px", display: "grid", placeItems: "center", borderRadius: "50%", background: "#0B8A5F" }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg></span>
                    {(provider.label || "ChatGPT") + " · conectado"}
                  </span>
                  <button type="button" onClick={() => setStep(2)} style={{ ...big(), opacity: 0, animation: "rise .6s ease-out 1.6s forwards" }}>Conocer a mi equipo</button>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 2 ? (
            <div style={{ position: "relative", width: "min(760px, 100%)", display: "flex", flexDirection: "column", gap: "34px", animation: "fade .5s ease-out" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "20px" }}>
                <span style={{ flex: "none", animation: "breathe 2.8s ease-in-out infinite", filter: "drop-shadow(0 4px 8px rgba(18,19,26,.16))" }}><Shape bot={team[0]} size={64} /></span>
                <p aria-label={ATLAS_LINE} style={{ margin: "6px 0 0", font: "600 clamp(30px, 4vw, 44px)/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.035em", minHeight: "160px" }}>
                  <span aria-hidden="true">{ATLAS_LINE.slice(0, typed)}</span>
                  <span aria-hidden="true" style={{ display: "inline-block", width: "3px", height: ".9em", marginLeft: "3px", verticalAlign: "-0.08em", background: HONEY, animation: "caret 1s steps(1) infinite" }} />
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "14px", paddingLeft: "84px", transition: "opacity .5s ease", opacity: typed >= ATLAS_LINE.length ? 1 : 0 }}>
                <div role="radiogroup" aria-label="A qué te dedicas" style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                  {ROLES.map((r) => {
                    const on = role === r.id && !roleText;
                    return <button key={r.id} type="button" role="radio" aria-checked={on} onClick={() => { setRole(r.id); setRoleText(""); }} style={{ height: "54px", padding: "0 24px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "17px", fontWeight: 500, transition: "all .25s ease", background: on ? HONEY : "rgba(255,255,255,.08)", color: on ? "#12131A" : "#FFFFFF" }}>{r.label}</button>;
                  })}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 6px 6px 22px", borderRadius: "999px", background: "rgba(255,255,255,.07)" }}>
                  <input type="text" aria-label="Cuéntaselo con tus palabras" value={roleText} onChange={(e) => { setRoleText(e.target.value); setRole(guessRole(e.target.value)); }} onKeyDown={(e) => { if (e.key === "Enter") setStep(3); }} placeholder="O cuéntaselo con tus palabras: «llevo las compras de una tienda de muebles»" style={{ flex: 1, minWidth: 0, height: "48px", border: 0, outline: "none", background: "transparent", color: "#FFFFFF", fontSize: "16px" }} />
                  <button type="button" onClick={() => setStep(3)} style={{ height: "48px", padding: "0 24px", border: 0, borderRadius: "999px", background: HONEY, color: "#12131A", cursor: "pointer", fontSize: "16px", fontWeight: 600 }}>Seguir</button>
                </div>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div style={{ position: "relative", width: "min(980px, 100%)", display: "flex", flexDirection: "column", alignItems: "center", gap: "30px", textAlign: "center", animation: "fade .5s ease-out" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <h1 style={{ margin: 0, font: "600 clamp(44px, 6vw, 72px)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.05em" }}>Tu equipo ya está aquí.</h1>
                <p style={{ margin: 0, fontSize: "19px", color: DIM }}>{"Pensado para "}{roleText ? "lo que nos has contado" : cur.id === "otra" ? "cualquier trabajo de oficina" : cur.label.toLowerCase()}{". Atlas coordina; los demás hacen."}</p>
              </div>
              <div aria-label="Tu equipo" role="list" style={{ position: "relative", width: "560px", maxWidth: "100%", height: "400px" }}>
                {team.map((m, i) => {
                  // Atlas in the middle, the others around him (the design ring).
                  const ring = team.length - 1 <= 3 ? [[400, 120], [205, 250], [10, 120]] : [[400, 120], [320, 280], [90, 280], [10, 120]];
                  const [l, t] = i ? ring[(i - 1) % ring.length] : [205, 110];
                  const size = i ? 64 : 92;
                  return (
                    <div key={m.id} role="listitem" style={{ position: "absolute", left: l + "px", top: t + "px", width: "150px", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", opacity: 0, animation: `fly 1.1s cubic-bezier(.2,.8,.2,1) ${(0.12 + i * 0.16).toFixed(2)}s forwards`, "--x": (i ? (l < 200 ? -700 : 700) : 0) + "px", "--y": (i ? (t > 150 ? 400 : -300) : -400) + "px", "--r": "0deg" }}>
                      <span aria-hidden="true" style={{ display: "inline-grid", animation: "breathe 3s ease-in-out infinite", filter: `drop-shadow(0 12px 28px ${m.color}99)` }}><Shape bot={m} size={size} /></span>
                      <span style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                        <strong style={{ font: "600 19px/1 'Bricolage Grotesque', sans-serif" }}>{m.name}</strong>
                        <span style={{ fontSize: "13px", lineHeight: 1.35, color: DIM }}>{m.help}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
              <button type="button" onClick={() => setStep(4)} style={big()}>Me gusta</button>
            </div>
          ) : null}

          {step === 4 ? (
            <div style={{ position: "relative", width: "min(640px, 100%)", display: "flex", flexDirection: "column", alignItems: "center", gap: "30px", textAlign: "center", animation: "fade .5s ease-out" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <h1 style={{ margin: 0, font: "600 clamp(44px, 6vw, 68px)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.05em" }}>¿Les dejas ver tu día?</h1>
                <p style={{ margin: 0, fontSize: "19px", lineHeight: 1.5, color: DIM }}>Con tu correo y tu calendario ayudan desde hoy. Nunca envían nada sin tu OK.</p>
              </div>
              <div style={{ width: "100%", display: "flex", flexDirection: "column", borderRadius: "26px", background: "rgba(255,255,255,.06)", overflow: "hidden" }}>
                {DAY_APPS.map(([id, label, note]) => {
                  const on = apps.includes(id);
                  return (
                    <button key={id} type="button" role="switch" aria-checked={on} onClick={() => setApps((l) => (on ? l.filter((x) => x !== id) : [...l, id]))} style={{ display: "flex", alignItems: "center", gap: "16px", minHeight: "76px", padding: "0 22px", border: 0, borderBottom: "1px solid rgba(255,255,255,.06)", background: "transparent", color: "#FFFFFF", cursor: "pointer", textAlign: "left" }}>
                      <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "3px" }}>
                        <strong style={{ fontSize: "17px", fontWeight: 600 }}>{label}</strong>
                        <span style={{ fontSize: "14px", color: FAINT }}>{note}</span>
                      </span>
                      <span aria-hidden="true" style={{ width: "52px", height: "32px", flex: "none", padding: "3px", borderRadius: "16px", transition: "background .25s ease", background: on ? "#0B8A5F" : "rgba(255,255,255,.18)" }}>
                        <span style={{ display: "block", width: "26px", height: "26px", borderRadius: "50%", background: "#FFFFFF", transition: "transform .25s cubic-bezier(.2,.8,.2,1)", transform: on ? "translateX(20px)" : "translateX(0)" }} />
                      </span>
                    </button>
                  );
                })}
                <span style={{ padding: "14px 22px", fontSize: "13px", color: FAINT, textAlign: "left" }}>Lo conectas en un minuto desde Ajustes › Conectado a. Hasta entonces no ven nada.</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "10px" }}>
                <button type="button" disabled={!!busy} onClick={() => { setApps([]); saveTeam([]); }} style={{ height: "60px", padding: "0 28px", border: 0, borderRadius: "999px", background: "rgba(255,255,255,.08)", color: "#FFFFFF", cursor: "pointer", fontSize: "17px", fontWeight: 600 }}>Ahora no</button>
                <button type="button" disabled={!!busy} onClick={() => saveTeam()} style={{ height: "60px", padding: "0 36px", border: 0, borderRadius: "999px", background: HONEY, color: "#12131A", cursor: "pointer", fontSize: "17px", fontWeight: 600 }}>{busy === "team" ? "Preparando tu equipo…" : "Seguir"}</button>
              </div>
            </div>
          ) : null}

          {step === 5 ? <FirstTask task={task} team={team} connected={connected} missionId={missionId} busy={busy} onStart={startTask} onEnter={enter} /> : null}

          {error ? <p role="alert" style={{ position: "relative", margin: "24px 0 0", padding: "10px 16px", borderRadius: "999px", background: "rgba(180,35,26,.25)", fontSize: "14px", color: "#FFD9D5" }}>{error}</p> : null}
          {step < 5 && step > 0 && !settings.onboarded ? (
            <button type="button" onClick={later} style={{ position: "absolute", right: "28px", top: "18px", height: "36px", padding: "0 14px", border: 0, borderRadius: "999px", background: "transparent", color: FAINT, cursor: "pointer", fontSize: "14px", WebkitAppRegion: "no-drag" }}>Saltar</button>
          ) : null}
          <div role="group" aria-label={`Paso ${step + 1} de 6`} style={{ position: "absolute", left: 0, right: 0, bottom: "40px", display: "flex", justifyContent: "center", gap: "8px" }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <button key={i} type="button" aria-label={"Ir al paso " + (i + 1)} disabled={i > step} onClick={() => setStep(i)} style={{ height: "8px", border: 0, borderRadius: "4px", padding: 0, cursor: i > step ? "default" : "pointer", transition: "all .35s cubic-bezier(.2,.8,.2,1)", width: i === step ? "28px" : "8px", background: i === step ? HONEY : i < step ? "rgba(255,255,255,.45)" : "rgba(255,255,255,.2)" }} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/** The first real task, live: Atlas hands it out and the result lands here. */
function FirstTask({ task, team, connected, missionId, busy, onStart, onEnter }) {
  const room = useRoom(missionId);
  const m = missionId ? room.mission : null;
  const done = m?.status === "completed";
  const botMessages = (room.messages || []).filter((x) => x.role !== "user" && x.text).slice(-3);
  const result = done ? [...(room.messages || [])].reverse().find((x) => x.role !== "user" && x.text) : null;
  const byId = (id) => team.find((b) => b.id === id) || null;
  const running = (room.steps || []).find((s) => s.status === "running");
  const feed = !missionId ? [] : [
    { bot: team[0], meta: "ahora", text: running ? `Se lo paso a ${byId(running.botId)?.name || "el equipo"}: es lo suyo.` : "Lo estoy repartiendo.", anim: "none" },
    ...botMessages.filter((x) => x !== result).map((x) => ({ bot: byId(x.botId) || team[0], meta: "trabajando", text: String(x.text).replace(/\s+/g, " ").slice(0, 160), anim: "breathe 1.6s ease-in-out infinite" })),
  ];
  return (
    <div style={{ position: "relative", width: "min(820px, 100%)", display: "flex", flexDirection: "column", gap: "26px", animation: "fade .5s ease-out" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", textAlign: "center" }}>
        <h1 style={{ margin: 0, font: "600 clamp(40px, 5.4vw, 64px)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.05em" }}>{done ? "Así trabaja tu colmena." : "Pídele algo de verdad."}</h1>
        <p style={{ margin: 0, fontSize: "18px", color: DIM }}>{done ? "Esto ha pasado en tu ordenador, con tus datos, en unos segundos." : connected ? "Tu primer encargo. Mira cómo se reparten el trabajo." : "Cuando conectes tu cuenta de ChatGPT, este será su primer encargo."}</p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 10px 10px 26px", borderRadius: "999px", background: "#FFFFFF", color: "#12131A", boxShadow: "0 30px 70px -30px rgba(0,0,0,.6)" }}>
        <span style={{ flex: 1, fontSize: "19px" }}>{task}</span>
        {connected ? (
          <button type="button" disabled={!!missionId || !!busy} onClick={onStart} style={{ height: "52px", padding: "0 26px", border: 0, borderRadius: "999px", cursor: missionId ? "default" : "pointer", fontSize: "16px", fontWeight: 600, transition: "background .2s ease", background: done ? "#E1F4EC" : missionId || busy ? "rgba(18,19,26,.08)" : "#12131A", color: done ? "#0B5A3E" : missionId || busy ? "#5C606C" : "#FFFFFF" }}>
            {done ? "Hecho" : missionId || busy ? "Trabajando…" : "Hazlo"}
          </button>
        ) : null}
      </div>
      <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: "14px", minHeight: connected ? "220px" : 0 }}>
        {feed.map((f, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "34px 1fr", gap: "14px", alignItems: "start", animation: "rise .45s ease-out" }}>
            <span aria-hidden="true" style={{ display: "inline-grid", width: "34px", height: "34px", placeItems: "center", animation: done ? "none" : f.anim }}><Shape bot={f.bot} size={28} /></span>
            <span style={{ display: "flex", flexDirection: "column", gap: "4px", paddingTop: "4px" }}>
              <span style={{ fontSize: "14px", color: FAINT }}><strong style={{ color: "#FFFFFF", fontWeight: 600 }}>{f.bot?.name}</strong>{" · "}{done ? "terminado" : f.meta}</span>
              <span style={{ fontSize: "17px", lineHeight: 1.5 }}>{f.text}</span>
            </span>
          </div>
        ))}
        {result ? (
          <div style={{ marginLeft: "48px", display: "flex", flexDirection: "column", gap: "14px", padding: "22px 24px", borderRadius: "24px", background: "#FFFFFF", color: "#12131A", animation: "zoomout .6s cubic-bezier(.2,.8,.2,1)", maxHeight: "320px", overflow: "auto" }}>
            <span style={{ font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#6B6F7A" }}>Resultado</span>
            <span style={{ fontSize: "16px", lineHeight: 1.55, color: "#3D404A", whiteSpace: "pre-wrap" }}>{String(result.text).slice(0, 900)}</span>
          </div>
        ) : null}
      </div>
      {done || !connected || missionId ? (
        <div style={{ display: "flex", justifyContent: "center", animation: "rise .5s ease-out .3s both" }}>
          <button type="button" onClick={onEnter} style={{ display: "flex", alignItems: "center", gap: "12px", height: "64px", padding: "0 38px", border: 0, borderRadius: "999px", background: done || !connected ? HONEY : "rgba(255,255,255,.1)", color: done || !connected ? "#12131A" : "#FFFFFF", cursor: "pointer", fontSize: "18px", fontWeight: 600, boxShadow: done || !connected ? "0 20px 50px -14px rgba(255,201,60,.7)" : "none" }}>
            {done || !connected ? "Entrar en Colmena" : "Seguirlo dentro de Colmena"}<span aria-hidden="true">→</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
