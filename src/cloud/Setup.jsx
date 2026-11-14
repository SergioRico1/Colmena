// /empezar: the guided start after creating a company or accepting an invitation, with the hive
// behind. Owners and admins: your AI → your bots → your team → a first request in #general.
// Members: your AI → the company's bots → the first request. Guests: the bots → in.
// Every step can be skipped. The step reached is kept on the company's server
// (/api/cloud/onboarding), so leaving and coming back resumes there.
//
// The bots sleep until the person has an AI account: the web connects API keys only (the
// providers' terms forbid a ChatGPT or Claude subscription in a hosted service; docs/CLOUD.md ›
// Phase 3). Each key is checked live by the same routes Ajustes uses before it is saved.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleAlert, CircleCheck, ExternalLink, Hash, Plus, UserPlus } from "../components/Icon.js";
import ProviderMark from "../components/v2/ProviderMark.jsx";
import { Shell } from "./Shell.jsx";
import { hive } from "./Hive.jsx";
import { BotCell, Roster } from "./Roster.jsx";
import { SEEDED_TEAM } from "../lib/hive.js";
import { app, auth, me } from "./api.js";

const ALL_STEPS = { ia: "Tu IA", bots: "Tus bots", equipo: "Tu equipo", llegada: "Tu primera petición" };
const MANAGERS = new Set(["owner", "admin"]);
const stepsFor = (role) => (MANAGERS.has(role) ? ["ia", "bots", "equipo", "llegada"] : role === "guest" ? ["bots", "llegada"] : ["ia", "bots", "llegada"]);

/** The providers the web connects, each with where its key is made (server routes per kind). */
const PROVIDERS = [
  { id: "openai", name: "OpenAI", site: "platform.openai.com", url: "https://platform.openai.com/api-keys", placeholder: "sk-…" },
  { id: "anthropic", name: "Anthropic", site: "console.anthropic.com", url: "https://console.anthropic.com/settings/keys", placeholder: "sk-ant-…" },
  { id: "gemini", name: "Gemini", site: "aistudio.google.com", url: "https://aistudio.google.com/apikey", placeholder: "AIza…" },
  { id: "openrouter", name: "OpenRouter", site: "openrouter.ai", url: "https://openrouter.ai/settings/keys", placeholder: "sk-or-v1-…" },
  { id: "deepseek", name: "DeepSeek", site: "platform.deepseek.com", url: "https://platform.deepseek.com/api_keys", placeholder: "sk-…" },
  { id: "moonshot", name: "Kimi", site: "platform.kimi.ai", url: "https://platform.kimi.ai/console/api-keys", placeholder: "sk-…" },
  { id: "opencode-go", name: "OpenCode Go", site: "opencode.ai", url: "https://opencode.ai/auth", placeholder: "Tu clave de OpenCode" },
];
// Pasting often brings a trailing space, a line break or an invisible character.
const clean = (v) => String(v).replace(/[​-‍⁠﻿­]/g, "").trim();
const connectKey = (engine, key) => (engine === "openai" ? app("/auth/apikey", "POST", { key })
  : engine === "anthropic" ? app("/auth/anthropic", "POST", { method: "api_key", secret: key })
  : engine === "opencode-go" ? app("/auth/opencode", "POST", { key })
  : app(`/ai/accounts/${engine}`, "POST", { key }));
const introOf = (bot) => SEEDED_TEAM.find((s) => s.id === bot.id)?.intro || (String(bot.instructions || "").match(/^[^.!?\n]+[.!?]?/) || [""])[0] || bot.role;
/** A colour for a bot of your own: one the team does not wear yet, never honey. */
const OWN_COLORS = ["#0A8C9E", "#A445D6", "#2E9A3E", "#D43C86", "#3A5BE8", "#5B6680"];

function Steps({ steps, at }) {
  const i = steps.indexOf(at);
  return (
    <>
      <p className="cl-kick">{`Paso ${i + 1} de ${steps.length}`}<span aria-hidden="true">·</span>{ALL_STEPS[at]}</p>
      <ol className="cl-steps" aria-label="Pasos">
        {steps.map((s, k) => <li key={s} data-done={k < i ? "" : undefined} aria-current={k === i ? "step" : undefined}><span className="cl-sr">{ALL_STEPS[s] + (k < i ? " (hecho)" : k === i ? " (ahora)" : "")}</span></li>)}
      </ol>
    </>
  );
}

