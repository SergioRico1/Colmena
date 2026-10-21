import React, { useEffect, useMemo, useRef, useState } from "react";
import { get } from "../lib/api.js";

// Controlled version of design/Disparador.dc.html (same markup and inline styles).
// Props: { tipo, value (config), sentence (last known), onChange(config, sentence), bots, folders, rooms, connectors, onProbar }
//  - value === undefined → the component keeps its own state (reference page).
//  - onProbar(config, sentence) → Promise<string> for event triggers («Probar con lo último»).
// Config shapes per tipo are documented in TRIGGER_DEFAULTS below.

export const TRIGGER_META = {
  dia: ["Cada día a una hora", "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"],
  semana: ["Cada semana", "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4"],
  vez: ["Una sola vez", "M5 21V4h12l-2 4 2 4H5"],
  correo: ["Llegue un correo", "M3 5h18v14H3zM3 7l9 6 9-6"],
  archivo: ["Se suba un archivo", "M3 6h7l2 2h9v11H3z"],
  evento: ["Se acerque un evento", "M4 6h16v14H4zM4 10h16M8 14h4"],
  sala: ["Alguien escriba en una sala", "M4 5h16v11H9l-5 4z"],
  hoja: ["Cambie una hoja de cálculo", "M4 4h16v16H4zM4 10h16M10 4v16"],
  web: ["Una página web cambia", "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 9h17M3.5 15h17M12 3c-2.4 2.5-3.6 5.5-3.6 9s1.2 6.5 3.6 9c2.4-2.5 3.6-5.5 3.6-9S14.4 5.5 12 3z"],
};
export const TIME_TRIGGERS = ["dia", "semana", "vez"];

const ZONES = [
  ["Europe/Madrid", "Madrid"],
  ["Atlantic/Canary", "Canarias"],
  ["Europe/Lisbon", "Lisboa"],
  ["America/Mexico_City", "Ciudad de México"],
];
function localZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Madrid";
  } catch {
    return "Europe/Madrid";
  }
}
function zoneOffset(tz) {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName");
    const raw = (part?.value || "GMT").replace("GMT", "UTC");
    return raw === "UTC" ? "UTC+0" : raw.replace("-", "−");
  } catch {
    // Older ICU without «shortOffset»: work it out from the wall clock of that zone.
    try {
      const now = new Date();
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(now).map((p) => [p.type, p.value]));
      const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
      const minutes = Math.round((wall - now.getTime()) / 60000 / 15) * 15;
      if (!minutes) return "UTC+0";
      const h = Math.trunc(Math.abs(minutes) / 60), m = Math.abs(minutes) % 60;
      return `UTC${minutes < 0 ? "−" : "+"}${h}${m ? ":" + String(m).padStart(2, "0") : ""}`;
    } catch {
      return "UTC";
    }
  }
}

const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Sensible defaults: nothing starts empty except optional fields. */
export function triggerDefaults(tipo, { folders = [], rooms = [] } = {}) {
  const zona = ZONES.some(([z]) => z === localZone()) ? localZone() : localZone() || "Europe/Madrid";
  const tomorrow = new Date(Date.now() + 864e5);
  switch (tipo) {
    case "dia": return { hora: "08:00", dias: [1, 2, 3, 4, 5], festivo: "saltar", zona };
    case "semana": return { dia: 1, hora: "09:00", cada: 1, zona };
    case "vez": return { fecha: isoDay(tomorrow), hora: "10:00", avisarAntes: true, zona };
    case "correo": return { buzon: "tu correo", de: "todos", remitentes: [], asunto: "", adjuntos: "igual", entender: true };
    case "archivo": {
      const f = folders[0];
      return { carpetaId: f?.id || null, carpeta: f ? folderPath(f) : "", subcarpetas: true, tipo: "todo", nombre: "", quien: "todos" };
    }
    case "evento": return { calendario: "del equipo", filtro: "todos", palabra: "", antelacion: 30, unidad: "minutos", laboral: true };
    case "sala": {
      const r = rooms[0];
      return { missionId: r?.id || null, sala: r?.room || "*", modo: "mencion", palabras: "", deQuien: "personas" };
    }
    case "hoja": return { hoja: "", pestana: "", cambio: "fila", columna: "", valor: "" };
    case "web": return { url: "", condicion: "cambia", texto: "", precio: "", frecuencia: "1h" };
    default: return {};
  }
}

export const folderPath = (f) => (f?.label || f?.path || "").replace(/\\/g, "/").replace(/\/+$/, "");

function daysText(dias) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const pl = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];
  const sel = order.filter((d) => dias.indexOf(d) !== -1);
  if (sel.length === 7) return "todos los días";
  if (sel.length === 0) return "ningún día";
  if (sel.join() === "1,2,3,4,5") return "de lunes a viernes";
  if (sel.join() === "6,0") return "los fines de semana";
  const names = sel.map((d) => pl[d]);
  return "los " + (names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " y " + names[names.length - 1]);
}

