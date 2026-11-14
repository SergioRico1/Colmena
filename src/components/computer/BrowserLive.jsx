import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Globe, Lock, LockOpen, Maximize2, Minimize2, RotateCw } from "../Icon.js";
import { BotPresence } from "../v2/Presence.jsx";
import { post } from "../../lib/api.js";
import { isCloud } from "../../lib/cloud.js";
import { useStore } from "../../lib/store.jsx";
import { useActivity } from "../../lib/liveStore.js";
import { useBreakpoint } from "../../lib/breakpoint.js";
import { useDialogFocus, DIALOG_VEIL } from "../../lib/useDialogFocus.js";
import { useBrowserFrames } from "./useBrowserFrames.js";
import LiveStage, { STAGE_CSS } from "./LiveStage.jsx";
import { HandBack, HANDBACK_CSS, WatchedView, botWords, returnBody } from "./takeover.jsx";

export { useBrowserFrames };

// «Vista en vivo» of a bot's browser: who is driving (the bot or you), what the bot is doing
// now, the page's address, and the page itself at its own aspect ratio. «Ampliar» opens it as
// large as the window allows (the whole screen on a phone). While you only watch, a click or a
// key on it asks «¿Quieres tomar el control?» (it never reaches the page). With the control of a
// cloud browser the frame is the page under your hands (LiveStage.jsx); on the desktop you use
// the browser's own window. Giving it back is one step with an optional note (takeover.jsx).
const VERB_LABEL = {
  navegando: "Navegando",
  "rellenando un formulario": "Rellenando un formulario",
  "usando el ordenador": "Usando el ordenador",
  "ejecutando una tarea": "Ejecutando una tarea",
};
// A frame older than this is said to be old (the cloud sends one after each action, the desktop
// about one a second while the bot works).
const STALE_MS = 20_000;
// Narrower than this, a 1280-px page is too small to read and click.
const NARROW_PX = 560;

