import { Fragment, useState } from "react";
import { Eye, EyeOff, KeyRound } from "../Icon.js";
import { post } from "../../lib/api.js";
import { isCloud } from "../../lib/cloud.js";
import { useResource } from "../../lib/store.jsx";
import { maskSecret, secretSegments, suggestKey } from "../../lib/secretMask.js";

// A key, token or password you pasted into a message (src/lib/secretMask.js) is drawn masked:
// its first characters and then •, with «Mostrar» for that one value. Copying keeps the real
// text. «Guardar en llaves» moves it to the encrypted key store (server/secrets.mjs); the
// message then keeps only its name, drawn as a small key pill.

const MARKER = /\{\{\s*secret:([A-Z][A-Z0-9_]{0,127})\s*\}\}/g;
const I = { size: 12, strokeWidth: 2.3, "aria-hidden": "true" };
const LINK = { display: "inline-flex", alignItems: "center", gap: "4px", height: "22px", padding: "0 7px", margin: "0 0 0 4px", border: 0, borderRadius: "var(--r-pill)", background: "rgb(var(--c-ink-rgb) / .06)", color: "var(--c-text-2)", cursor: "pointer", fontSize: "var(--t-caption)", fontWeight: 600, verticalAlign: "1px", userSelect: "none", whiteSpace: "nowrap" };

/** A key already in «Llaves»: its name only. */
function KeyMarker({ name }) {
  return (
    <span title="Guardada cifrada en tus llaves" style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "0 8px", borderRadius: "var(--r-pill)", background: "rgb(var(--c-ink-rgb) / .07)", fontSize: "0.9em", fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "baseline" }}>
      <KeyRound size={12} strokeWidth={2.3} aria-hidden="true" />{name}
    </span>
  );
}

