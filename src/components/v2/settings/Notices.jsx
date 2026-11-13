import Select from "../../Select.jsx";
import { useEffect, useState } from "react";
import { Calendar, FileText, Folder, Mail, MessageSquare, Volume2 } from "lucide-react";
import { playNoticeSound } from "../../../lib/noticeSounds.js";
import { useAction, useResource, useStore } from "../../../lib/store.jsx";
import { get, patch, post } from "../../../lib/api.js";
import { reversible } from "../../../lib/undoToast.js";
import { Alert, Card, Choices, INK, LINE, MUTED, Panel, Pills, Row, Switch, SwitchRow, UNDO_MS, btn, select, useSettings } from "./v3.jsx";

// Ajustes › Avisos (design/V3Ajustes.dc.html): what reaches you, how (a Windows notice and/or
// a sound), the quiet hours (fixed: 19:00 to 9:00 and weekends, server/notifications.mjs), the
// recap when you come back to a room, and the two bots that look for you: «Te avisa de lo
// importante» (server/watch.mjs) and «Revisión de Atlas» (server/checkins.mjs).

const LEVELS = [["tuyo", "Solo lo que me necesita", "Aprobaciones y preguntas"], ["importante", "Lo importante", "Y tareas terminadas o atascadas"], ["todo", "Todo", "Cada mensaje y cada paso"]];
const LEVEL_WORD = { tuyo: "solo lo que te necesita", importante: "lo importante", todo: "todo" };
const modeOf = (windows, sound) => (windows && sound ? "both" : windows ? "windows" : sound ? "sound" : "off");

// ───────────────────────────────────────────────────── «Te avisa de lo importante»
const RESULT = { "nada nuevo": "Nada nuevo", "nada importante": "Nada que contarte", "sin fuentes": "Conecta una app o elige una carpeta para empezar", error: "No pudo mirar" };
const SOURCE_ICON = { gmail: Mail, outlook: Mail, calendar: Calendar, slack: MessageSquare, drive: FileText, notion: FileText, folders: Folder };
const SOURCE_PHRASE = { gmail: "tu correo", outlook: "tu correo de Outlook", calendar: "tu agenda", slack: "Slack", drive: "Drive", notion: "Notion", folders: "tus carpetas" };
const hhmm = (iso) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const lastLine = (d) => {
  if (d.stopped) return "Parado tras varios fallos: " + (d.lastError || "no pudo mirar");
  if (!d.lastAt) return null;
  const what = RESULT[d.lastResult] || (/novedad/.test(d.lastResult || "") ? "Te contó " + d.lastResult : d.lastResult || "Miró");
  return what + " · " + hhmm(d.lastAt);
};

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
  const enable = (v) => save({ enabled: v }).then(() => reversible({ id: "watch:enabled", text: v ? `${name} te avisará de lo importante` : `${name} ya no mira lo que llega`, ms: UNDO_MS, undo: () => patch("/watch", { enabled: !v }).then(setData) }));
  return (
    <>
      <SwitchRow first anchor="te-avisa" title="Te avisa de lo importante" sub={sub} on={!!data.enabled} busy={act.busy} onChange={enable} />
      {data.enabled && places.length ? (
        <Row title="Dónde mira">
          <span role="group" aria-label="Dónde mira" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {places.map((s) => {
              const Icon = SOURCE_ICON[s.id] || FileText;
              const trouble = s.unavailable ? "Esta app no ofrece todavía una lectura que Colmena entienda." : s.stopped ? "Parado tras varios fallos: " + (s.error || "") : s.error;
              return (
                <button key={s.id} type="button" role="switch" aria-checked={s.on} disabled={act.busy} title={trouble || (s.on ? "Mira aquí. Pulsa para dejar de mirar." : "No mira aquí. Pulsa para que mire.")} onClick={() => save({ sources: { [s.id]: !s.on } })}
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 12px", border: 0, borderRadius: "999px", cursor: act.busy ? "wait" : "pointer", fontSize: "13px", fontWeight: 500, background: s.on ? INK : "#F1F1EC", color: s.on ? "#FFFFFF" : "#3D404A" }}>
                  <Icon size={14} strokeWidth={2} aria-hidden="true" />{s.label}
                  {s.on && trouble ? <span aria-label="Con problemas" style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#E5675A" }} /> : null}
                </button>
              );
            })}
          </span>
        </Row>
      ) : null}
      {data.enabled ? (
        <>
          <Row title="Qué te cuenta" sub={[lastLine(data) ? lastLine(data) + held : null].filter(Boolean).join("")} subColor={data.lastResult === "error" || data.stopped ? "#B4232A" : MUTED}>
            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
              <Pills label="Qué te cuenta" busy={act.busy} value={data.level} onPick={(v) => save({ level: v })} items={[["urgente", "Solo lo urgente"], ["importante", "Todo lo importante"]]} />
              {places.length ? <button type="button" disabled={act.busy} onClick={look} style={btn("outline", 34)}>{act.busy ? "Mirando…" : "Mirar ahora"}</button> : null}
              {data.chatId && bot ? <a href={`/chat/${bot.id}?c=${data.chatId}`} style={{ fontSize: "13px", fontWeight: 600, color: "#1F4FD1" }}>Ver su chat</a> : null}
            </span>
          </Row>
          <label style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px 22px 16px", borderTop: LINE }}>
            <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontSize: "15px", fontWeight: 500 }}>Qué te importa</span>
              <span style={{ fontSize: "13px", color: MUTED }}>{`Con tus palabras. ${name} lo tiene en cuenta cada vez que mira.`}</span>
            </span>
            <textarea className="c-quiet" value={draft} maxLength={1500} rows={3} onChange={(e) => setList(e.target.value)} onBlur={keep}
              placeholder={"Avísame enseguida si escribe mi socia.\nLos pedidos de la tienda, mejor juntos en el resumen.\nNo me cuentes los boletines del banco."}
              style={{ width: "100%", boxSizing: "border-box", resize: "vertical", minHeight: "84px", padding: "10px 12px", border: "1px solid rgba(18,19,26,.14)", borderRadius: "10px", background: "#FFFFFF", font: "400 14.5px/1.5 'Geist', sans-serif", color: INK }} />
          </label>
        </>
      ) : null}
      {act.error ? <p role="alert" style={{ margin: 0, padding: "10px 22px", fontSize: "14px", color: "#B4232A", borderTop: LINE }}>{act.error}</p> : null}
    </>
  );
}

