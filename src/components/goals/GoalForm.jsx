import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../../lib/store.jsx";
import { BotAvatar, darkBtn, field, honeyBtn, label, textBtn, toDateInput, errorText, Spinner } from "./shared.jsx";

/**
 * Create / edit a goal. `initial` = existing goal (edit) or a partial draft (create).
 * onSubmit({ title, why, dueAt, ownerBotId }) returns a promise; onCancel closes the form.
 */
export default function GoalForm({ initial = {}, mode = "create", busy = false, error = null, onSubmit, onCancel }) {
  const { bots } = useStore();
  const team = bots.filter((b) => b.enabled !== false);
  const [title, setTitle] = useState(initial.title || "");
  const [why, setWhy] = useState(initial.why || "");
  const [due, setDue] = useState(toDateInput(initial.dueAt));
  const [owner, setOwner] = useState(initial.ownerBotId || "atlas");
  const [local, setLocal] = useState(null);
  const first = useRef(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  const ownerBot = team.find((b) => b.id === owner);
  const create = mode === "create";

  const submit = (e) => {
    e.preventDefault();
    if (!title.trim()) {
      setLocal("Escribe qué quieres conseguir.");
      first.current?.focus();
      return;
    }
    setLocal(null);
    onSubmit({ title: title.trim(), why: why.trim(), dueAt: due || null, ownerBotId: owner });
  };

  return (
    <form onSubmit={submit} aria-label={create ? "Nuevo objetivo" : "Editar objetivo"} style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "20px", background: "#FFFFFF", border: "2px solid #12131A", borderRadius: "26px" }}>
      <h2 style={{ margin: "0", font: "600 20px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{create ? "Nuevo objetivo" : "Editar el objetivo"}</h2>
      <label style={label}>
        {"¿Qué quieres conseguir?"}
        <input ref={first} value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} placeholder="Por ejemplo: Abrir la tienda online antes de Navidad" style={field} aria-invalid={local ? "true" : undefined} />
      </label>
      <label style={label}>
        {"¿Por qué te importa?"}
        <textarea value={why} maxLength={1000} rows={2} onChange={(e) => setWhy(e.target.value)} placeholder="Con tus palabras. Atlas lo tendrá en cuenta al proponer los hitos." style={{ ...field, resize: "vertical", lineHeight: "1.45" }} />
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
        <label style={{ ...label, flex: "1 1 180px" }}>
          {"Para cuándo"}
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={field} />
        </label>
        <label style={{ ...label, flex: "2 1 240px" }}>
          {"Quién lo coordina"}
          <span style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <span style={{ position: "absolute", left: "10px", pointerEvents: "none", display: "flex" }}><BotAvatar bot={ownerBot} size={24} /></span>
            <select value={owner} onChange={(e) => setOwner(e.target.value)} style={{ ...field, paddingLeft: ownerBot ? "44px" : "12px", cursor: "pointer" }}>
              {team.map((b) => <option key={b.id} value={b.id}>{`${b.name} · ${b.role}`}</option>)}
            </select>
          </span>
        </label>
      </div>
      {local || error ? <span role="alert" style={errorText}>{local || error}</span> : null}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
        <button type="submit" disabled={busy} style={create ? honeyBtn : darkBtn}>
          {busy ? <Spinner /> : null}
          {create ? (busy ? "Creando…" : "Crear objetivo") : busy ? "Guardando…" : "Guardar cambios"}
        </button>
        <button type="button" onClick={onCancel} style={{ ...textBtn, height: "44px", fontSize: "14px" }}>{"Cancelar"}</button>
        {create ? <span style={{ fontSize: "13px", color: "#4A4F5C" }}>{"Después podrás pedir a Atlas que lo parta en hitos."}</span> : null}
      </div>
    </form>
  );
}