function SaveKey({ secret, messageId, onClose }) {
  const hint = suggestKey(secret);
  const [name, setName] = useState(hint.name);
  const [hosts, setHosts] = useState(hint.hosts.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const save = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post("/secrets", { name: name.trim(), value: secret.value, allowedHosts: hosts.split(/[,\s]+/).filter(Boolean), messageId: messageId || null });
      setSaved(r?.secret?.name || name.trim().toUpperCase());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const field = { display: "block", width: "100%", boxSizing: "border-box", height: "34px", padding: "0 10px", border: "1px solid rgb(var(--c-ink-rgb) / .14)", borderRadius: "var(--r-md)", background: "var(--c-card)", font: "inherit", fontSize: "var(--t-ui)", color: "var(--c-text)" };
  return (
    <span role="dialog" aria-label="Guardar en llaves" data-secret-ui="" className="c-pop" onKeyDown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "Enter") save(e); }}
      style={{ position: "absolute", zIndex: 30, bottom: "calc(100% + 6px)", right: 0, width: "300px", display: "flex", flexDirection: "column", gap: "10px", padding: "14px", background: "var(--c-card)", border: "1px solid rgb(var(--c-ink-rgb) / .08)", borderRadius: "var(--r-lg)", boxShadow: "var(--c-shadow-pop)", fontSize: "var(--t-ui)", lineHeight: 1.45, color: "var(--c-text)", textAlign: "left", whiteSpace: "normal", userSelect: "none" }}>
      {saved ? (
        <span role="status" style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
          <KeyRound size={15} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", marginTop: "2px", color: "var(--c-ok-ink)" }} />
          <span>{`Guardada como ${saved}. Los bots pueden usarla sin verla.`}</span>
        </span>
      ) : (<>
        <span style={{ display: "block", fontWeight: 600, fontSize: "var(--t-ui)" }}>{"Guardar en llaves"}</span>
        <span style={{ display: "block", color: "var(--c-text-2)" }}>{`Se guarda cifrada en ${isCloud() ? "la nube de tu empresa" : "este ordenador"}${messageId ? " y en el mensaje queda solo su nombre." : "."}`}</span>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{"Nombre"}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} autoFocus style={{ ...field, fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", textTransform: "uppercase" }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{"Dónde se puede usar"}</span>
          <input value={hosts} onChange={(e) => setHosts(e.target.value)} placeholder="api.ejemplo.com" spellCheck={false} style={field} />
        </label>
        {error ? <span role="alert" style={{ display: "block", color: "var(--c-error)", fontSize: "var(--t-meta)" }}>{error}</span> : null}
        <span style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button type="button" onClick={onClose} style={{ height: "32px", padding: "0 12px", border: 0, borderRadius: "var(--r-pill)", background: "rgb(var(--c-ink-rgb) / .06)", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text)" }}>{"Cancelar"}</button>
          <button type="button" onClick={save} disabled={busy || !name.trim() || !hosts.trim()} style={{ height: "32px", padding: "0 14px", border: 0, borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", cursor: busy ? "wait" : "pointer", fontSize: "var(--t-meta)", fontWeight: 600, opacity: !name.trim() || !hosts.trim() ? 0.5 : 1 }}>{busy ? "Guardando…" : "Guardar"}</button>
        </span>
      </>)}
    </span>
  );
}

/** One secret of a message: masked, «Mostrar», and «Guardar en llaves» when the store exists. */
export function MaskedSecret({ secret, messageId = null }) {
  const [shown, setShown] = useState(false);
  const [saving, setSaving] = useState(false);
  const { data } = useResource("/secrets");
  const savable = !!data?.available && suggestKey(secret).savable;
  return (
    <span style={{ position: "relative", whiteSpace: "pre-wrap" }}>
      <span data-secret={secret.value} title={shown ? undefined : "Clave oculta"}
        style={{ padding: "1px 5px", borderRadius: "var(--r-sm)", background: "rgb(var(--c-ink-rgb) / .06)", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: "0.88em", letterSpacing: shown ? 0 : ".02em", overflowWrap: "anywhere" }}>
        {shown ? secret.value : maskSecret(secret.value)}
      </span>
      <button type="button" data-secret-ui="" aria-pressed={shown ? "true" : "false"} onClick={() => setShown((v) => !v)} style={LINK}>
        {shown ? <EyeOff {...I} /> : <Eye {...I} />}{shown ? "Ocultar" : "Mostrar"}
      </button>
      {savable ? (
        <button type="button" data-secret-ui="" aria-expanded={saving ? "true" : "false"} onClick={() => setSaving((v) => !v)} style={LINK}>
          <KeyRound {...I} />{"Guardar en llaves"}
        </button>
      ) : null}
      {saving ? <SaveKey secret={secret} messageId={messageId} onClose={() => setSaving(false)} /> : null}
    </span>
  );
}

/**
 * `text` with its secrets masked and its saved-key markers as pills; every other piece goes
 * through `plain(text, key)` (mention pills and so on).
 */
export function SecretText({ text, messageId = null, plain = (t) => t }) {
  const value = String(text || "");
  const pieces = [];
  let at = 0;
  MARKER.lastIndex = 0;
  for (let m; (m = MARKER.exec(value)); ) {
    if (m.index > at) pieces.push({ text: value.slice(at, m.index) });
    pieces.push({ marker: m[1] });
    at = m.index + m[0].length;
  }
  if (at < value.length) pieces.push({ text: value.slice(at) });
  const out = [];
  pieces.forEach((p, i) => {
    if (p.marker) return out.push(<KeyMarker key={"k" + i} name={p.marker} />);
    secretSegments(p.text).forEach((s, j) => out.push(s.secret
      ? <MaskedSecret key={i + ":" + j} secret={s.secret} messageId={messageId} />
      : <Fragment key={i + ":" + j}>{plain(s.text, i + ":" + j)}</Fragment>));
  });
  return out;
}

/** The selection's text with each masked secret as it really is (and without its buttons). */
export function realSelectionText(selection) {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return "";
  const range = selection.getRangeAt(0);
  const start = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const inside = start?.closest?.("[data-secret]");
  if (inside && inside.contains(range.endContainer)) return inside.getAttribute("data-secret") || "";
  const frag = range.cloneContents();
  if (!frag.querySelector("[data-secret], [data-secret-ui]")) return selection.toString();
  frag.querySelectorAll("[data-secret-ui]").forEach((n) => n.remove());
  frag.querySelectorAll("[data-secret]").forEach((n) => { n.textContent = n.getAttribute("data-secret") || n.textContent; });
  return frag.textContent || "";
}

/** onCopy of a message: what lands on the clipboard is the real text. */
export function copyRealSecrets(e) {
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed) return;
  const text = realSelectionText(sel);
  if (text === sel.toString()) return;
  e.clipboardData?.setData("text/plain", text);
  e.preventDefault();
}