const CSS = `
@keyframes colmena-live{0%{box-shadow:0 0 0 0 color-mix(in srgb, var(--c-ok) 70%, transparent)}100%{box-shadow:0 0 0 6px transparent}}
@media (prefers-reduced-motion: reduce){.bl-dot{animation:none!important}}
.colmena-live-btn:focus-visible{outline:2px solid var(--c-focus);outline-offset:2px}
.bl{display:flex;flex-direction:column;gap:12px;min-width:0;padding:14px;border:1px solid var(--c-line);border-radius:var(--r-md);background:var(--c-card);color:var(--c-text)}
.bl-head{display:flex;align-items:center;gap:10px;min-width:0}
.bl-who{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.bl-name{display:flex;align-items:center;gap:8px;min-width:0;font-size:var(--t-body);font-weight:600}
.bl-name>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bl-now{font-size:var(--t-meta);line-height:1.4;color:var(--c-text-2);overflow-wrap:anywhere}
.bl-pill{flex:none;display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:var(--r-pill);font-size:var(--t-caption);font-weight:600;white-space:nowrap}
.bl-pill--bot{background:var(--c-chip);color:var(--c-text-2)}
.bl-pill--you{background:var(--c-accent-soft);color:var(--c-accent-ink)}
.bl-dot{width:7px;height:7px;border-radius:var(--r-circle);background:var(--c-ok);flex:none}
.bl-icon-btn{flex:none;height:32px;padding:0 10px;display:inline-flex;align-items:center;gap:6px;border:0;border-radius:var(--r-sm);background:transparent;color:var(--c-text-2);font:500 var(--t-meta)/1 'Geist',sans-serif;cursor:pointer}
.bl-icon-btn:hover{background:var(--c-hover);color:var(--c-text)}
.bl-icon-btn:focus-visible{outline:2px solid var(--c-focus);outline-offset:2px}
.bl-addr{display:flex;align-items:center;gap:8px;min-width:0;height:32px;padding:0 10px;border-radius:var(--r-sm);background:var(--c-sunken);font:400 var(--t-caption)/1 'Geist Mono',ui-monospace,monospace;color:var(--c-text-3)}
.bl-addr>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.bl-addr b{font-weight:500;color:var(--c-text)}
.bl-reload{flex:none;width:26px;height:26px;margin-right:-6px;display:grid;place-items:center;border:0;border-radius:var(--r-xs);background:transparent;color:var(--c-text-2);cursor:pointer}
.bl-reload:hover:not(:disabled){background:var(--c-hover);color:var(--c-text)}
.bl-reload:focus-visible{outline:2px solid var(--c-focus);outline-offset:1px}
.bl[data-big] :is(.bl-head,.bl-addr,.bl-caption,.bl-tools,.bl-row,.bl-note-line,.bl-back){width:100%;max-width:var(--bl-col,none);margin-inline:auto;box-sizing:border-box}
.bl-note-line{margin:0;font-size:var(--t-meta);line-height:1.45;color:var(--c-text-2)}
@keyframes bl-flash{0%{background:var(--c-accent-soft);color:var(--c-accent-ink)}100%{background:transparent}}
.bl-flash{animation:bl-flash 1.6s ease-out both;border-radius:var(--r-xs)}
@media (prefers-reduced-motion: reduce){.bl-flash{animation:none;color:var(--c-accent-ink)}}
.bl-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.bl-veil{position:fixed;inset:0;z-index:2147482000;display:flex;padding:24px;background:${DIALOG_VEIL}}
.bl-veil>.bl{flex:1;min-height:0;max-width:1480px;margin:0 auto;box-shadow:var(--c-shadow-pop);animation:c-pop-in 160ms var(--c-ease) both}
.bl-placeholder{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:14px;border:1px dashed var(--c-line-strong);border-radius:var(--r-md);font-size:var(--t-meta);color:var(--c-text-2)}
@media (max-width: 639.98px){
  .bl-veil{padding:0;background:var(--c-card)}
  .bl-veil>.bl{border:0;border-radius:0;box-shadow:none;padding:calc(10px + var(--safe-t)) calc(12px + var(--safe-r)) calc(12px + var(--safe-b)) calc(12px + var(--safe-l));height:var(--app-h,100dvh)}
}
${STAGE_CSS}
${HANDBACK_CSS}
`;

