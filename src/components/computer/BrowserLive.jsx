import { useState } from "react";
import { Globe, Lock, LockOpen } from "../Icon.js";
import { BotPresence } from "../v2/Presence.jsx";
import { post } from "../../lib/api.js";
import { isCloud } from "../../lib/cloud.js";
import { avatarStyle, initial } from "../../lib/bots.js";
import { useBrowserFrames } from "./useBrowserFrames.js";
import { ReturnNote, WatchedView, returnBody } from "./takeover.jsx";
import { C } from "../../lib/theme.js";

export { useBrowserFrames };

// «Vista en vivo» of a bot's browser, in the visual language of design/EnVivo.dc.html.
// While you only watch, the view is a picture: a click or a key on it asks «¿Quieres tomar el
// control?» (it never reaches the page). With «Devolver» you can leave the bot a one-line note.
const VERB_LABEL = {
  navegando: "Navegando",
  "rellenando un formulario": "Rellenando un formulario",
  "usando el ordenador": "Usando el ordenador",
  "ejecutando una tarea": "Ejecutando una tarea",
};

const CSS = `
@keyframes colmena-live{0%{box-shadow:0 0 0 0 color-mix(in srgb, var(--c-ok) 70%, transparent)}100%{box-shadow:0 0 0 7px transparent}}
.colmena-live-btn:focus-visible{outline:3px solid var(--c-accent);outline-offset:2px}
`;

const buttonBase = { height: "40px", padding: "0 14px", borderRadius: "var(--r-md)", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "8px" };
const BUTTON_DARK = { ...buttonBase, background: "var(--c-btn)", color: "var(--c-btn-text)", border: 0 };
const BUTTON_HONEY = { ...buttonBase, background: "var(--c-honey)", color: "var(--c-honey-ink)", border: "2px solid var(--c-text)" };
const BUTTON_LIGHT = { ...buttonBase, background: "var(--c-card)", color: "var(--c-text)", border: "1px solid var(--c-line)", fontWeight: 500 };

function GlobeIcon() {
  return (
    <Globe size={14} />
  );
}

function LockIcon({ secure }) {
  return secure ? <Lock size={13} weight="bold" color="var(--c-ok-ink)" /> : <LockOpen size={13} weight="bold" color="var(--c-text-4)" />;
}

function Avatar({ bot }) {
  return (
    <BotPresence bot={bot} size={32} />
  );
}

/**
 * @param {{missionId: string, bot: object|null, verb?: string|null, missionActive?: boolean}} props
 * verb: the bot's live verb (store.activity[bot.id]?.verb). missionActive hides «Detener» when nothing runs.
 */
