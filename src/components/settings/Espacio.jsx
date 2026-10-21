import { useEffect, useState } from "react";
import { Card, Notice, PageHeader, Toggle, btn, field } from "./SettingsShell.jsx";
import { useAction, useStore } from "../../lib/store.jsx";
import { get, patch, post } from "../../lib/api.js";

const EVERY = [1, 2, 4, 8];
const RESULT = { "avisó": "te avisó de algo", "nada importante": "no vio nada urgente", "sin cambios": "nada había cambiado", nada: "no había nada pendiente" };

/** «Revisión de Atlas»: periodic check on the cheapest model; it only writes when it matters. */
function CheckinCard() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  useEffect(() => { get("/checkin").then(setState).catch(() => {}); }, []);
  if (!state) return null;
  const save = async (changes) => { setBusy(true); try { setState(await patch("/checkin", changes)); } catch (e) { setNote(e.message); } finally { setBusy(false); } };
  const runNow = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await post("/checkin/run", {});
      setState(r);
      setNote(r.notified ? "Atlas te ha dejado un aviso." : r.reason === "nada pendiente" ? "No hay nada pendiente: no ha hecho falta preguntar al modelo." : "Atlas no ve nada urgente ahora.");
    } catch (e) {
      setNote(e.message);
    } finally {
      setBusy(false);
    }
  };
  const when = state.lastAt ? new Date(state.lastAt).toLocaleString("es-ES", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <Card id="revision" title="Revisión de Atlas">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px", lineHeight: "1.5" }}>
          <strong style={{ fontSize: "15px" }}>{state.enabled ? `Atlas revisa cada ${state.everyHours === 1 ? "hora" : state.everyHours + " horas"}, de ${state.from ?? 9} a ${state.to ?? 20} h${state.weekends ? "" : ", entre semana"}` : "Revisión desactivada"}</strong>
          <span style={{ color: "#5C606C" }}>Mira lo que espera tu respuesta, las salas paradas, los hitos que vencen y las automatizaciones que fallan, y solo te escribe si merece la pena. Usa el modelo más barato y no gasta nada si no ha cambiado nada.</span>
        </span>
        <Toggle large on={state.enabled} disabled={busy} label="Revisión de Atlas" onChange={(v) => save({ enabled: v })} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px", paddingTop: "12px", borderTop: "1px solid rgba(18,19,26,.06)", fontSize: "14px" }}>
        <span role="group" aria-label="Cada cuánto" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ color: "#5C606C", marginRight: "4px" }}>Cada</span>
          {EVERY.map((h) => {
            const on = state.everyHours === h;
            return <button key={h} type="button" aria-pressed={on ? "true" : "false"} disabled={busy || !state.enabled} onClick={() => save({ everyHours: h })} style={{ height: "34px", padding: "0 12px", borderRadius: "17px", cursor: "pointer", fontSize: "13px", ...(on ? { background: "#12131A", color: "#FFFFFF", border: "0", fontWeight: "600" } : { background: "rgba(18,19,26,.06)", border: "0" }) }}>{h === 1 ? "1 h" : h + " h"}</button>;
          })}
        </span>
        <span role="group" aria-label="En qué horario" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
          <span style={{ color: "#5C606C" }}>de</span>
          <select aria-label="Desde" disabled={busy || !state.enabled} value={state.from ?? 9} onChange={(e) => save({ from: Number(e.target.value) })} style={{ height: "34px", padding: "0 8px", border: "0", borderRadius: "999px", background: "#FFFFFF", fontSize: "13px" }}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0") + ":00"}</option>)}
          </select>
          <span style={{ color: "#5C606C" }}>a</span>
          <select aria-label="Hasta" disabled={busy || !state.enabled} value={state.to ?? 20} onChange={(e) => save({ to: Number(e.target.value) })} style={{ height: "34px", padding: "0 8px", border: "0", borderRadius: "999px", background: "#FFFFFF", fontSize: "13px" }}>
            {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0") + ":00"}</option>)}
          </select>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginLeft: "6px", color: "#5C606C" }}>
            <input type="checkbox" disabled={busy || !state.enabled} checked={!!state.weekends} onChange={(e) => save({ weekends: e.target.checked })} />
            {"también fines de semana"}
          </label>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "13px", color: "#5C606C" }}>{when ? `Última: ${when}${state.lastResult ? " · " + (RESULT[state.lastResult] || state.lastResult) : ""}` : "Aún no ha revisado."}</span>
          <button type="button" onClick={runNow} disabled={busy} style={{ ...btn.quiet, color: "#12131A" }}>{busy ? "Revisando…" : "Revisar ahora"}</button>
        </span>
      </div>
      {note ? <Notice tone="ok">{note}</Notice> : null}
    </Card>
  );
}

