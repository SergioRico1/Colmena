import { useEffect, useState } from "react";
import { useAction, useStore } from "../../../lib/store.jsx";
import { del, get, patch, post, put } from "../../../lib/api.js";
import { later, reversible, useHiddenVersion, visible } from "../../../lib/undoToast.js";
import { Alert, BotMark, Card, Go, MUTED, Panel, Pills, Row, Switch, SwitchRow, UNDO_MS, anchorOf, btn, useSettings } from "./v3.jsx";

// Ajustes › Permisos y autonomía (design/V3Permisos.dc.html): the red lines, which no setting,
// routine or bot can skip (send outside, pay, publish, delete for real, type passwords,
// install); how much each bot does on its own; which app each one may read or change; the
// permissions you gave «for ever»; and the automatic reviewer. Browsing never asks.

const RED = ["Enviar algo fuera", "Mover dinero o pagar", "Publicar en público", "Borrar de verdad", "Escribir contraseñas", "Instalar programas"];
const AUTONOMY = [["sugiere", "Solo sugiere"], ["avisa", "Hace y avisa"], ["solo", "Hace solo"]];
const AUTONOMY_WORD = { sugiere: "solo sugiere", avisa: "hace y avisa", solo: "hace solo" };
// Kinds of app a bot can be given (bot.tools): none → lee → escribe. «pide» (reads and asks
// before writing) shows as its own step and moves on to «escribe».
const APPS = [["correo", "Correo"], ["calendario", "Calendario"], ["carpeta", "Carpeta"], ["hojas", "Hojas"], ["chat", "Chat"]];
const NEXT = { none: "lee", lee: "escribe", pide: "escribe", escribe: "none" };
const CELL = { none: ["No", "#F1F1EC", "#5C606C"], lee: ["Lee", "#EEF0F4", "#1F4FD1"], pide: ["Lee y pide", "#EEF0F4", "#1F4FD1"], escribe: ["Escribe", "#12131A", "#FFFFFF"] };
const lock = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flex: "none" }}><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>;

// «Tareas de Código» (T3 Code auto-settle rules, GET/PUT /api/code/archive-settings): finished
// tasks leave the list on their own when saved into main, when their PR closes, or after idle days.
const DAYS = [[0, "Nunca"], [1, "1 día"], [3, "3 días"], [7, "7 días"], [14, "14 días"]];
// How long a bot that acts on its own waits for your answer (settings.questionWaitMinutes).
const WAITS = [[5, "5 min"], [10, "10 min"], [30, "30 min"], [60, "1 hora"], [0, "Sin límite"]];
function CodeArchive() {
  const [rules, setRules] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { get("/code/archive-settings").then((d) => setRules(d.rules), (e) => setError(e.message)); }, []);
  if (!rules) return error ? <Alert>{error}</Alert> : null;
  const save = async (change, text) => {
    const before = Object.fromEntries(Object.keys(change).map((k) => [k, rules[k]]));
    setBusy(true); setError(null);
    try {
      setRules((await put("/code/archive-settings", change)).rules);
      reversible({ id: "code-archive:" + Object.keys(change)[0], text, ms: UNDO_MS, undo: () => put("/code/archive-settings", before).then((d) => setRules(d.rules)) });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Card anchor="codigo-archivar" label="Tareas de Código">
      <div style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "18px 22px 10px" }}>
        <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>Tareas de Código</h3>
        <span style={{ fontSize: "13px", lineHeight: 1.45, color: MUTED }}>Archivar no borra nada: la tarea pasa a «Archivadas» y vuelve si le escribes. Nunca se archiva si está fijada, trabaja, te espera o está pospuesta.</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Row title="Archivar las inactivas" sub="Tras estos días sin que escribas ni trabaje.">
          <Pills label="Archivar las inactivas tras" items={DAYS} value={rules.idleDays} busy={busy} onPick={(v) => save({ idleDays: v }, v ? `Se archivan tras ${v} ${v === 1 ? "día" : "días"}` : "Ya no se archivan por inactividad")} />
        </Row>
        <SwitchRow title="Al guardarla en main" sub="Su copia ya se limpia; la tarea sale de la lista." on={rules.onSave} busy={busy} onChange={(v) => save({ onSave: v }, v ? "Se archivan al guardarse en main" : "No se archivan al guardarse")} />
        <SwitchRow title="Al fusionarse o cerrarse su PR" on={rules.onPr} busy={busy} onChange={(v) => save({ onPr: v }, v ? "Se archivan al cerrarse su PR" : "No se archivan al cerrarse su PR")} />
        <SwitchRow title="Conservar las que tienen una PR abierta" sub="Aunque pasen los días sin actividad." on={rules.keepWithPr} busy={busy} onChange={(v) => save({ keepWithPr: v }, v ? "Se conservan las que tienen PR" : "Las que tienen PR también se archivan")} />
      </div>
      {error ? <div style={{ padding: "0 22px 14px" }}><Alert>{error}</Alert></div> : null}
    </Card>
  );
}

