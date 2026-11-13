import { useState } from "react";
import { Eye, EyeOff, KeyRound, Plus, Trash2 } from "../Icon.js";
import { Card, Notice, btn, field } from "./SettingsShell.jsx";
import { useAction, useResource } from "../../lib/store.jsx";
import { del, patch, post } from "../../lib/api.js";
import { dateTime } from "../../lib/format.js";

// Ajustes › Seguridad › Bóveda: site accounts a bot can sign in with (browser_sign_in). The
// passwords are encrypted by Windows for your user on this computer; Colmena never shows them
// again, nor gives them to a bot: it fills the login form itself, only on that site.

function PasswordInput({ value, onChange, label, autoFocus = false }) {
  const [shown, setShown] = useState(false);
  return (
    <span style={{ position: "relative", display: "flex" }}>
      <input className="c-quiet" type={shown ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} autoComplete="new-password" autoFocus={autoFocus} maxLength={1000} spellCheck={false}
        style={{ ...field.input, flex: "1", paddingRight: "44px" }} />
      <button type="button" onClick={() => setShown((v) => !v)} aria-label={shown ? "Ocultar la contraseña" : "Ver la contraseña"} title={shown ? "Ocultar" : "Ver"}
        style={{ position: "absolute", right: "4px", top: "4px", width: "36px", height: "36px", display: "grid", placeItems: "center", background: "transparent", border: 0, borderRadius: "var(--r-sm)", cursor: "pointer", color: "var(--c-text-3)" }}>
        {shown ? <EyeOff size={16} strokeWidth={2} aria-hidden="true" /> : <Eye size={16} strokeWidth={2} aria-hidden="true" />}
      </button>
    </span>
  );
}

function AddForm({ onDone }) {
  const { act, busy, error } = useAction();
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("");
  const submit = (e) => {
    e.preventDefault();
    act(async () => {
      await post("/vault", { url, username, password, ...(label.trim() ? { label } : {}) });
      setPassword("");
      onDone();
    });
  };
  return (
    <form onSubmit={submit} className="c-enter" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px", background: "var(--c-hover)", borderRadius: "var(--r-lg)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "12px" }}>
        <label style={field.label}>{"Web"}<input className="c-quiet" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.ejemplo.com" inputMode="url" autoFocus style={field.input} /></label>
        <label style={field.label}>{"Nombre (opcional)"}<input className="c-quiet" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Banco de la empresa" maxLength={80} style={field.input} /></label>
        <label style={field.label}>{"Usuario o correo"}<input className="c-quiet" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" maxLength={320} style={field.input} /></label>
        <label style={field.label}>{"Contraseña"}<PasswordInput value={password} onChange={setPassword} label="Contraseña" /></label>
      </div>
      <Notice>{error}</Notice>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <button type="submit" disabled={busy || !url.trim() || !username.trim() || !password} style={{ ...btn.dark, opacity: busy || !url.trim() || !username.trim() || !password ? 0.6 : 1 }}>{busy ? "Guardando…" : "Guardar en la bóveda"}</button>
        <button type="button" onClick={onDone} style={btn.quiet}>{"Cancelar"}</button>
      </div>
    </form>
  );
}