// ─────────────────────────────────────────────────────────── «Revisión de Atlas»
const EVERY = [[1, "Cada hora"], [2, "2 h"], [4, "4 h"], [8, "8 h"]];
const CHECKIN_RESULT = { "avisó": "te avisó de algo", "nada importante": "no vio nada urgente", "sin cambios": "nada había cambiado", nada: "no había nada pendiente" };
function CheckinRows() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  useEffect(() => { get("/checkin").then(setState).catch(() => {}); }, []);
  if (!state) return null;
  const save = async (changes) => { setBusy(true); setNote(null); try { setState(await patch("/checkin", changes)); return true; } catch (e) { setNote(e.message); return false; } finally { setBusy(false); } };
  const enable = (v) => save({ enabled: v }).then((ok) => ok && reversible({ id: "checkin:enabled", text: v ? "Atlas revisará por ti" : "Atlas ya no revisa", ms: UNDO_MS, undo: () => patch("/checkin", { enabled: !v }).then(setState) }));
  const runNow = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await post("/checkin/run", {});
      setState(r);
      setNote(r.notified ? "Atlas te ha dejado un aviso en Inicio." : r.reason === "nada pendiente" ? "No había nada pendiente: no ha hecho falta preguntar al modelo." : "Atlas no ve nada urgente ahora.");
    } catch (e) { setNote(e.message); } finally { setBusy(false); }
  };
  const when = state.lastAt ? new Date(state.lastAt).toLocaleString("es-ES", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : null;
  const hour = { ...select, width: "92px", height: "36px", fontSize: "13.5px" };
  return (
    <>
      <SwitchRow anchor="revision-atlas" title="Revisión de Atlas" sub="Mira lo que espera tu respuesta, las salas paradas y lo que vence, y solo te escribe si merece la pena. Con el modelo más barato." on={!!state.enabled} busy={busy} onChange={enable} />
      {state.enabled ? (
        <>
          <Row title="Cada cuánto">
            <Pills label="Cada cuánto revisa" busy={busy} value={state.everyHours} onPick={(h) => save({ everyHours: h })} items={EVERY} />
          </Row>
          <Row title="En qué horario" sub={when ? `Última: ${when}${state.lastResult ? " · " + (CHECKIN_RESULT[state.lastResult] || state.lastResult) : ""}` : "Aún no ha revisado."}>
            <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "14px" }}>
              <Select aria-label="Desde" disabled={busy} value={state.from ?? 9} onChange={(e) => save({ from: Number(e.target.value) })} style={hour} options={Array.from({ length: 24 }, (_, h) => [h, h + ":00"])} />
              a
              <Select aria-label="Hasta" disabled={busy} value={state.to ?? 20} onChange={(e) => save({ to: Number(e.target.value) })} style={hour} options={Array.from({ length: 24 }, (_, h) => [h + 1, (h + 1) + ":00"])} />
              <label style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <input type="checkbox" disabled={busy} checked={!!state.weekends} onChange={(e) => save({ weekends: e.target.checked })} style={{ accentColor: INK }} />
                y fines de semana
              </label>
              <button type="button" onClick={runNow} disabled={busy} style={btn("outline", 34)}>{busy ? "Revisando…" : "Revisar ahora"}</button>
            </span>
          </Row>
        </>
      ) : null}
      {note ? <p role="status" style={{ margin: 0, padding: "12px 22px", fontSize: "14px", color: "#0B6B4A", borderTop: LINE }}>{note}</p> : null}
    </>
  );
}