/** The plain-language sentence shown in the dark box, the «Cuando» button and the list. */
export function triggerSentence(t, s) {
  const DN = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const ML = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  if (t === "dia") return "sean las " + s.hora + " " + daysText(s.dias || []);
  if (t === "semana") return "sea " + DN[s.dia] + " a las " + s.hora + (Number(s.cada) !== 1 ? ", cada " + s.cada + " semanas" : "");
  if (t === "vez") {
    const p = (s.fecha || "").split("-").map(Number);
    if (p.length < 3 || !p[0]) return "llegue la fecha que elijas";
    const d = new Date(p[0], p[1] - 1, p[2]);
    return "llegue el " + DN[d.getDay()] + " " + p[2] + " de " + ML[p[1] - 1] + " a las " + s.hora;
  }
  if (t === "correo") {
    let r = "llegue un correo a " + ((s.buzon || "").trim() || "tu correo");
    if (s.de === "algunos" && s.remitentes?.length) r += " de " + s.remitentes.join(" o ");
    if ((s.asunto || "").trim()) r += " con «" + s.asunto.trim() + "» en el asunto";
    if (s.adjuntos === "pdf") r += " y un PDF adjunto";
    if (s.adjuntos === "si") r += " y algún adjunto";
    return r;
  }
  if (t === "archivo") {
    const tipos = { pdf: "un PDF", hoja: "una hoja de cálculo", imagen: "una imagen", todo: "un archivo" };
    const carpeta = s.carpeta ? s.carpeta.split("/").filter(Boolean).join(" / ") : "la carpeta que elijas";
    return "se suba " + (tipos[s.tipo] || "un archivo") + " a " + carpeta + (s.subcarpetas ? " (o sus subcarpetas)" : "") + ((s.nombre || "").trim() ? " con «" + s.nombre.trim() + "» en el nombre" : "");
  }
  if (t === "evento") {
    const palabra = (s.palabra || "").trim();
    const f = s.filtro === "todos" ? "cualquier evento" : s.filtro === "fuera" ? "una reunión con gente de fuera" : palabra ? "un evento con «" + palabra + "»" : "un evento con la palabra que elijas";
    return "falten " + s.antelacion + " " + s.unidad + " para " + f + " del calendario " + ((s.calendario || "").trim() || "del equipo");
  }
  if (t === "sala") {
    const sala = !s.sala || s.sala === "*" ? "cualquier sala" : "# " + s.sala;
    if (s.modo === "todo") return "alguien escriba en " + sala;
    if (s.modo === "mencion") return "alguien mencione a un bot en " + sala;
    return "alguien escriba «" + ((s.palabras || "").trim() || "…") + "» en " + sala;
  }
  if (t === "web") {
    const where = (s.url || "").trim() ? webDomain(s.url) : "la página que elijas";
    if (s.condicion === "contiene") return "la página de " + where + " contenga «" + ((s.texto || "").trim() || "…") + "»";
    if (s.condicion === "precio_bajo") return "el precio en " + where + " baje de " + (String(s.precio ?? "").trim() ? String(s.precio).trim().replace(".", ",") + " €" : "el límite que elijas");
    return "cambie la página de " + where;
  }
  if (t === "hoja") {
    const hoja = (s.hoja || "").trim() || "la hoja que elijas";
    const where = hoja + ((s.pestana || "").trim() ? " › " + s.pestana.trim() : "");
    const col = (s.columna || "").trim();
    if (s.cambio === "fila") return "se añada una fila a " + where;
    if (s.cambio === "columna") return "cambie la columna " + (col || "que elijas") + " de " + where;
    return (col ? "el " + col.toLowerCase() : "el valor") + " supere " + ((s.valor || "").trim() || "el límite") + " en " + where;
  }
  return "";
}

/** «example.com» from what the person typed (with or without https://). */
export function webDomain(url) {
  const raw = String(url || "").trim();
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw).hostname.replace(/^www\./, "");
  } catch {
    return raw;
  }
}

