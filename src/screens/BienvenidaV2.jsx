import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { css } from "../design/V3Bienvenida.jsx";
import { shapeOf } from "../components/v2/Presence.jsx";
import { WindowDots } from "../components/v2/Rail.jsx";
import ProviderMark from "../components/v2/ProviderMark.jsx";
import { B, ROLES, APP_TASK } from "../lib/onboarding.js";
import { useAction, useStore } from "../lib/store.jsx";
import { useExpert } from "../lib/expert.js";
import { patch, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";

// Colmena 3 · Bienvenida (design/V3Bienvenida.dc.html): a dark column with the six steps and
// the page beside it. Hola → the AI account they think with (ChatGPT sign-in, Claude or
// OpenCode Go) → how much you want to see (simple or expert) and what you do → your team →
// the apps you use → a first request. Every step can be skipped. ?paso=0–5 opens one (QA).

const INK = "#12131A";
const MUTED = "#5C606C";
const TEXT2 = "#4A4D57";
const GREEN = "#0B6B4A";
const RED = "#B4232A";
const STEPS = [["Hola", "Qué es Colmena"], ["Cuenta de IA", "Con qué piensan"], ["Cómo trabajas", "Detalle y oficio"], ["Tu equipo", "Los bots que te ayudan"], ["Tus apps", "Opcional"], ["Primera petición", "Para empezar"]];
const LAST = STEPS.length - 1;
const BRAINS = [
  { id: "openai", name: "ChatGPT", note: "Usa tu plan Plus o Pro: no pagas nada más.", rec: true },
  { id: "anthropic", name: "Claude", note: "Con tu suscripción, Claude Code o una clave de API." },
  { id: "opencode-go", name: "OpenCode Go", note: "Modelos abiertos a precio fijo." },
];
// The roles the server knows (server/onboarding.mjs), with the board's names first.
const ROLE_CHIPS = [["otra", "Trabajo de oficina"], ["diseno", "Diseño"], ["programacion", "Programación"], ["finanzas", "Economía y finanzas"], ["marketing", "Marketing"], ["clientes", "Atención al cliente"], ["operaciones", "Operaciones"], ["legal", "Legal"], ["personas", "Personas y RR. HH."]];
// What they can see of your day (server DAILY_APPS ids).
const DAY_APPS = [
  { id: "correo", mark: "@", name: "Correo", note: "Gmail u Outlook. Leen y preparan borradores." },
  { id: "calendario", mark: "31", name: "Calendario", note: "Buscan huecos y preparan reuniones." },
  { id: "carpetas", mark: "▤", name: "Archivos", note: "Drive, OneDrive o una carpeta de este ordenador." },
  { id: "chat", mark: "#", name: "Slack o Teams", note: "Resumen de canales y respuestas que tú apruebas." },
];
// The welcome's crew, by size and breathing pace (the board's rhythm).
const SIZES = [64, 52, 46, 52, 50, 50];
const PACES = [2.8, 2.4, 3, 2.6, 2.2, 3.2];
const CLAUDE_WAYS = [
  { id: "cli", title: "Claude Code de este ordenador", sub: "Usa la sesión de Claude Code que ya tienes iniciada aquí." },
  { id: "token", title: "Token de suscripción", sub: "Un token creado con «claude setup-token» en tu terminal." },
  { id: "api_key", title: "Clave de API", sub: "Pago por uso desde la consola de Anthropic." },
];

/** A bot as the board draws it: its shape, flat colour; Atlas, who coordinates, in ink. */
function face(bot) {
  const s = shapeOf(bot);
  const color = bot?.id === "atlas" && (!bot.color || bot.color.toUpperCase() === "#FFC93C") ? INK : bot?.color || "#C9CBD1";
  return { background: color, clipPath: s.clip, borderRadius: s.radius };
}
// Pasting often brings a trailing space, a line break or an invisible character.
const clean = (v) => String(v).replace(/[​-‍⁠﻿­]/g, "").trim();
const ghost = { height: "48px", padding: "0 18px", border: "0", borderRadius: "999px", background: "transparent", fontSize: "15px", fontWeight: "500", color: TEXT2, cursor: "pointer" };
const primary = (off = false) => ({ height: "52px", padding: "0 28px", border: "0", borderRadius: "999px", background: INK, color: "#FFFFFF", fontSize: "16px", fontWeight: "600", cursor: off ? "default" : "pointer", opacity: off ? 0.5 : 1, display: "inline-flex", alignItems: "center" });
const outline = { height: "40px", padding: "0 16px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", background: "#FFFFFF", fontSize: "14px", fontWeight: "500", cursor: "pointer", flex: "none" };
const field = { flex: "1 1 240px", minWidth: "0", height: "44px", padding: "0 16px", border: "1px solid rgba(18,19,26,.12)", borderRadius: "14px", background: "#FFFFFF", font: "500 14px/1 'Geist Mono', monospace", color: INK };
const h1 = { margin: "0", font: "600 48px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.04em" };
const lead = { margin: "0", fontSize: "17px", lineHeight: "1.5", color: TEXT2 };

export default function BienvenidaV2({ query = {} }) {
  const { bots = [], settings = {}, provider, authError, ai } = useStore();
  const [expert, setExpert] = useExpert();
  const engines = ai?.engines || [];
  const info = (id) => engines.find((e) => e.id === id) || (id === "openai" && provider?.connected ? { id, connected: true, detail: provider.label } : null);
  const anyConnected = BRAINS.some((b) => info(b.id)?.connected);
  const [step, setStep] = useState(() => Math.max(0, Math.min(LAST, Number(query.paso) || 0)));
  const [brain, setBrain] = useState(() => BRAINS.find((b) => info(b.id)?.connected)?.id || "openai");
  const [panel, setPanel] = useState(false);
  const [waiting, setWaiting] = useState(null);
  const [role, setRole] = useState(() => (ROLES.some((r) => r.id === settings.role) ? settings.role : "otra"));
  const [dropped, setDropped] = useState([]);
  const [apps, setApps] = useState(() => (Array.isArray(settings.dailyApps) ? settings.dailyApps.filter((a) => DAY_APPS.some((d) => d.id === a)) : []));
  const [text, setText] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  useLayoutEffect(() => {
    document.documentElement.dataset.v2 = "1";
    return () => { delete document.documentElement.dataset.v2; };
  }, []);
  const chosen = info(brain);
  useEffect(() => { if (chosen?.connected || authError) setWaiting(null); }, [chosen?.connected, authError]);
  useEffect(() => { if (chosen?.connected) setPanel(false); }, [chosen?.connected]);
  useEffect(() => { setError(null); }, [step]);

  const real = (id) => bots.find((b) => b.id === id) || null;
  const cur = ROLES.find((r) => r.id === role) || ROLES.at(-1);
  const team = useMemo(() => cur.team.map(([id, help]) => {
    const r = bots.find((b) => b.id === id);
    return { ...B[id], ...(r ? { name: r.name, color: r.color, shape: r.shape } : {}), help: id === "atlas" ? "Coordina y reparte" : help };
  }), [cur, bots]);
  const kept = team.filter((m) => m.id === "atlas" || !dropped.includes(m.id));
  // Step 0: the built-in team as it is on this computer (the code's defaults until it loads).
  const crew = useMemo(() => {
    const list = bots.length ? bots.filter((b) => b.builtin !== false && b.id !== "leo") : Object.values(B).filter((b) => b.id !== "leo");
    return [...list].sort((a, b) => (a.id === "atlas" ? -1 : b.id === "atlas" ? 1 : 0)).slice(0, 6);
  }, [bots]);
  const ideas = useMemo(() => [...new Set([...apps.map((a) => APP_TASK[a]).filter(Boolean), ...cur.tasks])], [apps, cur]);
  const request = text ?? ideas[0] ?? "";
  const roleName = (ROLE_CHIPS.find(([id]) => id === role)?.[1] || cur.label).toLowerCase();
  const writer = real("vera") || B.vera;

  const run = async (k, fn) => {
    if (busy) return undefined;
    setBusy(k);
    setError(null);
    try { return await fn(); } catch (e) { setError(e.message); return undefined; } finally { setBusy(null); }
  };
  const login = () => run("login", async () => {
    const r = await post("/auth/start");
    if (r?.url) { window.open(r.url, "_blank", "noopener"); setWaiting({ url: r.url }); }
  });
  const cancelLogin = () => run("cancel", () => post("/auth/cancel")).then(() => setWaiting(null));
  const connectClaude = (body) => run("connect", () => post("/auth/anthropic", body));
  const connectOpenCode = (key) => run("connect", () => post("/auth/opencode", { key }));
  const save = (list = apps) => run("team", async () => {
    await post("/onboarding", { role, team: kept.map((b) => b.id), apps: list });
    setSaved(true);
    return true;
  });
  const later = () => run("later", async () => { await patch("/settings", { onboarded: true }); navigate("/"); });
  const send = async () => {
    if (!saved && !settings.onboarded && !(await save())) return;
    const prompt = request.trim();
    if (!prompt) return navigate("/");
    if (!anyConnected) {
      try { sessionStorage.setItem("colmena:draft", JSON.stringify({ text: prompt, mode: "equipo" })); } catch { /* private mode */ }
      return navigate("/");
    }
    const ok = await run("send", () => post("/missions", { prompt, mode: "equipo", botIds: kept.map((b) => b.id).filter((id) => bots.some((x) => x.id === id && x.enabled !== false)).slice(0, 4), safety: "preguntar" }));
    if (ok) navigate("/");
  };

  // The main button of each step.
  const next = () => {
    if (step === 1 && !chosen?.connected) {
      if (brain === "openai") return waiting ? undefined : login();
      return setPanel(true);
    }
    if (step === 4) return save().then((ok) => ok && setStep(5));
    setStep(Math.min(LAST, step + 1));
  };
  const skip = () => (step === 4 ? save([]).then((ok) => ok && setStep(5)) : setStep(Math.min(LAST, step + 1)));
  const brainName = BRAINS.find((b) => b.id === brain)?.name || "ChatGPT";
  const nextLabel = step === 0 ? "Empezar"
    : step === 1 ? (waiting && !chosen?.connected ? "Esperando a " + brainName + "…" : "Continuar con " + brainName)
    : step === 3 ? "Me gusta este equipo"
    : step === 4 && busy === "team" ? "Preparando tu equipo…" : "Seguir";
  // While a sign-in or a connect panel is open, its own button is the one to press.
  const connecting = step === 1 && !chosen?.connected && (!!waiting || panel);
  const showSkip = step === 4 || (step === 1 && !anyConnected);
  const desktop = typeof window !== "undefined" && !!window.colmenaWindow;

  return (
    <>
      <style>{css}</style>
      <div style={{ position: "relative", height: "100vh", overflowY: "auto", background: "#F5F5F2" }}>
        {desktop ? <div aria-hidden="true" style={{ position: "fixed", top: 0, left: "110px", right: 0, height: "26px", zIndex: 5, WebkitAppRegion: "drag" }} /> : null}
        <div style={{ minHeight: "100vh", display: "flex", flexWrap: "wrap", background: "#F5F5F2", color: INK }}>
          <aside style={{ flex: "1 1 360px", maxWidth: "460px", display: "flex", flexDirection: "column", gap: "40px", padding: "28px 40px 36px", background: INK, color: "#FFFFFF" }}>
            <div style={{ height: "20px", display: "flex", alignItems: "center" }}><WindowDots dark inline /></div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <img src="/colmena-icon-128.png" alt="" width="44" height="44" style={{ display: "block", width: "44px", height: "44px", animation: "breathe 3s ease-in-out infinite" }} />
              <span style={{ font: "600 26px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{"Colmena"}</span>
            </div>
            <ol aria-label="Pasos" style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "4px" }}>
              {STEPS.map(([label, hint], i) => {
                const done = i < step, on = i === step;
                const body = (
                  <>
                    <span aria-hidden="true" style={{ flex: "none", width: "26px", height: "26px", display: "grid", placeItems: "center", borderRadius: "50%", border: `1.5px solid ${done || on ? "#FFFFFF" : "rgba(255,255,255,.3)"}`, background: done ? "#FFFFFF" : "transparent", color: done ? INK : "#FFFFFF", fontSize: "12px", fontWeight: "600" }}>{done ? "✓" : String(i + 1)}</span>
                    <span style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                      <span style={{ fontSize: "15px", fontWeight: "600", color: on || done ? "#FFFFFF" : "#C9CBD3" }}>{label}</span>
                      <span style={{ fontSize: "12.5px", color: "#A9ACB6" }}>{hint}</span>
                    </span>
                  </>
                );
                const row = { display: "flex", alignItems: "center", gap: "14px", minHeight: "44px", padding: "0 14px", borderRadius: "14px", background: on ? "rgba(255,255,255,.08)" : "transparent" };
                return (
                  <li key={label} aria-current={on ? "step" : undefined} style={done ? { display: "flex" } : row}>
                    {done ? <button type="button" onClick={() => setStep(i)} aria-label={`Volver a «${label}»`} style={{ ...row, flex: "1", border: "0", color: "inherit", textAlign: "left", cursor: "pointer", WebkitAppRegion: "no-drag" }}>{body}</button> : body}
                  </li>
                );
              })}
            </ol>
            <span style={{ flex: "1" }} />
            <p style={{ margin: "0", display: "flex", gap: "10px", fontSize: "13.5px", lineHeight: "1.5", color: "#C9CBD3" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", marginTop: "1px" }}>
                <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
                <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
              </svg>
              {"Tus bots, chats y archivos se quedan en este ordenador. Puedes cambiar todo esto luego en Ajustes."}
            </p>
          </aside>

          <main style={{ position: "relative", flex: "999 1 560px", minWidth: "0", display: "flex", flexDirection: "column", padding: "56px clamp(24px, 6vw, 96px) 40px" }}>
            {!settings.onboarded && step < LAST ? (
              <button type="button" disabled={!!busy} onClick={later} style={{ position: "absolute", top: "18px", right: "24px", height: "36px", padding: "0 12px", border: "0", borderRadius: "999px", background: "transparent", color: MUTED, fontSize: "14px", cursor: "pointer", WebkitAppRegion: "no-drag", zIndex: 6 }}>{"Saltar la bienvenida"}</button>
            ) : null}
            <div key={step} style={{ flex: "1", width: "100%", maxWidth: "720px", display: "flex", flexDirection: "column", justifyContent: "center", gap: "32px", animation: "rise .45s ease-out" }}>
              {step === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
                  <h1 style={{ margin: "0", font: "600 clamp(48px, 6vw, 80px)/0.96 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.045em" }}>
                    {"Hola."}
                    <br />
                    <span style={{ color: "#8A8D96" }}>{"Esto es tu equipo."}</span>
                  </h1>
                  <ul aria-label="Tu equipo" style={{ margin: "6px 0 4px", padding: "0", listStyle: "none", display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "14px 26px" }}>
                    {crew.map((c, i) => (
                      <li key={c.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                        <span aria-hidden="true" style={{ width: SIZES[i % 6] + "px", height: SIZES[i % 6] + "px", ...face(c), animation: `breathe ${PACES[i % 6]}s ease-in-out infinite`, animationDelay: i * -0.4 + "s" }} />
                        <span style={{ fontSize: "13.5px", fontWeight: "500", color: "#3D404A" }}>{c.name}</span>
                      </li>
                    ))}
                  </ul>
                  <p style={{ margin: "0", fontSize: "20px", lineHeight: "1.5", color: TEXT2, maxWidth: "560px" }}>{"Colmena es un grupo de bots que trabaja contigo como compañeros: escriben, investigan, calculan y programan. Tú decides qué hacen solos y qué te preguntan antes."}</p>
                  <p style={{ margin: "0", fontSize: "15px", color: MUTED }}>{"Te llevará unos dos minutos. Puedes saltar cualquier paso."}</p>
                </div>
              ) : null}

              {step === 1 ? (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <h1 style={h1}>{"¿Con qué piensan?"}</h1>
                    <p style={lead}>{"Tus bots usan tu cuenta de IA. Inicias sesión en la página oficial; Colmena nunca ve tu contraseña."}</p>
                  </div>
                  <div role="radiogroup" aria-label="Cuenta de IA" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {BRAINS.map((b) => {
                      const on = brain === b.id;
                      const e = info(b.id);
                      const note = e?.connected ? { text: "Conectada · " + (e.detail || e.label || b.name), fg: GREEN }
                        : b.id === "openai" && authError ? { text: "No se pudo entrar: " + String(authError.message || authError), fg: RED }
                        : { text: b.note, fg: MUTED };
                      return (
                        <div key={b.id} style={{ display: "flex", flexDirection: "column", borderRadius: "20px", background: "#FFFFFF", boxShadow: `inset 0 0 0 2px ${on ? INK : "transparent"}` }}>
                          <button type="button" role="radio" aria-checked={on} onClick={() => { if (!on) { setBrain(b.id); setPanel(false); setError(null); } }} style={{ display: "flex", alignItems: "center", gap: "16px", minHeight: "76px", padding: "14px 20px", border: "0", borderRadius: "20px", background: "transparent", textAlign: "left", cursor: "pointer" }}>
                            <ProviderMark engine={b.id} size={40} style={{ background: "#F1F1EC" }} />
                            <span style={{ flex: "1", display: "flex", flexDirection: "column", gap: "3px" }}>
                              <span style={{ fontSize: "16px", fontWeight: "600" }}>{b.name}</span>
                              <span role={on ? "status" : undefined} style={{ fontSize: "14px", color: note.fg }}>{note.text}</span>
                            </span>
                            {e?.connected ? (
                              <span aria-hidden="true" style={{ width: "24px", height: "24px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: GREEN, color: "#FFFFFF" }}><Check size={13} strokeWidth={3} /></span>
                            ) : b.rec ? (
                              <span style={{ height: "24px", padding: "0 10px", display: "inline-flex", alignItems: "center", borderRadius: "999px", background: "#F1F1EC", fontSize: "12px", fontWeight: "600", color: "#3D404A" }}>{"Recomendado"}</span>
                            ) : null}
                          </button>
                          {on && !e?.connected && b.id === "openai" && waiting ? <Waiting url={waiting.url} busy={!!busy} onCancel={cancelLogin} /> : null}
                          {on && !e?.connected && panel && b.id === "anthropic" ? <ClaudeConnect busy={busy === "connect"} onConnect={connectClaude} /> : null}
                          {on && !e?.connected && panel && b.id === "opencode-go" ? <KeyConnect busy={busy === "connect"} onConnect={connectOpenCode} /> : null}
                        </div>
                      );
                    })}
                  </div>
                  <p style={{ margin: "0", fontSize: "14px", color: MUTED }}>
                    {"¿Prefieres otra forma? "}
                    <a href="/ajustes/ia" onClick={(e) => { e.preventDefault(); navigate("/ajustes/ia"); }} style={{ color: "#1F4FD1" }}>{"Usar una clave de API o un modelo en este ordenador"}</a>
                  </p>
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <h1 style={h1}>{"¿Cuánto quieres ver?"}</h1>
                    <p style={lead}>{"Lo cambias cuando quieras con el interruptor «Modo experto», al pie de la barra."}</p>
                  </div>
                  <div role="radiogroup" aria-label="Nivel de detalle" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", gap: "12px" }}>
                    <button type="button" role="radio" aria-checked={!expert} onClick={() => expert && setExpert(false)} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "12px", padding: "22px", border: `2px solid ${expert ? "transparent" : INK}`, borderRadius: "22px", background: "#FFFFFF", textAlign: "left", cursor: "pointer" }}>
                      <span style={{ font: "600 24px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Lo justo"}</span>
                      <span style={{ fontSize: "14.5px", lineHeight: "1.5", color: TEXT2 }}>{"Resultados y lo que te necesita. Los bots te cuentan en frases lo que hacen."}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", borderRadius: "12px", background: "#F6F6F3", fontSize: "13.5px" }}>
                        <span aria-hidden="true" style={{ width: "16px", height: "16px", flex: "none", ...face(writer) }} />
                        {writer.name + " ha leído el informe"}
                      </span>
                    </button>
                    <button type="button" role="radio" aria-checked={expert} onClick={() => !expert && setExpert(true)} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "12px", padding: "22px", border: `2px solid ${expert ? INK : "transparent"}`, borderRadius: "22px", background: "#FFFFFF", textAlign: "left", cursor: "pointer" }}>
                      <span style={{ font: "600 24px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Con todo detalle"}</span>
                      <span style={{ fontSize: "14.5px", lineHeight: "1.5", color: TEXT2 }}>{"Herramientas, tokens, modelo, registros y atajos. Para quien quiere ver las tripas."}</span>
                      <span style={{ padding: "10px 12px", borderRadius: "12px", background: INK, color: "#E6E7EC", font: "400 12.5px/1.4 'Geist Mono', monospace" }}>{"read_file informe_q3.docx · 4.120 tk"}</span>
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <span style={{ fontSize: "15px", fontWeight: "600" }}>
                      {"¿A qué te dedicas? "}
                      <span style={{ fontWeight: "400", color: MUTED }}>{"Así te proponemos un equipo."}</span>
                    </span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {ROLE_CHIPS.map(([id, label]) => {
                        const on = role === id;
                        return <button key={id} type="button" aria-pressed={on} onClick={() => { setRole(id); setDropped([]); }} style={{ height: "40px", padding: "0 16px", border: `1px solid ${on ? INK : "rgba(18,19,26,.12)"}`, borderRadius: "999px", background: on ? INK : "#FFFFFF", color: on ? "#FFFFFF" : "#3D404A", fontSize: "14px", fontWeight: "500", cursor: "pointer" }}>{label}</button>;
                      })}
                    </div>
                  </div>
                </>
              ) : null}

              {step === 3 ? (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <h1 style={h1}>{"Tu equipo ya está aquí."}</h1>
                    <p style={lead}>{"Pensado para "}{roleName}{". Atlas coordina y reparte; los demás hacen. Quita los que no quieras: puedes crear más luego."}</p>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: "10px" }}>
                    {team.map((m) => {
                      const atlas = m.id === "atlas";
                      const keep = atlas || !dropped.includes(m.id);
                      return (
                        <label key={m.id} title={atlas ? "Atlas siempre está: coordina al equipo" : undefined} style={{ display: "flex", alignItems: "center", gap: "14px", minHeight: "72px", padding: "14px 18px", borderRadius: "18px", background: "#FFFFFF", cursor: atlas ? "default" : "pointer", opacity: keep ? 1 : 0.55, transition: "opacity .2s ease" }}>
                          <span aria-hidden="true" style={{ flex: "none", width: "36px", height: "36px", ...face(m) }} />
                          <span style={{ flex: "1", display: "flex", flexDirection: "column", gap: "2px" }}>
                            <span style={{ fontSize: "15.5px", fontWeight: "600" }}>{m.name}</span>
                            <span style={{ fontSize: "13.5px", color: MUTED }}>{m.help}</span>
                          </span>
                          <input type="checkbox" checked={keep} aria-disabled={atlas || undefined} onChange={() => !atlas && setDropped((l) => (keep ? [...l, m.id] : l.filter((x) => x !== m.id)))} aria-label={`Quedarme con ${m.name}`} style={{ width: "20px", height: "20px", accentColor: INK }} />
                        </label>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {step === 4 ? (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <h1 style={h1}>{"¿Les dejas ver tu día?"}</h1>
                    <p style={lead}>{"Con tu correo, tu calendario y tus archivos ayudan desde hoy. Nunca envían, publican ni borran nada sin tu OK."}</p>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {DAY_APPS.map((a) => {
                      const on = apps.includes(a.id);
                      return (
                        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: "16px", minHeight: "72px", padding: "14px 18px", borderRadius: "18px", background: "#FFFFFF" }}>
                          <span aria-hidden="true" style={{ flex: "none", width: "40px", height: "40px", display: "grid", placeItems: "center", borderRadius: "12px", background: "#F1F1EC", fontSize: "13px", fontWeight: "600" }}>{a.mark}</span>
                          <span style={{ flex: "1", display: "flex", flexDirection: "column", gap: "2px" }}>
                            <span style={{ fontSize: "15.5px", fontWeight: "600" }}>{a.name}</span>
                            <span style={{ fontSize: "13.5px", color: MUTED }}>{a.note}</span>
                          </span>
                          <button type="button" aria-pressed={on} onClick={() => setApps((l) => (on ? l.filter((x) => x !== a.id) : [...l, a.id]))} style={{ ...outline, display: "inline-flex", alignItems: "center", gap: "6px", ...(on ? { background: INK, color: "#FFFFFF", borderColor: INK } : {}) }}>
                            {on ? <Check size={14} strokeWidth={2.6} aria-hidden="true" /> : null}
                            {on ? "Elegida" : "Conectar"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <p style={{ margin: "0", fontSize: "14px", lineHeight: "1.5", color: MUTED }}>{"Las conectas en un minuto desde Ajustes › Apps y carpetas, con tu cuenta de cada app. Hasta entonces no ven nada."}</p>
                </>
              ) : null}

              {step === 5 ? (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <h1 style={h1}>{"Pídeles algo."}</h1>
                    <p style={lead}>{anyConnected ? "Escribe como se lo dirías a un compañero. Atlas decide quién lo hace." : "Escribe como se lo dirías a un compañero. Atlas lo repartirá cuando conectes tu cuenta de IA."}</p>
                  </div>
                  <form onSubmit={(e) => { e.preventDefault(); send(); }} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "8px 8px 8px 22px", borderRadius: "26px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 24px 60px -30px rgba(18,19,26,.35)" }}>
                    <label htmlFor="v3-first-request" style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Tu primera petición"}</label>
                    <input className="c-bare" id="v3-first-request" type="text" autoFocus value={request} onChange={(e) => setText(e.target.value)} placeholder="Escribe lo que necesitas" style={{ flex: "1", minWidth: "0", height: "56px", border: "0", background: "transparent", fontSize: "18px" }} />
                    <button type="submit" aria-label="Enviar y entrar en Colmena" disabled={!!busy} style={{ width: "48px", height: "48px", flex: "none", display: "grid", placeItems: "center", border: "0", borderRadius: "50%", background: INK, color: "#FFFFFF", cursor: busy ? "wait" : "pointer" }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 19V5M6 11l6-6 6 6" />
                      </svg>
                    </button>
                  </form>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {ideas.filter((i) => i !== request).slice(0, 4).map((i) => (
                      <button key={i} type="button" onClick={() => setText(i)} style={{ height: "38px", padding: "0 16px", border: "1px solid rgba(18,19,26,.12)", borderRadius: "999px", background: "transparent", fontSize: "14px", color: "#3D404A", cursor: "pointer" }}>{i}</button>
                    ))}
                  </div>
                </>
              ) : null}

              {error ? <p role="alert" style={{ margin: "0", fontSize: "14px", color: RED }}>{error}</p> : null}
            </div>

            <div style={{ width: "100%", maxWidth: "720px", display: "flex", alignItems: "center", gap: "12px", paddingTop: "24px" }}>
              {step > 0 ? <button type="button" onClick={() => setStep(step - 1)} style={ghost}>{"Atrás"}</button> : null}
              <span style={{ flex: "1" }} />
              {showSkip ? <button type="button" disabled={!!busy} onClick={skip} style={ghost}>{"Ahora no"}</button> : null}
              {step < LAST ? (
                <button type="button" disabled={!!busy || connecting} onClick={next} style={primary(!!busy || connecting)}>{nextLabel}</button>
              ) : (
                <button type="button" disabled={!!busy} onClick={send} style={primary(!!busy)}>{busy === "send" || busy === "team" ? "Enviando…" : anyConnected ? "Enviar y entrar en Colmena" : "Entrar en Colmena"}</button>
              )}
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

/** ChatGPT's official page is open in the browser: what to do meanwhile. */
function Waiting({ url, busy, onCancel }) {
  return (
    <div role="status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", padding: "0 20px 18px 76px", animation: "rise .25s ease-out" }}>
      <span style={{ flex: "1 1 240px", display: "flex", alignItems: "center", gap: "10px", fontSize: "14px", lineHeight: "1.5", color: TEXT2 }}>
        <span aria-hidden="true" style={{ width: "14px", height: "14px", flex: "none", border: "2px solid rgba(18,19,26,.15)", borderTopColor: INK, borderRadius: "50%", animation: "spin 1s linear infinite" }} />
        {"Inicia sesión en tu navegador. Te esperamos aquí; cuando termines, vuelve a esta ventana."}
      </span>
      <button type="button" onClick={() => window.open(url, "_blank", "noopener")} style={outline}>{"Abrir otra vez la página"}</button>
      <button type="button" disabled={busy} onClick={onCancel} style={{ ...outline, border: "0", background: "transparent", color: TEXT2 }}>{"Cancelar"}</button>
    </div>
  );
}

/** A secret pasted once (token or key), kept encrypted on this computer by the server. */
function SecretForm({ label, placeholder, busy, onSubmit }) {
  const [value, setValue] = useState("");
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const ready = !!clean(value);
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ready) onSubmit(clean(value)); }} style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      <input className="c-quiet" ref={ref} type="password" autoComplete="off" spellCheck="false" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} style={field} />
      <button type="submit" disabled={busy || !ready} style={{ ...outline, height: "44px", background: INK, color: "#FFFFFF", border: "0", fontWeight: "600", opacity: busy || !ready ? 0.5 : 1, cursor: busy ? "wait" : "pointer" }}>{busy ? "Comprobando…" : "Conectar"}</button>
    </form>
  );
}

/** Claude, the three ways OpenClaw offers (the same as Ajustes › Cuentas de IA). */
function ClaudeConnect({ busy, onConnect }) {
  const [way, setWay] = useState("cli");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "0 20px 20px 76px", animation: "rise .25s ease-out" }}>
      <div role="radiogroup" aria-label="Cómo conectar Claude" style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "6px", borderRadius: "16px", background: "#F6F6F3" }}>
        {CLAUDE_WAYS.map((w) => {
          const on = way === w.id;
          return (
            <button key={w.id} type="button" role="radio" aria-checked={on} onClick={() => setWay(w.id)} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "52px", padding: "8px 14px", border: "0", borderRadius: "12px", cursor: "pointer", textAlign: "left", background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 3px rgba(18,19,26,.12)" : "none" }}>
              <span style={{ flex: "1", display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "14.5px", fontWeight: "600" }}>{w.title}</span>
                <span style={{ fontSize: "13px", color: MUTED }}>{w.sub}</span>
              </span>
              <span aria-hidden="true" style={{ width: "20px", height: "20px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: on ? INK : "transparent", boxShadow: on ? "none" : "inset 0 0 0 1.5px rgba(18,19,26,.2)" }}>
                <Check size={11} strokeWidth={3.4} color="#FFFFFF" style={{ opacity: on ? 1 : 0 }} />
              </span>
            </button>
          );
        })}
      </div>
      {way === "cli" ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px" }}>
          <span style={{ flex: "1 1 260px", fontSize: "14px", lineHeight: "1.6", color: MUTED }}>
            {"Si aún no has entrado, abre una terminal y escribe "}
            <code style={{ padding: "3px 8px", borderRadius: "8px", background: "#F1F1EC", font: "500 13px 'Geist Mono', monospace", color: INK }}>{"claude auth login"}</code>
          </span>
          <button type="button" disabled={busy} onClick={() => onConnect({ method: "cli" })} style={{ ...outline, background: INK, color: "#FFFFFF", border: "0", fontWeight: "600", cursor: busy ? "wait" : "pointer" }}>{busy ? "Comprobando…" : "Conectar"}</button>
        </div>
      ) : null}
      {way === "token" ? <SecretForm label="Token de suscripción de Claude" placeholder="sk-ant-oat01-…" busy={busy} onSubmit={(secret) => onConnect({ method: "token", secret })} /> : null}
      {way === "api_key" ? <SecretForm label="Clave de API de Anthropic" placeholder="sk-ant-api03-…" busy={busy} onSubmit={(secret) => onConnect({ method: "api_key", secret })} /> : null}
    </div>
  );
}

/** OpenCode Go: the key from opencode.ai/auth. */
function KeyConnect({ busy, onConnect }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "0 20px 20px 76px", animation: "rise .25s ease-out" }}>
      <span style={{ fontSize: "14px", lineHeight: "1.6", color: MUTED }}>
        {"Pega la clave de "}
        <a href="https://opencode.ai/auth" target="_blank" rel="noopener noreferrer" style={{ color: INK, fontWeight: "600" }}>{"opencode.ai/auth"}</a>
        {". Se guarda cifrada en este ordenador."}
      </span>
      <SecretForm label="Clave de OpenCode" placeholder="Tu clave de OpenCode" busy={busy} onSubmit={onConnect} />
    </div>
  );
}
