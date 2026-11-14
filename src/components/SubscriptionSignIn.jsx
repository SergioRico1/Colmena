import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink } from "./Icon.js";

// «Iniciar sesión con ChatGPT / con Claude» in hosted Colmena (server/cloud/ai.mjs): the second way
// to connect an AI, beside the API key, in the guided start (src/cloud/Setup.jsx) and in Ajustes ›
// Tu cuenta de IA (settings/CloudAccount.jsx). Pluggable: `call(path, method, body)` is each
// screen's own request helper, and `FLOWS` says how each provider signs in, so another route can
// replace one without touching the screens.
//   chatgpt  the Codex device code: a code to type at OpenAI's page, polled until it is connected
//   claude   the token `claude setup-token` makes on the person's computer, checked live
// Before either, the person confirms one honest line about the provider's terms («Entendido,
// conectar»); the server keeps that consent per person and provider and refuses without it.

export const FLOWS = Object.freeze({
  chatgpt: { kind: "device", name: "ChatGPT", company: "OpenAI" },
  claude: { kind: "token", name: "Claude", company: "Anthropic" },
});
const CLAUDE_CODE_SETUP = "https://code.claude.com/docs/en/setup";
const mono = "'Geist Mono', ui-monospace, monospace";
const box = { display: "flex", flexDirection: "column", gap: "12px" };
const note = { margin: 0, fontSize: "var(--t-meta)", lineHeight: 1.5, color: "var(--c-text-3)" };
const strongBtn = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", minHeight: "40px", padding: "0 16px", border: 0, borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", font: "600 var(--t-ui)/1 'Geist', sans-serif", cursor: "pointer", textDecoration: "none" };
const quietBtn = { ...strongBtn, background: "transparent", color: "var(--c-text)", border: "1px solid var(--c-line-strong)" };
const field = { width: "100%", minWidth: 0, minHeight: "44px", padding: "0 14px", border: "1px solid var(--c-line-strong)", borderRadius: "var(--r-md)", background: "var(--c-card)", color: "var(--c-text)", font: `500 var(--t-ui)/1 ${mono}`, boxSizing: "border-box" };
const Alert = ({ children }) => (children ? <p role="alert" style={{ margin: 0, padding: "10px 12px", borderRadius: "var(--r-md)", background: "var(--c-error-soft)", color: "var(--c-error)", fontSize: "var(--t-meta)" }}>{children}</p> : null);
const clean = (v) => String(v).replace(/[\s ​-‍⁠﻿­]+/g, "");

/** The one line and «Entendido, conectar». */
function Consent({ line, onAccept, busy }) {
  return (
    <div style={box}>
      <p style={{ ...note, color: "var(--c-text-2)" }}>{line}</p>
      <span><button type="button" onClick={onAccept} disabled={busy} style={strongBtn}>{busy ? "Un momento…" : "Entendido, conectar"}</button></span>
    </div>
  );
}

function DeviceCode({ call, onConnected }) {
  const [code, setCode] = useState(null); // {userCode, verificationUrl, interval}
  const [state, setState] = useState(null); // "expired"
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!code) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const r = await call("/cloud/ai/chatgpt/device/poll", "POST", {});
        if (!alive) return;
        if (r?.status === "connected") { setCode(null); onConnected?.(r); return; }
        if (r?.status === "expired" || r?.status === "none") { setCode(null); setState("expired"); return; }
        timer.current = setTimeout(tick, Math.max(3, Number(r?.interval) || code.interval || 5) * 1000);
      } catch (e) { if (alive) { setCode(null); setError(e.message); } }
    };
    timer.current = setTimeout(tick, Math.max(3, code.interval || 5) * 1000);
    return () => { alive = false; clearTimeout(timer.current); };
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = async () => {
    setBusy(true); setError(null); setState(null);
    try { setCode(await call("/cloud/ai/chatgpt/device", "POST", {})); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(code.userCode); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch {} };
  if (code)
    return (
      <div style={box} role="status">
        <p style={{ ...note, color: "var(--c-text-2)" }}>Abre la página de OpenAI, inicia sesión con tu cuenta de ChatGPT y escribe este código:</p>
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
          <strong style={{ font: `600 clamp(24px, 7vw, 32px)/1.1 ${mono}`, letterSpacing: ".08em", color: "var(--c-text)" }}>{code.userCode}</strong>
          <button type="button" onClick={copy} style={{ ...quietBtn, minHeight: "36px" }}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copied ? "Copiado" : "Copiar"}</button>
        </span>
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px" }}>
          <a href={code.verificationUrl} target="_blank" rel="noopener noreferrer" style={strongBtn}>Abrir la página de OpenAI<ExternalLink size={14} aria-hidden="true" /></a>
          <span style={{ ...note, display: "inline-flex", alignItems: "center", gap: "8px" }}><i aria-hidden="true" className="sub-wait" />Esperando a que lo escribas. Caduca en 15 minutos.</span>
        </span>
        <span><button type="button" onClick={() => setCode(null)} style={{ ...quietBtn, minHeight: "36px" }}>Cancelar</button></span>
      </div>
    );
  return (
    <div style={box}>
      <ol style={{ ...note, margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "4px", color: "var(--c-text-2)" }}>
        <li>En ChatGPT, abre Ajustes › Seguridad y activa el inicio de sesión con código de dispositivo.</li>
        <li>Pide aquí tu código y escríbelo en la página de OpenAI. Esta pantalla sigue sola.</li>
      </ol>
      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px" }}>
        <button type="button" onClick={start} disabled={busy} style={strongBtn}>{busy ? "Pidiendo el código…" : "Pedir mi código"}</button>
        {state === "expired" ? <span role="status" style={{ ...note, color: "var(--c-text-2)" }}>El código caducó. Pide otro.</span> : null}
      </span>
      <Alert>{error}</Alert>
    </div>
  );
}