export default function BrowserLive({ missionId, bot, verb = null, missionActive = true }) {
  const { frame, available, takeover } = useBrowserFrames(missionId);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState("");
  const color = bot?.color || C.accent;
  const name = bot?.name || "el bot";
  const label = VERB_LABEL[verb] || (verb ? verb.charAt(0).toUpperCase() + verb.slice(1) : takeover ? "Esperando" : "Navegando");

  const run = async (key, fn) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };
  const takeControl = () => run("take", () => post("/computer/takeover", { missionId, action: "take", ...(frame?.botId ? { botId: frame.botId } : {}) }));
  const giveBack = () => run("return", async () => { await post("/computer/takeover", returnBody(missionId, frame?.botId, note)); setNote(""); });
  const stop = () => run("stop", () => post("/missions/" + encodeURIComponent(missionId) + "/control", { action: "pause" }));
  // Hosted: the browser is in the cloud, so the person's hands reach it through the frame itself
  // (a click where they click, what they type, a key); each answer brings a fresh frame.
  const cloud = isCloud();
  const [typed, setTyped] = useState("");
  const remote = (body) => run("input", () => post("/computer/input", { missionId, ...body }));
  const clickAt = (e) => {
    if (!cloud || !takeover) return;
    const r = e.currentTarget.getBoundingClientRect();
    remote({ kind: "click", x: Math.round(((e.clientX - r.left) / r.width) * 1280), y: Math.round(((e.clientY - r.top) / r.height) * 800) });
  };

  if (!frame) {
    const desktopOnly = available === false;
    return (
      <article aria-label={"Vista en vivo del navegador de " + name} style={{ margin: "6px 0", border: "1px dashed var(--c-line-strong)", borderRadius: "var(--r-md)", background: "var(--c-card)", padding: "18px 16px", display: "flex", alignItems: "center", gap: "12px" }}>
        <style>{CSS}</style>
        <span aria-hidden="true" style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", background: "var(--c-chip)", borderRadius: "var(--r-md)", color: "var(--c-text-2)" }}>
          <GlobeIcon />
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
          <strong style={{ fontSize: "var(--t-body)" }}>{desktopOnly ? "El navegador de los bots no está disponible aquí" : "El navegador de " + name + " está cerrado"}</strong>
          <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-2)" }}>
            {desktopOnly
              ? "Solo funciona en la aplicación de escritorio de Colmena."
              : "Cuando " + name + " abra una página, la verás aquí en directo."}
          </span>
        </div>
      </article>
    );
  }

  let host = "", secure = false;
  try {
    const u = new URL(frame.url);
    host = u.hostname.replace(/^www\./, "");
    secure = u.protocol === "https:";
  } catch {}

  return (
    <article
      aria-label={"Vista en vivo del navegador de " + name}
      style={{ margin: "6px 0", border: "2px solid " + color, borderRadius: "var(--r-md)", overflow: "hidden", background: "var(--c-card)", boxShadow: takeover ? "8px 8px 0 var(--c-honey-ring)" : "none", transition: "box-shadow .2s ease" }}
    >
      <style>{CSS}</style>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", padding: "12px 16px", borderBottom: "1px solid var(--c-line)" }}>
        <Avatar bot={bot} />
        <strong style={{ fontSize: "var(--t-body)" }}>{name}</strong>
        <span style={{ display: "flex", alignItems: "center", gap: "8px", height: "28px", padding: "0 10px", background: "var(--c-chip)", borderRadius: "var(--r-pill)", fontSize: "var(--t-meta)", fontWeight: 600 }}>
          <GlobeIcon />
          {takeover ? "Te ha dado el control" : label}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ display: "flex", alignItems: "center", gap: "8px", font: "600 var(--t-micro)/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--c-text-3)" }}>
          <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "var(--r-circle)", background: "var(--c-ok)", animation: "colmena-live 1.4s ease-out infinite" }} />
          Vista en vivo
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", background: "var(--c-sunken)", borderBottom: "1px solid var(--c-line)", minWidth: 0 }}>
        <LockIcon secure={secure} />
        <span title={frame.url} style={{ font: "500 var(--t-caption)/1.4 'Geist Mono', monospace", color: "var(--c-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flex: "0 1 auto" }}>
          {host || frame.url}
        </span>
        {frame.title ? (
          <span style={{ fontSize: "var(--t-caption)", color: "var(--c-text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flex: 1 }}>· {frame.title}</span>
        ) : null}
      </div>

      <WatchedView watching={!takeover} name={name} busy={!!busy} onTake={takeControl} takeStyle={BUTTON_DARK} quietStyle={BUTTON_LIGHT} style={{ background: C.btn, display: "grid", placeItems: "center" }}>
        <img
          src={frame.image}
          alt={"Lo que ve " + name + ": " + (frame.title || host || "página web")}
          onClick={clickAt}
          style={{ display: "block", width: "100%", height: "auto", maxHeight: "70vh", objectFit: "contain", cursor: cloud && takeover ? "pointer" : undefined }}
        />
      </WatchedView>

      {takeover ? (
        <p style={{ margin: 0, padding: "12px 16px", borderTop: "1px solid var(--c-line)", background: "var(--c-honey-soft)", fontSize: "var(--t-ui)", lineHeight: 1.5 }}>
          <strong>Tienes el control.</strong> {name} espera sin tocar nada. {cloud ? "Pulsa sobre la imagen para hacer clic donde quieras y escribe abajo; " : "Usa la ventana «Colmena · Navegador de " + name + "» y "}pulsa «Devolver» cuando termines.
        </p>
      ) : null}
      {cloud && takeover ? (
        <form onSubmit={(e) => { e.preventDefault(); if (typed) remote({ kind: "type", text: typed }).then(() => setTyped("")); }}
          style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", padding: "10px 16px", borderTop: "1px solid var(--c-line)" }}>
          <label style={{ flex: "1 1 220px", display: "flex" }}>
            <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Escribir en la página</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Escribe aquí y pulsa Escribir" autoComplete="off"
              style={{ flex: 1, minWidth: 0, height: "40px", padding: "0 12px", border: "1px solid var(--c-line)", borderRadius: "var(--r-md)", background: "var(--c-card)", color: "var(--c-text)", font: "inherit" }} />
          </label>
          <button type="submit" className="colmena-live-btn" disabled={!!busy || !typed} style={BUTTON_LIGHT}>Escribir</button>
          {["Enter", "Tab", "Escape"].map((k) => (
            <button key={k} type="button" className="colmena-live-btn" disabled={!!busy} onClick={() => remote({ kind: "key", key: k })} style={BUTTON_LIGHT}>{k === "Enter" ? "Intro" : k === "Escape" ? "Esc" : k}</button>
          ))}
          <button type="button" className="colmena-live-btn" disabled={!!busy} onClick={() => remote({ kind: "scroll" })} style={BUTTON_LIGHT}>Bajar</button>
        </form>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "8px", padding: "12px 16px", borderTop: "1px solid var(--c-line)" }}>
        {takeover ? <ReturnNote name={name} value={note} onChange={setNote} onSubmit={giveBack} disabled={busy === "return"} style={{ flex: "1 1 260px" }} /> : null}
        {takeover ? (
          <button type="button" className="colmena-live-btn" onClick={giveBack} disabled={!!busy} style={BUTTON_HONEY}>
            {busy === "return" ? "Devolviendo…" : "Devolver el control a " + name}
          </button>
        ) : (
          <button type="button" className="colmena-live-btn" onClick={takeControl} disabled={!!busy} style={BUTTON_DARK}>
            {busy === "take" ? "Abriendo…" : "Tomar el control"}
          </button>
        )}
        {missionActive && !takeover ? (
          <button type="button" className="colmena-live-btn" onClick={stop} disabled={!!busy} style={BUTTON_LIGHT}>
            {busy === "stop" ? "Deteniendo…" : "Detener"}
          </button>
        ) : null}
        {error ? <span role="alert" style={{ fontSize: "var(--t-meta)", color: "var(--c-error)" }}>{error}</span> : null}
      </div>
    </article>
  );
}
