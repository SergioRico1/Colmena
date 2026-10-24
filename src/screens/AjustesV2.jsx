import { useEffect, useState } from "react";
import { Calendar, Check, FileText, Folder, Lock, Mail, MessageSquare, Pause, Play, Volume2 } from "lucide-react";
import { playNoticeSound } from "../lib/noticeSounds.js";
import { BotPresence, PersonPresence } from "../components/v2/Presence.jsx";
import { useAction, useResource, useStore } from "../lib/store.jsx";
import { del, get, patch, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { EngineRow, EngineChoices } from "../components/v2/settings/Engines.jsx";
import ProviderMark, { WithMark } from "../components/v2/ProviderMark.jsx";
import { updates, useUpdates } from "../lib/updates.js";
import { later, reversible } from "../lib/undoToast.js";
import SettingsLayout from "../components/v2/settings/Layout.jsx";
import UsageSection from "../components/v2/settings/Usage.jsx";
import DiagnosticsSection, { diagnosticsDot, useDiagnostics } from "../components/v2/settings/Diagnostics.jsx";
import DictationSettings from "../components/v2/settings/Dictation.jsx";
import BackupSettings from "../components/v2/settings/Backup.jsx";
import EncryptionSettings from "../components/v2/settings/Encryption.jsx";
import PeopleSettings from "../components/v2/settings/People.jsx";
import { ALIAS, DEFAULT_SECTION, PARENT, SECTION_OF } from "../components/v2/settings/sections.js";
import { Chevron, FAINT, FieldRow, Group, INK, LINE, LinkRow, MUTED, Segmented, SwitchRow, Text, anchorOf, inputStyle, pill, rowStyle } from "../components/v2/settings/rows.jsx";
import VaultCard from "../components/settings/Vault.jsx";
import ApiKeysCard from "../components/settings/ApiKeys.jsx";
import AjustesSeccion from "./AjustesSeccion.jsx";
import DocHistory from "../components/v2/team/DocHistory.jsx";
import CodeArchiveSettings from "../components/v2/code/ArchiveSettings.jsx";

// Colmena 2.0 · Ajustes by sections (design/V2AjustesSecciones.dc.html): nine sections by
// what you want to do, each at /ajustes/<section> and each setting at …#<anchor>
// (src/components/v2/settings/sections.js). The detailed editors (models per bot, the app
// catalogue, folders, people, the action log) stay one click below their section.

const RED_LINES = ["…enviar algo fuera de la empresa", "…mover dinero", "…borrar o sobrescribir archivos", "…instalar programas"];
const CONNECTOR_LOOK = {
  correo: ["@", "#EAF0FF"], calendario: ["31", "#FFF0E6"], carpeta: ["▤", "#EAF6F0"], hojas: ["▦", "#EAF6F0"], chat: ["#", "#F2EEFF"],
  video: ["▶", "#FFF0E6"], crm: ["◎", "#EAF0FF"], erp: ["€", "#FFF4D1"],
};
// Search hint for the connections catalogue (/ajustes/conexiones?q=…).
const CATALOGUE_QUERY = { correo: "gmail", calendario: "calendar", carpeta: "drive", hojas: "sheets", chat: "slack", video: "meet", crm: "crm", erp: "accounting" };
const ROLES = ["Administrador", "Dirección", "Responsable de equipo", "Ventas", "Marketing", "Finanzas", "Operaciones", "Atención al cliente", "Recursos humanos"];
const hhmm = (iso) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

/** A text setting saved when you leave the field or press Enter. */
function TextField({ title, sub, value, onSave, anchor, last, max = 80, placeholder, list }) {
  const [draft, setDraft] = useState(value || "");
  useEffect(() => { setDraft(value || ""); }, [value]);
  const keep = () => { const v = draft.trim(); if (v && v !== (value || "")) onSave(v); else setDraft(value || ""); };
  return (
    <FieldRow title={title} sub={sub} anchor={anchor} last={last} control="1 1 300px">
      <input type="text" aria-label={title} value={draft} maxLength={max} placeholder={placeholder} list={list} onChange={(e) => setDraft(e.target.value)} onBlur={keep} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(value || ""); e.currentTarget.blur(); } }} style={inputStyle} />
    </FieldRow>
  );
}