function SetupToken({ call, onConnected }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (!clean(token)) { setError("Pega el token que te dio «claude setup-token»."); return; }
    setBusy(true); setError(null);
    try { await call("/auth/anthropic", "POST", { method: "token", secret: clean(token) }); setToken(""); onConnected?.(); } catch (err) { setError(err.message); }
    setBusy(false);
  };
  return (
    <form onSubmit={submit} style={box}>
      <ol style={{ ...note, margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px", color: "var(--c-text-2)" }}>
        <li>Si no tienes Claude Code, <a href={CLAUDE_CODE_SETUP} target="_blank" rel="noopener noreferrer" style={{ color: "var(--c-accent-ink)" }}>instálalo<ExternalLink size={12} aria-hidden="true" style={{ verticalAlign: "-1px", marginLeft: 3 }} /></a>.</li>
        <li>En tu ordenador, abre una terminal y ejecuta <code style={{ font: `500 var(--t-meta) ${mono}`, padding: "1px 6px", borderRadius: "var(--r-xs)", background: "var(--c-chip)", color: "var(--c-text)" }}>claude setup-token</code>. Se abre el navegador para que entres con tu cuenta de Claude.</li>
        <li>Pega aquí el token que te muestra (empieza por <span style={{ font: `500 var(--t-meta) ${mono}` }}>sk-ant-oat01-</span>).</li>
      </ol>
      <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <span style={{ font: "500 var(--t-meta)/1.3 'Geist', sans-serif", color: "var(--c-text-2)" }}>Token de Claude</span>
        <input type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-oat01-…" value={token} onChange={(e) => setToken(e.target.value)} aria-invalid={error ? "true" : undefined} style={field} />
      </label>
      <Alert>{error}</Alert>
      <span><button type="submit" disabled={busy} style={strongBtn}>{busy ? "Comprobando…" : "Conectar mi Claude"}</button></span>
    </form>
  );
}

/**
 * The whole second way for one provider: the consent line until it is given, then the flow.
 * `info`: GET /api/cloud/ai ({consent, consentLines, policy}); `onConnected` refreshes the screen.
 */
export default function SubscriptionSignIn({ provider, info, call, onConnected }) {
  const flow = FLOWS[provider];
  const [consented, setConsented] = useState(!!info?.consent?.[provider]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { if (info?.consent?.[provider]) setConsented(true); }, [info, provider]);
  if (!flow) return null;
  const allowed = provider === "chatgpt" ? info?.policy?.chatgptLogin !== false : info?.policy?.claudeToken !== false;
  if (!allowed) return <p style={note}>{`Quien administra la empresa ha desactivado el inicio de sesión con ${flow.name}. Usa una clave de API.`}</p>;
  if (!consented)
    return (
      <>
        <Consent line={info?.consentLines?.[provider] || `Usar tu suscripción de ${flow.name} desde un servicio alojado va contra las condiciones de ${flow.company}: pueden limitar tu cuenta.`} busy={busy}
          onAccept={async () => { setBusy(true); setError(null); try { await call("/cloud/ai/consent", "POST", { provider }); setConsented(true); } catch (e) { setError(e.message); } setBusy(false); }} />
        <Alert>{error}</Alert>
      </>
    );
  return flow.kind === "device" ? <DeviceCode call={call} onConnected={onConnected} /> : <SetupToken call={call} onConnected={onConnected} />;
}
