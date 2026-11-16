import { useEffect, useRef, useState } from "react";
import BotFace from "../BotFace.jsx";
import { ColorPicker, ShapePicker } from "./LookPicker.jsx";
import { portraitOf } from "../../lib/bots.js";

// «Nombre y aspecto» of a bot's profile: the name you write and its look chosen freely from
// Colmena's own options (shape and colour, LookPicker.jsx), drawn live as it will look. Saving is
// one change with «Deshacer» (the profile's `onSave`). Every bot's colour can change, Atlas's
// too. A bot with a portrait keeps showing it, inside the chosen shape.
const label = { display: "flex", flexDirection: "column", gap: "6px", fontSize: "var(--t-ui)", fontWeight: "600", color: "var(--c-text-2)" };
const input = { height: "44px", padding: "0 14px", border: "1px solid rgb(var(--c-ink-rgb) / .14)", borderRadius: "var(--r-md)", fontSize: "var(--t-body)", fontWeight: "400", color: "var(--c-text)", background: "var(--c-card)" };
const btn = (strong) => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: "40px", padding: "0 18px", borderRadius: "var(--r-pill)", border: strong ? 0 : "1px solid var(--c-line-strong)", background: strong ? "var(--c-btn)" : "transparent", color: strong ? "var(--c-btn-text)" : "var(--c-text)", font: "600 var(--t-ui)/1 'Geist', sans-serif", cursor: "pointer" });

export default function BotLookDialog({ bot, onSave, onClose }) {
  const [name, setName] = useState(bot.name || "");
  const [shape, setShape] = useState(bot.shape === "circle" ? "capsule" : bot.shape || "square");
  const [color, setColor] = useState(bot.color || "#0E7C86");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const field = useRef(null);
  useEffect(() => { field.current?.focus(); field.current?.select(); }, []);
  const clean = name.trim().replace(/\s+/g, " ");
  const changes = {
    ...(clean && clean !== bot.name ? { name: clean } : {}),
    ...(shape !== bot.shape ? { shape } : {}),
    ...(color.toUpperCase() !== String(bot.color || "").toUpperCase() ? { color } : {}),
  };
  const dirty = Object.keys(changes).length > 0;
  const preview = { ...bot, name: clean || bot.name, shape, color, portrait: null };
  const save = async (e) => {
    e?.preventDefault();
    if (!clean) { setError("Ponle un nombre."); return; }
    if (!dirty) { onClose(); return; }
    setBusy(true); setError(null);
    try { await onSave(changes); onClose(); }
    catch (err) { setError(err?.message || "No se pudo guardar."); }
    finally { setBusy(false); }
  };
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }} onKeyDown={(e) => { if (e.key === "Escape" && !busy) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(18, 19, 26, 0.55)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "72px 16px 32px", overflowY: "auto" }}>
      <form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="aspecto-t"
        style={{ width: "min(560px, 100%)", background: "var(--c-card)", borderRadius: "var(--r-xl)", boxShadow: "0 24px 64px rgb(0 0 0 / .25)", display: "flex", flexDirection: "column", gap: "18px", padding: "22px 24px 20px", animation: "rise .25s ease-out" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ flex: "none", width: "72px", height: "72px", display: "grid", placeItems: "center", borderRadius: "var(--r-lg)", background: "var(--c-hover)" }}><BotFace bot={preview} size={48} decorative /></span>
          <span style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
            <h2 id="aspecto-t" style={{ margin: 0, font: "600 var(--t-heading)/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Nombre y aspecto"}</h2>
            <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{"Así lo verá todo el equipo, en los chats y en las salas."}</span>
          </span>
        </div>
        <label style={label}>{"Nombre"}
          <input ref={field} className="c-quiet" type="text" value={name} maxLength={30} disabled={busy} onChange={(e) => setName(e.target.value)} placeholder="Ponle un nombre" style={input} />
        </label>
        <ShapePicker bot={preview} value={shape} onChange={setShape} disabled={busy} />
        <ColorPicker bot={preview} value={color} onChange={setColor} disabled={busy} />
        {portraitOf(bot) ? <p style={{ margin: 0, fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{"Tiene un retrato: se sigue viendo el retrato, dentro de la forma que elijas."}</p> : null}
        {error ? <p role="alert" style={{ margin: 0, fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{error}</p> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <button type="button" onClick={onClose} disabled={busy} style={btn(false)}>{"Cancelar"}</button>
          <button type="submit" disabled={busy || !clean} style={{ ...btn(true), opacity: busy || !clean ? 0.6 : 1 }}>{busy ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </div>
  );
}
