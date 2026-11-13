import { useState } from "react";
import { Copy, Pencil, UserPlus, X } from "../../Icon.js";
import { PeerAvatar } from "./PeerAvatar.jsx";
import { del, patch, post } from "../../../lib/api.js";
import { useStore } from "../../../lib/store.jsx";
import { useDialogFocus } from "../../../lib/useDialogFocus.js";
import { C } from "../../../lib/theme.js";

// Who is in a group (design/V2Personas.dc.html, paso roles): the owner renames it, chooses
// each person's role (Miembro, or Invitado: writes and reads, wakes no bot), takes someone
// out, adds people or invites someone new straight into it with a code. Every change is a
// new list signed by the owner; the others only accept lists from the owner.
const enc = encodeURIComponent;
const ROLE = { owner: "Creó la conversación", member: "Miembro", guest: "Invitado" };
const pill = { display: "inline-flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 12px", border: 0, borderRadius: "var(--r-sm)", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600 };
const seg = (on) => ({ height: "28px", padding: "0 10px", border: 0, borderRadius: "var(--r-pill)", cursor: "pointer", fontSize: "var(--t-caption)", fontWeight: 600, background: on ? "var(--c-card)" : "transparent", boxShadow: on ? "var(--c-shadow-lift)" : "none", color: "var(--c-text)" });

