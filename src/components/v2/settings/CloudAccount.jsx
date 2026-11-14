import { useEffect, useRef, useState } from "react";
import ProviderMark from "../ProviderMark.jsx";
import { Check, Copy, ExternalLink } from "../../Icon.js";
import { useAction, useResource, useStore } from "../../../lib/store.jsx";
import { del, post } from "../../../lib/api.js";
import { later } from "../../../lib/undoToast.js";
import { ENGINE_NAMES, KEY_ENGINES } from "../../../lib/engineNames.js";
import { Alert, Chip, LINE, UNDO_MS, anchorOf, btn, danger, field, mono } from "./v3.jsx";
import { ClaudePanel, OpenCodePanel, Warning } from "./Engines.jsx";
import { ConnectOther, KeyPanel } from "./OtherAis.jsx";

// Ajustes › «Tu cuenta de IA» in hosted Colmena (docs/CLOUD.md › Phase 3; src/lib/cloud.js): the
// AI accounts of the person signed in. A bot's turn uses the account of whoever asked it, so its
// limits and errors are theirs. GET /api/cloud/ai says what is connected and what the company
// allows: ChatGPT by device code and the Claude setup-token only when an admin turned them on
// (Empresa › IA), each with the providers' warning. Nothing here exists on the desktop.

const INSET = "clamp(20px, 12vw, 80px)"; // under the name on a laptop, full width on a phone
const PAD = `16px 20px 20px ${INSET}`;
const IDLE = {
  openai: "Con una clave de API de OpenAI (pagas por uso).",
  anthropic: "Opus, Sonnet y Haiku, con una clave de API de Anthropic.",
  "opencode-go": "Modelos abiertos a precio fijo, con tu clave de OpenCode.",
};

/** One account: mark, name, what is connected, and its panel below when open. */
function Account({ id, info, note, children, disconnect = null, open, setOpen }) {
  const connected = !!info?.connected;
  const name = info?.label || ENGINE_NAMES[id];
  return (
    <div {...anchorOf({ openai: "chatgpt", anthropic: "claude", "opencode-go": "opencode" }[id] || id)} style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)", scrollMarginTop: "24px", overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", padding: "18px 20px" }}>
        <ProviderMark engine={id} size={44} style={{ background: "var(--c-chip)", borderRadius: "var(--r-md)" }} />
        <span style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "var(--t-read)", fontWeight: 600 }}>{name}<Chip tone={connected ? "green" : "quiet"}>{connected ? "Conectada" : "Sin conectar"}</Chip></span>
          <span role="status" style={{ fontSize: "var(--t-ui)", color: info?.limit || info?.resting ? "var(--c-honey-text)" : "var(--c-text-2)", overflowWrap: "anywhere" }}>{note}</span>
        </span>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={btn(open ? "outline" : connected ? "outline" : "dark", 38)}>{open ? "Cerrar" : connected ? "Gestionar" : "Conectar"}</button>
      </div>
      {open ? children : null}
      {open && connected && disconnect ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 16px", padding: `12px 20px 16px ${INSET}`, borderTop: LINE }}>
          <span style={{ flex: "1 1 220px", fontSize: "var(--t-ui)", lineHeight: 1.5, color: "var(--c-text-3)" }}>Si la desconectas, los bots no podrán trabajar para ti con ella.</span>
          <button type="button" onClick={disconnect} style={danger(34)}>Desconectar</button>
        </div>
      ) : null}
    </div>
  );
}

/** The OpenAI API key (POST /api/auth/apikey). */
function OpenAiKey({ onDone }) {
  const act = useAction();
  const [key, setKey] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); act.act(() => post("/auth/apikey", { key: key.trim() })).then((r) => r?.ok && onDone()); }} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={{ fontSize: "var(--t-ui)", lineHeight: 1.6, color: "var(--c-text-3)" }}>
        Créala en <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" style={{ color: "var(--c-text)", fontWeight: 600 }}>platform.openai.com</a>. Pagas por uso; se guarda cifrada en la nube de tu empresa.
      </span>
      <span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <input type="password" autoComplete="off" spellCheck={false} aria-label="Clave de API de OpenAI" placeholder="sk-…" value={key} onChange={(e) => setKey(e.target.value)} style={{ ...field, width: "auto", flex: "1 1 220px", height: "40px", fontFamily: mono }} />
        <button type="submit" disabled={act.busy || key.trim().length < 20} style={btn("dark", 40)}>{act.busy ? "Comprobando…" : "Conectar"}</button>
      </span>
      <Alert>{act.error}</Alert>
    </form>
  );
}

