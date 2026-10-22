import { useState } from "react";
import { Card, Notice, PageHeader, btn, field } from "./SettingsShell.jsx";
import { useAction, useStore } from "../../lib/store.jsx";
import { del, post } from "../../lib/api.js";
import { later } from "../../lib/undoToast.js";

const ROLES = ["Administrador", "Responsable", "Colaborador", "Solo lectura"];
const ROLE_HELP = {
  Administrador: "Cambia ajustes y aprueba todo.",
  Responsable: "Aprueba envíos y misiones de su área.",
  Colaborador: "Recibe tareas asignadas.",
  "Solo lectura": "Aparece en el registro, no decide.",
};
const initials = (name) => (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

/** Ajustes › Personas: who signs approvals and gets missions assigned (POST /api/people). */
export default function Personas() {
  const { people, settings } = useStore();
  const { act, busy, error, setError } = useAction();
  const [draft, setDraft] = useState({ name: "", email: "", role: "Colaborador" });

  const add = async (event) => {
    event.preventDefault();
    if (!draft.name.trim()) return setError("Escribe el nombre de la persona.");
    if (draft.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) return setError("Ese correo no parece válido.");
    const ok = await act(() => post("/people", { name: draft.name.trim(), email: draft.email.trim(), role: draft.role }));
    if (ok !== undefined) setDraft({ name: "", email: "", role: "Colaborador" });
  };

  const row = (p, you, i) => (
    <div key={p.id || "tu"} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", minHeight: "60px", padding: "8px 0", borderTop: i ? "1px solid rgba(18,19,26,.06)" : "0" }}>
      <span aria-hidden="true" style={{ width: "36px", height: "36px", flex: "none", borderRadius: "50%", background: you ? "#12131A" : "rgba(18,19,26,.06)", color: you ? "#FFFFFF" : "#12131A", display: "grid", placeItems: "center", fontWeight: "700", fontSize: "13px" }}>{you ? "TÚ" : initials(p.name)}</span>
      <span style={{ flex: "1 1 200px", minWidth: "0", display: "flex", flexDirection: "column", gap: "3px" }}>
        <strong style={{ fontSize: "15px" }}>{p.name}{you ? <span style={{ fontWeight: "400", color: "#5C606C" }}> · tú</span> : null}</strong>
        <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: "12px", color: "#5C606C", overflowWrap: "anywhere" }}>{p.email || (you ? "en este ordenador" : "sin correo")}</span>
      </span>
      <span style={{ padding: "4px 9px", background: p.role === "Administrador" ? "#12131A" : "#F4F4F0", color: p.role === "Administrador" ? "#FFFFFF" : "#3D404A", borderRadius: "6px", fontSize: "12px", fontWeight: "600" }}>{p.role || "Colaborador"}</span>
      {you ? <a href="/ajustes/espacio" style={{ ...btn.quiet, textDecoration: "none" }}>Editar</a>
        : <button type="button" onClick={() => later({ id: "person:" + p.id, keys: ["person:" + p.id], text: `${p.name || "Persona"} ya no está en el espacio`, error: "No se pudo quitar", run: () => act(() => del(`/people/${encodeURIComponent(p.id)}`)) })} aria-label={`Quitar a ${p.name}`} style={btn.quiet}>Quitar</button>}
    </div>
  );

  return (
    <>
      <PageHeader title="Personas">Quién firma lo que se aprueba y a quién se asignan tareas en este ordenador.</PageHeader>
      <div role="note" style={{ maxWidth: "720px", display: "flex", gap: "12px", padding: "14px 16px", background: "#FFFFFF", border: "0", borderRadius: "14px", fontSize: "14px", lineHeight: "1.5" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", marginTop: "2px" }}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
        <span>Colmena funciona solo en este ordenador: no hay invitaciones ni cuentas en red. Las personas sirven para <strong>firmar</strong> las aprobaciones del registro y para <strong>asignar</strong> tareas.</span>
      </div>
      <Notice>{error}</Notice>

      <Card id="personas-lista" title="En este espacio" aside={<span style={{ font: "500 12px/1 'Geist Mono', monospace", color: "#5C606C" }}>{people.length || 1} {people.length > 1 ? "personas" : "persona"}</span>}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {row(people.find((p) => p.self) || { name: settings.userName || "Tu cuenta", role: settings.userRole || "Administrador" }, true, 0)}
          {people.filter((p) => !p.self).map((p, i) => row(p, false, i + 1))}
        </div>
      </Card>

      <form onSubmit={add} aria-labelledby="nueva-persona" style={{ background: "#FFFFFF", border: "0", borderRadius: "26px", padding: "22px", display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <h2 id="nueva-persona" style={{ margin: "0", font: "600 20px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>Añadir una persona</h2>
          <span style={{ fontSize: "13px", color: "#5C606C" }}>Queda en la lista de este ordenador. Nadie recibe ningún aviso.</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
          <label style={{ ...field.label, flex: "1 1 200px" }}>
            Nombre
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Marta López" autoComplete="off" style={field.input} />
          </label>
          <label style={{ ...field.label, flex: "1 1 220px" }}>
            Correo
            <input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="marta@empresa.com" autoComplete="off" style={{ ...field.input, ...field.mono }} />
          </label>
          <label style={{ ...field.label, flex: "1 1 180px" }}>
            Rol
            <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} style={{ ...field.input, cursor: "pointer", fontWeight: "600" }}>
              {ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
        </div>
        <span style={{ fontSize: "13px", color: "#5C606C" }}>{ROLE_HELP[draft.role]}</span>
        <button type="submit" disabled={busy} style={{ ...btn.dark, alignSelf: "flex-start", height: "44px", borderRadius: "999px" }}>{busy ? "Añadiendo…" : "Añadir persona"}</button>
      </form>
    </>
  );
}