function EntryRow({ e, first }) {
  const { act, busy, error } = useAction();
  const [changing, setChanging] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "12px 0", borderTop: first ? "0" : "1px solid rgb(var(--c-ink-rgb) / .06)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
        <span aria-hidden="true" style={{ width: "34px", height: "34px", flex: "none", display: "grid", placeItems: "center", background: "var(--c-hover)", border: "1px solid rgb(var(--c-ink-rgb) / .06)", borderRadius: "var(--r-sm)", color: "var(--c-text-3)" }}><KeyRound size={16} strokeWidth={2.1} /></span>
        <span style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
          <strong style={{ fontSize: "var(--t-ui)" }}>{e.label}</strong>
          <span style={{ ...field.mono, fontSize: "var(--t-caption)", color: "var(--c-text-3)", overflowWrap: "anywhere" }}>{[e.domain, e.username, e.uses ? `usada ${e.uses} ${e.uses === 1 ? "vez" : "veces"}` : "sin usar", e.lastUsedAt ? "última " + dateTime(e.lastUsedAt) : null].filter(Boolean).join(" · ")}</span>
        </span>
        {confirm ? (
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "var(--t-meta)" }}>{"¿Quitarla de la bóveda?"}</span>
            <button type="button" disabled={busy} onClick={() => act(() => del(`/vault/${encodeURIComponent(e.id)}`))} style={{ ...btn.quiet, color: "var(--c-error)", borderColor: "color-mix(in srgb, var(--c-error) 35%, transparent)", fontWeight: "600" }}>{"Quitar"}</button>
            <button type="button" onClick={() => setConfirm(false)} style={btn.quiet}>{"No"}</button>
          </span>
        ) : (
          <span style={{ display: "flex", gap: "6px" }}>
            <button type="button" onClick={() => setChanging((v) => !v)} style={btn.quiet}>{"Cambiar contraseña"}</button>
            <button type="button" onClick={() => setConfirm(true)} aria-label={"Quitar " + e.label} title="Quitar de la bóveda" style={{ ...btn.quiet, width: "36px", padding: 0 }}><Trash2 size={15} strokeWidth={2} aria-hidden="true" /></button>
          </span>
        )}
      </div>
      {changing ? (
        <form className="c-enter" onSubmit={(ev) => { ev.preventDefault(); act(async () => { await patch(`/vault/${encodeURIComponent(e.id)}`, { password }); setPassword(""); setChanging(false); }); }} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", paddingLeft: "46px" }}>
          <span style={{ flex: "1 1 240px" }}><PasswordInput value={password} onChange={setPassword} label={"Nueva contraseña de " + e.label} autoFocus /></span>
          <button type="submit" disabled={busy || !password} style={{ ...btn.dark, opacity: busy || !password ? 0.6 : 1 }}>{"Guardar"}</button>
          <button type="button" onClick={() => { setPassword(""); setChanging(false); }} style={btn.quiet}>{"Cancelar"}</button>
        </form>
      ) : null}
      <Notice>{error}</Notice>
    </div>
  );
}

export default function VaultCard() {
  const { data, loading } = useResource("/vault");
  const [adding, setAdding] = useState(false);
  const entries = data?.entries || [];
  const available = data?.available !== false;
  return (
    <Card id="boveda" title="Bóveda de contraseñas" aside={available && !adding ? <button type="button" onClick={() => setAdding(true)} style={btn.outline}><Plus size={15} strokeWidth={2.4} aria-hidden="true" />{"Añadir cuenta"}</button> : null}>
      <p style={{ margin: "0", fontSize: "var(--t-ui)", lineHeight: "1.5", color: "var(--c-text-3)" }}>
        {"Guarda aquí las cuentas con las que quieres que tus bots puedan entrar en una web. Windows las cifra para tu usuario en este ordenador. Ningún bot ve ni escribe la contraseña: Colmena rellena el acceso en su navegador, solo si la página es de esa web, y te pide permiso la primera vez. Los códigos de verificación y los captchas siguen siendo cosa tuya."}
      </p>
      {!available ? <Notice tone="info">{"La bóveda cifrada solo funciona en Windows, en la aplicación de escritorio."}</Notice> : null}
      {adding ? <AddForm onDone={() => setAdding(false)} /> : null}
      {entries.length ? (
        <div style={{ display: "flex", flexDirection: "column" }}>{entries.map((e, i) => <EntryRow key={e.id} e={e} first={i === 0} />)}</div>
      ) : !adding ? (
        <p style={{ margin: "0", padding: "14px", background: "var(--c-hover)", borderRadius: "var(--r-md)", fontSize: "var(--t-ui)", lineHeight: "1.5", color: "var(--c-text-3)" }}>{loading ? "Cargando…" : "Aún no has guardado ninguna cuenta."}</p>
      ) : null}
    </Card>
  );
}