/** ChatGPT by device code: the code, big; where to type it; polled until it is connected. */
function ChatGptCode({ warning }) {
  const { run } = useStore();
  const act = useAction();
  const [code, setCode] = useState(null); // {userCode, verificationUrl, interval, expiresAt}
  const [state, setState] = useState(null); // "expired" | "connected"
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!code) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const r = await post("/cloud/ai/chatgpt/device/poll");
        if (!alive) return;
        if (r?.status === "connected") { setCode(null); setState("connected"); run(async () => null).catch(() => {}); return; }
        if (r?.status === "expired" || r?.status === "none") { setCode(null); setState("expired"); return; }
        timer.current = setTimeout(tick, Math.max(3, Number(r?.interval) || code.interval || 5) * 1000);
      } catch (e) {
        if (alive) { setCode(null); setError(e.message); }
      }
    };
    timer.current = setTimeout(tick, Math.max(3, code.interval || 5) * 1000);
    return () => { alive = false; clearTimeout(timer.current); };
  }, [code, run]);
  const start = () => { setError(null); setState(null); act.act(() => post("/cloud/ai/chatgpt/device")).then((r) => r?.userCode && setCode(r)); };
  const copy = async () => { try { await navigator.clipboard.writeText(code.userCode); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch {} };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <Warning text={warning} />
      {code ? (
        <div role="status" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--c-sunken)" }}>
          <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-2)" }}>Abre la página de OpenAI, inicia sesión y escribe este código:</span>
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
            <strong style={{ font: `600 clamp(24px, 7vw, 34px)/1.1 ${mono}`, letterSpacing: ".08em", color: "var(--c-text)", overflowWrap: "anywhere" }}>{code.userCode}</strong>
            <button type="button" onClick={copy} aria-label={copied ? "Copiado" : "Copiar el código"} title={copied ? "Copiado" : "Copiar"} style={btn("ghost", 34)}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copied ? "Copiado" : "Copiar"}</button>
          </span>
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px" }}>
            <a href={code.verificationUrl} target="_blank" rel="noopener noreferrer" style={btn("dark", 40)}>Abrir la página de OpenAI<ExternalLink size={14} aria-hidden="true" /></a>
            <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>Esperando a que lo escribas… El código caduca en 15 minutos.</span>
          </span>
          <button type="button" onClick={() => setCode(null)} style={{ ...btn("ghost", 32), alignSelf: "flex-start" }}>Cancelar</button>
        </div>
      ) : (
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px" }}>
          <button type="button" disabled={act.busy} onClick={start} style={btn("outline", 40)}>{act.busy ? "Pidiendo el código…" : "Iniciar sesión con ChatGPT (código)"}</button>
          {state === "expired" ? <span role="status" style={{ fontSize: "var(--t-ui)", color: "var(--c-honey-text)" }}>El código ha caducado. Pide otro.</span> : null}
          {state === "connected" ? <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "var(--t-ui)", color: "var(--c-ok-ink)" }}><Check size={16} aria-hidden="true" />Conectada</span> : null}
        </span>
      )}
      <Alert>{error || act.error}</Alert>
    </div>
  );
}