// ───────────────────────────────────────────────────────────────────── Tu cuenta
function AccountSection({ settings, people, set, busy }) {
  const others = people.filter((p) => !p.self);
  return (
    <>
      <Group id="tu-t" title="Tú">
        <div style={{ display: "flex", alignItems: "center", gap: "18px", padding: "20px", borderBottom: LINE }}>
          <PersonPresence name={settings.userName || "Tú"} me size={56} />
          <Text title={settings.userName || "Tu cuenta"} sub={[settings.userRole, "en este ordenador"].filter(Boolean).join(" · ")} />
        </div>
        <TextField anchor="tu-nombre" title="Tu nombre" sub="Así te llaman los bots y firmas lo que apruebas." value={settings.userName} onSave={(v) => set({ userName: v })} />
        <TextField anchor="tu-rol" title="Tu rol" sub="Les ayuda a saber qué te importa." value={settings.userRole} list="st-roles" onSave={(v) => set({ userRole: v })} last />
        <datalist id="st-roles">{ROLES.map((r) => <option key={r} value={r} />)}</datalist>
      </Group>
      <Group id="esp-t" title="Tu espacio">
        <TextField anchor="nombre-espacio" title="Nombre del espacio" sub="El equipo, la empresa o el departamento que trabaja aquí." value={settings.spaceName} onSave={(v) => set({ spaceName: v })} last />
      </Group>
      <Group id="per-t" title="Personas del espacio" anchor="personas" note="Las personas de este espacio sirven para firmar lo que se aprueba y para asignar tareas. Para hablar con alguien que usa Colmena en su ordenador, ve a Ajustes › Personas.">
        {others.slice(0, 6).map((p) => (
          <div key={p.id} style={rowStyle(false, "64px")}>
            <PersonPresence name={p.name} size={32} />
            <Text title={p.name} sub={[p.role, p.email].filter(Boolean).join(" · ")} />
          </div>
        ))}
        <LinkRow title={others.length ? "Añadir o quitar personas" : "Añadir una persona"} value={others.length ? `${others.length + 1} en total` : null} to="/ajustes/personas" last />
      </Group>
      {busy ? <span role="status" style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>Guardando…</span> : null}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────── Inteligencia
function IntelligenceSection({ settings, provider, authError, models, ai, set, act }) {
  const engine = (id) => ai?.engines?.find((e) => e.id === id) || null;
  const openaiOn = !!engine("openai")?.connected || (!ai && !!provider?.connected);
  const teamEngine = ai?.primary || (openaiOn ? "openai" : null);
  // ChatGPT sign-in (the end of the flow arrives over SSE as a state refresh).
  const [waiting, setWaiting] = useState(null);
  const connected = ai ? openaiOn : !!provider?.connected;
  useEffect(() => { if (connected || authError) setWaiting(null); }, [connected, authError]);
  const login = () => act.act(async () => {
    const r = await post("/auth/start");
    if (r?.url) { window.open(r.url, "_blank", "noopener"); setWaiting({ url: r.url }); }
  });
  const gpt = waiting ? { text: "Esperando a que inicies sesión…", fg: "#8A5A00" }
    : connected ? { text: "Conectada · " + ((ai ? engine("openai")?.detail : provider?.label) || "ChatGPT"), fg: "#0B6B4A" }
    : authError ? { text: String(authError.message || authError), fg: "#B4231A" }
    : { text: "Colmena piensa con tu plan de ChatGPT. Inicia sesión para empezar.", fg: MUTED };
  const [open, setOpen] = useState(false);
  // ChatGPT's own list (Claude and OpenCode models are «provider/model» refs).
  const gptModels = models.filter((m) => !String(m.slug).includes("/"));
  const modelLabel = gptModels.find((m) => m.slug === settings.model)?.label || settings.model || "El recomendado";
  return (
    <>
      <Group id="ia-t" title="Cuentas de IA" note="Colmena entra con una cuenta que ya tienes: recibe un permiso, nunca tu contraseña.">
        <div {...anchorOf("chatgpt")} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", minHeight: "76px", padding: "14px 20px", borderBottom: LINE, scrollMarginTop: "24px" }}>
          <ProviderMark engine="openai" />
          <span style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: "3px" }}>
            <strong style={{ fontSize: "16px", fontWeight: 600 }}>Tu cuenta de ChatGPT</strong>
            <span role="status" style={{ fontSize: "14px", color: gpt.fg }}>{gpt.text}</span>
          </span>
          {waiting ? (
            <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span aria-hidden="true" style={{ width: "18px", height: "18px", borderRadius: "50%", border: "2px solid rgba(18,19,26,.15)", borderTopColor: INK, animation: "spin .8s linear infinite" }} />
              <button type="button" onClick={() => act.act(() => post("/auth/cancel")).then(() => setWaiting(null))} style={pill(false)}>Cancelar</button>
            </span>
          ) : connected ? (
            <button type="button" disabled={act.busy} onClick={() => act.act(() => post("/auth/logout"))} style={pill(false)}>Desconectar</button>
          ) : (
            <button type="button" disabled={act.busy} onClick={login} style={pill(true)}>Iniciar sesión</button>
          )}
        </div>
        {waiting ? (
          <p style={{ margin: 0, padding: "14px 20px 16px 76px", fontSize: "14px", lineHeight: 1.5, color: MUTED, borderBottom: LINE, animation: "fade .3s ease-out" }}>
            Hemos abierto la página oficial de inicio de sesión en tu navegador. Colmena nunca ve tu contraseña. Vuelve aquí cuando termines.{" "}
            <button type="button" onClick={() => window.open(waiting.url, "_blank", "noopener")} style={{ border: 0, padding: 0, background: "none", font: "inherit", color: INK, fontWeight: 600, textDecoration: "underline", cursor: "pointer" }}>Abrirla otra vez</button>
          </p>
        ) : null}
        {ai ? (
          <>
            <EngineRow engine="anthropic" info={engine("anthropic")} anchor="claude" />
            <EngineRow engine="opencode-go" info={engine("opencode-go")} anchor="opencode" last />
          </>
        ) : null}
      </Group>
      <Group id="usan-t" title="Qué usan" note={ai?.engines?.filter((e) => e.connected).length > 1 ? "Si la IA principal llega al límite de su plan o no responde, el trabajo sigue con la de respaldo, sin perder nada." : "Con dos IA conectadas puedes elegir una de respaldo para cuando la principal llegue a su límite."}>
        {ai ? <EngineChoices ai={ai} localConfigured={!!ai.local} last={false} /> : null}
        {teamEngine === "openai" || !ai ? (
          <>
            <button type="button" aria-haspopup="listbox" aria-expanded={open} disabled={!gptModels.length} onClick={() => setOpen(!open)} {...anchorOf("modelo")} style={{ ...rowStyle(false), cursor: gptModels.length ? "pointer" : "default" }}>
              <span style={{ flex: 1, fontSize: "16px" }}>Modelo que usan</span>
              <span style={{ fontSize: "15px", color: MUTED }}>{connected ? <WithMark engine="openai">{modelLabel}</WithMark> : "Al iniciar sesión"}</span>
              {gptModels.length ? <Chevron open={open} /> : null}
            </button>
            {open ? (
              <div role="listbox" aria-label="Modelo que usan" style={{ display: "flex", flexDirection: "column", gap: "2px", margin: "0 12px 12px", padding: "6px", borderRadius: "18px", background: "#F4F4F0", animation: "rise .2s ease-out" }}>
                {gptModels.map((m) => {
                  const on = m.slug === settings.model;
                  return (
                    <button key={m.slug} type="button" role="option" aria-selected={on} onClick={() => { setOpen(false); set({ model: m.slug }); }} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "52px", padding: "6px 14px", border: 0, borderRadius: "14px", cursor: "pointer", textAlign: "left", color: INK, background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 3px rgba(18,19,26,.12)" : "none" }}>
                      <ProviderMark engine="openai" size={28} />
                      <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
                        <strong style={{ fontSize: "15px", fontWeight: 600 }}>{m.label || m.slug}</strong>
                        {m.description ? <span style={{ fontSize: "13px", color: MUTED }}>{m.description}</span> : null}
                      </span>
                      <span aria-hidden="true" style={{ width: "20px", height: "20px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: on ? INK : "transparent", boxShadow: on ? "none" : "inset 0 0 0 1.5px rgba(18,19,26,.2)" }}>
                        <Check size={11} strokeWidth={3.4} color="#FFFFFF" style={{ opacity: on ? 1 : 0 }} />
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : null}
        <LinkRow anchor="por-bot" title="Qué usa cada bot" sub="Una IA distinta para un bot, o un modelo fijo por familia" to="/ajustes/ia" />
        <LinkRow anchor="avanzado" title="Clave de OpenAI y modelo de este ordenador" to="/ajustes/ia-v1" />
        <LinkRow title="Lo que queda de cada plan" value="En Uso" to="/ajustes/uso#limites-plan" last />
      </Group>
    </>
  );
}

// ───────────────────────────────────────────────────────────────── Bots y autonomía
const EVERY = [[1, "Cada hora"], [2, "2 h"], [4, "4 h"], [8, "8 h"]];
const CHECKIN_RESULT = { "avisó": "te avisó de algo", "nada importante": "no vio nada urgente", "sin cambios": "nada había cambiado", nada: "no había nada pendiente" };
/** «Revisión de Atlas» (server/checkins.mjs) in rows: on/off, how often, which hours, now. */
function CheckinRows() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  useEffect(() => { get("/checkin").then(setState).catch(() => {}); }, []);
  if (!state) return null;
  const save = async (changes) => { setBusy(true); setNote(null); try { setState(await patch("/checkin", changes)); } catch (e) { setNote(e.message); } finally { setBusy(false); } };
  const runNow = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await post("/checkin/run", {});
      setState(r);
      setNote(r.notified ? "Atlas te ha dejado un aviso en Hoy." : r.reason === "nada pendiente" ? "No había nada pendiente: no ha hecho falta preguntar al modelo." : "Atlas no ve nada urgente ahora.");
    } catch (e) { setNote(e.message); } finally { setBusy(false); }
  };
  const when = state.lastAt ? new Date(state.lastAt).toLocaleString("es-ES", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : null;
  const select = { height: "38px", padding: "0 10px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.05)", fontSize: "13px", fontWeight: 600, color: INK };
  return (
    <>
      <SwitchRow anchor="revision-atlas" title="Revisión de Atlas" sub="Mira lo que espera tu respuesta, las salas paradas y lo que vence, y solo te escribe si merece la pena. Con el modelo más barato." on={!!state.enabled} busy={busy} onChange={(v) => save({ enabled: v })} />
      {state.enabled ? (
        <>
          <FieldRow title="Cada cuánto">
            <Segmented label="Cada cuánto revisa" busy={busy} value={state.everyHours} onPick={(h) => save({ everyHours: h })} items={EVERY} />
          </FieldRow>
          <FieldRow title="En qué horario" sub={when ? `Última: ${when}${state.lastResult ? " · " + (CHECKIN_RESULT[state.lastResult] || state.lastResult) : ""}` : "Aún no ha revisado."}>
            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "14px", color: MUTED }}>
              de
              <select aria-label="Desde" disabled={busy} value={state.from ?? 9} onChange={(e) => save({ from: Number(e.target.value) })} style={select}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0") + ":00"}</option>)}
              </select>
              a
              <select aria-label="Hasta" disabled={busy} value={state.to ?? 20} onChange={(e) => save({ to: Number(e.target.value) })} style={select}>
                {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0") + ":00"}</option>)}
              </select>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <input type="checkbox" disabled={busy} checked={!!state.weekends} onChange={(e) => save({ weekends: e.target.checked })} />
                fines de semana
              </label>
              <button type="button" onClick={runNow} disabled={busy} style={{ ...pill(false), height: "38px", padding: "0 14px", fontSize: "13px" }}>{busy ? "Revisando…" : "Revisar ahora"}</button>
            </span>
          </FieldRow>
        </>
      ) : null}
      {note ? <p role="status" style={{ margin: 0, padding: "12px 20px", fontSize: "14px", color: "#0B6B4A", borderBottom: LINE }}>{note}</p> : null}
    </>
  );
}

function AutonomySection({ settings, paused, grants, bots, set, act }) {
  const botOf = (id) => bots.find((b) => b.id === id) || null;
  const pause = (on) => act.act(() => post("/control", { action: on ? "pause-all" : "resume-all" })).then(() => {
    reversible({ id: "pause-all", text: on ? "Equipo en pausa" : "El equipo sigue", undo: () => act.act(() => post("/control", { action: on ? "resume-all" : "pause-all" })) });
  });
  return (
    <>
      <Group id="ok-t" title="Siempre te preguntan antes de…" anchor="lineas-rojas" note="Esto no se puede apagar: un bot nunca hace nada de esto sin tu OK, aunque una sala, un encargo o una web le digan lo contrario.">
        {RED_LINES.map((t, i) => (
          <div key={t} style={rowStyle(i === RED_LINES.length - 1)}>
            <span style={{ flex: 1, fontSize: "16px" }}>{t}</span>
            <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 600, color: MUTED }}>
              <Lock size={14} strokeWidth={2.2} aria-hidden="true" />Siempre
            </span>
          </div>
        ))}
      </Group>
      <Group id="solo-t" title="Lo que hacen solos">
        <SwitchRow anchor="revisor" title="Revisor automático" sub="Lo que no sale de Colmena (guardar un archivo, recordar algo) lo aprueba el modelo más barato si es claramente parte de lo que pediste. Si duda, te lo deja a ti." on={settings.autoReview !== false} busy={act.busy} onChange={(v) => set({ autoReview: v })} />
        <SwitchRow anchor="aprenden" title="Aprenden de su trabajo" sub="Crean habilidades y recuerdos nuevos, pasan unos controles y los usan desde ya; te lo cuentan con «Deshacer». Los de «Solo sugiere» te los proponen antes." on={settings.learning !== false} busy={act.busy} onChange={(v) => set({ learning: v })} />
        <CheckinRows />
        <LinkRow anchor="capacidades" title="Qué más puede hacer cada bot" value="En Colmena" to="/colmena" last />
      </Group>
      <Group id="perfil-t" title="Tu perfil (USER.md) y sus versiones" anchor="perfil-historial" note="Cada cambio de tu perfil queda guardado: puedes volver a cualquier versión. El carácter de cada bot tiene su propio historial en su ficha.">
        <DocHistory doc="user" empty="Todavía no hay un perfil resumido: Colmena lo prepara cuando sabe lo suficiente de ti." />
      </Group>
      <Group id="cuentan-t" title="Cómo te lo cuentan">
        <SwitchRow anchor="narracion" title="Te cuentan en qué están" sub="Una frase mientras trabajan: «Leyendo tus correos de hoy…»." on={settings.narration !== false} busy={act.busy} onChange={(v) => set({ narration: v })} />
        <SwitchRow anchor="sugerencias" title="Respuestas sugeridas" sub="Hasta tres respuestas listas para pulsar bajo la última pregunta." on={settings.suggestions !== false} busy={act.busy} onChange={(v) => set({ suggestions: v })} />
        <SwitchRow anchor="resumenes" title="Resúmenes de sala" sub="Al volver a una sala, dos frases con lo que pasó mientras no estabas." on={settings.recaps !== false} busy={act.busy} onChange={(v) => set({ recaps: v })} last />
      </Group>
      <Group id="pausa-t" title="Todo el equipo" anchor="pausa">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", minHeight: "76px", padding: "14px 20px" }}>
          <Text title={paused ? "El equipo está en pausa" : "Pausar a todo el equipo"} sub={paused ? "Ningún bot trabaja ni ejecuta rutinas. Lo hecho se conserva y sigue donde lo dejó." : "Detiene a todos los bots y rutinas al momento. Lo hecho se conserva."} />
          <button type="button" disabled={act.busy} onClick={() => pause(!paused)} style={pill(!paused)}>
            {paused ? <Play size={15} strokeWidth={2.2} aria-hidden="true" /> : <Pause size={15} strokeWidth={2.2} aria-hidden="true" />}{paused ? "Reanudar" : "Pausar"}
          </button>
        </div>
      </Group>
      <Group id="siempre-t" title="Permisos que diste para siempre" anchor="permisos" note="Retirar uno hace que el bot vuelva a preguntarte cada vez.">
        {!grants.length ? <p style={{ margin: 0, padding: "18px 20px", fontSize: "15px", color: MUTED }}>Ninguno. Te preguntarán cada vez.</p> : null}
        {grants.map((g, i) => (
          <div key={g.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", minHeight: "64px", padding: "10px 20px", borderBottom: i === grants.length - 1 ? 0 : LINE }}>
            {botOf(g.botId) ? <BotPresence bot={botOf(g.botId)} size={24} /> : null}
            <span style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontSize: "15px" }}>{g.label || g.title || g.text || "Permiso"}</span>
              <span style={{ fontSize: "13px", color: FAINT }}>{[botOf(g.botId)?.name || "Todos los bots", g.createdAt ? "desde el " + new Date(g.createdAt).toLocaleDateString("es-ES", { day: "numeric", month: "long" }) : null, g.uses ? `${g.uses} veces` : null].filter(Boolean).join(" · ")}</span>
            </span>
            <button type="button" onClick={() => later({ id: "grant:" + g.id, keys: ["grant:" + g.id], text: "Permiso retirado", error: "No se pudo retirar", run: () => act.act(() => del(`/grants/${encodeURIComponent(g.id)}`)) })} style={{ ...pill(false), height: "36px", padding: "0 14px", fontSize: "13px" }}>Retirar</button>
          </div>
        ))}
      </Group>
    </>
  );
}

// ──────────────────────────────────────────────────────────────── Apps y conexiones
function AppsSection({ connectors, folders, bots, computer, act }) {
  const botOf = (id) => bots.find((b) => b.id === id) || null;
  return (
    <>
      <Group id="con-t" title="Apps conectadas" anchor="apps-conectadas">
        {connectors.map((c) => {
          const [glyph, tint] = CONNECTOR_LOOK[c.id] || ["•", "#EEEEE9"];
          return (
            <LinkRow key={c.id} to={`/ajustes/conexiones${c.connected ? "" : "?q=" + encodeURIComponent(CATALOGUE_QUERY[c.id] || c.name)}`}
              icon={<span aria-hidden="true" style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", borderRadius: "12px", font: "600 15px/1 'Geist', sans-serif", background: tint }}>{glyph}</span>}
              title={c.name}
              sub={c.connected ? "Conectado" + (c.botCount ? ` · lo usan ${c.botCount} ${c.botCount === 1 ? "bot" : "bots"}` : "") : "Sin conectar"} />
          );
        })}
        <LinkRow title="Todas tus apps" sub="Conectar otra, añadir una cuenta o quitarla" to="/ajustes/conexiones" />
        <LinkRow anchor="que-app" title="Qué app usa cada bot" sub="Quién solo mira y quién puede cambiar algo" to="/ajustes/permisos" last />
      </Group>
      <Group id="pc-t" title="Carpetas de este ordenador" anchor="carpetas" note="Los bots no pueden salir de las carpetas que les das. Borrar un archivo siempre te lo preguntan.">
        {folders.map((f) => (
          <div key={f.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 16px", minHeight: "76px", padding: "12px 20px", borderBottom: LINE }}>
            <span aria-hidden="true" style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", borderRadius: "12px", background: "#EAF6F0" }}><Folder size={18} strokeWidth={2} /></span>
            <span style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
              <strong style={{ fontSize: "16px", fontWeight: 600 }}>{f.label}</strong>
              <span style={{ color: MUTED, font: "500 12px/1.4 'Geist Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</span>
              <span style={{ fontSize: "13px", color: FAINT }}>{f.botIds?.length ? f.botIds.map((id) => botOf(id)?.name).filter(Boolean).join(", ") : "Todos"}</span>
            </span>
            <span style={{ flex: "0 1 230px" }}>
              <Segmented label={"Acceso a " + f.label} busy={act.busy} value={f.access} onPick={(v) => act.act(() => patch(`/folders/${encodeURIComponent(f.id)}`, { access: v }))} items={[["lee", "Solo leer"], ["escribe", "Leer y escribir"]]} />
            </span>
          </div>
        ))}
        <LinkRow title={folders.length ? "Elegir otra carpeta…" : "Elegir una carpeta…"} sub={folders.length ? "Y quién ve cada una" : "Ningún bot ve tus archivos hasta que les des una carpeta."} to="/ajustes/ordenador" last />
      </Group>
      <Group id="web-t" title="La web">
        <div {...anchorOf("navegador")} style={rowStyle(true, "72px")}>
          <Text title="Navegador propio para cada bot" sub="Pueden usar webs como tú. Nunca escriben contraseñas: las de la bóveda las pone Colmena." />
          <span style={{ fontSize: "14px", fontWeight: 500, color: computer?.available ? "#0B6B4A" : FAINT, whiteSpace: "nowrap" }}>{computer?.available ? "Activo" : "En la app de escritorio"}</span>
        </div>
      </Group>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────── Avisos
const RESULT = { "nada nuevo": "Nada nuevo", "nada importante": "Nada que contarte", "sin fuentes": "Conecta una app o elige una carpeta para empezar", error: "No pudo mirar" };
const SOURCE_ICON = { gmail: Mail, outlook: Mail, calendar: Calendar, slack: MessageSquare, drive: FileText, notion: FileText, folders: Folder };
const SOURCE_PHRASE = { gmail: "tu correo", outlook: "tu correo de Outlook", calendar: "tu agenda", slack: "Slack", drive: "Drive", notion: "Notion", folders: "tus carpetas" };
const lastLine = (d) => {
  if (d.stopped) return "Parado tras varios fallos: " + (d.lastError || "no pudo mirar");
  if (!d.lastAt) return null;
  const what = RESULT[d.lastResult] || (/novedad/.test(d.lastResult || "") ? "Te contó " + d.lastResult : d.lastResult || "Miró");
  return what + " · " + hhmm(d.lastAt);
};
/**
 * «Te avisa de lo importante» (server/watch.mjs, OpenClaw heartbeat): on/off, where it looks
 * (each connected place), how much it tells you, and what matters to you, in your words.
 */
function WatchRows({ bots }) {
  const { data, setData } = useResource("/watch");
  const act = useAction();
  const [list, setList] = useState(null); // «Qué te importa» while you write it
  if (!data) return null;
  const save = (changes) => act.act(async () => setData(await patch("/watch", changes)));
  const look = () => act.act(async () => setData(await post("/watch/run", {})));
  const bot = bots.find((b) => b.id === data.bot?.id);
  const name = bot?.name || "Un bot";
  const places = (data.sources || []).filter((s) => s.connected);
  const sub = places.length
    ? `${name} mira lo nuevo en ${[...new Set(places.map((s) => SOURCE_PHRASE[s.id] || s.label))].join(", ").replace(/, ([^,]*)$/, " y $1")} y te escribe solo cuando algo te importa.`
    : `Conecta tu correo, tu agenda u otra app y ${bot?.name || "tu bot"} te contará lo importante que llegue.`;
  const held = data.held ? ` · ${data.held} para el próximo resumen` : "";
  const draft = list ?? data.checklist ?? "";
  const keep = () => { if (list != null && list.trim() !== (data.checklist || "")) save({ checklist: list }); setList(null); };
  return (
    <>
      <SwitchRow anchor="te-avisa" title="Te avisa de lo importante" sub={sub} on={!!data.enabled} busy={act.busy} onChange={(v) => save({ enabled: v })} />
      {data.enabled ? (
        <>
          {places.length ? (
            <FieldRow title="Dónde mira" control="1 1 300px">
              <span role="group" aria-label="Dónde mira" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {places.map((s) => {
                  const Icon = SOURCE_ICON[s.id] || FileText;
                  const trouble = s.unavailable ? "Esta app no ofrece todavía una lectura que Colmena entienda." : s.stopped ? "Parado tras varios fallos: " + (s.error || "") : s.error;
                  return (
                    <button key={s.id} type="button" role="switch" aria-checked={s.on} disabled={act.busy} title={trouble || (s.on ? "Mira aquí. Pulsa para dejar de mirar." : "No mira aquí. Pulsa para que mire.")} onClick={() => save({ sources: { [s.id]: !s.on } })}
                      style={{ display: "flex", alignItems: "center", gap: "8px", height: "38px", padding: "0 14px 0 12px", borderRadius: "999px", cursor: act.busy ? "wait" : "pointer", fontSize: "13px", fontWeight: 600, transition: "all .2s ease",
                        border: s.on ? "1px solid #12131A" : "1px solid rgba(18,19,26,.12)", background: s.on ? "#12131A" : "transparent", color: s.on ? "#FFFFFF" : MUTED }}>
                      <Icon size={15} strokeWidth={2.2} aria-hidden="true" />
                      {s.label}
                      {s.on && trouble ? <span aria-label="Con problemas" style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#E5675A" }} /> : null}
                    </button>
                  );
                })}
              </span>
            </FieldRow>
          ) : null}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", minHeight: "72px", padding: "12px 20px", borderBottom: LINE }}>
            <span style={{ flex: "1 1 160px", display: "flex", flexDirection: "column", gap: "3px" }}>
              <span style={{ fontSize: "16px" }}>Qué te cuenta</span>
              <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: "13px", color: data.lastResult === "error" || data.stopped ? "#B4372A" : FAINT }}>
                {lastLine(data) ? <span title={data.lastError || undefined}>{lastLine(data) + held}</span> : null}
                {places.length ? <button type="button" disabled={act.busy} onClick={look} style={{ padding: 0, border: 0, background: "transparent", cursor: act.busy ? "wait" : "pointer", fontSize: "13px", fontWeight: 600, color: "#1F4FD1" }}>{act.busy ? "Mirando…" : "Mirar ahora"}</button> : null}
                {data.chatId && bot ? <a href={`/chat/${bot.id}?c=${data.chatId}`} style={{ fontSize: "13px", fontWeight: 600, color: "#1F4FD1" }}>Ver su chat</a> : null}
              </span>
            </span>
            <span style={{ flex: "1 1 300px" }}>
              <Segmented label="Qué te cuenta" busy={act.busy} value={data.level} onPick={(v) => save({ level: v })} items={[["urgente", "Solo lo urgente"], ["importante", "Todo lo importante"]]} />
            </span>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px 20px 18px", borderBottom: LINE }}>
            <span style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              <span style={{ fontSize: "16px" }}>Qué te importa</span>
              <span style={{ fontSize: "13px", color: FAINT }}>{`Con tus palabras. ${name} lo tiene en cuenta cada vez que mira.`}</span>
            </span>
            <textarea value={draft} maxLength={1500} rows={3} onChange={(e) => setList(e.target.value)} onBlur={keep}
              placeholder={"Avísame enseguida si escribe Oriol.\nLos pedidos de la app de Lumbre, mejor juntos en el resumen.\nNo me cuentes los boletines del banco."}
              style={{ width: "100%", boxSizing: "border-box", resize: "vertical", minHeight: "84px", padding: "12px 14px", border: "1px solid rgba(18,19,26,.1)", borderRadius: "16px", background: "#F6F6F3", font: "400 15px/1.5 'Geist', sans-serif", color: INK, outline: "none" }} />
          </label>
        </>
      ) : null}
      {act.error ? <p role="alert" style={{ margin: 0, padding: "10px 20px", fontSize: "14px", color: "#B4372A", borderBottom: LINE }}>{act.error}</p> : null}
    </>
  );
}
// «Cómo te avisa»: a Windows notice, a sound, both or nothing; each kind sounds its own way.
const NOTICE_MODES = [["both", "Aviso y sonido"], ["windows", "Solo aviso"], ["sound", "Solo sonido"], ["off", "Nada"]];
const NOTICE_SUB = {
  both: "Un aviso de Windows y un sonido distinto si ha terminado o si te necesita.",
  windows: "Un aviso de Windows, sin sonido.",
  sound: "Solo el sonido: uno si ha terminado y otro si te necesita.",
  off: "Nada te interrumpe. Todo sigue en Hoy y en el contador del icono.",
};
function NoticeMode({ value, busy, onPick }) {
  const sounds = value === "both" || value === "sound";
  const tryOne = { display: "inline-flex", alignItems: "center", gap: "7px", height: "34px", padding: "0 14px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: INK, background: "rgba(18,19,26,.05)" };
  return (
    <div {...anchorOf("como-avisa")} style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "14px 20px 16px", borderBottom: LINE, scrollMarginTop: "24px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px" }}>
        <span style={{ flex: "1 1 160px", display: "flex", flexDirection: "column", gap: "3px" }}>
          <strong style={{ fontSize: "16px", fontWeight: 600 }}>Cómo te avisa</strong>
          <span role="status" style={{ fontSize: "14px", color: MUTED }}>{NOTICE_SUB[value] || NOTICE_SUB.both}</span>
        </span>
        <span style={{ flex: "1 1 360px" }}>
          <Segmented label="Cómo te avisa" busy={busy} value={value} onPick={onPick} items={NOTICE_MODES} />
        </span>
      </div>
      {sounds ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", animation: "fade .25s ease-out" }}>
          <span style={{ fontSize: "13px", color: FAINT, marginRight: "4px" }}>Escúchalos</span>
          <button type="button" onClick={() => playNoticeSound("done")} style={tryOne}><Volume2 size={14} strokeWidth={2.2} aria-hidden="true" />Ha terminado</button>
          <button type="button" onClick={() => playNoticeSound("needs")} style={tryOne}><Volume2 size={14} strokeWidth={2.2} aria-hidden="true" />Te necesita</button>
          <button type="button" onClick={() => playNoticeSound("message")} style={tryOne}><Volume2 size={14} strokeWidth={2.2} aria-hidden="true" />Una persona te escribe</button>
          <button type="button" onClick={() => playNoticeSound("mention")} style={tryOne}><Volume2 size={14} strokeWidth={2.2} aria-hidden="true" />Te mencionan</button>
        </div>
      ) : null}
    </div>
  );
}
function NoticesSection({ settings, bots, set, busy }) {
  return (
    <>
      <Group id="vig-t" title="Lo que llega">
        <WatchRows bots={bots} />
      </Group>
      <Group id="av-t" title="Cómo y cuándo">
        <NoticeMode value={settings.notifyMode || "both"} busy={busy} onPick={(v) => set({ notifyMode: v })} />
        <SwitchRow anchor="horario" title="Horario tranquilo" sub="De 19:00 a 9:00 y fines de semana. Los bots siguen, pero no te avisan." on={!!settings.quietHours} busy={busy} onChange={(v) => set({ quietHours: v })} />
        <FieldRow title="Avísame de" anchor="avisame-de" last>
          <Segmented label="Avísame de" busy={busy} value={settings.notifyLevel || "todo"} onPick={(v) => set({ notifyLevel: v })} items={[["todo", "Todo"], ["importante", "Lo importante"], ["tuyo", "Solo lo que te toca"]]} />
        </FieldRow>
      </Group>
    </>
  );
}

// ─────────────────────────────────────────────────────────────── Privacidad y datos
function PrivacySection({ memories, act }) {
  const forgetAll = () => {
    const all = memories.map((m) => m.id);
    later({ id: "forget-all", keys: all.map((id) => "memory:" + id), text: "Los bots lo olvidan todo", error: "No se pudo olvidar todo",
      run: () => act.act(async () => { for (const id of all) await del(`/memories/${encodeURIComponent(id)}`); }) });
  };
  return (
    <>
      <Group id="pri-t" title="Lo que saben de ti" note="Olvidarlo todo no toca el Archivo: tus entregables y conversaciones se quedan.">
        <div {...anchorOf("privado")} style={rowStyle(false)}>
          <span style={{ flex: 1, fontSize: "16px" }}>Lo que hablas en privado con un bot</span>
          <span style={{ fontSize: "15px", color: MUTED }}>solo lo ves tú</span>
        </div>
        <LinkRow anchor="recuerdos" title="Qué recuerda cada bot de ti" value={`${memories.length} ${memories.length === 1 ? "cosa" : "cosas"}`} to="/archivo?pestana=memoria" last={!memories.length} />
        {memories.length ? (
          <button type="button" {...anchorOf("olvidar")} onClick={forgetAll} style={{ ...rowStyle(true), cursor: "pointer", fontSize: "16px", color: "#B4372A" }}>Hacer que los bots lo olviden todo</button>
        ) : null}
      </Group>
      <BackupSettings />
      <EncryptionSettings />
      <DictationSettings />
      <div {...anchorOf("boveda")} style={{ scrollMarginTop: "24px", borderRadius: "26px" }}><VaultCard /></div>
      <div {...anchorOf("claves")} style={{ scrollMarginTop: "24px", borderRadius: "26px" }}><ApiKeysCard /></div>
      <Group id="reg-t" title="Registro">
        <LinkRow anchor="registro" title="Registro de acciones" sub="Todo lo que han hecho, con quién lo aprobó y cuándo" to="/ajustes/seguridad" last />
      </Group>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────── Acerca de
function updateLine(u) {
  if (u.status === "checking") return "Buscando…";
  if (u.status === "downloading") return `Descargando la ${u.version}… ${u.percent || 0} %`;
  if (u.status === "ready") return u.waiting ? "Se actualizará cuando el equipo termine." : `La ${u.version} está lista. Se instala al reiniciar.`;
  if (u.status === "error") return u.error;
  return "Estás al día" + (u.checkedAt ? " · comprobado a las " + hhmm(u.checkedAt) : "");
}
const SHORTCUTS = [
  ["Ctrl K", "Buscar cualquier cosa o hacer algo (con «>», solo acciones)"],
  ["Ctrl N", "Nuevo chat"],
  ["Ctrl Z", "Deshacer lo último que archivaste o borraste"],
  ["/", "Buscar un ajuste, dentro de Ajustes"],
  ["F1", "Atajos de Código, dentro de Código"],
];
function AboutSection() {
  const u = useUpdates();
  const [notes, setNotes] = useState(false);
  const busy = u && (u.status === "checking" || u.status === "downloading");
  const manual = u?.status === "error" && u.manual;
  return (
    <>
      <Group id="upd-t" title="Colmena" note="Las versiones nuevas se descargan solas y se instalan al reiniciar o al cerrar Colmena. Nunca a mitad de una misión.">
        {u ? (
          <>
            <div {...anchorOf("version")} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", minHeight: "76px", padding: "12px 20px", borderBottom: LINE, scrollMarginTop: "24px" }}>
              <Text title={"Colmena " + u.current} sub={updateLine(u)} subColor={u.status === "ready" ? "#0B6B4A" : u.status === "error" ? "#B4372A" : MUTED} />
              <span {...anchorOf("actualizaciones")}>
                {u.status === "ready" && !u.waiting ? (
                  <button type="button" onClick={() => updates.restart()} style={pill(true)}>Reiniciar para actualizar</button>
                ) : manual ? (
                  <button type="button" onClick={() => updates.download()} style={pill(true)}>Descargar</button>
                ) : u.status === "ready" ? null : (
                  <button type="button" disabled={busy || !u.supported} onClick={() => updates.check()} style={{ ...pill(false), cursor: busy ? "wait" : "pointer" }}>{u.status === "downloading" ? "Descargando…" : busy ? "Buscando…" : "Buscar actualizaciones"}</button>
                )}
              </span>
            </div>
            <FieldRow anchor="canal" title="Canal" sub={u.channel === "beta" ? "Las novedades antes que nadie, con algún fallo." : "Versiones probadas."} control="0 1 230px" last={!(u.notes && u.version)}>
              <Segmented label="Canal de actualizaciones" value={u.channel} onPick={(v) => updates.setChannel(v)} items={[["stable", "Estable"], ["beta", "Beta"]]} />
            </FieldRow>
            {u.notes && u.version ? (
              <>
                <button type="button" aria-expanded={notes} onClick={() => setNotes(!notes)} style={{ ...rowStyle(!notes), cursor: "pointer" }}>
                  <Text title={"Novedades de la " + u.version} />
                  <Chevron open={notes} />
                </button>
                {notes ? <p style={{ margin: 0, padding: "0 20px 18px", fontSize: "14px", lineHeight: 1.6, color: MUTED, whiteSpace: "pre-wrap", animation: "fade .25s ease-out" }}>{u.notes}</p> : null}
              </>
            ) : null}
          </>
        ) : (
          <div {...anchorOf("version")} style={rowStyle(true, "72px")}>
            <Text title="Colmena 2.0" sub="Las actualizaciones las lleva la app de escritorio." />
          </div>
        )}
      </Group>
      <Group id="kb-t" title="Atajos de teclado" anchor="atajos">
        {SHORTCUTS.map(([k, what], i) => (
          <div key={k} style={rowStyle(i === SHORTCUTS.length - 1, "56px")}>
            <span style={{ flex: 1, fontSize: "15px" }}>{what}</span>
            <span style={{ display: "flex", gap: "4px" }}>
              {k.split(" ").map((p) => <kbd key={p} style={{ minWidth: "26px", height: "26px", padding: "0 7px", display: "inline-grid", placeItems: "center", borderRadius: "7px", background: "rgba(18,19,26,.06)", font: "600 12px/1 'Geist Mono', monospace", color: INK }}>{p}</kbd>)}
            </span>
          </div>
        ))}
      </Group>
    </>
  );
}

export default function AjustesV2({ params = {} }) {
  const store = useStore();
  const { settings = {}, provider, authError, models = [], connectors = [], folders = [], grants = [], memories = [], computer, bots = [], people = [], paused = false, ai = null, ready } = store;
  const act = useAction();
  const set = (changes) => act.act(() => patch("/settings", changes));
  const { result } = useDiagnostics();
  const raw = params.section || null;
  // A detail page of a section (/ajustes/ordenador, /ajustes/personas, /ajustes/seguridad).
  if (raw && PARENT[raw] && !SECTION_OF[raw]) return <AjustesSeccion params={{ section: raw }} />;
  const id = raw ? ALIAS[raw] || raw : DEFAULT_SECTION;
  const section = SECTION_OF[id];
  const noAI = ready && ai && !ai.engines?.some((e) => e.connected);
  const dots = {
    ...(noAI ? { inteligencia: { color: "#B4372A", label: "Ninguna IA conectada" } } : {}),
    ...(diagnosticsDot(result) ? { diagnostico: diagnosticsDot(result) } : {}),
  };
  if (!section) {
    return (
      <SettingsLayout active={null} open title="Esta sección no existe" lead="Elige una de la lista. Tus ajustes siguen como estaban." dots={dots}>
        <a href="/ajustes" onClick={(e) => { e.preventDefault(); navigate("/ajustes"); }} style={{ ...pill(true), alignSelf: "flex-start", textDecoration: "none" }}>Ir a Ajustes</a>
      </SettingsLayout>
    );
  }
  return (
    <SettingsLayout active={id} open={!!raw} dots={dots}>
      {act.error ? <p role="alert" style={{ margin: "-16px 20px 0", fontSize: "14px", color: "#B4231A" }}>{act.error}</p> : null}
      {id === "cuenta" ? <AccountSection settings={settings} people={people} set={set} busy={act.busy} /> : null}
      {id === "inteligencia" ? <IntelligenceSection settings={settings} provider={provider} authError={authError} models={models} ai={ai} set={set} act={act} /> : null}
      {id === "autonomia" ? <AutonomySection settings={settings} paused={paused || settings.paused} grants={grants} bots={bots} set={set} act={act} /> : null}
      {id === "autonomia" ? <CodeArchiveSettings /> : null}
      {id === "apps" ? <AppsSection connectors={connectors} folders={folders} bots={bots} computer={computer} act={act} /> : null}
      {id === "contactos" ? <PeopleSettings /> : null}
      {id === "avisos" ? <NoticesSection settings={settings} bots={bots} set={set} busy={act.busy} /> : null}
      {id === "privacidad" ? <PrivacySection memories={memories} act={act} /> : null}
      {id === "uso" ? <UsageSection /> : null}
      {id === "diagnostico" ? <DiagnosticsSection /> : null}
      {id === "acerca" ? <AboutSection /> : null}
    </SettingsLayout>
  );
}
