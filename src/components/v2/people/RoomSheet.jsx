import { useEffect, useState } from "react";
import { Copy, Pencil, UserPlus, X } from "lucide-react";
import { PeerAvatar } from "./PeerAvatar.jsx";
import { del, patch, post } from "../../../lib/api.js";
import { useStore } from "../../../lib/store.jsx";

// Who is in a group (design/V2Personas.dc.html, paso roles): the owner renames it, chooses
// each person's role (Miembro, or Invitado: writes and reads, wakes no bot), takes someone
// out, adds people or invites someone new straight into it with a code. Every change is a
// new list signed by the owner; the others only accept lists from the owner.
const enc = encodeURIComponent;
const ROLE = { owner: "Creó la conversación", member: "Miembro", guest: "Invitado" };
const pill = { display: "inline-flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 14px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: 600 };
const seg = (on) => ({ height: "28px", padding: "0 10px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "12px", fontWeight: 600, background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 2px rgba(18,19,26,.12)" : "none", color: "#12131A" });

export default function RoomSheet({ share, onClose, onChanged }) {
  const { peers } = useStore();
  const [title, setTitle] = useState(share.title);
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [inviting, setInviting] = useState(null); // {name, role} while writing, then the invitation
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const mine = share.mine;
  const act = async (fn) => { setBusy(true); setError(null); try { await fn(); await onChanged?.(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const members = [...share.members].sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : a.name.localeCompare(b.name)));
  const outside = (peers?.contacts || []).filter((c) => c.status === "active" && !share.members.some((m) => m.id === c.id));
  return (
    <div role="dialog" aria-modal="true" aria-label={"Personas de " + share.title} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", justifyContent: "flex-end", background: "rgba(18,19,26,.28)", animation: "fade .2s ease-out" }}>
      <aside style={{ width: "min(460px, 100%)", height: "100%", overflowY: "auto", padding: "28px 26px 36px", boxSizing: "border-box", background: "rgba(255,255,255,.96)", WebkitBackdropFilter: "blur(30px) saturate(1.6)", backdropFilter: "blur(30px) saturate(1.6)", borderRadius: "30px 0 0 30px", boxShadow: "-40px 0 80px -30px rgba(18,19,26,.35)", display: "flex", flexDirection: "column", gap: "22px", animation: "sheet .4s cubic-bezier(.2,.8,.2,1)" }}>
        <header style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={{ font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#6B6F7A" }}>{share.members.length + " personas"}</span>
            {renaming ? (
              <form onSubmit={(e) => { e.preventDefault(); act(async () => { await patch("/peers/shares/" + enc(share.id), { title }); setRenaming(false); }); }} style={{ display: "flex", gap: "6px" }}>
                <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} aria-label="Nombre de la conversación" style={{ flex: 1, minWidth: 0, height: "40px", padding: "0 12px", border: 0, borderRadius: "12px", outline: "none", background: "#F4F4F0", font: "600 18px/1 'Bricolage Grotesque', sans-serif" }} />
                <button type="submit" disabled={busy || !title.trim()} style={{ ...pill, background: "#12131A", color: "#FFFFFF" }}>{"Guardar"}</button>
              </form>
            ) : (
              <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px", font: "600 26px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>
                <span style={{ color: "#A3A6AE" }}>{"#"}</span>{share.title}
                {mine ? <button type="button" aria-label="Cambiar el nombre" onClick={() => { setTitle(share.title); setRenaming(true); }} style={{ width: "32px", height: "32px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "rgba(18,19,26,.05)", cursor: "pointer", color: "#3D404A" }}><Pencil size={14} strokeWidth={2.2} /></button> : null}
              </h2>
            )}
          </span>
          <button type="button" aria-label="Cerrar" onClick={onClose} style={{ width: "38px", height: "38px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "rgba(18,19,26,.05)", cursor: "pointer" }}><X size={18} strokeWidth={2.2} /></button>
        </header>

        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {members.map((m) => (
            <div key={m.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 12px", minHeight: "56px", padding: "6px 4px" }}>
              <PeerAvatar person={m} size={36} dot={!m.me} ring="#FFFFFF" />
              <span style={{ flex: "1 1 140px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                <strong style={{ fontSize: "15px", fontWeight: 600 }}>{m.me ? "Tú" : m.name}</strong>
                <span style={{ fontSize: "12px", color: "#6B6F7A" }}>{ROLE[m.role] || "Miembro"}{m.role === "guest" ? " · no despierta a los bots" : ""}</span>
              </span>
              {mine && m.role !== "owner" ? (
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span role="radiogroup" aria-label={"Papel de " + m.name} style={{ display: "flex", gap: "2px", padding: "2px", borderRadius: "999px", background: "rgba(18,19,26,.05)" }}>
                    {[["member", "Miembro"], ["guest", "Invitado"]].map(([v, label]) => <button key={v} type="button" role="radio" aria-checked={m.role === v ? "true" : "false"} disabled={busy} onClick={() => m.role !== v && act(() => patch("/peers/shares/" + enc(share.id) + "/members/" + enc(m.id), { role: v }))} style={seg(m.role === v)}>{label}</button>)}
                  </span>
                  <button type="button" disabled={busy} onClick={() => act(() => del("/peers/shares/" + enc(share.id) + "/members/" + enc(m.id)))} style={{ ...pill, height: "30px", padding: "0 10px", background: "transparent", color: "#B4231A", fontSize: "12px" }}>{"Quitar"}</button>
                </span>
              ) : null}
            </div>
          ))}
        </div>

        {mine ? (
          <>
            {outside.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#5C606C" }}>{"Añadir"}</span>
                <span style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {outside.map((c) => <button key={c.id} type="button" disabled={busy} onClick={() => act(() => post("/peers/shares/" + enc(share.id) + "/members", { members: [c.id] }))} style={{ ...pill, padding: "0 12px 0 4px", background: "rgba(18,19,26,.06)", color: "#12131A" }}><PeerAvatar person={c} size={28} />{c.name.split(" ")[0]}</button>)}
                </span>
              </div>
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px", borderRadius: "20px", background: "#F4F4F0" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                <strong style={{ fontSize: "14px", fontWeight: 600 }}>{"Invitar a alguien nuevo"}</strong>
                <span style={{ fontSize: "12px", lineHeight: 1.5, color: "#5C606C" }}>{"Le das un código: al pegarlo queda conectado contigo y dentro de esta conversación. Caduca en 24 horas."}</span>
              </span>
              {inviting?.code ? (
                <>
                  <pre style={{ margin: 0, padding: "12px 14px", borderRadius: "14px", background: "#FFFFFF", whiteSpace: "pre-wrap", font: "400 12px/1.55 'Geist Mono', monospace", userSelect: "text" }}>{inviting.text}</pre>
                  <span style={{ display: "flex", gap: "6px" }}>
                    <button type="button" onClick={() => navigator.clipboard?.writeText(inviting.text).then(() => setInviting({ ...inviting, copied: true })).catch(() => {})} style={{ ...pill, background: "#12131A", color: "#FFFFFF" }}><Copy size={14} strokeWidth={2.2} aria-hidden="true" />{inviting.copied ? "Copiado" : "Copiar el mensaje"}</button>
                    <button type="button" onClick={() => setInviting(null)} style={{ ...pill, background: "rgba(18,19,26,.06)", color: "#12131A" }}>{"Otra"}</button>
                  </span>
                  <span style={{ fontSize: "12px", color: "#6B6F7A" }}>{"Mándaselo tú, por WhatsApp o correo. Colmena no lo envía."}</span>
                </>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); if (!inviting?.name?.trim()) return; act(async () => { const made = await post("/peers/invites", { name: inviting.name.trim(), room: share.id, role: inviting.role || "member" }); setInviting({ ...made, role: inviting.role }); }); }} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <input value={inviting?.name || ""} onChange={(e) => setInviting({ ...(inviting || {}), name: e.target.value })} maxLength={80} placeholder="Cómo se llama" aria-label="Cómo se llama" style={{ height: "40px", padding: "0 12px", border: 0, borderRadius: "12px", outline: "none", background: "#FFFFFF", font: "inherit", fontSize: "14px" }} />
                  <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                    <span role="radiogroup" aria-label="Papel" style={{ display: "flex", gap: "2px", padding: "2px", borderRadius: "999px", background: "rgba(18,19,26,.06)" }}>
                      {[["member", "Miembro"], ["guest", "Invitado"]].map(([v, label]) => <button key={v} type="button" role="radio" aria-checked={(inviting?.role || "member") === v ? "true" : "false"} onClick={() => setInviting({ ...(inviting || {}), role: v })} style={seg((inviting?.role || "member") === v)}>{label}</button>)}
                    </span>
                    <button type="submit" disabled={busy || !inviting?.name?.trim()} style={{ ...pill, background: inviting?.name?.trim() ? "#12131A" : "#C9CBD1", color: "#FFFFFF" }}><UserPlus size={14} strokeWidth={2.2} aria-hidden="true" />{"Crear invitación"}</button>
                  </span>
                </form>
              )}
            </div>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: "#5C606C" }}>{"Quién está aquí y con qué papel lo decide " + (share.members.find((m) => m.role === "owner")?.name || "quien la creó") + ". Solo vale la lista que firma su Colmena."}</p>
        )}
        {error ? <span role="alert" style={{ fontSize: "13px", color: "#B4231A" }}>{error}</span> : null}
      </aside>
    </div>
  );
}