export default function CloudAccount() {
  const { ai = null } = useStore();
  const { data, error } = useResource("/cloud/ai");
  const act = useAction();
  const [open, setOpen] = useState(null);
  const policy = data?.policy || ai?.policy || {};
  const warnings = data?.warnings || {};
  const engines = data?.engines || [];
  const engine = (id) => engines.find((e) => e.id === id) || { id, connected: false, label: ENGINE_NAMES[id] };
  const fake = data?.fake ?? ai?.fake;
  const toggle = (id) => (on) => setOpen(on ? id : null);

  const disconnect = (id, kind) => () => later({
    id: "engine:" + id, keys: ["engine:" + id], ms: UNDO_MS, text: `${engine(id).label || ENGINE_NAMES[id]} se desconecta`, error: "No se pudo desconectar",
    run: () => act.act(() => del("/auth/provider?kind=" + encodeURIComponent(kind))),
  });

  const gpt = engine("openai");
  const viaChatGpt = gpt.connected && !!data?.chatgpt;
  const gptNote = gpt.limit ? `Ha llegado a su ${gpt.limit.label || "límite de uso"}. Es tu límite: los bots esperan o usan otra de tus cuentas.`
    : viaChatGpt ? `ChatGPT · ${data.chatgpt.email || "tu cuenta"}${data.chatgpt.plan ? " · plan " + data.chatgpt.plan : ""}`
    : gpt.connected ? gpt.detail || "Clave de API"
    : IDLE.openai;
  const claude = engine("anthropic");
  const claudeWays = ["api_key", ...(policy.claudeToken ? ["token"] : [])];
  const note = (e) => (e.limit ? `Ha llegado a su ${e.limit.label || "límite de uso"}. Es tu límite: los bots esperan o usan otra de tus cuentas.` : e.resting ? "Descansa unos minutos: ha llegado a su límite." : e.connected ? e.detail || "Conectada" : IDLE[e.id] || "");

  return (
    <>
      <p style={{ margin: 0, fontSize: "var(--t-ui)", lineHeight: 1.55, color: "var(--c-text-2)" }}>
        Los bots usan la cuenta de IA de quien les pide algo: cuando trabajan para ti, los límites y los errores son los de tu cuenta.
      </p>
      {fake ? <p role="note" style={{ margin: 0, alignSelf: "flex-start", padding: "6px 10px", borderRadius: "var(--r-sm)", background: "var(--c-chip)", fontSize: "var(--t-meta)", color: "var(--c-text-2)" }}>Este espacio usa el modelo de prueba.</p> : null}
      <Alert>{error || act.error}</Alert>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <Account id="openai" info={gpt} note={gptNote} open={open === "openai"} setOpen={toggle("openai")} disconnect={disconnect("openai", viaChatGpt ? "chatgpt" : "apikey")}>
          {!gpt.connected ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px", padding: PAD, borderTop: LINE }}>
              <OpenAiKey onDone={() => setOpen(null)} />
              {policy.chatgptLogin ? <ChatGptCode warning={warnings.chatgpt} /> : null}
            </div>
          ) : null}
        </Account>
        <Account id="anthropic" info={claude} note={note(claude)} open={open === "anthropic"} setOpen={toggle("anthropic")} disconnect={disconnect("anthropic", "anthropic")}>
          {!claude.connected ? <ClaudePanel key={claudeWays.join()} ways={claudeWays} warning={warnings.claude} onDone={() => setOpen(null)} style={{ padding: PAD, borderBottom: 0, borderTop: LINE }} /> : null}
        </Account>
        <Account id="opencode-go" info={engine("opencode-go")} note={note(engine("opencode-go"))} open={open === "opencode-go"} setOpen={toggle("opencode-go")} disconnect={disconnect("opencode-go", "opencode-go")}>
          {!engine("opencode-go").connected ? <OpenCodePanel onDone={() => setOpen(null)} style={{ padding: PAD, borderBottom: 0, borderTop: LINE }} /> : null}
        </Account>
        {KEY_ENGINES.filter((id) => engine(id).connected).map((id) => (
          <Account key={id} id={id} info={engine(id)} note={note(engine(id))} open={open === id} setOpen={toggle(id)} disconnect={disconnect(id, id)}>
            <KeyPanel engine={id} mode="manage" info={engine(id)} catalog={[]} style={{ padding: `16px 20px 4px ${INSET}`, borderTop: LINE }} />
          </Account>
        ))}
        <ConnectOther engines={engines} catalog={{}} />
      </div>
    </>
  );
}