/** Ajustes › Espacio: names, learning and the global pause (PATCH /api/settings, POST /api/control). */
export default function Espacio() {
  const { settings, paused, skills } = useStore();
  const { act, busy, error } = useAction();
  const [form, setForm] = useState({ spaceName: "", userName: "", userRole: "" });
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setForm({ spaceName: settings.spaceName || "", userName: settings.userName || "", userRole: settings.userRole || "" });
  }, [settings.spaceName, settings.userName, settings.userRole]);
  const pending = skills.filter((s) => s.status === "pending").length;
  const dirty = form.spaceName !== (settings.spaceName || "") || form.userName !== (settings.userName || "") || form.userRole !== (settings.userRole || "");

  const save = async (event) => {
    event.preventDefault();
    setSaved(false);
    const ok = await act(() => patch("/settings", { spaceName: form.spaceName.trim(), userName: form.userName.trim(), userRole: form.userRole.trim() }));
    if (ok !== undefined) setSaved(true);
  };

  return (
    <>
      <PageHeader title="Espacio">El equipo o departamento que trabaja aquí: su nombre, quién eres tú y cómo aprenden los bots.</PageHeader>
      <Notice>{error}</Notice>

      <form onSubmit={save} aria-labelledby="nombres" style={{ background: "#FFFFFF", border: "0", borderRadius: "26px", padding: "22px", display: "flex", flexDirection: "column", gap: "14px" }}>
        <h2 id="nombres" style={{ margin: "0", font: "600 20px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>Nombre y cuenta</h2>
        <label style={field.label}>
          Nombre del espacio
          <input value={form.spaceName} onChange={(e) => setForm({ ...form, spaceName: e.target.value })} maxLength={80} placeholder="Equipo de operaciones" style={{ ...field.input, height: "48px", font: "600 18px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }} />
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
          <label style={{ ...field.label, flex: "1 1 220px" }}>
            Tu nombre
            <input value={form.userName} onChange={(e) => setForm({ ...form, userName: e.target.value })} maxLength={80} placeholder="Tu cuenta" style={field.input} />
          </label>
          <label style={{ ...field.label, flex: "1 1 220px" }}>
            Tu rol
            <input value={form.userRole} onChange={(e) => setForm({ ...form, userRole: e.target.value })} maxLength={80} placeholder="Administrador" list="roles-espacio" style={field.input} />
            <datalist id="roles-espacio"><option value="Administrador" /><option value="Responsable" /><option value="Colaborador" /></datalist>
          </label>
        </div>
        <span style={{ fontSize: "13px", color: "#5C606C" }}>Tu nombre firma lo que apruebas en el registro y aparece abajo en la barra lateral.</span>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
          <button type="submit" disabled={busy || !dirty} style={{ ...btn.dark, height: "44px", borderRadius: "999px", opacity: dirty ? 1 : 0.55 }}>Guardar cambios</button>
          {saved && !dirty ? <span role="status" style={{ fontSize: "13px", color: "#0B6B4A", fontWeight: "600" }}>Guardado</span> : null}
        </div>
      </form>

      <Card id="aprendizaje" title="Aprendizaje automático">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px", lineHeight: "1.5" }}>
            <strong style={{ fontSize: "15px" }}>{settings.learning !== false ? "Los bots aprenden de su trabajo" : "Aprendizaje desactivado"}</strong>
            <span style={{ color: "#5C606C" }}>Los bots crean y mejoran habilidades al repetir tareas, y las usan desde ese momento. En la sala verás «Aprendido: …» con Deshacer, y puedes revisar sus pasos en el perfil de cada bot.</span>
          </span>
          <Toggle large on={settings.learning !== false} disabled={busy} label="Aprendizaje automático" onChange={(v) => act(() => patch("/settings", { learning: v }))} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px", paddingTop: "12px", borderTop: "1px solid rgba(18,19,26,.06)", fontSize: "14px" }}>
          <span>{pending ? `${pending} ${pending === 1 ? "habilidad espera" : "habilidades esperan"} tu revisión.` : "Ninguna habilidad espera revisión."}</span>
          <a href="/biblioteca?tab=habilidades" style={{ ...btn.quiet, color: "#12131A", textDecoration: "none" }}>Ver habilidades</a>
        </div>
      </Card>

      <Card id="sugerencias" title="Respuestas sugeridas">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px", lineHeight: "1.5" }}>
            <strong style={{ fontSize: "15px" }}>{settings.suggestions !== false ? "Te sugiere qué responder" : "Sin sugerencias"}</strong>
            <span style={{ color: "#5C606C" }}>Cuando un bot contesta, el modelo más barato propone hasta tres respuestas. Solo rellenan la caja al pulsarlas (o con Tab); nunca se envían solas.</span>
          </span>
          <Toggle large on={settings.suggestions !== false} disabled={busy} label="Respuestas sugeridas" onChange={(v) => act(() => patch("/settings", { suggestions: v }))} />
        </div>
      </Card>

      <Card id="narracion" title="Qué está haciendo">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px", lineHeight: "1.5" }}>
            <strong style={{ fontSize: "15px" }}>{settings.narration !== false ? "Te cuentan en qué están" : "Solo el estado"}</strong>
            <span style={{ color: "#5C606C" }}>En los trabajos largos, cada bot te dice en una frase qué está haciendo y qué le falta («Ya tengo dos tarifas; me falta la de Iberdrola»). Lo escribe el modelo más barato, como mucho cada 15 segundos.</span>
          </span>
          <Toggle large on={settings.narration !== false} disabled={busy} label="Narración del trabajo" onChange={(v) => act(() => patch("/settings", { narration: v }))} />
        </div>
      </Card>

      <CheckinCard />

      <section aria-labelledby="pausa" style={paused
        ? { background: "#FFFFFF", border: "0", borderRadius: "18px", padding: "22px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px" }
        : { background: "#FFFFFF", border: "0", borderRadius: "18px", padding: "22px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px" }}>
        <span style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: "6px" }}>
          <h2 id="pausa" style={{ margin: "0", font: "600 20px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{paused ? "El equipo está en pausa" : "Pausar a todo el equipo"}</h2>
          <span style={{ fontSize: "14px", lineHeight: "1.5", color: "#5C606C" }}>{paused
            ? "Ningún bot trabaja ni ejecuta automatizaciones. El trabajo hecho se conserva y sigue donde lo dejó al reanudar."
            : "Detiene a todos los bots y automatizaciones al momento. El trabajo hecho se conserva."}</span>
        </span>
        {paused
          ? <button type="button" disabled={busy} onClick={() => act(() => post("/control", { action: "resume-all" }))} style={{ ...btn.dark, height: "48px", padding: "0 20px", borderRadius: "999px", fontSize: "15px" }}>Reanudar el equipo</button>
          : <button type="button" disabled={busy} onClick={() => act(() => post("/control", { action: "pause-all" }))} style={{ ...btn.honey, height: "48px", padding: "0 20px", fontSize: "15px" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            Pausar a todo el equipo
          </button>}
      </section>
    </>
  );
}
