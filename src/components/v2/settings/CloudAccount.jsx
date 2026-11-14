import { useState } from "react";
import ProviderMark from "../ProviderMark.jsx";
import { useAction, useResource, useStore } from "../../../lib/store.jsx";
import { del, post, put } from "../../../lib/api.js";
import { later } from "../../../lib/undoToast.js";
import { ENGINE_NAMES, KEY_ENGINES } from "../../../lib/engineNames.js";
import { Alert, Chip, LINE, UNDO_MS, anchorOf, btn, danger, field, mono } from "./v3.jsx";
import { ClaudePanel, OpenCodePanel } from "./Engines.jsx";
import SubscriptionSignIn from "../../SubscriptionSignIn.jsx";
import DesktopRoute from "../../DesktopRoute.jsx";
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

/** One of the two ways to connect ChatGPT or Claude, under its own small heading. */
function Way({ title, sub, children }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <h3 style={{ margin: 0, display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 10px", font: "600 var(--t-ui)/1.3 'Geist', sans-serif", color: "var(--c-text)" }}>{title}<span style={{ fontWeight: 400, fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{sub}</span></h3>
      {children}
    </section>
  );
}

export default function CloudAccount() {
  const { ai = null, run } = useStore();
  const { data, error } = useResource("/cloud/ai");
  // The sign-in flows speak to the workspace with the app's own helper; done, the state reloads.
  const call = (path, _method, body) => post(path, body);
  const signedIn = () => { setOpen(null); run(async () => null).catch(() => {}); };
  const act = useAction();
  const [open, setOpen] = useState(null);
  const policy = data?.policy || ai?.policy || {};
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
              <Way title="Con clave de API" sub="Pagas por uso"><OpenAiKey onDone={() => setOpen(null)} /></Way>
              <Way title="Con tu suscripción de ChatGPT" sub="Recomendado: desde la app de escritorio"><DesktopRoute plan="ChatGPT" compact /></Way>
              {policy.chatgptLogin !== false ? <Way title="Iniciar sesión con ChatGPT aquí" sub="En la web"><SubscriptionSignIn provider="chatgpt" info={data} call={call} onConnected={signedIn} /></Way> : null}
            </div>
          ) : null}
        </Account>
        <Account id="anthropic" info={claude} note={note(claude)} open={open === "anthropic"} setOpen={toggle("anthropic")} disconnect={disconnect("anthropic", "anthropic")}>
          {!claude.connected ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px", padding: PAD, borderTop: LINE }}>
              <Way title="Con clave de API" sub="Pagas por uso"><ClaudePanel ways={["api_key"]} onDone={() => setOpen(null)} style={{ padding: 0, border: 0 }} /></Way>
              <Way title="Con tu suscripción de Claude" sub="Recomendado: desde la app de escritorio"><DesktopRoute plan="Claude" compact /></Way>
              {policy.claudeToken !== false ? <Way title="Iniciar sesión con Claude aquí" sub="En la web"><SubscriptionSignIn provider="claude" info={data} call={call} onConnected={signedIn} /></Way> : null}
            </div>
          ) : null}
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
      <CodeAndApps />
    </>
  );
}

/**
 * Phase 4: «Código» in the cloud runs with your API key (never a subscription), your GitHub token
 * (or the company's) and, if you turn it on, your own connected apps instead of the company's.
 */
function CodeAndApps() {
  const { data: gh } = useResource("/cloud/github");
  const { data: apps } = useResource("/cloud/apps/mine");
  const act = useAction();
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(null);
  const [mineOn, setMineOn] = useState(null);
  const on = mineOn ?? !!apps?.on;
  const saveToken = (e) => {
    e.preventDefault();
    setSaved(null);
    act.act(() => put("/cloud/github", { scope: "mine", token: token.trim() })).then((r) => { if (!r?.ok) return; setSaved(token.trim() ? "Token guardado." : "Token quitado."); setToken(""); }, () => {});
  };
  const flip = () => act.act(() => put("/cloud/apps/mine", { on: !on })).then((r) => { if (r) setMineOn(!!r.on); }, () => {});
  return (
    <section aria-labelledby="ca-code" style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px" }}>
      <h3 id="ca-code" style={{ margin: 0, fontSize: "var(--t-body)", fontWeight: 600 }}>Código y apps en la nube</h3>
      <p style={{ margin: 0, fontSize: "var(--t-ui)", lineHeight: 1.55, color: "var(--c-text-2)" }}>
        «Código» trabaja en la máquina de tu empresa con tu clave de API de Anthropic, OpenAI u OpenCode. Las suscripciones de Claude y ChatGPT no se pueden usar en un servicio alojado: sus condiciones lo prohíben.
      </p>
      <form onSubmit={saveToken} style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "flex-end" }}>
        <label style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: "6px", fontSize: "var(--t-meta)", color: "var(--c-text-2)" }}>
          Tu token de GitHub {gh?.mine ? "(guardado)" : gh?.company ? "(si no pones uno, se usa el de la empresa)" : ""}
          <input type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => { setToken(e.target.value); setSaved(null); }} placeholder={gh?.mine ? "Pega otro para cambiarlo, o guarda vacío para quitarlo" : "ghp_… o github_pat_…"} style={{ ...field, width: "100%", boxSizing: "border-box", height: "40px", fontFamily: mono }} />
        </label>
        <button type="submit" disabled={act.busy || (!token.trim() && !gh?.mine)} style={btn("dark", 40)}>{token.trim() || !gh?.mine ? "Guardar" : "Quitar"}</button>
      </form>
      {saved ? <p role="status" style={{ margin: 0, fontSize: "var(--t-meta)", color: "var(--c-ok-ink)" }}>{saved}</p> : null}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px" }}>
          <strong id="ca-apps" style={{ fontSize: "var(--t-ui)" }}>Mis propias apps</strong>
          <p style={{ margin: "2px 0 0", fontSize: "var(--t-meta)", lineHeight: 1.5, color: "var(--c-text-2)" }}>Activado, tus bots usan las cuentas que conectes tú (tu Gmail, tu calendario…) en vez de las de la empresa.</p>
        </div>
        <button type="button" role="switch" aria-checked={on} aria-labelledby="ca-apps" disabled={act.busy} onClick={flip} style={btn(on ? "dark" : "ghost", 36)}>{on ? "Activado" : "Desactivado"}</button>
      </div>
      <Alert>{act.error}</Alert>
    </section>
  );
}
