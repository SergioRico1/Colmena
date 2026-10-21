import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { post } from "../../lib/api.js";
import { ago } from "../../lib/format.js";
import { useCountdown } from "./Dots.jsx";
import { BotAvatar, ErrorLine, findBot } from "./common.jsx";
import { useStore } from "../../lib/store.jsx";

// A bot asks for an API key (OpenClaw masked secret request): docked above the composer
// (and in the Bandeja). You see who asks, why, for which sites and whether it replaces a
// saved one; the value is typed hidden (an eye shows it), goes straight to the encrypted
// store and the bot only learns «guardada». It always starts hidden for a new request.
const I = { size: 15, strokeWidth: 2.2, "aria-hidden": "true" };

export default function SecretPrompt({ approval, bots = [], compact = false }) {
  const store = useStore();
  const s = approval?.secret;
  const bot = findBot(bots.length ? bots : store.bots, approval?.botId);
  const [value, setValue] = useState("");
  const [shown, setShown] = useState(false);
  const [hosts, setHosts] = useState(() => (s?.allowedHosts || []).join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const input = useRef(null);
  // A different request: hidden again, empty, its own sites.
  useEffect(() => { setValue(""); setShown(false); setError(null); setDone(null); setHosts((s?.allowedHosts || []).join(", ")); }, [approval?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = useCountdown(approval?.expiresAt ? Date.parse(approval.expiresAt) : null);
  if (!s) return null;
  const minutes = left == null ? null : Math.max(1, Math.ceil(left / 60));
  const save = async (e) => {
    e?.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/secrets/requests/${encodeURIComponent(approval.id)}`, { value, allowedHosts: hosts.split(/[,\s]+/).filter(Boolean) });
      setValue("");
      setDone("saved");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const decline = async () => {
    setBusy(true);
    try { await post(`/secrets/requests/${encodeURIComponent(approval.id)}/cancel`); setDone("declined"); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  if (done) {
    return (
      <p role="status" className="c-band" style={{ margin: compact ? 0 : "0 0 10px", display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", background: done === "saved" ? "#E1F4EC" : "#F7F8FA", border: "1px solid " + (done === "saved" ? "#9ED4BC" : "#DCE0E8"), borderRadius: "12px", fontSize: "13px", color: done === "saved" ? "#0B5A3E" : "#4A4F5C" }}>
        {done === "saved" ? <ShieldCheck {...I} /> : <KeyRound {...I} />}
        {done === "saved" ? `Clave ${s.name} guardada. ${bot.name} ya puede usarla, sin verla.` : `Le has dicho a ${bot.name} que no.`}
      </p>
    );
  }
  return (
    <form id={"clave-" + approval.id} onSubmit={save} aria-label={`${bot.name} te pide la clave ${s.name}`} className="c-band"
      style={{ margin: compact ? 0 : "0 0 10px", padding: "14px 16px", background: "#FFFFFF", border: "0", borderRadius: "24px", boxShadow: "0 0 0 1px rgba(255,201,60,.6), 0 0 0 7px rgba(255,201,60,.16), 0 30px 60px -30px rgba(201,138,0,.6)", display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
        <BotAvatar bot={bot} size={30} mood="duda" />
        <div style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
          <strong style={{ fontSize: "15px" }}>{`${bot.name} necesita una clave`}</strong>
          <span style={{ fontSize: "13px", color: "#2B2D36", lineHeight: "1.45" }}>{s.reason}</span>
        </div>
        {minutes ? <span title="Si no la das, sigue sin ella" style={{ flex: "none", font: "500 11px/1 'Geist Mono', monospace", color: minutes <= 2 ? "#B4372A" : "#555A68", paddingTop: "4px" }}>{left === 0 ? "caducada" : `caduca en ${minutes} min`}</span> : null}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", fontSize: "13px", color: "#4A4F5C" }}>
        <LockKeyhole {...I} size={14} />
        <span>{"Se guarda como "}<code style={{ font: "600 12px/1 'Geist Mono', monospace", padding: "3px 6px", background: "#F7F8FA", border: "1px solid #E6E8EE", borderRadius: "5px", color: "#12131A" }}>{s.name}</code>{" · clave protegida"}</span>
      </div>
      {s.existing ? <p role="note" style={{ margin: 0, padding: "8px 10px", background: "#FFF4D1", border: "1px solid #F2D27A", borderRadius: "10px", fontSize: "13px" }}>{`Sustituye a la ${s.name} guardada ${ago(s.existing.updatedAt) || "antes"}${s.existing.updatedBy ? " (" + s.existing.updatedBy + ")" : ""}.`}</p> : null}
      <label style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 4px 4px 12px", background: "#FFFFFF", border: "1.5px solid #A9AEBB", borderRadius: "12px" }}>
        <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{`Valor de ${s.name}`}</span>
        <KeyRound {...I} style={{ color: "#555A68", flex: "none" }} />
        <input ref={input} type={shown ? "text" : "password"} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" spellCheck={false} placeholder="Pega aquí la clave" name="colmena-secret"
          style={{ flex: "1", minWidth: 0, height: "38px", border: "0", outline: "none", background: "transparent", font: "500 14px/1 'Geist Mono', monospace", letterSpacing: shown ? "0" : "0.08em" }} />
        <button type="button" className="rm-focus" aria-pressed={shown ? "true" : "false"} aria-label={shown ? "Ocultar la clave" : "Mostrar la clave"} title={shown ? "Ocultar" : "Mostrar"} onClick={() => { setShown(!shown); input.current?.focus(); }}
          style={{ width: "36px", height: "36px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "9px", cursor: "pointer", color: "#4A4F5C" }}>
          {shown ? <EyeOff {...I} /> : <Eye {...I} />}
        </button>
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "#555A68" }}>
        Sitios donde se puede usar
        <input value={hosts} onChange={(e) => setHosts(e.target.value)} placeholder="api.ejemplo.com" autoComplete="off" spellCheck={false}
          style={{ height: "34px", padding: "0 10px", background: "#F7F8FA", border: "1px solid #DCE0E8", borderRadius: "9px", font: "500 13px/1 'Geist Mono', monospace", color: "#12131A" }} />
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
        <button type="submit" disabled={busy || !value.trim() || left === 0} className="c-press" style={{ height: "40px", padding: "0 16px", background: "#FFC93C", border: "2px solid #12131A", borderRadius: "10px", cursor: "pointer", fontWeight: "700", fontSize: "14px", opacity: busy || !value.trim() ? 0.55 : 1 }}>{busy ? "Guardando…" : "Guardar la clave"}</button>
        <button type="button" disabled={busy} onClick={decline} style={{ height: "40px", padding: "0 14px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "10px", cursor: "pointer", fontSize: "14px" }}>Ahora no</button>
        <span style={{ flex: "1 1 220px", fontSize: "12px", lineHeight: "1.4", color: "#555A68" }}>{`Se guarda cifrada en este ordenador. ${bot.name} nunca la ve: solo sabrá que está guardada.`}</span>
      </div>
      <ErrorLine>{error}</ErrorLine>
    </form>
  );
}

/** In the conversation: «Nora te pidió la clave X» (answer it above the box) or «la guardaste». */
export function SecretLine({ message, approval, bots }) {
  const bot = findBot(bots, message.botId);
  const status = approval?.status;
  const text = status === "answered" || message.stored ? `Guardaste la clave ${approval?.secret?.name || ""} para ${bot.name}.`
    : status === "pending" ? `${bot.name} te pide la clave ${approval?.secret?.name || ""}. Escríbela en el recuadro de abajo.`
      : status === "expired" ? `${bot.name} pidió una clave y caducó sin respuesta.`
        : `${bot.name} pidió una clave y le dijiste que no.`;
  return (
    <p style={{ margin: "0", padding: "6px 0 6px 52px", display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", lineHeight: "1.45", color: "#4A4F5C" }}>
      <KeyRound {...I} size={14} style={{ color: status === "pending" ? "#8A6400" : "#555A68", flex: "none" }} />{text}
    </p>
  );
}
