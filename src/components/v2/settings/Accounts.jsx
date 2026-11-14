import Select from "../../Select.jsx";
import { useEffect, useState } from "react";
import ProviderMark from "../ProviderMark.jsx";
import { Laptop, Pause } from "../../Icon.js";
import { ClaudePanel, OpenCodePanel } from "./Engines.jsx";
import { useAction, useStore } from "../../../lib/store.jsx";
import { del, patch, post } from "../../../lib/api.js";
import { later, reversible } from "../../../lib/undoToast.js";
import { useExpert } from "../../../lib/expert.js";
import { Advanced, Alert, BotMark, Card, Choices, Chip, Go, LINE, Meter, Panel, Row, Term, UNDO_MS, anchorOf, btn, danger, mono, select, useSettings } from "./v3.jsx";
import { disconnectAiText } from "./effects.js";
import { ConnectOther, KeyPanel } from "./OtherAis.jsx";
import { ENGINE_NAMES, KEY_ENGINES } from "../../../lib/engineNames.js";
import { isCloud } from "../../../lib/cloud.js";
import CloudAccount from "./CloudAccount.jsx";

// Ajustes › Cuentas de IA (design/V3AjustesIA.dc.html): the three accounts Colmena thinks with
// (ChatGPT; Claude through Claude Code, a setup-token or an API key; OpenCode Go), which one
// the team uses, which one covers when it fails or reaches its plan's limit (the work hands
// over with its context, server/providers), how hard they think and what each bot uses.
// Gemini, OpenRouter, DeepSeek, Kimi and a «Servidor propio» come in through «Conectar otra
// IA» (OtherAis.jsx) and, once connected, get their own card like the three above.

const ENGINES = ["openai", "anthropic", "opencode-go"];
const IDLE = {
  openai: "Colmena piensa con tu plan de ChatGPT. Inicia sesión para empezar.",
  anthropic: "Opus, Sonnet y Haiku. Con Claude Code, tu suscripción o una clave.",
  "opencode-go": "Modelos abiertos a precio fijo. Útil como tercer respaldo.",
};
const THINK = [["rapido", "Rápido", "Respuestas cortas y tareas simples"], ["equilibrado", "Equilibrado", "Lo normal para casi todo"], ["profundo", "A fondo", "Análisis largos y código difícil"]];
const THINK_LABEL = Object.fromEntries(THINK.map(([v, l]) => [v, l]));
const COLS = "minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, .9fr)";
const windowName = (m) => (!m ? "" : m === 10080 ? "esta semana" : m % 60 === 0 ? `de ${m / 60} h` : `de ${m} min`);
const hm = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : null; };
const small = { ...select, width: "100%", height: "32px", padding: "0 6px", fontSize: "var(--t-ui)" };