export default function NoticesSection() {
  const { bots = [] } = useStore();
  const { settings, save, error } = useSettings();
  const mode = settings.notifyMode || "both";
  const windows = mode === "both" || mode === "windows";
  const sound = mode === "both" || mode === "sound";
  const level = settings.notifyLevel || "todo";
  const setMode = (next, text) => save({ notifyMode: next }, text, { notifyMode: mode });
  return (
    <>
      <Alert>{error}</Alert>
      <Panel anchor="avisame-de" title="Avísame de…">
        <Choices label="Nivel de avisos" value={level} items={LEVELS} onPick={(v) => v !== level && save({ notifyLevel: v }, "Te avisarán de " + LEVEL_WORD[v], { notifyLevel: level })} />
      </Panel>
      <Card label="Cómo y cuándo">
        <SwitchRow first anchor="como-avisa" title="Notificaciones del sistema" sub="Aunque Colmena esté cerrada en la bandeja." on={windows} onChange={(v) => setMode(modeOf(v, sound), v ? "Notificaciones encendidas" : "Notificaciones apagadas")} />
        <Row as="label" anchor="sonido-avisos" title="Sonido" sub="Uno si ha terminado y otro si te necesita.">
          <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
            <Select aria-label="Sonido" value={sound ? "on" : "off"} onChange={(e) => setMode(modeOf(windows, e.target.value === "on"), e.target.value === "on" ? "Con sonido" : "Sin sonido")} style={{ ...select, width: "220px" }} options={[["on", "Un sonido para cada aviso"], ["off", "Sin sonido"]]} />
            {sound ? <button type="button" aria-label="Escuchar el sonido de «te necesita»" title="Escuchar" onClick={(e) => { e.preventDefault(); playNoticeSound("needs"); }} style={{ ...btn("outline", 40), width: "40px", padding: 0 }}><Volume2 size={16} strokeWidth={2} aria-hidden="true" /></button> : null}
          </span>
        </Row>
        <Row anchor="horario" title="Horario tranquilo" sub="De 19:00 a 9:00 y los fines de semana. Siguen trabajando; te lo cuentan por la mañana.">
          <Switch on={!!settings.quietHours} label="Horario tranquilo" onChange={(v) => save({ quietHours: v }, v ? "Horario tranquilo encendido" : "Horario tranquilo apagado", { quietHours: !v })} />
        </Row>
        <SwitchRow anchor="resumenes" title="Resumen al volver a una sala" sub="Dos frases con lo que pasó mientras no estabas." on={settings.recaps !== false} onChange={(v) => save({ recaps: v }, v ? "Resúmenes de sala encendidos" : "Resúmenes de sala apagados", { recaps: !v })} />
      </Card>
      <Card label="Lo que llega" anchor={null}>
        <WatchRows bots={bots} />
        <CheckinRows />
      </Card>
    </>
  );
}