const Problem = ({ text }) => (text ? <p className="cl-error" role="alert"><CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />{text}</p> : null);

/* ── 1. Your AI ─────────────────────────────────────────────────────────── */
function AiStep({ ai, onConnected, next, skip }) {
  const [engine, setEngine] = useState("openai");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);
  const p = PROVIDERS.find((x) => x.id === engine);
  const connected = ai?.engines?.find((e) => e.connected) || (ai?.connected ? { label: ai.fake ? "El modelo de prueba" : "Tu cuenta" } : null);
  const submit = async (e) => {
    e.preventDefault();
    if (busy || !clean(key)) return;
    setBusy(true); setError(null);
    try {
      await connectKey(engine, clean(key));
      setKey("");
      await onConnected();
    } catch (err) { setError(err.message); input.current?.focus(); }
    setBusy(false);
  };
  return (
    <>
      <h1 className="cl-title">Despierta a tus bots</h1>
      <p className="cl-lead">Tus bots piensan con tu cuenta de IA. Hasta que conectes una, duermen.</p>
      {connected ? (
        <>
          <p className="cl-done" role="status"><CircleCheck size={18} style={{ flex: "none" }} /><span><b>{connected.label || "Tu IA"}</b> está conectada. Tus bots ya pueden trabajar para ti.</span></p>
          <div className="cl-actions"><button type="button" className="cl-btn" onClick={next} autoFocus>Conocer a mis bots<ArrowRight size={16} /></button></div>
        </>
      ) : (
        <form className="cl-form" onSubmit={submit}>
          <fieldset className="cl-choices" aria-describedby="ai-terms">
            <legend className="cl-label" style={{ marginBottom: 8 }}>Elige tu IA</legend>
            {PROVIDERS.map((x) => (
              <label key={x.id} className="cl-choice">
                <input type="radio" name="engine" value={x.id} checked={engine === x.id} onChange={() => { setEngine(x.id); setError(null); }} />
                <ProviderMark engine={x.id} size={24} tile={false} />{x.name}
              </label>
            ))}
          </fieldset>
          <p className="cl-note" id="ai-terms">En la web se conecta con una clave de API: las condiciones de OpenAI y Anthropic no permiten usar tu suscripción de ChatGPT o Claude en un servicio como este. Tu suscripción sí funciona en la app de escritorio de Colmena, en tu ordenador.</p>
          <label className="cl-field">
            <span className="cl-label">{`Clave de API de ${p.name}`}</span>
            <input ref={input} className="cl-input mono" type="password" autoComplete="off" spellCheck={false} placeholder={p.placeholder} value={key} onChange={(e) => setKey(e.target.value)}
              aria-invalid={error ? "true" : undefined} aria-describedby={error ? "ai-error" : "ai-where"} />
            <span className="cl-note" id="ai-where">Créala en <a href={p.url} target="_blank" rel="noopener noreferrer">{p.site}<ExternalLink size={12} style={{ verticalAlign: "-1px", marginLeft: 3 }} /></a>. La comprobamos ahora y se guarda cifrada; solo se ven sus últimos 4 caracteres.</span>
          </label>
          {error ? <p id="ai-error" className="cl-error" role="alert"><CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />{error}</p> : null}
          <details className="cl-help">
            <summary>¿No tienes clave? Cómo conseguirla</summary>
            <ol>
              <li><b>OpenAI</b>: entra en <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">platform.openai.com/api-keys</a>, pulsa «Create new secret key» y cópiala. Pagas por uso: añade saldo en Billing.</li>
              <li><b>Anthropic</b>: entra en <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com</a>, pulsa «Create Key» y cópiala. También es pago por uso.</li>
              <li>Pégala aquí. Puedes cambiarla cuando quieras en Ajustes › Tu cuenta de IA.</li>
            </ol>
          </details>
          <div className="cl-actions" style={{ marginTop: 6 }}>
            <button className="cl-btn" type="submit" disabled={busy || !clean(key)}>{busy ? "Comprobando…" : "Conectar y despertar"}{busy ? null : <ArrowRight size={16} />}</button>
            <button type="button" className="cl-skip" onClick={skip}>Ahora no</button>
          </div>
        </form>
      )}
    </>
  );
}

