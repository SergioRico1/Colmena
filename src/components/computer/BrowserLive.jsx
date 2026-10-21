import { useState } from "react";
import { BotPresence } from "../v2/Presence.jsx";
import { post } from "../../lib/api.js";
import { avatarStyle, initial } from "../../lib/bots.js";
import { useBrowserFrames } from "./useBrowserFrames.js";

export { useBrowserFrames };

// «Vista en vivo» of a bot's browser, in the visual language of design/EnVivo.dc.html.
const VERB_LABEL = {
  navegando: "Navegando",
  "rellenando un formulario": "Rellenando un formulario",
  "usando el ordenador": "Usando el ordenador",
  "ejecutando una tarea": "Ejecutando una tarea",
};

const CSS = `
@keyframes colmena-live{0%{box-shadow:0 0 0 0 rgba(61,220,151,.7)}100%{box-shadow:0 0 0 7px rgba(61,220,151,0)}}
.colmena-live-btn:focus-visible{outline:3px solid #2F6BFF;outline-offset:2px}
`;

const buttonBase = { height: "40px", padding: "0 14px", borderRadius: "10px", cursor: "pointer", fontSize: "13px", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "8px" };
const BUTTON_DARK = { ...buttonBase, background: "#12131A", color: "#FFFFFF", border: 0 };
const BUTTON_HONEY = { ...buttonBase, background: "#FFC93C", color: "#12131A", border: "2px solid #12131A" };
const BUTTON_LIGHT = { ...buttonBase, background: "#FFFFFF", color: "#12131A", border: "1px solid #DCE0E8", fontWeight: 500 };

function GlobeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </svg>
  );
}

function LockIcon({ secure }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={secure ? "#0B6B4A" : "#9DA2B0"} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d={secure ? "M8 11V8a4 4 0 0 1 8 0v3" : "M8 11V8a4 4 0 0 1 7.5-2"} />
    </svg>
  );
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
  const color = bot?.color || "#FFC93C";
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
  const giveBack = () => run("return", () => post("/computer/takeover", { missionId, action: "return", ...(frame?.botId ? { botId: frame.botId } : {}) }));
  const stop = () => run("stop", () => post("/missions/" + encodeURIComponent(missionId) + "/control", { action: "pause" }));

  if (!frame) {
    const desktopOnly = available === false;
    return (
      <article aria-label={"Vista en vivo del navegador de " + name} style={{ margin: "6px 0", border: "1px dashed #A9AEBB", borderRadius: "18px", background: "#FFFFFF", padding: "18px 16px", display: "flex", alignItems: "center", gap: "12px" }}>
        <style>{CSS}</style>
        <span aria-hidden="true" style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", background: "#EEF0F4", borderRadius: "12px", color: "#4A4F5C" }}>
          <GlobeIcon />
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
          <strong style={{ fontSize: "15px" }}>{desktopOnly ? "El navegador de los bots no está disponible aquí" : "El navegador de " + name + " está cerrado"}</strong>
          <span style={{ fontSize: "13px", color: "#4A4F5C" }}>
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
      style={{ margin: "6px 0", border: "2px solid " + color, borderRadius: "18px", overflow: "hidden", background: "#FFFFFF", boxShadow: takeover ? "8px 8px 0 #FFC93C" : "none", transition: "box-shadow .2s ease" }}
    >
      <style>{CSS}</style>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", padding: "12px 16px", borderBottom: "1px solid #E6E8EE" }}>
        <Avatar bot={bot} />
        <strong style={{ fontSize: "15px" }}>{name}</strong>
        <span style={{ display: "flex", alignItems: "center", gap: "8px", height: "28px", padding: "0 10px", background: "#EEF0F4", borderRadius: "14px", fontSize: "13px", fontWeight: 600 }}>
          <GlobeIcon />
          {takeover ? "Te ha dado el control" : label}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ display: "flex", alignItems: "center", gap: "8px", font: "600 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}>
          <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#3DDC97", animation: "colmena-live 1.4s ease-out infinite" }} />
          Vista en vivo
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 16px", background: "#F6F7F9", borderBottom: "1px solid #E6E8EE", minWidth: 0 }}>
        <LockIcon secure={secure} />
        <span title={frame.url} style={{ font: "500 12px/1.4 'Geist Mono', monospace", color: "#12131A", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flex: "0 1 auto" }}>
          {host || frame.url}
        </span>
        {frame.title ? (
          <span style={{ fontSize: "12px", color: "#4A4F5C", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flex: 1 }}>· {frame.title}</span>
        ) : null}
      </div>

      <div style={{ background: "#12131A", display: "grid", placeItems: "center" }}>
        <img
          src={frame.image}
          alt={"Lo que ve " + name + ": " + (frame.title || host || "página web")}
          style={{ display: "block", width: "100%", height: "auto", maxHeight: "70vh", objectFit: "contain" }}
        />
      </div>

      {takeover ? (
        <p style={{ margin: 0, padding: "12px 16px", borderTop: "1px solid #E6E8EE", background: "#FFF8E1", fontSize: "14px", lineHeight: 1.5 }}>
          <strong>Tienes el control.</strong> {name} espera sin tocar nada. Usa la ventana «Colmena · Navegador de {name}» y pulsa «Devolver» cuando termines.
        </p>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", padding: "12px 16px", borderTop: "1px solid #E6E8EE" }}>
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
        {error ? <span role="alert" style={{ fontSize: "13px", color: "#B4372A" }}>{error}</span> : null}
      </div>
    </article>
  );
}
