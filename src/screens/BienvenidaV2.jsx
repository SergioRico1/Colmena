import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { css } from "../design/V3Bienvenida.jsx";
import { shapeOf } from "../components/v2/Presence.jsx";
import { WindowDots } from "../components/v2/Rail.jsx";
import ProviderMark from "../components/v2/ProviderMark.jsx";
import { B, ROLES, APP_TASK, ROLE_CHIPS, STEPS, nameDraft, roleChips } from "../lib/onboarding.js";
import TeamStep from "../components/v3/onboarding/TeamStep.jsx";
import { useAction, useStore } from "../lib/store.jsx";
import { useExpert } from "../lib/expert.js";
import { patch, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";

// Colmena 3 · Bienvenida (design/V3Bienvenida.dc.html; docs/PLAN-equipo-y-salas.md, scope 5):
// a dark column with the steps and the page beside it. Hola (what Colmena is, your name) →
// the AI account your bots think with → your team: create one, join one with a code, or
// start alone → how much you want to see and what you do → your bots → the apps you use →
// a first request. Every step can be skipped. ?paso=0–6 opens one (QA).

const INK = "#12131A";
const MUTED = "#5C606C";
const GREEN = "#0B6B4A";
const RED = "#B4232A";
const LAST = STEPS.length - 1;
const STEP = { hola: 0, cuenta: 1, equipo: 2, trabajo: 3, bots: 4, apps: 5, peticion: 6 };
const BRAINS = [
  { id: "openai", name: "ChatGPT", note: "Usa tu plan Plus o Pro: no pagas nada más.", rec: true },
  { id: "anthropic", name: "Claude", note: "Con tu suscripción, Claude Code o una clave de API." },
  { id: "opencode-go", name: "OpenCode Go", note: "Modelos abiertos a precio fijo." },
];
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
const ghost = { height: "48px", padding: "0 18px", border: "0", borderRadius: "var(--r-pill)", background: "transparent", fontSize: "var(--t-body)", fontWeight: "500", color: "var(--c-text-2)", cursor: "pointer" };
const primary = (off = false) => ({ height: "52px", padding: "0 28px", border: "0", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-read)", fontWeight: "600", cursor: off ? "default" : "pointer", opacity: off ? 0.5 : 1, display: "inline-flex", alignItems: "center" });
const outline = { height: "40px", padding: "0 16px", border: "1px solid rgb(var(--c-ink-rgb) / .16)", borderRadius: "var(--r-pill)", background: "var(--c-card)", fontSize: "var(--t-ui)", fontWeight: "500", cursor: "pointer", flex: "none" };
const field = { flex: "1 1 240px", minWidth: "0", height: "44px", padding: "0 16px", border: "1px solid rgb(var(--c-ink-rgb) / .12)", borderRadius: "var(--r-lg)", background: "var(--c-card)", font: "500 var(--t-ui)/1 'Geist Mono', monospace", color: "var(--c-text)" };
const h1 = { margin: "0", font: "600 var(--t-display-m)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.04em" };
const lead = { margin: "0", fontSize: "var(--t-lead)", lineHeight: "1.5", color: "var(--c-text-2)" };

/** No mailbox: nobody to reach yet, so a team cannot be made here (TeamStep says so). */
const peopleOffFor = (peers) => !peers || peers.relay?.status === "off";

export default function BienvenidaV2({ query = {} }) {
  const { bots = [], settings = {}, provider, authError, ai, account = null, peers = null, teams = [] } = useStore();
  const [expert, setExpert] = useExpert();
  const engines = ai?.engines || [];
  const info = (id) => engines.find((e) => e.id === id) || (id === "openai" && provider?.connected ? { id, connected: true, detail: provider.label } : null);
  const anyConnected = BRAINS.some((b) => info(b.id)?.connected);
  const [step, setStep] = useState(() => Math.max(0, Math.min(LAST, Number(query.paso) || 0)));
  const [brain, setBrain] = useState(() => BRAINS.find((b) => info(b.id)?.connected)?.id || "openai");
  const [panel, setPanel] = useState(false);
  const [waiting, setWaiting] = useState(null);
  const [role, setRole] = useState(() => (ROLES.some((r) => r.id === settings.role) ? settings.role : "otra"));
  const [moreRoles, setMoreRoles] = useState(false);
  const [name, setName] = useState(() => nameDraft(settings, account));
  // With whom you work: a team you already have counts as created.
  const [who, setWho] = useState(() => { const t = (teams || []).find((x) => x?.id && x.id !== "solo"); return t ? { choice: "create", team: { id: t.id, name: t.name } } : { choice: "create" }; });
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
    // Leo comes with a legal team: the look it will get is kept ready (server/bot-looks.mjs).
    const ready = !r ? settings.botLooks?.[id] : null;
    return { ...B[id], ...(r ? { name: r.name, color: r.color, shape: r.shape } : ready ? { name: ready.name, color: ready.color } : {}), help: id === "atlas" ? "Coordina y reparte" : help };
  }), [cur, bots, settings.botLooks]);
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
  const coordinator = real("atlas")?.name || B.atlas.name;
  const [relooked, setRelooked] = useState("");
  const relook = (m, what) => run("look", async () => {
    const bot = await post(`/bots/${encodeURIComponent(m.id)}/look`, { what });
    setRelooked(what === "name" ? `${m.name} ahora se llama ${bot.name}.` : `${bot.name} tiene otro color.`);
  });

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
    await post("/onboarding", { role, team: kept.map((b) => b.id), apps: list, ...(name.trim() ? { userName: name.trim() } : {}) });
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
    // Your name is what your colleagues will read: kept as soon as you move on.
    if (step === STEP.hola && name.trim() && name.trim() !== nameDraft(settings, null)) return run("name", async () => { await patch("/settings", { userName: name.trim() }); setStep(1); });
    if (step === STEP.cuenta && !chosen?.connected) {
      if (brain === "openai") return waiting ? undefined : login();
      return setPanel(true);
    }
    if (step === STEP.apps) return save().then((ok) => ok && setStep(STEP.peticion));
    setStep(Math.min(LAST, step + 1));
  };
  const skip = () => (step === STEP.apps ? save([]).then((ok) => ok && setStep(STEP.peticion)) : setStep(Math.min(LAST, step + 1)));
  const brainName = BRAINS.find((b) => b.id === brain)?.name || "ChatGPT";
  const nextLabel = step === STEP.hola ? "Empezar"
    : step === STEP.cuenta ? (waiting && !chosen?.connected ? "Esperando a " + brainName + "…" : "Continuar con " + brainName)
    : step === STEP.equipo ? (who.choice === "solo" ? "Empezar solo" : "Seguir")
    : step === STEP.bots ? "Me quedo con estos"
    : step === STEP.apps && busy === "team" ? "Preparando tus bots…" : "Seguir";
  // While a sign-in or a connect panel is open, its own button is the one to press.
  const connecting = step === STEP.cuenta && !chosen?.connected && (!!waiting || panel);
  // «¿Con quién trabajas?»: one primary action per state. While a team is chosen but not made (or
  // a code not used), its own button («Crear equipo», «Continuar») is the one; «Seguir» waits and says why.
  const teamPending = step === STEP.equipo && !peopleOffFor(peers) && ((who.choice === "create" && !who.team) || (who.choice === "join" && !who.joined))
    ? (who.choice === "create" ? "Ponle nombre al equipo y pulsa «Crear equipo», o elige «Empezar solo»." : "Pega el código y pulsa «Continuar», o elige «Empezar solo».")
    : null;
  const showSkip = step === STEP.apps || (step === STEP.cuenta && !anyConnected);
  const peopleOff = !peers || peers.relay?.status === "off";
  const chips = roleChips(role, moreRoles);
  const desktop = typeof window !== "undefined" && !!window.colmenaWindow;

  return (
    <>
      <style>{css}</style>
      <div style={{ position: "relative", height: "100vh", overflowY: "auto", background: "var(--c-sunken)" }}>
        {desktop ? <div aria-hidden="true" style={{ position: "fixed", top: 0, left: "110px", right: 0, height: "26px", zIndex: 5, WebkitAppRegion: "drag" }} /> : null}
        <div style={{ minHeight: "100vh", display: "flex", flexWrap: "wrap", background: "var(--c-sunken)", color: "var(--c-text)" }}>
          <aside style={{ flex: "1 1 360px", maxWidth: "460px", display: "flex", flexDirection: "column", gap: "40px", padding: "28px 40px 36px", background: "var(--c-btn)", color: "var(--c-btn-text)" }}>
            <div style={{ height: "20px", display: "flex", alignItems: "center" }}><WindowDots dark inline /></div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <img src="/colmena-icon-128.png" alt="" width="44" height="44" style={{ display: "block", width: "44px", height: "44px", animation: "breathe 3s ease-in-out infinite" }} />
              <span style={{ font: "600 var(--t-heading)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{"Colmena"}</span>
            </div>
            <ol aria-label="Pasos" style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "4px" }}>
              {STEPS.map(([label, hint], i) => {
                const done = i < step, on = i === step;
                const body = (
                  <>
                    <span aria-hidden="true" style={{ flex: "none", width: "26px", height: "26px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", border: `1.5px solid ${done || on ? "#FFFFFF" : "rgba(255,255,255,.3)"}`, background: done ? "var(--c-card)" : "transparent", color: done ? "var(--c-text)" : "#FFFFFF", fontSize: "var(--t-caption)", fontWeight: "600" }}>{done ? "✓" : String(i + 1)}</span>
                    <span style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                      <span style={{ fontSize: "var(--t-body)", fontWeight: "600", color: on || done ? "#FFFFFF" : "#C9CBD3" }}>{label}</span>
                      <span style={{ fontSize: "var(--t-meta)", color: "#A9ACB6" }}>{hint}</span>
                    </span>
                  </>
                );
                const row = { display: "flex", alignItems: "center", gap: "14px", minHeight: "44px", padding: "0 14px", borderRadius: "var(--r-lg)", background: on ? "rgba(255,255,255,.08)" : "transparent" };
                return (
                  <li key={label} aria-current={on ? "step" : undefined} style={done ? { display: "flex" } : row}>
                    {done ? <button type="button" onClick={() => setStep(i)} aria-label={`Volver a «${label}»`} style={{ ...row, flex: "1", border: "0", color: "inherit", textAlign: "left", cursor: "pointer", WebkitAppRegion: "no-drag" }}>{body}</button> : body}
                  </li>
                );
              })}
            </ol>
            <span style={{ flex: "1" }} />
            <p style={{ margin: "0", display: "flex", gap: "10px", fontSize: "var(--t-ui)", lineHeight: "1.5", color: "#C9CBD3" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", marginTop: "1px" }}>
                <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
                <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
              </svg>
              {"Tus bots, chats y archivos se quedan en este ordenador. Puedes cambiar todo esto luego en Ajustes."}
            </p>
          </aside>

          <main style={{ position: "relative", flex: "999 1 560px", minWidth: "0", display: "flex", flexDirection: "column", padding: "56px clamp(24px, 6vw, 96px) 40px" }}>
            {!settings.onboarded && step < LAST ? (
              <button type="button" disabled={!!busy} onClick={later} style={{ position: "absolute", top: "18px", right: "24px", height: "36px", padding: "0 12px", border: "0", borderRadius: "var(--r-pill)", background: "transparent", color: "var(--c-text-3)", fontSize: "var(--t-ui)", cursor: "pointer", WebkitAppRegion: "no-drag", zIndex: 6 }}>{"Saltar la bienvenida"}</button>
            ) : null}
            <div key={step} style={{ flex: "1", width: "100%", maxWidth: "720px", display: "flex", flexDirection: "column", justifyContent: "center", gap: "32px", animation: "rise .45s ease-out" }}>
              {step === STEP.hola ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
                  <h1 style={{ margin: "0", font: "600 clamp(var(--t-display-m), 6vw, var(--t-display-xl))/0.96 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.045em" }}>
                    {"Hola."}
                    <br />
                    <span style={{ color: "var(--c-text-3)" }}>{"Aquí trabaja tu equipo."}</span>
                  </h1>
                  <ul aria-label="Tus bots" style={{ margin: "6px 0 4px", padding: "0", listStyle: "none", display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "14px 26px" }}>
                    {crew.map((c, i) => (
                      <li key={c.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                        <span aria-hidden="true" style={{ width: SIZES[i % 6] + "px", height: SIZES[i % 6] + "px", ...face(c), animation: `breathe ${PACES[i % 6]}s ease-in-out infinite`, animationDelay: i * -0.4 + "s" }} />
                        <span style={{ fontSize: "var(--t-ui)", fontWeight: "500", color: "var(--c-text-2)" }}>{c.name}</span>
                      </li>
                    ))}
                  </ul>
                  <p style={{ margin: "0", fontSize: "var(--t-title)", lineHeight: "1.5", color: "var(--c-text-2)", maxWidth: "600px" }}>{"Colmena es el sitio donde las personas de tu equipo y los bots de cada una trabajan juntos. Estos son los tuyos: viven en tu ordenador, con tu cuenta de IA y tus datos, y tú decides qué hacen solos y qué te preguntan antes."}</p>
                  <label style={{ display: "flex", flexDirection: "column", gap: "8px", maxWidth: "420px" }}>
                    <span style={{ fontSize: "var(--t-body)", fontWeight: "600" }}>{"¿Cómo te llamas? "}<span style={{ fontWeight: "400", color: "var(--c-text-3)" }}>{"Así te verán tus compañeros."}</span></span>
                    <input className="c-quiet" type="text" value={name} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); next(); } }} placeholder="Tu nombre" style={{ height: "48px", padding: "0 16px", border: "1px solid rgb(var(--c-ink-rgb) / .14)", borderRadius: "var(--r-lg)", background: "var(--c-card)", fontSize: "var(--t-read)", color: "var(--c-text)" }} />
                  </label>
                  <p style={{ margin: "0", fontSize: "var(--t-body)", color: "var(--c-text-3)" }}>{"Te llevará unos tres minutos. Puedes saltar cualquier paso."}</p>
                </div>
              ) : null}

              {step === STEP.cuenta ? (
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
                        <div key={b.id} style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-xl)", background: "var(--c-card)", boxShadow: `inset 0 0 0 2px ${on ? INK : "transparent"}` }}>
                          <button type="button" role="radio" aria-checked={on} onClick={() => { if (!on) { setBrain(b.id); setPanel(false); setError(null); } }} style={{ display: "flex", alignItems: "center", gap: "16px", minHeight: "76px", padding: "14px 20px", border: "0", borderRadius: "var(--r-xl)", background: "transparent", textAlign: "left", cursor: "pointer" }}>
                            <ProviderMark engine={b.id} size={40} style={{ background: "var(--c-chip)" }} />
                            <span style={{ flex: "1", display: "flex", flexDirection: "column", gap: "3px" }}>
                              <span style={{ fontSize: "var(--t-read)", fontWeight: "600" }}>{b.name}</span>
                              <span role={on ? "status" : undefined} style={{ fontSize: "var(--t-ui)", color: note.fg }}>{note.text}</span>
                            </span>
                            {e?.connected ? (
                              <span aria-hidden="true" style={{ width: "24px", height: "24px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: GREEN, color: "#FFFFFF" }}><Check size={13} strokeWidth={3} /></span>
                            ) : b.rec ? (
                              <span style={{ height: "24px", padding: "0 10px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-pill)", background: "var(--c-chip)", fontSize: "var(--t-caption)", fontWeight: "600", color: "var(--c-text-2)" }}>{"Recomendado"}</span>
                            ) : null}
                          </button>
                          {on && !e?.connected && b.id === "openai" && waiting ? <Waiting url={waiting.url} busy={!!busy} onCancel={cancelLogin} /> : null}
                          {on && !e?.connected && panel && b.id === "anthropic" ? <ClaudeConnect busy={busy === "connect"} onConnect={connectClaude} /> : null}
                          {on && !e?.connected && panel && b.id === "opencode-go" ? <KeyConnect busy={busy === "connect"} onConnect={connectOpenCode} /> : null}
                        </div>
                      );
                    })}
                  </div>
                  <p style={{ margin: "0", fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>
                    {"¿Prefieres otra forma? "}
                    <a href="/ajustes/ia" onClick={(e) => { e.preventDefault(); navigate("/ajustes/ia"); }} style={{ color: "var(--c-accent-ink)" }}>{"Usar una clave de API o un modelo en este ordenador"}</a>
                  </p>
                </>
              ) : null}

              {step === STEP.equipo ? (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <h1 style={h1}>{"¿Con quién trabajas?"}</h1>
                    <p style={lead}>{"En un equipo habláis entre vosotros y con los bots de todos en las mismas salas. Cada bot trabaja en el ordenador de su dueño, y lo que sale de un ordenador lo aprueba su dueño."}</p>
                  </div>
                  <TeamStep value={who} onChange={setWho} off={peopleOff} />
                </>
              ) : null}

              {step === STEP.trabajo ? (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <h1 style={h1}>{"¿Cuánto quieres ver?"}</h1>
                    <p style={lead}>{"Lo cambias cuando quieras con el interruptor «Modo experto», al pie de la barra."}</p>
                  </div>
                  <div role="radiogroup" aria-label="Nivel de detalle" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", gap: "12px" }}>
                    <button type="button" role="radio" aria-checked={!expert} onClick={() => expert && setExpert(false)} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "12px", padding: "22px", border: `2px solid ${expert ? "transparent" : "var(--c-text)"}`, borderRadius: "var(--r-2xl)", background: "var(--c-card)", textAlign: "left", cursor: "pointer" }}>
                      <span style={{ font: "600 var(--t-heading)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Lo justo"}</span>
                      <span style={{ fontSize: "var(--t-body)", lineHeight: "1.5", color: "var(--c-text-2)" }}>{"Resultados y lo que te necesita. Los bots te cuentan en frases lo que hacen."}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", borderRadius: "var(--r-md)", background: "var(--c-hover)", fontSize: "var(--t-ui)" }}>
                        <span aria-hidden="true" style={{ width: "16px", height: "16px", flex: "none", ...face(writer) }} />
                        {writer.name + " ha leído el informe"}
                      </span>
                    </button>
                    <button type="button" role="radio" aria-checked={expert} onClick={() => !expert && setExpert(true)} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "12px", padding: "22px", border: `2px solid ${expert ? "var(--c-text)" : "transparent"}`, borderRadius: "var(--r-2xl)", background: "var(--c-card)", textAlign: "left", cursor: "pointer" }}>
                      <span style={{ font: "600 var(--t-heading)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Con todo detalle"}</span>
                      <span style={{ fontSize: "var(--t-body)", lineHeight: "1.5", color: "var(--c-text-2)" }}>{"Herramientas, tokens, modelo, registros y atajos. Para quien quiere ver las tripas."}</span>
                      <span style={{ padding: "10px 12px", borderRadius: "var(--r-md)", background: INK, color: "#E6E7EC", font: "400 var(--t-meta)/1.4 'Geist Mono', monospace" }}>{"read_file informe_q3.docx · 4.120 tk"}</span>
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <span style={{ fontSize: "var(--t-body)", fontWeight: "600" }}>
                      {"¿A qué te dedicas? "}
                      <span style={{ fontWeight: "400", color: "var(--c-text-3)" }}>{"Así te proponemos unos bots."}</span>
                    </span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {chips.shown.map(([id, label]) => {
                        const on = role === id;
                        return <button key={id} type="button" aria-pressed={on} onClick={() => { setRole(id); setDropped([]); }} style={{ height: "40px", padding: "0 16px", border: `1px solid ${on ? "var(--c-text)" : "rgb(var(--c-ink-rgb) / .12)"}`, borderRadius: "var(--r-pill)", background: on ? "var(--c-btn)" : "var(--c-card)", color: on ? "var(--c-btn-text)" : "var(--c-text-2)", fontSize: "var(--t-ui)", fontWeight: "500", cursor: "pointer" }}>{label}</button>;
                      })}
                      {chips.more ? <button type="button" aria-expanded="false" onClick={() => setMoreRoles(true)} style={{ height: "40px", padding: "0 16px", border: "1px dashed rgba(18,19,26,.28)", borderRadius: "var(--r-pill)", background: "transparent", color: "var(--c-text-2)", fontSize: "var(--t-ui)", fontWeight: "500", cursor: "pointer" }}>{"Otro"}</button> : null}
                    </div>
                  </div>
                </>
              ) : null}

              {step === STEP.bots ? (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <h1 style={h1}>{"Tus bots ya están aquí."}</h1>
                    <p style={lead}>{"Pensado para "}{roleName}{`. ${coordinator} coordina y reparte; los demás hacen. Quita los que no quieras: puedes crear más luego.`}</p>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: "10px" }}>
                    {team.map((m) => {
                      const atlas = m.id === "atlas";
                      const keep = atlas || !dropped.includes(m.id);
                      // Names and colours are this person's own (server/bot-looks.mjs): «Otro nombre» and
                      // «Otro color» walk the bot's own sequence, never to one another of yours has.
                      const here = !!real(m.id) && !!settings.botLooks?.key;
                      const pill = { height: "32px", padding: "0 12px", border: "1px solid rgb(var(--c-ink-rgb) / .14)", borderRadius: "var(--r-pill)", background: "var(--c-card)", color: "var(--c-text-2)", fontSize: "var(--t-meta)", fontWeight: "500", cursor: busy ? "default" : "pointer" };
                      return (
                        <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px 18px", borderRadius: "var(--r-xl)", background: "var(--c-card)", opacity: keep ? 1 : 0.55, transition: "opacity .2s ease" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                            <span aria-hidden="true" style={{ flex: "none", width: "36px", height: "36px", ...face(m) }} />
                            <label htmlFor={"keep-" + m.id} title={atlas ? `${m.name} siempre está: coordina al equipo` : undefined} style={{ flex: "1", display: "flex", flexDirection: "column", gap: "2px", cursor: atlas ? "default" : "pointer" }}>
                              <span style={{ fontSize: "var(--t-read)", fontWeight: "600" }}>{m.name}</span>
                              <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{m.help}</span>
                            </label>
                            <input id={"keep-" + m.id} type="checkbox" checked={keep} aria-disabled={atlas || undefined} onChange={() => !atlas && setDropped((l) => (keep ? [...l, m.id] : l.filter((x) => x !== m.id)))} aria-label={`Quedarme con ${m.name}`} style={{ width: "24px", height: "24px", margin: 0, accentColor: "var(--c-text)" }} />
                          </div>
                          {here && keep ? (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", paddingLeft: "50px" }}>
                              <button type="button" disabled={!!busy} onClick={() => relook(m, "name")} aria-label={`Otro nombre para ${m.name}`} style={pill}>{"Otro nombre"}</button>
                              {atlas ? null : <button type="button" disabled={!!busy} onClick={() => relook(m, "color")} aria-label={`Otro color para ${m.name}`} style={pill}>{"Otro color"}</button>}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <p role="status" style={{ margin: "-18px 0 0", minHeight: "20px", fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{relooked || "Tus compañeros verán estos nombres y colores; los de cada persona son distintos."}</p>
                </>
              ) : null}

              {step === STEP.apps ? (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <h1 style={h1}>{"¿Les dejas ver tu día?"}</h1>
                    <p style={lead}>{"Con tu correo, tu calendario y tus archivos ayudan desde hoy. Nunca envían, publican ni borran nada sin tu OK."}</p>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {DAY_APPS.map((a) => {
                      const on = apps.includes(a.id);
                      return (
                        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: "16px", minHeight: "72px", padding: "14px 18px", borderRadius: "var(--r-xl)", background: "var(--c-card)" }}>
                          <span aria-hidden="true" style={{ flex: "none", width: "40px", height: "40px", display: "grid", placeItems: "center", borderRadius: "var(--r-md)", background: "var(--c-chip)", fontSize: "var(--t-meta)", fontWeight: "600" }}>{a.mark}</span>
                          <span style={{ flex: "1", display: "flex", flexDirection: "column", gap: "2px" }}>
                            <span style={{ fontSize: "var(--t-read)", fontWeight: "600" }}>{a.name}</span>
                            <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{a.note}</span>
                          </span>
                          <button type="button" aria-pressed={on} onClick={() => setApps((l) => (on ? l.filter((x) => x !== a.id) : [...l, a.id]))} style={{ ...outline, display: "inline-flex", alignItems: "center", gap: "6px", ...(on ? { background: "var(--c-btn)", color: "var(--c-btn-text)", borderColor: "var(--c-text)" } : {}) }}>
                            {on ? <Check size={14} strokeWidth={2.6} aria-hidden="true" /> : null}
                            {on ? "Elegida" : "Conectar"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <p style={{ margin: "0", fontSize: "var(--t-ui)", lineHeight: "1.5", color: "var(--c-text-3)" }}>{"Las conectas en un minuto desde Ajustes › Apps y carpetas, con tu cuenta de cada app. Hasta entonces no ven nada."}</p>
                </>
              ) : null}

              {step === STEP.peticion ? (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <h1 style={h1}>{"Pídeles algo."}</h1>
                    <p style={lead}>{anyConnected ? `Escribe como se lo dirías a un compañero. ${coordinator} decide quién lo hace.` : `Escribe como se lo dirías a un compañero. ${coordinator} lo repartirá cuando conectes tu cuenta de IA.`}</p>
                  </div>
                  <form onSubmit={(e) => { e.preventDefault(); send(); }} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "8px 8px 8px 22px", borderRadius: "var(--r-2xl)", background: "var(--c-card)", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 24px 60px -30px rgba(18,19,26,.35)" }}>
                    <label htmlFor="v3-first-request" style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Tu primera petición"}</label>
                    <input className="c-bare" id="v3-first-request" type="text" autoFocus value={request} onChange={(e) => setText(e.target.value)} placeholder="Escribe lo que necesitas" style={{ flex: "1", minWidth: "0", height: "56px", border: "0", background: "transparent", fontSize: "var(--t-lead)" }} />
                    <button type="submit" aria-label="Enviar y entrar en Colmena" disabled={!!busy} style={{ width: "48px", height: "48px", flex: "none", display: "grid", placeItems: "center", border: "0", borderRadius: "var(--r-circle)", background: "var(--c-btn)", color: "var(--c-btn-text)", cursor: busy ? "wait" : "pointer" }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 19V5M6 11l6-6 6 6" />
                      </svg>
                    </button>
                  </form>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {ideas.filter((i) => i !== request).slice(0, 4).map((i) => (
                      <button key={i} type="button" onClick={() => setText(i)} style={{ height: "38px", padding: "0 16px", border: "1px solid rgb(var(--c-ink-rgb) / .12)", borderRadius: "var(--r-pill)", background: "transparent", fontSize: "var(--t-ui)", color: "var(--c-text-2)", cursor: "pointer" }}>{i}</button>
                    ))}
                  </div>
                </>
              ) : null}

              {error ? <p role="alert" style={{ margin: "0", fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{error}</p> : null}
            </div>

            <div style={{ width: "100%", maxWidth: "720px", display: "flex", alignItems: "center", gap: "12px", paddingTop: "24px" }}>
              {step > 0 ? <button type="button" onClick={() => setStep(step - 1)} style={ghost}>{"Atrás"}</button> : null}
              <span style={{ flex: "1" }} />
              {showSkip ? <button type="button" disabled={!!busy} onClick={skip} style={ghost}>{"Ahora no"}</button> : null}
              {teamPending ? <span id="team-pending" style={{ fontSize: "var(--t-ui)", color: "var(--c-text-3)", textAlign: "right", maxWidth: "340px" }}>{teamPending}</span> : null}
              {step < LAST ? (
                <button type="button" disabled={!!busy || connecting || !!teamPending} aria-describedby={teamPending ? "team-pending" : undefined} onClick={next} style={primary(!!busy || connecting || !!teamPending)}>{nextLabel}</button>
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
      <span style={{ flex: "1 1 240px", display: "flex", alignItems: "center", gap: "10px", fontSize: "var(--t-ui)", lineHeight: "1.5", color: "var(--c-text-2)" }}>
        <span aria-hidden="true" style={{ width: "14px", height: "14px", flex: "none", border: "2px solid rgb(var(--c-ink-rgb) / .15)", borderTopColor: "var(--c-text)", borderRadius: "var(--r-circle)", animation: "spin 1s linear infinite" }} />
        {"Inicia sesión en tu navegador. Te esperamos aquí; cuando termines, vuelve a esta ventana."}
      </span>
      <button type="button" onClick={() => window.open(url, "_blank", "noopener")} style={outline}>{"Abrir otra vez la página"}</button>
      <button type="button" disabled={busy} onClick={onCancel} style={{ ...outline, border: "0", background: "transparent", color: "var(--c-text-2)" }}>{"Cancelar"}</button>
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
      <button type="submit" disabled={busy || !ready} style={{ ...outline, height: "44px", background: "var(--c-btn)", color: "var(--c-btn-text)", border: "0", fontWeight: "600", opacity: busy || !ready ? 0.5 : 1, cursor: busy ? "wait" : "pointer" }}>{busy ? "Comprobando…" : "Conectar"}</button>
    </form>
  );
}

/** Claude, the three ways OpenClaw offers (the same as Ajustes › Cuentas de IA). */
function ClaudeConnect({ busy, onConnect }) {
  const [way, setWay] = useState("cli");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "0 20px 20px 76px", animation: "rise .25s ease-out" }}>
      <div role="radiogroup" aria-label="Cómo conectar Claude" style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "6px", borderRadius: "var(--r-lg)", background: "var(--c-hover)" }}>
        {CLAUDE_WAYS.map((w) => {
          const on = way === w.id;
          return (
            <button key={w.id} type="button" role="radio" aria-checked={on} onClick={() => setWay(w.id)} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "52px", padding: "8px 14px", border: "0", borderRadius: "var(--r-md)", cursor: "pointer", textAlign: "left", background: on ? "var(--c-card)" : "transparent", boxShadow: on ? "0 1px 3px rgba(18,19,26,.12)" : "none" }}>
              <span style={{ flex: "1", display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "var(--t-body)", fontWeight: "600" }}>{w.title}</span>
                <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{w.sub}</span>
              </span>
              <span aria-hidden="true" style={{ width: "20px", height: "20px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: on ? INK : "transparent", boxShadow: on ? "none" : "inset 0 0 0 1.5px rgb(var(--c-ink-rgb) / .2)" }}>
                <Check size={11} strokeWidth={3.4} color="#FFFFFF" style={{ opacity: on ? 1 : 0 }} />
              </span>
            </button>
          );
        })}
      </div>
      {way === "cli" ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px" }}>
          <span style={{ flex: "1 1 260px", fontSize: "var(--t-ui)", lineHeight: "1.6", color: "var(--c-text-3)" }}>
            {"Si aún no has entrado, abre una terminal y escribe "}
            <code style={{ padding: "3px 8px", borderRadius: "var(--r-sm)", background: "var(--c-chip)", font: "500 var(--t-meta) 'Geist Mono', monospace", color: "var(--c-text)" }}>{"claude auth login"}</code>
          </span>
          <button type="button" disabled={busy} onClick={() => onConnect({ method: "cli" })} style={{ ...outline, background: "var(--c-btn)", color: "var(--c-btn-text)", border: "0", fontWeight: "600", cursor: busy ? "wait" : "pointer" }}>{busy ? "Comprobando…" : "Conectar"}</button>
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
      <span style={{ fontSize: "var(--t-ui)", lineHeight: "1.6", color: "var(--c-text-3)" }}>
        {"Pega la clave de "}
        <a href="https://opencode.ai/auth" target="_blank" rel="noopener noreferrer" style={{ color: "var(--c-text)", fontWeight: "600" }}>{"opencode.ai/auth"}</a>
        {". Se guarda cifrada en este ordenador."}
      </span>
      <SecretForm label="Clave de OpenCode" placeholder="Tu clave de OpenCode" busy={busy} onSubmit={onConnect} />
    </div>
  );
}