/* ── 2. Your bots ───────────────────────────────────────────────────────── */
function BotsStep({ bots, awake, manager, workspace, reload, next, toAi }) {
  // Owners and admins meet the seeded team one by one (keep, rename, put aside) and may make a
  // bot of their own; others see the company's team.
  const seeded = bots.filter((b) => b.builtin);
  const [i, setI] = useState(0);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [making, setMaking] = useState(false);
  const bot = manager ? seeded[i] : null;
  useEffect(() => { if (bot) setName(bot.name); setError(null); }, [bot?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // The wake: when the AI is connected, the team wakes as this step opens.
  useEffect(() => { if (awake) hive("ok"); }, [awake]);
  const team = bots.map((b, k) => ({ kind: "bot", key: b.id, bot: b, asleep: !awake, off: b.enabled === false, lit: manager && k === bots.indexOf(bot), name: b.name, line: b.enabled === false ? "Apartado" : b.role, fresh: true }));
  const decide = async (keep) => {
    setBusy(true); setError(null);
    try {
      const change = {};
      if (keep && clean(name) && clean(name) !== bot.name) change.name = clean(name);
      if (keep && bot.enabled === false) change.enabled = true;
      if (!keep) change.enabled = false;
      if (Object.keys(change).length) await app(`/bots/${encodeURIComponent(bot.id)}`, "PATCH", change);
      await reload();
      if (i + 1 < seeded.length) setI(i + 1);
      else setMaking(true);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };
  const sleepNote = awake ? null : (
    <p className="cl-note" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px" }}>
      Están dormidos: conecta tu IA para despertarlos.
      {toAi ? <button type="button" className="cl-link" onClick={toAi}>Conectar mi IA</button> : null}
    </p>
  );
  if (!manager || !bot || making)
    return (
      <>
        <h1 className="cl-title">{manager ? "Un bot tuyo" : `Los bots de ${workspace}`}</h1>
        <p className="cl-lead">{manager ? "Además de los seis, puedes hacer uno para lo que tu empresa necesita. Dile cómo se llama y qué hace." : awake ? "Trabajan para quien les pide algo, con su propia cuenta de IA. Contigo ya están despiertos." : "Trabajan para quien les pide algo, con su propia cuenta de IA."}</p>
        {manager ? <OwnBot taken={bots} reload={reload} next={next} back={() => { setMaking(false); setI(seeded.length - 1); }} /> : (
          <>
            <Roster items={team} label={`Los bots de ${workspace}`} />
            <div style={{ marginTop: 14 }}>{sleepNote}</div>
            <div className="cl-actions"><button type="button" className="cl-btn" onClick={next} autoFocus>Siguiente<ArrowRight size={16} /></button></div>
          </>
        )}
      </>
    );
  const atlas = bot.id === "atlas";
  return (
    <>
      <h1 className="cl-title">Conoce a tus bots</h1>
      <p className="cl-lead" style={{ marginBottom: 18 }}>{`${i + 1} de ${seeded.length}. Quédate con los que te sirvan; puedes cambiarlos cuando quieras.`}</p>
      <div className="cl-stage" aria-live="polite">
        <BotCell bot={bot} asleep={!awake} size="lg" />
        <div className="cl-stage-text">
          <h2 className="cl-stage-name">{bot.name}</h2>
          <span className="cl-stage-role">{bot.role}{awake ? "" : " · dormido"}</span>
          <p className="cl-quote">«{introOf(bot)}»</p>
        </div>
      </div>
      <label className="cl-field">
        <span className="cl-label">Nombre</span>
        <input className="cl-input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {atlas ? <p className="cl-note" style={{ marginTop: 8 }}>Atlas coordina al equipo: siempre está.</p> : null}
      <Problem text={error} />
      {sleepNote ? <div style={{ marginTop: 12 }}>{sleepNote}</div> : null}
      <div className="cl-actions">
        <button type="button" className="cl-btn" onClick={() => decide(true)} disabled={busy || !clean(name)}>{busy ? "Guardando…" : clean(name) !== bot.name ? "Guardar y seguir" : "Me quedo con él"}{busy ? null : <ArrowRight size={16} />}</button>
        {atlas ? null : <button type="button" className="cl-btn ghost" onClick={() => decide(false)} disabled={busy}>Ahora no</button>}
        {i > 0 ? <button type="button" className="cl-skip" onClick={() => setI(i - 1)}><ArrowLeft size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />Anterior</button> : null}
        <button type="button" className="cl-skip" onClick={() => setMaking(true)}>Saltar al final</button>
      </div>
      <div style={{ marginTop: 22 }}><Roster items={team} label="Tu equipo" compact /></div>
    </>
  );
}

function OwnBot({ taken, reload, next, back }) {
  const [name, setName] = useState("");
  const [what, setWhat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [made, setMade] = useState(null);
  const color = OWN_COLORS.find((c) => !taken.some((b) => String(b.color).toUpperCase() === c)) || OWN_COLORS[0];
  const create = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const job = clean(what);
      const bot = await app("/bots", "POST", { name: clean(name), role: job.length > 40 ? job.slice(0, 39).trimEnd() + "…" : job, instructions: job.length >= 10 ? job : job + ". Ayuda al equipo con esto.", color, shape: "square" });
      setMade(bot);
      await reload();
    } catch (err) { setError(err.message); }
    setBusy(false);
  };
  if (made)
    return (
      <>
        <div className="cl-stage" role="status">
          <BotCell bot={made} size="lg" />
          <div className="cl-stage-text"><h2 className="cl-stage-name">{made.name}</h2><span className="cl-stage-role">{made.role}</span><p className="cl-quote">Ya está en tu equipo.</p></div>
        </div>
        <div className="cl-actions"><button type="button" className="cl-btn" onClick={next} autoFocus>Siguiente<ArrowRight size={16} /></button></div>
      </>
    );
  return (
    <form className="cl-form" onSubmit={create}>
      <label className="cl-field"><span className="cl-label">Nombre</span><input className="cl-input" maxLength={40} required placeholder="Por ejemplo, Lola" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="cl-field"><span className="cl-label">Qué hace</span><textarea className="cl-input" rows={3} maxLength={600} required placeholder="Por ejemplo, lleva las facturas y avisa de los pagos pendientes" value={what} onChange={(e) => setWhat(e.target.value)} style={{ padding: "12px 14px", lineHeight: 1.45, resize: "vertical" }} /></label>
      <Problem text={error} />
      <div className="cl-actions" style={{ marginTop: 6 }}>
        <button type="submit" className="cl-btn" disabled={busy || !clean(name) || clean(what).length < 4}><Plus size={16} />{busy ? "Creando…" : "Crear el bot"}</button>
        <button type="button" className="cl-skip" onClick={back}><ArrowLeft size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />Volver</button>
        <button type="button" className="cl-skip" onClick={next}>Ahora no</button>
      </div>
    </form>
  );
}

/* ── 3. Your team ───────────────────────────────────────────────────────── */
function TeamStep({ workspace, next, skip }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState([]);
  const [error, setError] = useState(null);
  const emails = [...new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
  const invite = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const sent = [], failed = [];
    for (const email of emails.slice(0, 20)) {
      try { const r = await auth.invite(email, "member"); sent.push(r.invitation.email); } catch (err) { failed.push(`${email}: ${err.message}`); }
    }
    setDone((d) => [...d, ...sent]);
    setText(failed.length ? failed.map((f) => f.split(":")[0]).join("\n") : "");
    setError(failed.length ? failed.join(" · ") : null);
    setBusy(false);
  };
  return (
    <>
      <h1 className="cl-title">Invita a tu equipo</h1>
      <p className="cl-lead">{`A cada persona le llega un enlace por correo. Entra en ${workspace} y aparece en #general, con los bots.`}</p>
      <form className="cl-form" onSubmit={invite}>
        <label className="cl-field">
          <span className="cl-label">Correos</span>
          <textarea className="cl-input" rows={3} autoComplete="off" spellCheck={false} placeholder={"lucia@empresa.com\nmarcos@empresa.com"} value={text} onChange={(e) => setText(e.target.value)} aria-describedby="team-note" style={{ padding: "12px 14px", lineHeight: 1.45, resize: "vertical" }} />
          <span className="cl-note" id="team-note">Uno por línea o separados por comas. Cada enlace solo sirve para su dirección y caduca en 7 días.</span>
        </label>
        <Problem text={error} />
        {done.length ? <p className="cl-done" role="status"><Check size={18} style={{ flex: "none" }} /><span>{done.length === 1 ? `Invitación enviada a ${done[0]}.` : `${done.length} invitaciones enviadas.`}</span></p> : null}
        <div className="cl-actions" style={{ marginTop: 6 }}>
          {done.length && !emails.length
            ? <button type="button" className="cl-btn" onClick={next} autoFocus>Siguiente<ArrowRight size={16} /></button>
            : <button type="submit" className="cl-btn" disabled={busy || !emails.length}><UserPlus size={16} />{busy ? "Invitando…" : emails.length > 1 ? `Invitar a ${emails.length}` : "Invitar"}</button>}
          <button type="button" className="cl-skip" onClick={done.length ? next : skip}>{done.length ? "Seguir sin más" : "Ahora no"}</button>
        </div>
      </form>
    </>
  );
}

/* ── 4. Arrival: a first request in #general ────────────────────────────── */
function ArrivalStep({ bots, awake, guest, workspace, finish, toAi }) {
  const helpers = bots.filter((b) => b.enabled !== false && b.id !== "atlas").slice(0, 2);
  const atlas = bots.find((b) => b.id === "atlas" && b.enabled !== false);
  const lead = atlas || helpers[0];
  const names = helpers.map((b) => b.name);
  const suggested = lead ? `Preséntanos al equipo: qué puede hacer cada bot por ${workspace}${names.length && lead === atlas ? `, empezando por ${names.join(" y ")}` : ""}. En cinco líneas.` : "";
  const [text, setText] = useState(suggested);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ask = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { channels = [] } = await app("/chat/channels");
      const general = channels.find((c) => c.name === "general") || channels[0];
      if (!general) throw Error("No encuentro #general. Entra y búscalo en Canales.");
      await app(`/chat/channels/${encodeURIComponent(general.id)}/messages`, "POST", { text: `<@bot:${lead.id}> ${clean(text)}` });
      await finish("/canal/" + encodeURIComponent(general.id));
    } catch (err) { setError(err.message); setBusy(false); }
  };
  if (guest || !lead)
    return (
      <>
        <h1 className="cl-title">{`Bienvenida a ${workspace}`}</h1>
        <p className="cl-lead">{guest ? "Como invitado lees y escribes en las conversaciones a las que te añadan. Lo que hagan los bots lo verás allí." : "Tu equipo te espera en #general."}</p>
        <div className="cl-actions"><button type="button" className="cl-btn" onClick={() => finish("/")} autoFocus>Entrar en Colmena<ArrowRight size={16} /></button></div>
      </>
    );
  return (
    <>
      <h1 className="cl-title">Pide algo a tu equipo</h1>
      <p className="cl-lead">{awake ? `Tu primera petición, en #general. ${lead.name} la reparte y contesta en el hilo.` : "Tus bots están dormidos: sin una cuenta de IA no pueden contestar."}</p>
      {awake ? (
        <form className="cl-form" onSubmit={ask}>
          <label className="cl-field">
            <span className="cl-label">{`Para @${lead.name}, en #general`}</span>
            <textarea className="cl-input" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} style={{ padding: "12px 14px", lineHeight: 1.45, resize: "vertical" }} />
          </label>
          <Problem text={error} />
          <div className="cl-actions" style={{ marginTop: 6 }}>
            <button type="submit" className="cl-btn" disabled={busy || !clean(text)}><Hash size={16} />{busy ? "Enviando…" : "Preguntar en #general"}</button>
            <button type="button" className="cl-skip" onClick={() => finish("/")}>Entrar sin preguntar</button>
          </div>
        </form>
      ) : (
        <div className="cl-actions">
          {toAi ? <button type="button" className="cl-btn" onClick={toAi} autoFocus>Conectar mi IA<ArrowRight size={16} /></button> : null}
          <button type="button" className={toAi ? "cl-skip" : "cl-btn"} onClick={() => finish("/")}>Entrar en Colmena</button>
        </div>
      )}
    </>
  );
}