export function PauseButton() {
  const { paused, settings = {}, run } = useStore();
  const act = useAction();
  const on = !!(paused || settings.paused);
  const flip = () => act.act(() => post("/control", { action: on ? "resume-all" : "pause-all" })).then(() => {
    reversible({ id: "pause-all", text: on ? "El equipo sigue" : "Equipo en pausa", ms: UNDO_MS, undo: () => run(() => post("/control", { action: on ? "pause-all" : "resume-all" })) });
  });
  return (
    <button type="button" {...anchorOf("pausa")} disabled={act.busy} onClick={flip} title={on ? "Ningún bot trabaja ni ejecuta rutinas. Lo hecho se conserva." : "Detiene a todos los bots y rutinas al momento. Lo hecho se conserva."}
      style={{ ...btn(on ? "dark" : "outline", 40), fontWeight: 500, borderColor: "rgba(18,19,26,.16)" }}>
      {on ? "Reanudar al equipo" : "Pausar a todo el equipo"}
    </button>
  );
}

export default function AutonomySection() {
  const { bots = [], connectors = [], grants = [], ready, run } = useStore();
  const { settings, save, error } = useSettings();
  const act = useAction();
  const [pending, setPending] = useState(null);
  useHiddenVersion();
  const team = bots.filter((b) => b.enabled !== false && b.audience !== "yo");
  const apps = connectors.some((c) => c.id === "erp" && c.connected) ? [...APPS, ["erp", "Contabilidad"]] : APPS;
  const connected = (key) => connectors.find((c) => c.id === key)?.connected;
  const botOf = (id) => bots.find((b) => b.id === id) || null;

  const setBot = (b, change, text, before) => act.act(() => patch(`/bots/${encodeURIComponent(b.id)}`, change))
    .then(() => reversible({ id: `bot:${b.id}:${Object.keys(change)[0]}`, text, ms: UNDO_MS, undo: () => run(() => patch(`/bots/${encodeURIComponent(b.id)}`, before)) }));
  const cycle = (b, key) => {
    const now = b.tools?.[key] || "none";
    const next = NEXT[now] || "lee";
    setPending(b.id + key);
    setBot(b, { tools: { ...(b.tools || {}), [key]: next } }, `${b.name} en ${apps.find(([k]) => k === key)[1]}: ${CELL[next][0].toLowerCase()}`, { tools: { ...(b.tools || {}) } }).finally(() => setPending(null));
  };
  const shownGrants = visible("grant", grants);
  return (
    <>
      <Alert>{error || act.error}</Alert>
      <section {...anchorOf("lineas-rojas")} aria-labelledby="red-t" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "20px 22px", borderRadius: "20px", background: "#12131A", color: "#FFFFFF", scrollMarginTop: "24px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <h3 id="red-t" style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>Siempre te preguntan antes de…</h3>
          <span style={{ fontSize: "13.5px", color: "#C9CBD3" }}>Las líneas rojas. Ningún ajuste, rutina ni bot puede saltárselas. Navegar por la web nunca pregunta.</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: "8px" }}>
          {RED.map((r) => <div key={r} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "48px", padding: "0 14px", borderRadius: "12px", background: "rgba(255,255,255,.08)", fontSize: "14px" }}>{lock}{r}</div>)}
        </div>
        <span style={{ fontSize: "13.5px", color: "#E6E7EC" }}>Si pides tú «envíalo», sale tras 10 segundos para que puedas deshacer.</span>
      </section>

      <Panel big anchor="autonomia-bot" title="Cuánto hace solo cada bot" sub="Fuera de las líneas rojas." style={{ gap: "6px" }}>
        <>
          {team.map((b) => (
            <div key={b.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", minHeight: "52px", borderTop: "1px solid rgba(18,19,26,.05)" }}>
              <span style={{ flex: "1 1 140px", display: "flex", alignItems: "center", gap: "10px", fontSize: "14.5px", fontWeight: 500 }}><BotMark bot={b} size={18} />{b.name}</span>
              <div role="radiogroup" aria-label={"Autonomía de " + b.name} style={{ display: "inline-flex", flexWrap: "wrap", padding: "3px", gap: "2px", borderRadius: "999px", background: "#F1F1EC" }}>
                {AUTONOMY.map(([v, label]) => {
                  const on = (b.autonomy || "sugiere") === v;
                  return <button key={v} type="button" role="radio" aria-checked={on} disabled={act.busy} onClick={() => !on && setBot(b, { autonomy: v }, `${b.name} ${AUTONOMY_WORD[v]}`, { autonomy: b.autonomy || "sugiere" })} style={{ height: "30px", padding: "0 12px", border: 0, borderRadius: "999px", background: on ? "#12131A" : "transparent", color: on ? "#FFFFFF" : "#3D404A", fontSize: "13px", fontWeight: 500, cursor: "pointer" }}>{label}</button>;
                })}
              </div>
            </div>
          ))}
          {!team.length ? <p style={{ margin: 0, padding: "12px 0", fontSize: "14px", color: MUTED }}>{ready ? "Aún no hay bots en el equipo." : "Cargando el equipo…"}</p> : null}
        </>
      </Panel>

      <Panel big anchor="que-app" title="Qué app usa cada bot" sub={<>Toca una casilla para cambiarla: No → Lee → Escribe. Las apps se conectan en <Go to="/ajustes/apps">Apps y carpetas</Go>.</>}>
        <div role="table" aria-label="Qué app usa cada bot" style={{ display: "flex", flexDirection: "column", overflowX: "auto" }}>
          <div role="row" style={{ display: "grid", gridTemplateColumns: `minmax(120px, 1.3fr) repeat(${apps.length}, minmax(84px, 1fr))`, gap: "6px", alignItems: "center", minWidth: "560px", padding: "4px 0 8px", fontSize: "12.5px", fontWeight: 600, color: MUTED }}>
            <span role="columnheader">Bot</span>
            {apps.map(([k, label]) => (
              <span key={k} role="columnheader" title={connected(k) ? "Conectada" : "Sin conectar"} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "5px" }}>
                {label}<span aria-label={connected(k) ? "conectada" : "sin conectar"} style={{ width: "6px", height: "6px", borderRadius: "50%", background: connected(k) ? "#0B8A5F" : "rgba(18,19,26,.18)" }} />
              </span>
            ))}
          </div>
          {team.map((b) => (
            <div key={b.id} role="row" style={{ display: "grid", gridTemplateColumns: `minmax(120px, 1.3fr) repeat(${apps.length}, minmax(84px, 1fr))`, gap: "6px", alignItems: "center", minWidth: "560px", minHeight: "50px", borderTop: "1px solid rgba(18,19,26,.06)" }}>
              <span role="rowheader" style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "14px", fontWeight: 500 }}><BotMark bot={b} size={14} />{b.name}</span>
              {apps.map(([k, label]) => {
                const v = b.tools?.[k] || "none";
                const [text, bg, ink] = CELL[v] || CELL.none;
                return (
                  <span key={k} role="cell" style={{ display: "grid", placeItems: "center" }}>
                    <button type="button" onClick={() => cycle(b, k)} disabled={act.busy} aria-label={`${b.name} en ${label}: ${text}. Pulsa para cambiar a ${CELL[NEXT[v] || "lee"][0]}.`}
                      style={{ width: "100%", maxWidth: "92px", height: "32px", padding: "0 10px", border: 0, borderRadius: "999px", background: bg, color: ink, fontSize: "12.5px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", opacity: pending === b.id + k ? 0.5 : 1 }}>{text}</button>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </Panel>

      <Panel big anchor="permisos" title="Permisos que diste para siempre" sub="Cuando pulsaste «Permitir siempre». Retíralos cuando quieras. Las líneas rojas nunca entran aquí." style={{ gap: "6px" }}>
        <>
          {!shownGrants.length ? <p style={{ margin: 0, padding: "12px 0", fontSize: "14px", color: MUTED, borderTop: "1px solid rgba(18,19,26,.05)" }}>Ninguno. Te preguntarán cada vez.</p> : null}
          {shownGrants.map((g) => (
            <div key={g.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", minHeight: "54px", borderTop: "1px solid rgba(18,19,26,.05)" }}>
              <span style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "14.5px" }}>{[botOf(g.botId)?.name, g.label || g.title || g.text || "Permiso"].filter(Boolean).join(" · ")}</span>
                <span style={{ fontSize: "12.5px", color: MUTED }}>{[g.botId ? null : "Todos los bots", g.createdAt ? "Desde el " + new Date(g.createdAt).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : null, g.uses ? `usado ${g.uses} ${g.uses === 1 ? "vez" : "veces"}` : null].filter(Boolean).join(" · ")}</span>
              </span>
              <button type="button" onClick={() => later({ id: "grant:" + g.id, keys: ["grant:" + g.id], ms: UNDO_MS, text: "Permiso retirado", error: "No se pudo retirar", run: () => run(() => del(`/grants/${encodeURIComponent(g.id)}`)) })} style={btn("outline", 34)}>Retirar</button>
            </div>
          ))}
        </>
      </Panel>

      <Card><Row anchor="revisor" first title="Revisor automático" sub="Lo que no sale de Colmena (guardar un archivo, recordar algo) lo aprueba el modelo más barato si es claramente parte de lo que pediste. Nunca las líneas rojas ni nada tras leer contenido de fuera; si duda, te lo deja a ti." min="84px">
        <Switch on={settings.autoReview !== false} label="Revisor automático" onChange={(v) => save({ autoReview: v }, v ? "Revisor automático encendido" : "Revisor automático apagado", { autoReview: !v })} />
      </Row></Card>

      <Card>
        <Row anchor="esperar-respuesta" first title="Cuánto espera un bot tu respuesta" sub="Si le preguntas algo a un bot que hace solo y no respondes a tiempo, sigue con lo más prudente y te dice qué supuso. La pregunta sigue abierta: si respondes luego, se lo pasa. El silencio nunca vale como permiso." min="84px">
          <Pills label="Espera tu respuesta" items={WAITS} value={settings.questionWaitMinutes ?? 10} onPick={(v) => save({ questionWaitMinutes: v }, v ? `Espera tu respuesta ${v} min` : "Espera tu respuesta sin límite", { questionWaitMinutes: settings.questionWaitMinutes ?? 10 })} />
        </Row>
        <Row anchor="sin-supervision" title="Rutinas sin supervisión" sub="Las rutinas y disparadores que trabajan cuando no estás no esperan por las líneas rojas: hacen todo lo demás y te dejan en la Bandeja lo que necesita tu OK, para aprobarlo después." min="84px">
          <Switch on={settings.unattended === true} label="Rutinas sin supervisión" onChange={(v) => save({ unattended: v }, v ? "Las rutinas no esperan por las líneas rojas" : "Las rutinas esperan tu OK en las líneas rojas", { unattended: !v })} />
        </Row>
      </Card>

      <CodeArchive />
    </>
  );
}