function ago(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`;
}

/** The address as host (strong) and the rest; `secure` for the lock. */
function address(url) {
  try {
    const u = new URL(url);
    return { host: u.hostname.replace(/^www\./, ""), rest: (u.pathname === "/" ? "" : u.pathname) + u.search, secure: u.protocol === "https:" };
  } catch { return { host: "", rest: String(url || ""), secure: false }; }
}

/** Ticks every few seconds while a frame is shown, for «imagen de hace…». */
function useNow(on) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/**
 * @param {{missionId: string, bot: object|null, verb?: string|null, missionActive?: boolean}} props
 * bot: the bot whose browser it is when the screen knows; otherwise the frame's own bot is used.
 * verb: the bot's live verb (store.activity[bot.id]?.verb). missionActive hides «Detener» when nothing runs.
 */
export default function BrowserLive({ missionId, bot: given, verb = null, missionActive = true }) {
  const { frame, available, takeover } = useBrowserFrames(missionId);
  const { bots = [] } = useStore();
  const bot = given || (frame?.botId ? bots.find((b) => b.id === frame.botId) : null) || null;
  const doing = useActivity(bot?.id || frame?.botId || "");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState("");
  const [big, setBig] = useState(false);
  const bp = useBreakpoint();
  const now = useNow(!!frame);
  const titleId = useId();
  const here = useRef(null);
  const [col, setCol] = useState(0);
  const [nudged, setNudged] = useState(0);
  const w = botWords(bot?.name || null);
  const cloud = isCloud();
  const control = cloud && takeover;

  const run = async (key, fn) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const takeControl = () => run("take", () => post("/computer/takeover", { missionId, action: "take", ...(frame?.botId ? { botId: frame.botId } : {}) }));
  const giveBack = () => run("return", async () => { await post("/computer/takeover", returnBody(missionId, frame?.botId, note)); setNote(""); });
  const stop = () => run("stop", () => post("/missions/" + encodeURIComponent(missionId) + "/control", { action: "pause" }));
  const input = (body) => post("/computer/input", { missionId, ...body });
  const inputError = (e) => setError(e?.message || "La página no ha respondido.");

  // Taking the control of a page shown too small to read (a side panel, a phone) opens it large:
  // the whole screen on a phone, as large as the window allows elsewhere. «Reducir» brings it back.
  useEffect(() => {
    if (control && (bp === "phone" || (here.current && here.current.offsetWidth < NARROW_PX))) setBig(true);
  }, [control]); // eslint-disable-line react-hooks/exhaustive-deps -- only when the control arrives
  useEffect(() => { if (!frame) setBig(false); }, [frame]);
  const dialog = useDialogFocus({ onEscape: () => setBig(false), active: big });

  if (!frame) {
    const desktopOnly = available === false;
    return (
      <article aria-label={"Vista en vivo del navegador " + w.of} className="bl" style={{ flexDirection: "row", alignItems: "center", borderStyle: "dashed", borderColor: "var(--c-line-strong)" }}>
        <style>{CSS}</style>
        <span aria-hidden="true" style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", background: "var(--c-chip)", borderRadius: "var(--r-md)", color: "var(--c-text-2)" }}>
          <Globe size={16} />
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
          <strong style={{ fontSize: "var(--t-body)" }}>{desktopOnly ? "El navegador de los bots no está disponible aquí" : "El navegador " + w.of + " está cerrado"}</strong>
          <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-2)" }}>
            {desktopOnly ? "Solo funciona en la aplicación de escritorio de Colmena." : "Cuando " + w.who + " abra una página, la verás aquí en directo."}
          </span>
        </div>
      </article>
    );
  }

  const { host, rest, secure } = address(frame.url);
  const age = frame.at ? Math.max(0, now - frame.at) : 0;
  const stale = age > STALE_MS;
  const liveVerb = verb || doing?.verb || null;
  const verbText = VERB_LABEL[liveVerb] || (liveVerb ? liveVerb.charAt(0).toUpperCase() + liveVerb.slice(1) : "Navegando");
  const detail = doing?.detail && doing.detail !== host ? doing.detail : "";
  const nowText = takeover
    ? `${w.Who} espera sin tocar nada mientras lo llevas tú.`
    : missionActive
      ? [verbText, detail].filter(Boolean).join(" · ")
      : `${w.Who} no está navegando ahora. Es la última página que abrió.`;
  const pill = takeover
    ? <span className="bl-pill bl-pill--you">{"Lo llevas tú"}</span>
    : <span className="bl-pill bl-pill--bot">{missionActive ? <span aria-hidden="true" className="bl-dot" style={{ animation: "colmena-live 1.4s ease-out infinite" }} /> : null}{missionActive ? "Lo lleva " + w.who : "En pausa"}</span>;
  const label = `Página ${w.of}: ${host || frame.url}`;
  const alt = "Lo que ve " + w.who + ": " + (frame.title || host || "página web");

  const stageEl = (
    <LiveStage frame={frame} alt={alt} label={label} control={control} onInput={input} onError={inputError} fill={big}
      startZoomed={bp !== "laptop"} onWidth={big && bp !== "phone" ? setCol : undefined} />
  );
  // On the desktop the page is driven in the bot's own window: a click on the picture points there.
  const nudge = takeover && !cloud ? () => setNudged((n) => n + 1) : undefined;

  const body = (
    <article
      {...(big ? { ref: dialog, role: "dialog", "aria-modal": "true", "data-big": "" } : { ref: here })}
      aria-label={"Vista en vivo del navegador " + w.of}
      className="bl"
      style={big && col ? { "--bl-col": col + "px" } : undefined}
    >
      <style>{CSS}</style>
      <header className="bl-head">
        <BotPresence bot={bot} size={32} state={takeover ? "rest" : missionActive ? "work" : "rest"} />
        <div className="bl-who">
          <div className="bl-name"><span id={titleId}>{bot?.name || "Navegador del bot"}</span>{pill}</div>
          <span className="bl-now">
            <span role="status">{nowText}</span>
            {stale ? <span style={{ color: "var(--c-text-3)" }}>{` · imagen de hace ${ago(age)}`}</span> : null}
          </span>
        </div>
        <button type="button" className="bl-icon-btn" onClick={() => setBig((b) => !b)} aria-label={big ? "Reducir la vista" : "Ampliar la vista"} title={big ? "Reducir (Esc)" : "Ampliar"}>
          {big ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          <span>{big ? "Reducir" : "Ampliar"}</span>
        </button>
      </header>

      <div className="bl-addr" title={frame.url}>
        {secure ? <Lock size={13} weight="bold" color="var(--c-ok-ink)" aria-label="Conexión segura" /> : <LockOpen size={13} weight="bold" color="var(--c-text-4)" aria-label="Conexión no segura" />}
        <span style={{ flex: 1 }}><b>{host || frame.url}</b>{host ? rest : ""}</span>
        {control && /^https?:/i.test(frame.url || "") ? (
          <button type="button" className="bl-reload" aria-label="Volver a cargar la página" title="Volver a cargar la página" disabled={busy === "reload"}
            onClick={() => run("reload", () => input({ kind: "open", url: frame.url }))}>
            <RotateCw size={14} className={busy === "reload" ? "c-spin" : undefined} />
          </button>
        ) : null}
      </div>

      {takeover ? (nudge ? <div onClick={nudge} style={{ display: "contents" }}>{stageEl}</div> : stageEl) : (
        <WatchedView watching name={w.who} busy={!!busy} onTake={takeControl}
          takeStyle={{ height: "40px", padding: "0 14px", border: 0, borderRadius: "var(--r-sm)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-ui)", fontWeight: 600, cursor: "pointer" }}
          quietStyle={{ height: "40px", padding: "0 14px", border: 0, borderRadius: "var(--r-sm)", background: "var(--c-card)", color: "var(--c-text)", boxShadow: "inset 0 0 0 1px var(--c-line-strong)", fontSize: "var(--t-ui)", cursor: "pointer" }}
          style={big ? { flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", borderRadius: "var(--r-sm)" } : { borderRadius: "var(--r-sm)" }}>
          {stageEl}
        </WatchedView>
      )}

      {takeover && !cloud ? (
        <p key={nudged} className={"bl-note-line" + (nudged ? " bl-flash" : "")}>{`Haz clic y escribe en la ventana «Colmena · Navegador ${w.of}». Aquí ves lo mismo que allí.`}</p>
      ) : null}

      {takeover ? (
        <HandBack name={bot?.name || null} value={note} onChange={setNote} onSubmit={giveBack} busy={busy === "return"} disabled={!!busy && busy !== "return"} />
      ) : (
        <div className="bl-row">
          <button type="button" className="bl-btn" onClick={takeControl} disabled={!!busy}>{busy === "take" ? "Abriendo…" : "Tomar el control"}</button>
          {missionActive ? <button type="button" className="bl-btn bl-btn--quiet" onClick={stop} disabled={!!busy}>{busy === "stop" ? "Deteniendo…" : "Detener"}</button> : null}
        </div>
      )}
      {error ? <p role="alert" style={{ margin: 0, fontSize: "var(--t-meta)", color: "var(--c-error)" }}>{error}</p> : null}
    </article>
  );

  if (!big) return body;
  return (
    <>
      <div className="bl-placeholder">
        <style>{CSS}</style>
        <span style={{ flex: 1, minWidth: "160px" }}>{"El navegador " + w.of + " está ampliado."}</span>
        <button type="button" className="bl-btn bl-btn--quiet" onClick={() => setBig(false)}>Volver aquí</button>
      </div>
      {createPortal(
        <div className="bl-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) setBig(false); }}>
          {body}
        </div>,
        document.body,
      )}
    </>
  );
}