export default function RoomSheet({ share, onClose, onChanged }) {
  const { peers } = useStore();
  const [title, setTitle] = useState(share.title);
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [inviting, setInviting] = useState(null); // {name, role} while writing, then the invitation
  const box = useDialogFocus({ onEscape: onClose });
  const mine = share.mine;
  const act = async (fn) => { setBusy(true); setError(null); try { await fn(); await onChanged?.(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const members = [...share.members].sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : a.name.localeCompare(b.name)));
  const outside = (peers?.contacts || []).filter((c) => c.status === "active" && !share.members.some((m) => m.id === c.id));
  return (
    <div ref={box} role="dialog" aria-modal="true" aria-label={"Personas de " + share.title} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", justifyContent: "flex-end", background: "var(--c-scrim)", animation: "fade .2s ease-out" }}>
      <aside style={{ width: "min(460px, 100%)", height: "100%", overflowY: "auto", padding: "28px 26px 36px", boxSizing: "border-box", background: "var(--c-raised)", WebkitBackdropFilter: "blur(30px) saturate(1.6)", backdropFilter: "blur(30px) saturate(1.6)", borderRadius: "var(--r-3xl) 0 0 var(--r-3xl)", boxShadow: "var(--c-shadow-pop)", display: "flex", flexDirection: "column", gap: "22px", animation: "sheet .4s cubic-bezier(.2,.8,.2,1)" }}>
        <header style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={{ font: "500 var(--t-caption)/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--c-text-3)" }}>{share.members.length + " personas"}</span>
            {renaming ? (
              <form onSubmit={(e) => { e.preventDefault(); act(async () => { await patch("/peers/shares/" + enc(share.id), { title }); setRenaming(false); }); }} style={{ display: "flex", gap: "6px" }}>
                <input className="c-quiet" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} aria-label="Nombre de la conversación" style={{ flex: 1, minWidth: 0, height: "40px", padding: "0 12px", border: 0, borderRadius: "var(--r-md)", background: "var(--c-sunken)", font: "600 var(--t-lead)/1 'Bricolage Grotesque', sans-serif" }} />
                <button type="submit" disabled={busy || !title.trim()} style={{ ...pill, background: "var(--c-btn)", color: "var(--c-btn-text)" }}>{"Guardar"}</button>
              </form>
            ) : (
              <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px", font: "600 var(--t-read)/1.3 'Geist', sans-serif" }}>
                <span style={{ color: C.text4 }}>{"#"}</span>{share.title}
                {mine ? <button type="button" aria-label="Cambiar el nombre" onClick={() => { setTitle(share.title); setRenaming(true); }} style={{ width: "32px", height: "32px", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-circle)", background: "rgb(var(--c-ink-rgb) / .05)", cursor: "pointer", color: "var(--c-text-2)" }}><Pencil size={14} strokeWidth={2.2} /></button> : null}
              </h2>
            )}
          </span>
          <button type="button" aria-label="Cerrar" onClick={onClose} style={{ width: "38px", height: "38px", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-circle)", background: "rgb(var(--c-ink-rgb) / .05)", cursor: "pointer" }}><X size={18} strokeWidth={2.2} /></button>
        </header>

        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {members.map((m) => (
            <div key={m.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 12px", minHeight: "56px", padding: "6px 4px" }}>
              <PeerAvatar person={m} size={36} dot={!m.me} ring={C.card} />
              <span style={{ flex: "1 1 140px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                <strong style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>{m.me ? "Tú" : m.name}</strong>
                <span style={{ fontSize: "var(--t-caption)", color: "var(--c-text-3)" }}>{ROLE[m.role] || "Miembro"}{m.role === "guest" ? " · no despierta a los bots" : ""}</span>
              </span>
              {mine && m.role !== "owner" ? (
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span role="radiogroup" aria-label={"Papel de " + m.name} style={{ display: "flex", gap: "2px", padding: "2px", borderRadius: "var(--r-pill)", background: "rgb(var(--c-ink-rgb) / .05)" }}>
                    {[["member", "Miembro"], ["guest", "Invitado"]].map(([v, label]) => <button key={v} type="button" role="radio" aria-checked={m.role === v ? "true" : "false"} disabled={busy} onClick={() => m.role !== v && act(() => patch("/peers/shares/" + enc(share.id) + "/members/" + enc(m.id), { role: v }))} style={seg(m.role === v)}>{label}</button>)}
                  </span>
                  <button type="button" disabled={busy} onClick={() => act(() => del("/peers/shares/" + enc(share.id) + "/members/" + enc(m.id)))} style={{ ...pill, height: "30px", padding: "0 10px", background: "transparent", color: "var(--c-error)", fontSize: "var(--t-caption)" }}>{"Quitar"}</button>
                </span>
              ) : null}
            </div>
          ))}
        </div>

        {mine ? (
          <>
            {outside.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={{ fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text-3)" }}>{"Añadir"}</span>
                <span style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {outside.map((c) => <button key={c.id} type="button" disabled={busy} onClick={() => act(() => post("/peers/shares/" + enc(share.id) + "/members", { members: [c.id] }))} style={{ ...pill, padding: "0 12px 0 4px", background: "rgb(var(--c-ink-rgb) / .06)", color: "var(--c-text)" }}><PeerAvatar person={c} size={28} />{c.name.split(" ")[0]}</button>)}
                </span>
              </div>
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px", borderRadius: "var(--r-xl)", background: "var(--c-sunken)" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                <strong style={{ fontSize: "var(--t-ui)", fontWeight: 600 }}>{"Invitar a alguien nuevo"}</strong>
                <span style={{ fontSize: "var(--t-caption)", lineHeight: 1.5, color: "var(--c-text-3)" }}>{"Le das un código: al pegarlo queda conectado contigo y dentro de esta conversación. Caduca en 24 horas."}</span>
              </span>
              {inviting?.code ? (
                <>
                  <pre style={{ margin: 0, padding: "12px 14px", borderRadius: "var(--r-lg)", background: "var(--c-card)", whiteSpace: "pre-wrap", font: "400 var(--t-caption)/1.55 'Geist Mono', monospace", userSelect: "text" }}>{inviting.text}</pre>
                  <span style={{ display: "flex", gap: "6px" }}>
                    <button type="button" onClick={() => navigator.clipboard?.writeText(inviting.text).then(() => setInviting({ ...inviting, copied: true })).catch(() => {})} style={{ ...pill, background: "var(--c-btn)", color: "var(--c-btn-text)" }}><Copy size={14} strokeWidth={2.2} aria-hidden="true" />{inviting.copied ? "Copiado" : "Copiar el mensaje"}</button>
                    <button type="button" onClick={() => setInviting(null)} style={{ ...pill, background: "rgb(var(--c-ink-rgb) / .06)", color: "var(--c-text)" }}>{"Otra"}</button>
                  </span>
                  <span style={{ fontSize: "var(--t-caption)", color: "var(--c-text-3)" }}>{"Mándaselo tú, por WhatsApp o correo. Colmena no lo envía."}</span>
                </>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); if (!inviting?.name?.trim()) return; act(async () => { const made = await post("/peers/invites", { name: inviting.name.trim(), room: share.id, role: inviting.role || "member" }); setInviting({ ...made, role: inviting.role }); }); }} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <input className="c-quiet" value={inviting?.name || ""} onChange={(e) => setInviting({ ...(inviting || {}), name: e.target.value })} maxLength={80} placeholder="Cómo se llama" aria-label="Cómo se llama" style={{ height: "40px", padding: "0 12px", border: 0, borderRadius: "var(--r-md)", background: "var(--c-card)", font: "inherit", fontSize: "var(--t-ui)" }} />
                  <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                    <span role="radiogroup" aria-label="Papel" style={{ display: "flex", gap: "2px", padding: "2px", borderRadius: "var(--r-pill)", background: "rgb(var(--c-ink-rgb) / .06)" }}>
                      {[["member", "Miembro"], ["guest", "Invitado"]].map(([v, label]) => <button key={v} type="button" role="radio" aria-checked={(inviting?.role || "member") === v ? "true" : "false"} onClick={() => setInviting({ ...(inviting || {}), role: v })} style={seg((inviting?.role || "member") === v)}>{label}</button>)}
                    </span>
                    <button type="submit" disabled={busy || !inviting?.name?.trim()} style={{ ...pill, background: inviting?.name?.trim() ? "var(--c-btn)" : C.lineStrong, color: "var(--c-btn-text)" }}><UserPlus size={14} strokeWidth={2.2} aria-hidden="true" />{"Crear invitación"}</button>
                  </span>
                </form>
              )}
            </div>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: "var(--t-meta)", lineHeight: 1.5, color: "var(--c-text-3)" }}>{"Quién está aquí y con qué papel lo decide " + (share.members.find((m) => m.role === "owner")?.name || "quien la creó") + ". Solo vale la lista que firma su Colmena."}</p>
        )}
        {error ? <span role="alert" style={{ fontSize: "var(--t-meta)", color: "var(--c-error)" }}>{error}</span> : null}
      </aside>
    </div>
  );
}