/** Next (up to) 3 runs for time triggers, in local time. */
export function nextRuns(t, s, now = new Date()) {
  const DS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const MS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const at = (base, hhmm) => { const p = (hhmm || "0:0").split(":").map(Number); return new Date(base.getFullYear(), base.getMonth(), base.getDate(), p[0] || 0, p[1] || 0); };
  const fmt = (d, hhmm) => DS[d.getDay()] + " " + d.getDate() + " " + MS[d.getMonth()] + " · " + hhmm;
  const day = (i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
  const runs = [];
  if (t === "dia") {
    for (let i = 0; i < 21 && runs.length < 3; i++) {
      const c = at(day(i), s.hora);
      if (c > now && (s.dias || []).indexOf(c.getDay()) !== -1) runs.push(fmt(c, s.hora));
    }
  } else if (t === "semana") {
    let first = null;
    for (let i = 0; i < 8 && !first; i++) { const c = at(day(i), s.hora); if (c > now && c.getDay() === Number(s.dia)) first = c; }
    const n = Number(s.cada) || 1;
    for (let k = 0; first && k < 3; k++) runs.push(fmt(new Date(first.getFullYear(), first.getMonth(), first.getDate() + k * 7 * n), s.hora));
  } else if (t === "vez") {
    const p = (s.fecha || "").split("-").map(Number);
    if (p[0]) {
      const c = at(new Date(p[0], p[1] - 1, p[2]), s.hora);
      if (c > now) runs.push(fmt(c, s.hora) + " · y se pausa");
    }
  }
  return runs;
}

const CONNECTOR_FOR = { correo: ["correo", "El correo"], evento: ["calendario", "El calendario"], hoja: ["hojas", "Las hojas de cálculo"] };

// ── shared inline styles copied from the mockup ──
const labelStyle = { display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", fontWeight: "600" };
const inputStyle = { height: "44px", padding: "0 12px", border: "0", borderRadius: "10px", fontFamily: "inherit", fontSize: "15px", color: "#12131A", background: "#FFFFFF" };
const timeInput = { ...inputStyle, fontSize: "16px" };
const selectStyle = { height: "44px", padding: "0 10px", border: "0", borderRadius: "10px", fontFamily: "inherit", fontSize: "15px", color: "#12131A", background: "#FFFFFF" };
const segWrap = { display: "flex", flexWrap: "wrap", gap: "4px", padding: "4px", background: "#F4F4F0", borderRadius: "12px" };
const fieldTitle = { fontSize: "13px", fontWeight: "600" };
const col18 = { display: "flex", flexDirection: "column", gap: "18px" };
const col8 = { display: "flex", flexDirection: "column", gap: "8px" };

function Switch({ on, label, onToggle }) {
  return (
    <button type="button" role="switch" aria-checked={on ? "true" : "false"} aria-label={label} onClick={onToggle} style={{ width: "52px", height: "30px", flex: "none", padding: "3px", border: "0", borderRadius: "15px", cursor: "pointer", display: "flex", background: on ? "#12131A" : "rgba(18,19,26,.1)", justifyContent: on ? "flex-end" : "flex-start" }}>
      <span style={{ width: "24px", height: "24px", borderRadius: "50%", background: on ? "#FFC93C" : "#FFFFFF" }} />
    </button>
  );
}

function Seg({ label, value, options, onPick, minHeight = "38px", padding = "0 12px", wrap = true }) {
  return (
    <div role="radiogroup" aria-label={label} style={wrap ? segWrap : { display: "flex", gap: "4px", padding: "4px", background: "#F4F4F0", borderRadius: "12px" }}>
      {options.map(([id, text]) => {
        const on = value === id;
        return (
          <button key={String(id)} type="button" role="radio" aria-checked={on ? "true" : "false"} onClick={() => onPick(id)} style={{ flex: "1 1 auto", minHeight, padding, border: "0", borderRadius: "9px", cursor: "pointer", fontFamily: "inherit", fontSize: "13px", fontWeight: "600", background: on ? "#12131A" : "transparent", color: on ? "#FFFFFF" : "#12131A" }}>
            {text}
          </button>
        );
      })}
    </div>
  );
}

function Notice({ children }) {
  return (
    <div role="note" style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 14px", background: "#FFF4D1", borderRadius: "12px", fontSize: "13px", lineHeight: "1.45", color: "#3D404A" }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ flex: "none" }}><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></svg>
      <span>{children}</span>
    </div>
  );
}

export default function Disparador({ tipo = "correo", value, sentence: sentenceProp, onChange, folders = [], rooms = [], connectors = [], onProbar }) {
  const t = TRIGGER_META[tipo] ? tipo : "correo";
  const controlled = value !== undefined;
  const [inner, setInner] = useState({});
  const [nuevoRem, setNuevoRem] = useState("");
  const [probe, setProbe] = useState({ busy: false, text: null, error: false });
  const [preview, setPreview] = useState(null); // web: { busy, error, title, excerpt, price, domain }
  const defaults = useMemo(() => triggerDefaults(t, { folders, rooms }), [t, folders, rooms]);
  const raw = controlled ? value || {} : inner[t] || {};
  const s = { ...defaults, ...raw };
  const sentence = triggerSentence(t, s);

  // Report normalised config (+ sentence) whenever it changes, so the parent always stores a complete config.
  const lastSent = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const serial = t + "|" + JSON.stringify(s) + "|" + sentence;
  const rawSerial = JSON.stringify(raw);
  useEffect(() => {
    // Controlled: emit whenever the parent's value isn't normalised yet or its sentence is stale.
    const stale = controlled ? rawSerial !== JSON.stringify(s) || (sentenceProp !== undefined && sentenceProp !== sentence) : lastSent.current !== serial;
    if (!stale) return;
    lastSent.current = serial;
    onChangeRef.current?.(s, sentence);
  }, [serial, rawSerial, sentenceProp]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setProbe({ busy: false, text: null, error: false });
    setPreview(null);
  }, [t]);

  const update = (patch) => {
    const next = { ...s, ...patch };
    const nextSentence = triggerSentence(t, next);
    lastSent.current = t + "|" + JSON.stringify(next) + "|" + nextSentence;
    if (!controlled) setInner((all) => ({ ...all, [t]: next }));
    onChangeRef.current?.(next, nextSentence);
  };
  const set = (k, num = false) => (e) => update({ [k]: num ? Number(e.target.value) : e.target.value });

  const meta = TRIGGER_META[t];
  const DAYS = [[1, "L", "lunes"], [2, "M", "martes"], [3, "X", "miércoles"], [4, "J", "jueves"], [5, "V", "viernes"], [6, "S", "sábado"], [0, "D", "domingo"]];
  const dayStyle = (on) => ({ height: "44px", borderRadius: "10px", cursor: "pointer", fontFamily: "inherit", fontSize: "15px", fontWeight: "700", background: on ? "#12131A" : "#FFFFFF", color: on ? "#FFFFFF" : "#12131A", border: on ? "2px solid #12131A" : "1px solid #C9CED8" });
  const isTime = TIME_TRIGGERS.includes(t);
  const runs = isTime ? nextRuns(t, s) : [];
  const zoneOptions = !s.zona || ZONES.some(([z]) => z === s.zona) ? ZONES : [...ZONES, [s.zona, s.zona.split("/").pop().replace(/_/g, " ")]];
  const zoneSelect = (
    <label style={labelStyle}>
      {"Zona horaria"}
      <select value={s.zona || ZONES[0][0]} onChange={set("zona")} style={selectStyle}>
        {zoneOptions.map(([z, label]) => <option key={z} value={z}>{`${label} (${zoneOffset(z)})`}</option>)}
      </select>
    </label>
  );
  const connectorWarning = (() => {
    const pair = CONNECTOR_FOR[t];
    if (!pair) return null;
    const c = connectors.find((x) => x.id === pair[0]);
    if (c?.connected) return null;
    return <Notice>{pair[1]} aún no está conectado: puedes dejarlo preparado, pero no se pondrá en marcha hasta que lo conectes en <a href="/ajustes/conexiones" style={{ fontWeight: "600", textDecoration: "underline" }}>Ajustes › Conexiones</a>.</Notice>;
  })();

  const addRem = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const val = nuevoRem.trim();
      if (val && (s.remitentes || []).indexOf(val) === -1) update({ remitentes: [...(s.remitentes || []), val] });
      setNuevoRem("");
    }
  };

  const folder = folders.find((f) => f.id === s.carpetaId) || folders.find((f) => folderPath(f) === s.carpeta) || null;
  const carpetaParts = (s.carpeta || "").split("/").filter(Boolean);

  // Web: «Probar ahora» reads the public page now (title + excerpt) without starting anything.
  const probarWeb = async () => {
    if (!(s.url || "").trim()) {
      setPreview({ busy: false, error: "Escribe primero la dirección de la página." });
      return;
    }
    setPreview({ busy: true });
    try {
      const q = "?url=" + encodeURIComponent(s.url.trim()) + ((s.texto || "").trim() ? "&texto=" + encodeURIComponent(s.texto.trim()) : "");
      const r = await get("/automations/web-preview" + q);
      setPreview({ busy: false, ...r });
    } catch (e) {
      setPreview({ busy: false, error: e.message || "No se pudo leer la página." });
    }
  };

  const probar = async () => {
    if (!onProbar) return;
    setProbe({ busy: true, text: "Comprobando…", error: false });
    try {
      const text = await onProbar(s, sentence);
      setProbe({ busy: false, text: text || "Prueba hecha.", error: false });
    } catch (e) {
      setProbe({ busy: false, text: e.message || "No se pudo probar.", error: true });
    }
  };

  return (
    <div style={{ fontFamily: "'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#12131A", background: "#FFFFFF", border: "0", borderRadius: "16px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 18px", background: "#F6F6F3", borderBottom: "1px solid rgba(18,19,26,.06)" }}>
        <span aria-hidden="true" style={{ width: "34px", height: "34px", flex: "none", display: "grid", placeItems: "center", background: "#12131A", color: "#FFFFFF", borderRadius: "9px" }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={meta[1]} /></svg>
        </span>
        <div style={{ flex: "1", display: "flex", flexDirection: "column", gap: "2px" }}>
          <span style={{ font: "500 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#6B6F7A" }}>{"Configurar disparador"}</span>
          <strong style={{ font: "600 17px/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{meta[0]}</strong>
        </div>
      </div>
      <div style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "18px" }}>
        {t === "dia" ? (
          <div style={col18}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: "12px" }}>
              <label style={labelStyle}>{"Hora"}<input type="time" value={s.hora} onChange={set("hora")} style={timeInput} /></label>
              {zoneSelect}
            </div>
            <div style={col8}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                <span style={fieldTitle}>{"Qué días"}</span>
                <span style={{ display: "flex", gap: "4px" }}>
                  {[["Laborables", [1, 2, 3, 4, 5]], ["Todos", [0, 1, 2, 3, 4, 5, 6]], ["Fin de semana", [6, 0]]].map(([label, dias]) => (
                    <button key={label} type="button" onClick={() => update({ dias })} style={{ height: "30px", padding: "0 10px", background: "#FFFFFF", border: "0", borderRadius: "15px", cursor: "pointer", fontFamily: "inherit", fontSize: "12px", color: "#12131A" }}>{label}</button>
                  ))}
                </span>
              </div>
              <div role="group" aria-label="Días de la semana" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "6px" }}>
                {DAYS.map(([d, short, full]) => {
                  const on = (s.dias || []).indexOf(d) !== -1;
                  return <button key={d} type="button" aria-pressed={on ? "true" : "false"} aria-label={full} onClick={() => update({ dias: on ? s.dias.filter((x) => x !== d) : [...(s.dias || []), d] })} style={dayStyle(on)}>{short}</button>;
                })}
              </div>
              {(s.dias || []).length === 0 ? <span role="alert" style={{ fontSize: "13px", fontWeight: "600", color: "#B4372A" }}>{"Elige al menos un día."}</span> : null}
            </div>
            <div style={col8}>
              <span style={fieldTitle}>{"Si cae en festivo"}</span>
              <Seg label="Si cae en festivo" value={s.festivo} onPick={(festivo) => update({ festivo })} options={[["saltar", "Saltarlo"], ["igual", "Hacerlo igual"], ["siguiente", "Al siguiente laborable"]]} />
            </div>
          </div>
        ) : null}

        {t === "semana" ? (
          <div style={col18}>
            <div style={col8}>
              <span style={fieldTitle}>{"Qué día"}</span>
              <div role="radiogroup" aria-label="Día de la semana" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "6px" }}>
                {DAYS.map(([d, short, full]) => {
                  const on = Number(s.dia) === d;
                  return <button key={d} type="button" role="radio" aria-checked={on ? "true" : "false"} aria-label={full} onClick={() => update({ dia: d })} style={dayStyle(on)}>{short}</button>;
                })}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))", gap: "12px" }}>
              <label style={labelStyle}>{"Hora"}<input type="time" value={s.hora} onChange={set("hora")} style={timeInput} /></label>
              <label style={labelStyle}>
                {"Cada cuántas semanas"}
                <select value={String(s.cada)} onChange={set("cada", true)} style={selectStyle}>
                  <option value="1">{"Cada semana"}</option>
                  <option value="2">{"Cada 2 semanas"}</option>
                  <option value="3">{"Cada 3 semanas"}</option>
                  <option value="4">{"Cada 4 semanas"}</option>
                </select>
              </label>
            </div>
            {zoneSelect}
          </div>
        ) : null}

        {t === "vez" ? (
          <div style={col18}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: "12px" }}>
              <label style={labelStyle}>{"Fecha"}<input type="date" value={s.fecha} min={isoDay(new Date())} onChange={set("fecha")} style={timeInput} /></label>
              <label style={labelStyle}>{"Hora"}<input type="time" value={s.hora} onChange={set("hora")} style={timeInput} /></label>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "14px", fontWeight: "600" }}>{"Avisarme el día antes"}</span>
                <span style={{ fontSize: "13px", color: "#5C606C" }}>{"Por si quieres cambiar algo"}</span>
              </span>
              <Switch on={!!s.avisarAntes} label="Avisarme el día antes" onToggle={() => update({ avisarAntes: !s.avisarAntes })} />
            </div>
            <span style={{ fontSize: "13px", color: "#5C606C" }}>{"Después de ejecutarse, la automatización se pausa sola."}</span>
            {runs.length === 0 && s.fecha ? <span role="alert" style={{ fontSize: "13px", fontWeight: "600", color: "#B4372A" }}>{"Esa fecha y hora ya han pasado."}</span> : null}
          </div>
        ) : null}

        {t === "correo" ? (
          <div style={col18}>
            <label style={labelStyle}>
              {"En qué buzón"}
              <input type="text" list="colmena-buzones" value={s.buzon} onChange={set("buzon")} placeholder="tu correo o una dirección compartida" style={inputStyle} />
              <datalist id="colmena-buzones"><option value="tu correo" /></datalist>
            </label>
            <div style={col8}>
              <span style={fieldTitle}>{"De quién"}</span>
              <Seg label="Remitente" value={s.de} onPick={(de) => update({ de })} options={[["todos", "Cualquiera"], ["algunos", "Solo de estos remitentes"]]} />
              {s.de === "algunos" ? (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", minHeight: "48px", padding: "4px 6px", border: "0", borderRadius: "10px" }}>
                  {(s.remitentes || []).map((addr) => (
                    <span key={addr} style={{ display: "flex", alignItems: "center", gap: "2px", height: "34px", padding: "0 2px 0 12px", background: "#F4F4F0", borderRadius: "17px", fontSize: "14px" }}>
                      {addr}
                      <button type="button" aria-label={"Quitar " + addr} onClick={() => update({ remitentes: s.remitentes.filter((x) => x !== addr) })} style={{ width: "28px", height: "28px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "50%", cursor: "pointer", color: "#12131A" }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                      </button>
                    </span>
                  ))}
                  <input type="text" aria-label="Añadir remitente" value={nuevoRem} onChange={(e) => setNuevoRem(e.target.value)} onKeyDown={addRem} placeholder="Dirección o @dominio y pulsa Intro" style={{ flex: "1 1 160px", minWidth: "0", height: "36px", border: "0", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: "14px", color: "#12131A" }} />
                </div>
              ) : null}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: "12px" }}>
              <label style={labelStyle}>{"El asunto contiene"}<input type="text" value={s.asunto} onChange={set("asunto")} placeholder="Opcional" style={inputStyle} /></label>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={fieldTitle}>{"Adjuntos"}</span>
                <Seg label="Adjuntos" wrap={false} minHeight="36px" padding="0 8px" value={s.adjuntos} onPick={(adjuntos) => update({ adjuntos })} options={[["igual", "Da igual"], ["si", "Con adjuntos"], ["pdf", "Solo PDF"]]} />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 14px", background: "#FFF4D1", borderRadius: "12px" }}>
              <span aria-hidden="true" style={{ width: "26px", height: "26px", flex: "none", display: "grid", placeItems: "center", background: "radial-gradient(circle at 32% 26%, rgba(255,255,255,.62), rgba(255,255,255,0) 54%), #FFC93C", clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)", font: "600 12px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }} />
              <span style={{ flex: "1", display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "14px", fontWeight: "600" }}>{"Entender el contenido"}</span>
                <span style={{ fontSize: "13px", lineHeight: "1.4", color: "#3D404A" }}>{"Reconoce una factura aunque el asunto no lo diga."}</span>
              </span>
              <Switch on={!!s.entender} label="Entender el contenido" onToggle={() => update({ entender: !s.entender })} />
            </div>
            {connectorWarning}
          </div>
        ) : null}

        {t === "archivo" ? (
          <div style={col18}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={fieldTitle}>{"En qué carpeta"}</span>
              {folders.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", minHeight: "48px", padding: "6px 6px 6px 12px", border: "0", borderRadius: "10px" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h7l2 2h9v11H3z" /></svg>
                  {carpetaParts.map((label, i) => (
                    <span key={i} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px", fontWeight: i === carpetaParts.length - 1 ? "700" : "500" }}>
                      {label}
                      {i < carpetaParts.length - 1 ? <span aria-hidden="true" style={{ color: "#8C91A0" }}>{"›"}</span> : null}
                    </span>
                  ))}
                  <span style={{ flex: "1" }} />
                  <select aria-label="Cambiar carpeta" value={folder?.id || ""} onChange={(e) => { const f = folders.find((x) => x.id === e.target.value); if (f) update({ carpetaId: f.id, carpeta: folderPath(f) }); }} style={{ height: "36px", padding: "0 8px", border: "0", borderRadius: "999px", fontFamily: "inherit", fontSize: "13px", color: "#12131A", background: "#FFFFFF" }}>
                    {folder ? null : <option value="">{"Elige una carpeta"}</option>}
                    {folders.map((f) => <option key={f.id} value={f.id}>{folderPath(f).split("/").filter(Boolean).join(" / ")}</option>)}
                  </select>
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", minHeight: "48px", padding: "6px 6px 6px 12px", border: "0", borderRadius: "10px", fontSize: "14px", color: "#5C606C" , background: "#FFFFFF"}}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h7l2 2h9v11H3z" /></svg>
                  {"Aún no has compartido ninguna carpeta."}
                  <a href="/ajustes/ordenador" style={{ fontWeight: "600", color: "#1F4FD1" }}>{"Añadir carpeta en Ajustes › Este ordenador"}</a>
                </div>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <span style={{ fontSize: "14px", fontWeight: "600" }}>{"Incluir subcarpetas"}</span>
              <Switch on={!!s.subcarpetas} label="Incluir subcarpetas" onToggle={() => update({ subcarpetas: !s.subcarpetas })} />
            </div>
            <div style={col8}>
              <span style={fieldTitle}>{"Tipo de archivo"}</span>
              <Seg label="Tipo de archivo" minHeight="36px" padding="0 10px" value={s.tipo} onPick={(tipo_) => update({ tipo: tipo_ })} options={[["pdf", "PDF"], ["hoja", "Hojas"], ["imagen", "Imágenes"], ["todo", "Cualquiera"]]} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: "12px" }}>
              <label style={labelStyle}>{"El nombre contiene"}<input type="text" value={s.nombre} onChange={set("nombre")} placeholder="Opcional, p. ej. «factura»" style={inputStyle} /></label>
              <label style={labelStyle}>
                {"Quién lo sube"}
                <select value={s.quien} onChange={set("quien")} style={selectStyle}>
                  <option value="todos">{"Cualquiera"}</option>
                  <option value="equipo">{"Solo gente del equipo"}</option>
                  <option value="fuera">{"Solo gente de fuera"}</option>
                </select>
              </label>
            </div>
          </div>
        ) : null}

        {t === "evento" ? (
          <div style={col18}>
            <label style={labelStyle}>
              {"Calendario"}
              <input type="text" list="colmena-calendarios" value={s.calendario} onChange={set("calendario")} placeholder="del equipo" style={inputStyle} />
              <datalist id="colmena-calendarios"><option value="del equipo" /><option value="personal" /><option value="de salas de reunión" /></datalist>
            </label>
            <div style={col8}>
              <span style={fieldTitle}>{"Qué eventos"}</span>
              <Seg label="Qué eventos" padding="0 10px" value={s.filtro} onPick={(filtro) => update({ filtro })} options={[["todos", "Todos"], ["palabra", "Con una palabra"], ["fuera", "Con gente de fuera"]]} />
              {s.filtro === "palabra" ? <label style={labelStyle}>{"El título contiene"}<input type="text" value={s.palabra} onChange={set("palabra")} style={inputStyle} /></label> : null}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={fieldTitle}>{"Con cuánta antelación"}</span>
              <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: "8px" }}>
                <input type="number" min="1" max="99" aria-label="Cantidad" value={s.antelacion} onChange={(e) => update({ antelacion: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })} style={timeInput} />
                <select aria-label="Unidad" value={s.unidad} onChange={set("unidad")} style={selectStyle}>
                  <option value="minutos">{"minutos antes"}</option>
                  <option value="horas">{"horas antes"}</option>
                  <option value="días">{"días antes"}</option>
                </select>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "14px", fontWeight: "600" }}>{"Solo en horario laboral"}</span>
                <span style={{ fontSize: "13px", color: "#5C606C" }}>{"De lunes a viernes, de 8:00 a 19:00"}</span>
              </span>
              <Switch on={!!s.laboral} label="Solo en horario laboral" onToggle={() => update({ laboral: !s.laboral })} />
            </div>
            {connectorWarning}
          </div>
        ) : null}

        {t === "sala" ? (
          <div style={col18}>
            <label style={labelStyle}>
              {"En qué sala"}
              <select value={s.sala || "*"} onChange={(e) => { const r = rooms.find((x) => x.room === e.target.value); update({ sala: e.target.value, missionId: r?.id || null }); }} style={selectStyle}>
                {rooms.map((r) => <option key={r.id} value={r.room}>{"# " + r.room}</option>)}
                {s.sala && s.sala !== "*" && !rooms.some((r) => r.room === s.sala) ? <option value={s.sala}>{"# " + s.sala}</option> : null}
                <option value="*">{"Cualquier sala"}</option>
              </select>
            </label>
            <div style={col8}>
              <span style={fieldTitle}>{"Cuándo cuenta"}</span>
              <div role="radiogroup" aria-label="Qué mensajes cuentan" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {[["todo", "Cualquier mensaje"], ["mencion", "Cuando mencionen a un bot con @"], ["palabras", "Cuando contenga ciertas palabras"]].map(([id, label]) => {
                  const on = s.modo === id;
                  return (
                    <button key={id} type="button" role="radio" aria-checked={on ? "true" : "false"} onClick={() => update({ modo: id })} style={{ display: "grid", gridTemplateColumns: "20px 1fr", gap: "10px", alignItems: "center", minHeight: "46px", padding: "8px 12px", textAlign: "left", borderRadius: "10px", cursor: "pointer", fontFamily: "inherit", fontSize: "14px", color: "#12131A", background: on ? "#FFF4D1" : "#FFFFFF", border: on ? "2px solid #12131A" : "1px solid rgba(18,19,26,.1)" }}>
                      <span style={{ width: "18px", height: "18px", borderRadius: "50%", border: "0", display: "grid", placeItems: "center" }}><span style={{ width: "8px", height: "8px", borderRadius: "50%", background: on ? "#12131A" : "transparent" }} /></span>
                      {label}
                    </button>
                  );
                })}
              </div>
              {s.modo === "palabras" ? <label style={labelStyle}>{"Palabras (separadas por comas)"}<input type="text" value={s.palabras} onChange={set("palabras")} style={inputStyle} /></label> : null}
            </div>
            <label style={labelStyle}>
              {"De quién"}
              <select value={s.deQuien} onChange={set("deQuien")} style={selectStyle}>
                <option value="personas">{"Solo personas"}</option>
                <option value="todos">{"Personas y bots"}</option>
              </select>
            </label>
            <span style={{ fontSize: "13px", lineHeight: "1.45", color: "#5C606C" }}>{"Para evitar bucles, los mensajes del propio bot nunca lo vuelven a poner en marcha."}</span>
          </div>
        ) : null}

        {t === "hoja" ? (
          <div style={col18}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: "12px" }}>
              <label style={labelStyle}>{"Hoja de cálculo"}<input type="text" value={s.hoja} onChange={set("hoja")} placeholder="Nombre de la hoja" style={inputStyle} /></label>
              <label style={labelStyle}>{"Pestaña"}<input type="text" value={s.pestana} onChange={set("pestana")} placeholder="Opcional" style={inputStyle} /></label>
            </div>
            <div style={col8}>
              <span style={fieldTitle}>{"Qué cambio"}</span>
              <Seg label="Qué cambio" padding="0 10px" value={s.cambio} onPick={(cambio) => update({ cambio })} options={[["fila", "Fila nueva"], ["columna", "Cambie una columna"], ["supere", "Un valor supere…"]]} />
            </div>
            {s.cambio !== "fila" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(140px, 100%), 1fr))", gap: "8px" }}>
                <label style={labelStyle}>{"Columna"}<input type="text" value={s.columna} onChange={set("columna")} placeholder="p. ej. Importe" style={inputStyle} /></label>
                {s.cambio === "supere" ? <label style={labelStyle}>{"Supere"}<input type="text" value={s.valor} onChange={set("valor")} style={inputStyle} /></label> : null}
              </div>
            ) : null}
            <span style={{ fontSize: "13px", color: "#5C606C" }}>{"Se comprueba cada 5 minutos."}</span>
            {connectorWarning}
          </div>
        ) : null}

        {t === "web" ? (
          <div style={col18}>
            <label style={labelStyle}>
              {"Dirección de la página"}
              <input type="url" inputMode="url" value={s.url} onChange={(e) => { setPreview(null); update({ url: e.target.value }); }} placeholder="https://tienda.es/producto" style={inputStyle} />
            </label>
            <div style={col8}>
              <span style={fieldTitle}>{"Cuándo avisar"}</span>
              <Seg label="Cuándo avisar" padding="0 10px" value={s.condicion} onPick={(condicion) => update({ condicion })} options={[["cambia", "Cambie algo"], ["contiene", "Aparezca un texto"], ["precio_bajo", "Baje el precio"]]} />
            </div>
            {s.condicion === "contiene" ? (
              <label style={labelStyle}>{"Texto que tiene que aparecer"}<input type="text" value={s.texto} onChange={set("texto")} placeholder="p. ej. «Disponible»" style={inputStyle} /></label>
            ) : null}
            {s.condicion === "precio_bajo" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: "12px" }}>
                <label style={labelStyle}>
                  {"Baje de (€)"}
                  <input type="number" min="0" step="0.01" inputMode="decimal" value={s.precio} onChange={set("precio")} placeholder="50" style={timeInput} />
                </label>
                <label style={labelStyle}>{"Cerca del texto"}<input type="text" value={s.texto} onChange={set("texto")} placeholder="Opcional, p. ej. el nombre del producto" style={inputStyle} /></label>
              </div>
            ) : null}
            <div style={col8}>
              <span style={fieldTitle}>{"Cada cuánto mirarla"}</span>
              <Seg label="Cada cuánto mirarla" padding="0 10px" value={s.frecuencia} onPick={(frecuencia) => update({ frecuencia })} options={[["15m", "Cada 15 min"], ["1h", "Cada hora"], ["1d", "Una vez al día"]]} />
            </div>
            <span style={{ fontSize: "13px", lineHeight: "1.45", color: "#5C606C" }}>{"Solo páginas públicas. No cuenta lo que cambia solo, como «hace 2 días». Si la página falla 5 veces seguidas, la automatización se pausa y te dice por qué."}</span>
          </div>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px 16px", background: "#12131A", color: "#FFFFFF", borderRadius: "14px" }}>
          <span style={{ font: "500 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#C9CCD6" }}>{"Se pondrá en marcha cuando"}</span>
          <span aria-live="polite" style={{ font: "600 17px/1.4 'Bricolage Grotesque', sans-serif" }}>{sentence}</span>
          {isTime && runs.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", paddingTop: "4px" }}>
              <span style={{ fontSize: "12px", color: "#C9CCD6", alignSelf: "center", marginRight: "2px" }}>{"Próximas:"}</span>
              {runs.map((label) => <span key={label} style={{ padding: "5px 9px", background: "#2C2F3A", borderRadius: "7px", font: "500 12px/1 'Geist Mono', monospace" }}>{label}</span>)}
            </div>
          ) : null}
          {t === "web" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingTop: "4px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
                <button type="button" onClick={probarWeb} disabled={preview?.busy} aria-busy={preview?.busy ? "true" : "false"} style={{ height: "36px", padding: "0 14px", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", border: "0", cursor: "pointer", fontFamily: "inherit", fontSize: "13px", fontWeight: "700" }}>{"Probar ahora"}</button>
                <span role="status" style={{ fontSize: "13px", color: preview?.error ? "#FFB4A8" : "rgba(18,19,26,.06)" }}>
                  {preview?.busy ? "Leyendo la página…" : preview?.error || (preview?.title || preview?.excerpt ? `Leída ${preview.domain || ""}`.trim() : "Lee la página ahora para comprobar que se puede vigilar.")}
                </span>
              </div>
              {preview && !preview.busy && !preview.error ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "10px 12px", background: "#2C2F3A", borderRadius: "10px" }}>
                  <strong style={{ fontSize: "14px", lineHeight: "1.35", overflowWrap: "anywhere" }}>{preview.title || preview.domain || "Página sin título"}</strong>
                  {preview.excerpt ? <span style={{ fontSize: "13px", lineHeight: "1.45", color: "#C9CCD6", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: "3", WebkitBoxOrient: "vertical", overflowWrap: "anywhere" }}>{preview.excerpt}</span> : null}
                  {s.condicion === "precio_bajo" ? (
                    <span style={{ font: "500 12px/1.4 'Geist Mono', monospace", color: "#FFC93C" }}>{preview.price != null ? `Precio que se vigilará: ${String(preview.price).replace(".", ",")} €` : "No encuentro un precio en la página. Prueba con «Cerca del texto»."}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : !isTime ? (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", paddingTop: "4px" }}>
              <button type="button" onClick={probar} disabled={probe.busy} aria-busy={probe.busy ? "true" : "false"} style={{ height: "36px", padding: "0 14px", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", border: "0", cursor: "pointer", fontFamily: "inherit", fontSize: "13px", fontWeight: "700" }}>{"Probar con lo último"}</button>
              <span role="status" style={{ fontSize: "13px", color: probe.error ? "#FFB4A8" : "rgba(18,19,26,.06)" }}>{probe.text || (onProbar ? "Comprueba qué habría pasado esta semana." : "Guárdalo como automatización para probarlo con lo que ya ha pasado.")}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
