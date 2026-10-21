import { useState } from "react";
import { KeyRound, Pencil, Trash2 } from "lucide-react";
import { Card, Notice, btn, field } from "./SettingsShell.jsx";
import { useAction, useResource } from "../../lib/store.jsx";
import { del, patch } from "../../lib/api.js";
import { ago } from "../../lib/format.js";

// Ajustes › Seguridad › Claves de API: the keys you gave your bots when they asked for one
// (request_secret). Windows encrypts them for your user; no screen shows them again and no
// bot reads them: Colmena puts them into a request only for their sites (api_request).

function KeyRow({ s, first }) {
  const { act, busy, error } = useAction();
  const [editing, setEditing] = useState(false);
  const [hosts, setHosts] = useState(s.allowedHosts.join(", "));
  const [confirm, setConfirm] = useState(false);
  const meta = [s.uses ? `usada ${s.uses} ${s.uses === 1 ? "vez" : "veces"}` : "sin usar", s.lastUsedAt ? "última " + ago(s.lastUsedAt) : null, s.updatedBy ? "guardada por " + s.updatedBy : null].filter(Boolean).join(" · ");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "12px 0", borderTop: first ? "0" : "1px solid rgba(18,19,26,.06)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
        <span aria-hidden="true" style={{ width: "34px", height: "34px", flex: "none", display: "grid", placeItems: "center", background: "#F6F6F3", border: "1px solid rgba(18,19,26,.06)", borderRadius: "9px", color: "#5C606C" }}><KeyRound size={16} strokeWidth={2.1} /></span>
        <span style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
          <strong style={{ ...field.mono, fontSize: "13px", color: "#12131A" }}>{s.name}</strong>
          <span style={{ fontSize: "12px", color: "#5C606C", overflowWrap: "anywhere" }}>{"Solo en " + s.allowedHosts.join(", ")}</span>
          <span style={{ fontSize: "12px", color: "#6B6F7A" }}>{meta}</span>
        </span>
        {confirm ? (
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "13px" }}>{"¿Borrarla? Los bots dejarán de poder usarla."}</span>
            <button type="button" disabled={busy} onClick={() => act(() => del(`/secrets/${encodeURIComponent(s.name)}`))} style={{ ...btn.quiet, color: "#B4372A", borderColor: "#F1B5B7", fontWeight: "600" }}>{"Borrar"}</button>
            <button type="button" onClick={() => setConfirm(false)} style={btn.quiet}>{"No"}</button>
          </span>
        ) : (
          <span style={{ display: "flex", gap: "6px" }}>
            <button type="button" onClick={() => setEditing((v) => !v)} style={btn.quiet}><Pencil size={14} strokeWidth={2} aria-hidden="true" />{"Sitios"}</button>
            <button type="button" onClick={() => setConfirm(true)} aria-label={"Borrar " + s.name} title="Borrar la clave" style={{ ...btn.quiet, width: "36px", padding: 0 }}><Trash2 size={15} strokeWidth={2} aria-hidden="true" /></button>
          </span>
        )}
      </div>
      {editing ? (
        <form className="c-enter" onSubmit={(e) => { e.preventDefault(); act(async () => { await patch(`/secrets/${encodeURIComponent(s.name)}`, { allowedHosts: hosts.split(/[,\s]+/).filter(Boolean) }); setEditing(false); }); }}
          style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", paddingLeft: "46px" }}>
          <input value={hosts} onChange={(e) => setHosts(e.target.value)} aria-label={"Sitios de " + s.name} placeholder="api.ejemplo.com" spellCheck={false} style={{ ...field.input, ...field.mono, flex: "1 1 260px" }} />
          <button type="submit" disabled={busy || !hosts.trim()} style={{ ...btn.dark, opacity: busy || !hosts.trim() ? 0.6 : 1 }}>{"Guardar"}</button>
          <button type="button" onClick={() => { setHosts(s.allowedHosts.join(", ")); setEditing(false); }} style={btn.quiet}>{"Cancelar"}</button>
        </form>
      ) : null}
      <Notice>{error}</Notice>
    </div>
  );
}

export default function ApiKeysCard() {
  const { data, loading } = useResource("/secrets");
  const list = data?.secrets || [];
  return (
    <Card id="claves" title="Claves de API">
      <p style={{ margin: "0", fontSize: "14px", lineHeight: "1.5", color: "#5C606C" }}>
        {"Cuando un bot necesita una clave para un servicio (Holded, Stripe, tu CRM…), te la pide en un recuadro oculto. Windows la cifra para tu usuario en este ordenador y ningún bot la ve: Colmena la pone en la llamada solo si va a uno de sus sitios. Lo que cambie algo en el servicio siempre espera tu OK."}
      </p>
      {data?.available === false ? <Notice tone="info">{"Las claves cifradas solo funcionan en Windows, en la aplicación de escritorio."}</Notice> : null}
      {list.length ? (
        <div style={{ display: "flex", flexDirection: "column" }}>{list.map((s, i) => <KeyRow key={s.name} s={s} first={i === 0} />)}</div>
      ) : (
        <p style={{ margin: "0", padding: "14px", background: "#F6F6F3", borderRadius: "12px", fontSize: "14px", lineHeight: "1.5", color: "#5C606C" }}>{loading ? "Cargando…" : "Aún no has dado ninguna clave. Aparecerán aquí cuando un bot te pida una y la guardes."}</p>
      )}
    </Card>
  );
}