export function Setup() {
  const [who, setWho] = useState(undefined);
  const [state, setState] = useState(null); // {bots, ai}
  const [step, setStep] = useState(null);
  const [error, setError] = useState(null);
  const card = useRef(null);
  const load = async () => {
    const [s, ai] = await Promise.all([app("/state"), app("/cloud/ai").catch(() => null)]);
    setState({ bots: (s?.bots || []).filter((b) => !b.archived), ai: ai || { connected: !!s?.ai?.mine, fake: !!s?.ai?.fake }, onboarding: s?.cloud?.onboarding || null, workspace: s?.cloud?.workspace?.name || "" });
    return s;
  };
  useEffect(() => {
    me().then(async (m) => {
      if (!m?.user) { location.replace("/entrar?next=/empezar"); return; }
      if (!m.current) { location.replace("/empresa"); return; }
      setWho(m);
      try {
        const s = await load();
        const steps = stepsFor(m.current.role);
        const saved = s?.cloud?.onboarding;
        const first = saved?.started && steps.includes(saved.step) ? saved.step : steps[0];
        setStep(first);
        if (!saved?.started) app("/cloud/onboarding", "PUT", { step: first }).catch(() => {});
      } catch (e) { setError(e.message); }
    }, (e) => setError(e.message));
  }, []);
  const role = who?.current?.role;
  const steps = useMemo(() => stepsFor(role), [role]);
  const awake = !!(state?.ai?.connected || state?.ai?.engines?.some((e) => e.connected));
  // Focus moves to the new step's heading, so a screen reader hears where it is (not on arrival:
  // the first field keeps its own focus there).
  const moved = useRef(false);
  useEffect(() => {
    if (!step) return;
    if (!moved.current) { moved.current = true; return; }
    const h = card.current?.querySelector("h1");
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: false }); }
  }, [step]);
  const go = (to) => { setStep(to); app("/cloud/onboarding", "PUT", { step: to }).catch(() => {}); };
  const nextOf = (s) => steps[steps.indexOf(s) + 1] || null;
  const finish = async (to) => {
    await app("/cloud/onboarding", "PUT", { step: "llegada", finished: true }).catch(() => {});
    location.assign(to);
  };
  const right = who?.user ? <button type="button" className="cl-skip" onClick={() => finish("/")}>Ir a Colmena</button> : null;
  if (!who || !state || !step)
    return <Shell right={right}>{error ? <Problem text={error} /> : <><div className="cl-skeleton" style={{ width: "60%", height: 28, marginBottom: 14 }} /><div className="cl-skeleton" style={{ width: "90%" }} /></>}</Shell>;
  const workspace = state.workspace || who.current.name;
  const hiveBots = state.bots.filter((b) => b.enabled !== false).map((b) => ({ id: b.id, name: b.name, role: b.role, shape: b.shape, color: b.color }));
  const toAi = steps.includes("ia") ? () => go("ia") : null;
  return (
    <Shell right={right} bots={hiveBots.length ? hiveBots : SEEDED_TEAM} asleep={!awake}>
      <div ref={card} className="cl-setup">
        <Steps steps={steps} at={step} />
        {step === "ia" ? <AiStep ai={state.ai} onConnected={async () => { await load(); hive("ok"); }} next={() => go(nextOf("ia"))} skip={() => go(nextOf("ia"))} />
          : step === "bots" ? <BotsStep bots={state.bots} awake={awake} manager={MANAGERS.has(role)} workspace={workspace} reload={load} next={() => go(nextOf("bots"))} toAi={toAi} />
          : step === "equipo" ? <TeamStep workspace={workspace} next={() => go(nextOf("equipo"))} skip={() => go(nextOf("equipo"))} />
          : <ArrivalStep bots={state.bots} awake={awake} guest={role === "guest"} workspace={workspace} finish={finish} toAi={toAi} />}
      </div>
    </Shell>
  );
}