/** One account card: mark, name and its role, what it is, how much of the plan is gone, its button. */
function Provider({ id, info, primary, fallback, planLimits, login, engines, bots, catalog = [], pinned = "" }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const connected = !!info?.connected;
  useEffect(() => { if (connected) setOpen(false); }, [connected]);
  const name = info?.label || ENGINE_NAMES[id];
  const keyed = KEY_ENGINES.includes(id);
  const tag = !connected ? ["Sin conectar", "quiet"] : primary === id ? ["Principal", "dark"] : fallback === id ? ["Respaldo", "grey"] : ["Conectada", "grey"];
  const w = id === "openai" ? planLimits?.primary : null;
  const note = info?.limit ? `Ha llegado a su ${info.limit.label || "límite de uso"}${info.limit.resetsAt ? " · vuelve a las " + hm(info.limit.resetsAt) : ""}. Mientras, sigue el respaldo.`
    : info?.resting ? "Descansa unos minutos: ha llegado a su límite."
    : connected ? info.detail || "Conectada"
    : id === "openai" && login.waiting ? "Esperando a que inicies sesión en tu navegador…"
    : id === "openai" && login.error ? login.error : IDLE[id];
  const disconnect = () => later({
    id: "engine:" + id, keys: ["engine:" + id], ms: UNDO_MS, text: `${name} se desconecta`, error: "No se pudo desconectar",
    run: () => act.act(() => (id === "openai" ? post("/auth/logout") : del("/auth/provider?kind=" + id))),
  });
  const main = !connected
    ? (id === "openai"
      ? (login.waiting ? <button type="button" onClick={login.cancel} style={btn("outline", 38)}>Cancelar</button> : <button type="button" disabled={act.busy} onClick={login.start} style={btn("dark", 38)}>Conectar</button>)
      : <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={btn(open ? "outline" : "dark", 38)}>{open ? "Cancelar" : "Conectar"}</button>)
    : <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={btn("outline", 38)}>Gestionar</button>;
  return (
    <div {...anchorOf({ openai: "chatgpt", anthropic: "claude", "opencode-go": "opencode" }[id] || id)} style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)", scrollMarginTop: "24px", overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", padding: "18px 20px" }}>
        <ProviderMark engine={id} size={44} style={{ background: "var(--c-chip)", borderRadius: "var(--r-md)" }} />
        <span style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "var(--t-read)", fontWeight: 600 }}>{name}<Chip tone={tag[1]}>{tag[0]}</Chip></span>
          <span role="status" style={{ fontSize: "var(--t-ui)", color: info?.limit || info?.resting || login.waiting ? "var(--c-honey-text)" : id === "openai" && login.error && !connected ? "var(--c-error)" : "var(--c-text-2)" }}>{note}</span>
        </span>
        {w ? (
          <span style={{ flex: "0 1 180px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>
            <span>{`Usado ${w.usedPercent} % ${windowName(w.windowMinutes)}${w.resetsAt ? " · renueva " + hm(w.resetsAt) : ""}`}</span>
            <Meter percent={w.usedPercent} />
          </span>
        ) : null}
        {main}
      </div>
      {id === "openai" && login.waiting ? (
        <p style={{ margin: 0, padding: "0 20px 18px 80px", fontSize: "var(--t-ui)", lineHeight: 1.5, color: "var(--c-text-3)", animation: "fade .3s ease-out" }}>
          Hemos abierto la página oficial de inicio de sesión. Colmena nunca ve tu contraseña: recibe un permiso.{" "}
          <button type="button" onClick={() => window.open(login.waiting.url, "_blank", "noopener")} style={{ border: 0, padding: 0, background: "none", font: "inherit", color: "var(--c-text)", fontWeight: 600, textDecoration: "underline", cursor: "pointer" }}>Abrirla otra vez</button>
        </p>
      ) : null}
      {open && !connected && id === "anthropic" ? <ClaudePanel onDone={() => setOpen(false)} style={{ padding: "2px 20px 20px 80px", borderBottom: 0, borderTop: LINE, paddingTop: "16px" }} /> : null}
      {open && !connected && id === "opencode-go" ? <OpenCodePanel onDone={() => setOpen(false)} style={{ padding: "16px 20px 20px 80px", borderBottom: 0, borderTop: LINE }} /> : null}
      {open && connected && keyed ? <KeyPanel engine={id} mode="manage" info={{ ...info, pinned }} catalog={catalog} style={{ padding: "16px 20px 4px 80px", borderTop: LINE }} /> : null}
      {open && connected ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 16px", padding: keyed ? "12px 20px 16px 80px" : "14px 20px 16px 80px", borderTop: keyed ? 0 : LINE, animation: "fade .25s ease-out" }}>
          <span style={{ flex: "1 1 240px", display: "flex", flexDirection: "column", gap: "4px", fontSize: "var(--t-ui)", lineHeight: 1.5 }}>
            {id === "anthropic" && info.method ? <span style={{ color: "var(--c-text-2)" }}>{{ cli: "Conectada con la sesión de Claude Code de este ordenador.", token: "Conectada con un token de suscripción (claude setup-token).", api_key: "Conectada con una clave de API: pagas por uso." }[info.method] || null}</span> : null}
            <span style={{ color: "var(--c-text-3)" }}>{"Si la desconectas: " + disconnectAiText({ id, engines, primary, fallback, bots })}</span>
          </span>
          <button type="button" disabled={act.busy} onClick={disconnect} style={danger(34)}>Desconectar</button>
        </div>
      ) : null}
      {act.error ? <p role="alert" style={{ margin: 0, padding: "0 20px 14px 80px", fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{act.error}</p> : null}
    </div>
  );
}

/** The bot table: account, model and how hard each one thinks. */
function PerBot({ bots, engines, team, busy, setBot }) {
  const live = engines.filter((e) => e.connected);
  return (
    <Panel anchor="por-bot" style={{ gap: "4px", padding: "18px 22px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "10px", marginBottom: "6px" }}>
        <h3 style={{ margin: 0, fontSize: "var(--t-body)", fontWeight: 600 }}>Qué usa cada bot</h3>
        <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>Cambia uno solo si lo necesita.</span>
      </div>
      <div role="table" aria-label="Qué usa cada bot" className="r-rtable r-xbox" style={{ display: "flex", flexDirection: "column", overflowX: "auto" }}>
        <div role="row" style={{ display: "grid", gridTemplateColumns: COLS, gap: "12px", minWidth: "560px", padding: "8px 0", fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text-3)" }}>
          <span role="columnheader">Bot</span><span role="columnheader">Cuenta</span><span role="columnheader">Modelo</span><span role="columnheader">Piensa</span>
        </div>
        {bots.map((b) => {
          const own = live.find((e) => e.id === b.engine);
          return (
            <div role="row" key={b.id} style={{ display: "grid", gridTemplateColumns: COLS, gap: "12px", alignItems: "center", minWidth: "560px", minHeight: "44px", borderTop: "1px solid rgb(var(--c-ink-rgb) / .05)", fontSize: "var(--t-ui)" }}>
              <span role="rowheader" style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}><BotMark bot={b} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span></span>
              <span role="cell" data-label="Cuenta">
                {live.length > 1 ? (
                  <Select aria-label={"Cuenta de " + b.name} disabled={busy} value={own?.id || ""} onChange={(e) => setBot(b, { engine: e.target.value || null }, "cuenta")} style={small} options={[["", team ? `Como el equipo (${team.label})` : "Como el equipo"], ...live.map((e) => [e.id, e.label])]} />
                ) : own?.label || team?.label || "—"}
              </span>
              <span role="cell" data-label="Modelo" title={b.model?.reason ? "Elegido porque " + b.model.reason : undefined} style={{ font: `400 var(--t-meta)/1.2 ${mono}`, color: "var(--c-text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.model?.slug ? String(b.model.slug).replace(/^[a-z-]+\//, "") : "Sin modelo todavía"}</span>
              <span role="cell" data-label="Piensa">
                <Select aria-label={"Cuánto piensa " + b.name} disabled={busy} value={b.thinking || "equilibrado"} onChange={(e) => setBot(b, { thinking: e.target.value }, "piensa")} style={{ ...small, color: "var(--c-text-2)" }} options={THINK} />
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/** Hosted (src/lib/cloud.js): «Tu cuenta de IA», the signed-in person's own accounts. */
export default function AccountsSection() {
  return isCloud() ? <CloudAccount /> : <DesktopAccounts />;
}

function DesktopAccounts() {
  const { ai = null, provider, authError, models = [], bots = [], planLimits = null, run } = useStore();
  const { settings, save, error } = useSettings();
  const [expert] = useExpert();
  const act = useAction();
  const engines = ai?.engines || ENGINES.map((id) => ({ id, connected: id === "openai" && !!provider?.connected, label: ENGINE_NAMES[id] }));
  const engine = (id) => engines.find((e) => e.id === id) || null;
  // The model an account is pinned to for every family («Gestionar» › Modelo); "" = Automático.
  const pinOf = (id) => { const p = ai?.pins?.[id] || {}; return p.luna && p.luna === p.sol && p.sol === p.astra ? p.luna : ""; };
  const live = engines.filter((e) => e.connected);
  const primary = ai?.primary || live[0]?.id || null;
  const team = engine(primary);
  const list = bots.filter((b) => b.enabled !== false && b.audience !== "yo");

  // ChatGPT sign-in: the end of the flow arrives over SSE as a state refresh.
  const [waiting, setWaiting] = useState(null);
  const gptOn = !!engine("openai")?.connected;
  useEffect(() => { if (gptOn || authError) setWaiting(null); }, [gptOn, authError]);
  const login = {
    waiting,
    error: authError ? String(authError.message || authError) : null,
    start: () => act.act(async () => { const r = await post("/auth/start"); if (r?.url) { window.open(r.url, "_blank", "noopener"); setWaiting({ url: r.url }); } }),
    cancel: () => act.act(() => post("/auth/cancel")).then(() => setWaiting(null)),
  };

  const setEngines = (changes, text, back) => act.act(() => patch("/ai/engines", changes)).then(() => reversible({ id: "ai:" + Object.keys(changes).join(","), text, ms: UNDO_MS, undo: () => run(() => patch("/ai/engines", back)) }));
  // Every account is listed; one that cannot be chosen says why (Select's disabled reason).
  const mark = (id) => <ProviderMark engine={id} size={16} tile={false} />;
  const offWhy = (e) => (e.connected ? false : "No está conectada: conéctala arriba");
  const primaries = live.length ? engines.map((e) => ({ value: e.id, label: e.label, icon: mark(e.id), disabled: offWhy(e) })) : [["", "Ninguna todavía"]];
  const fallbacks = [
    ...engines.map((e) => ({ value: e.id, label: e.label, icon: mark(e.id), disabled: e.id === primary ? "Es la principal: el respaldo tiene que ser otra" : offWhy(e) })),
    ...(ai?.local ? [{ value: "local", label: "El modelo de este ordenador", icon: Laptop }] : []),
    { value: "none", label: "Nada: esperar", icon: Pause },
  ];
  const fallback = fallbacks.some((o) => o.value === ai?.fallback && !o.disabled) ? ai.fallback : "none";
  const gptModels = models.filter((m) => !String(m.slug).includes("/"));

  // «Cuánto piensan»: the team's way, set on every bot at once («Deshacer» puts each one back).
  const ways = new Set(list.map((b) => b.thinking || "equilibrado"));
  const think = ways.size === 1 ? [...ways][0] : null;
  const setBot = (b, change, what) => {
    const before = what === "cuenta" ? { engine: b.engine ?? null } : { thinking: b.thinking || "equilibrado" };
    act.act(() => patch(`/bots/${encodeURIComponent(b.id)}`, change)).then(() => reversible({ id: `bot:${b.id}:${what}`, text: `${b.name}: ${what === "cuenta" ? (engine(change.engine)?.label || "como el equipo") : "piensa " + THINK_LABEL[change.thinking].toLowerCase()}`, ms: UNDO_MS, undo: () => run(() => patch(`/bots/${encodeURIComponent(b.id)}`, before)) }));
  };
  const setThink = (v) => {
    const before = list.map((b) => [b.id, b.thinking || "equilibrado"]);
    act.act(async () => { for (const b of list) if ((b.thinking || "equilibrado") !== v) await patch(`/bots/${encodeURIComponent(b.id)}`, { thinking: v }); })
      .then(() => reversible({ id: "ai:thinking", text: `Tu equipo piensa: ${THINK_LABEL[v].toLowerCase()}`, ms: UNDO_MS, undo: () => run(async () => { for (const [id, t] of before) await patch(`/bots/${encodeURIComponent(id)}`, { thinking: t }); }) }));
  };

  return (
    <>
      <Alert>{error || act.error}</Alert>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {[...ENGINES, ...KEY_ENGINES.filter((id) => engine(id)?.connected)].map((id) => <Provider key={id} id={id} info={engine(id)} primary={primary} fallback={ai?.fallback} planLimits={planLimits} login={login} engines={engines} bots={list} catalog={ai?.catalog?.[id] || []} pinned={pinOf(id)} />)}
        <ConnectOther engines={engines} catalog={ai?.catalog || {}} />
      </div>

      <Card label="Qué usan">
        <Row as="label" first anchor="piensan-con" title="Piensan con" sub={live.length > 1 ? "La cuenta que usan por defecto." : live.length ? "Es la única conectada. Conecta otra arriba para poder elegir." : "Conecta una cuenta arriba para que tus bots puedan pensar."}>
          <Select aria-label="Piensan con" disabled={!live.length || act.busy} value={primary || ""} onChange={(e) => setEngines({ primary: e.target.value }, "Tu equipo piensa con " + engine(e.target.value)?.label, { primary })} style={{ ...select, width: "220px" }} options={primaries} />
        </Row>
        <Row as="label" anchor="respaldo" title="Si falla o llega al límite, usar"
          sub={!live.length ? "Primero conecta una cuenta." : fallback === "none" ? (live.length < 2 && !ai?.local ? "Con una sola cuenta no hay respaldo: si llega a su límite, paran y te avisan; lo hecho se conserva." : "Si la principal llega a su límite, paran y te avisan; lo hecho se conserva.") : "Siguen trabajando sin que tengas que hacer nada, con todo lo que llevaban."}>
          <Select aria-label="Si falla o llega al límite, usar" disabled={!live.length || act.busy} value={fallback} onChange={(e) => setEngines({ fallback: e.target.value }, "Respaldo cambiado", { fallback })} style={{ ...select, width: "220px" }} options={fallbacks} />
        </Row>

        <div {...anchorOf("cuanto-piensan")} style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px 22px", borderTop: LINE, scrollMarginTop: "24px" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <span style={{ fontSize: "var(--t-body)", fontWeight: 500 }}>Cuánto piensan</span>
            <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{think ? "Más a fondo es más lento y gasta más de tu plan." : "Cada bot a su manera: elige una para todo el equipo o cámbialo abajo."}</span>
          </span>
          <Choices label="Cuánto piensan" min={170} value={think} busy={act.busy || !list.length} items={THINK} onPick={(v) => v !== think && setThink(v)} />
        </div>
      </Card>

      <Advanced summary="El modelo de ChatGPT y qué cuenta, qué modelo y cuánto piensa cada bot." anchors={["modelo", "por-bot"]}>
        {gptOn && gptModels.length ? (
          <Card label="Modelo">
            <Row as="label" first anchor="modelo" title="Modelo de ChatGPT" sub="El que usan cuando piensan con ChatGPT. Colmena elige uno bueno; cámbialo solo si lo necesitas.">
              <Select aria-label="Modelo de ChatGPT" value={settings.model || ""} onChange={(e) => save({ model: e.target.value }, "Modelo cambiado", { model: settings.model })} style={{ ...select, width: "220px" }} options={gptModels.map((m) => [m.slug, m.label || m.slug])} />
            </Row>
          </Card>
        ) : null}
        {list.length ? <PerBot bots={list} engines={engines} team={team} busy={act.busy} setBot={setBot} /> : null}
      </Advanced>

      <p style={{ margin: 0, fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>
        Tu propio servidor de modelos (Ollama, LM Studio, vLLM) se conecta en «Conectar otra IA». ¿Una <Term tip="Una clave que da acceso a OpenAI pagando por uso, en lugar de tu plan de ChatGPT.">clave de API</Term> de OpenAI? Está en{" "}
        {expert ? <Go to="/ajustes/avanzado#clave-openai">Servidores y claves</Go> : <><Go to="/ajustes/general#modo-experto">Servidores y claves</Go>, con el modo experto</>}.
      </p>
    </>
  );
}
