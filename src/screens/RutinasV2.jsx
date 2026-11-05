import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import Shell from "../components/v2/Shell.jsx";
import { BotPresence } from "../components/v2/Presence.jsx";
import TrabajoHeader, { BotDot, trabajoMain } from "../components/v3/TrabajoHeader.jsx";
import { useAction, useResource, useStore } from "../lib/store.jsx";
import { del, patch, post } from "../lib/api.js";
import { navigate, useRouter } from "../lib/router.jsx";
import { ago, isRoom } from "../lib/format.js";
import { later, useHidden } from "../lib/undoToast.js";

// Colmena 3 · Trabajo › Rutinas (design/V3Rutinas.dc.html): what repeats. «Nueva rutina» reads
// as a sentence you tap to change (?nueva=1 opens it, with ?texto= and ?bot= from a chat).
// «Tus rutinas» lists, filtered by kind, the three kinds of standing work: routines
// (automations with a trigger), encargos (standing orders a bot keeps in mind) and
// recordatorios por tema (intents: «cuando se hable de X, recuérdame Y»).

const INK = "#12131A";
const MUTED = "#4A4D57";
const FAINT = "#5C606C";
const SOFT = "#F6F6F3";

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const low = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const DAY = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTH = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const HOURS = ["08:00", "09:00", "13:00", "18:00"];
const hourLabel = (h) => h.replace(/^0/, "");

/** The next day `dow` (0–6) after today. */
function nextDow(dow, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  do d.setDate(d.getDate() + 1); while (d.getDay() !== dow);
  return d;
}
const dateLabel = (d) => `el ${DAY[d.getDay()]} ${d.getDate()}`;

/** When a time rule would run next (up to n times), for the preview line. */
function nextTimes(type, b, n = 3, now = new Date()) {
  const at = (d, h) => { const [hh, mm] = h.split(":").map(Number); const x = new Date(d); x.setHours(hh, mm, 0, 0); return x; };
  const out = [];
  if (type === "vez") return [];
  if (type === "cada") {
    const every = everyMinutes(b.everyN, b.everyUnit) * 60000;
    for (let i = 1; i <= n && every > 0; i++) out.push(new Date(now.getTime() + i * every));
    return out;
  }
  for (let i = 0; i < 60 && out.length < n; i++) {
    const d = at(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i), b.hour);
    if (d <= now) continue;
    if (type === "dia" && b.workdays && (d.getDay() === 0 || d.getDay() === 6)) continue;
    if (type === "semana" && d.getDay() !== b.dow) continue;
    out.push(d);
  }
  return out;
}
const listJoin = (xs) => (xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " y " + xs.at(-1));

const TIME_TYPES = ["dia", "semana", "vez", "cada"];

// «Cada N minutos/horas» (server/triggers.mjs «cada»): at least every 15 minutes.
const EVERY = [[15, "minutos"], [30, "minutos"], [1, "horas"], [2, "horas"], [4, "horas"], [8, "horas"]];
const MIN_EVERY = 15;
const everyMinutes = (n, unit) => (Number(n) || 0) * (unit === "horas" ? 60 : 1);
const everyLabel = (n, unit) => (unit === "minutos" ? `${n} min` : Number(n) === 1 ? "1 hora" : `${n} horas`);
const everyText = (n, unit) => (unit === "minutos" ? `Cada ${n} minutos` : Number(n) === 1 ? "Cada hora" : `Cada ${n} horas`);
const clock = (d) => d.getHours() + ":" + pad(d.getMinutes());

// Where each run goes (server/scheduler.mjs DELIVERY_MODES): a new conversation each time,
// always the same one (created on the first run), or a room that already exists («sala:<id>»).
const WHERE = [
  { id: "nueva", label: "en una conversación nueva cada vez", title: "Una conversación nueva cada vez", desc: "Cada vez empieza de cero" },
  { id: "misma", label: "siempre en la misma conversación", title: "Siempre en la misma conversación", desc: "La crea la primera vez y sigue en ella" },
];
const whereOf = (a) => (a?.delivery?.mode === "sala" && a.delivery.missionId ? "sala:" + a.delivery.missionId : a?.delivery?.mode === "misma" ? "misma" : "nueva");
/** «en #Ventas», «siempre en la misma conversación»… for the sentence and the list. */
function whereLabel(where, missions) {
  if (!where.startsWith("sala:")) return (WHERE.find((w) => w.id === where) || WHERE[0]).label;
  const room = missions.find((m) => m.id === where.slice(5));
  return room ? "en #" + (room.title || "sala") : "en una conversación que ya no existe";
}

const OUTS = [
  { id: "hoy", label: "te lo deja en Inicio", title: "Te lo deja en Inicio", desc: "Lo verás al abrir Colmena", glyph: "☀", tint: "#FFF4D1", notify: "resultado", prompt: "" },
  { id: "correo", label: "te lo manda por correo", title: "Te lo manda por correo", desc: "Antes de enviarlo te pide permiso", glyph: "@", tint: "#EAF0FF", notify: "resultado", prompt: "Cuando acabes, mándame el resultado por correo." },
  { id: "archivo", label: "lo guarda en la Biblioteca", title: "Lo guarda en la Biblioteca", desc: "Sin avisarte; lo buscas cuando quieras", glyph: "▤", tint: "#EAF6F0", notify: "fallo", prompt: "Guarda el resultado como un archivo, sin avisarme salvo que algo falle." },
  { id: "ok", label: "te pide OK antes de hacer nada", title: "Te pide OK antes de nada", desc: "Te llega a Inicio como algo que te toca", glyph: "✓", tint: "#FFF4D1", notify: "siempre", prompt: "Antes de hacer nada que cambie algo, prepáralo y pídeme el OK." },
];

const GENERIC_IDEAS = [
  ["resume lo importante", "Correos, salas y documentos nuevos, en una página"],
  ["prepara el plan de la semana", "Repasa tareas y plazos y propone prioridades"],
  ["revisa lo pendiente y te avisa", "Lo que va con retraso o espera a alguien"],
];

// Card labels of the triggers (design/V3Rutinas: «A una hora» · «Cuando pase algo»).
const TRIGGER_CARDS = {
  dia: ["Cada día", "a una hora, laborables o todos"], semana: ["Cada semana", "un día y una hora"], vez: ["Una vez", "un día y hora"], cada: ["Cada cierto tiempo", "cada N minutos u horas"],
  correo: ["Llega un correo", "de alguien o de cualquiera"], archivo: ["Se sube un archivo", "en una carpeta"], evento: ["Evento del calendario", "antes de una reunión"],
  sala: ["Mensaje en una sala", "una mención o cualquier mensaje"], hoja: ["Cambia una hoja", "una fila o una columna"],
};
const EVENT_TYPES = ["correo", "archivo", "evento", "sala", "hoja"];
const FILTERS = [["todas", "Todas"], ["hora", "Por horario"], ["algo", "Cuando pasa algo"], ["recordatorio", "Recordatorios"], ["encargo", "Encargos"]];
const sel = (on) => (on ? INK : "rgba(18,19,26,.1)");
const go = (href) => (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); navigate(href); };

/** «hoy 17:00», «mañana 9:00», «lunes 9:00», «12 nov». */
function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const days = Math.round((new Date(d.toDateString()) - new Date(new Date().toDateString())) / 864e5);
  const t = d.getHours() + ":" + pad(d.getMinutes());
  if (days === 0) return "hoy " + t;
  if (days === 1) return "mañana " + t;
  if (days === -1) return "ayer " + t;
  if (days > 1 && days < 7) return DAY[d.getDay()] + " " + t;
  return `${d.getDate()} ${MONTH[d.getMonth()].slice(0, 3)}`;
}

export default function RutinasV2() {
  const { query } = useRouter();
  const { automations = [], bots = [], missions = [], skills = [], ready } = useStore();
  const orders = useResource("/standing-orders");
  const intents = useResource("/intents");
  const [filter, setFilter] = useState({ encargos: "encargo", recordatorios: "recordatorio" }[query.pestana] || "todas");
  const [open, setOpen] = useState(query.nueva === "1");
  useEffect(() => { if (query.nueva === "1") setOpen(true); }, [query.nueva]);
  const [orderForm, setOrderForm] = useState(false);
  const [editing, setEditing] = useState(null);
  // The routine being changed inline, and a counter to reload it with what is saved now.
  const [changing, setChanging] = useState(null);
  const [reloads, setReloads] = useState(0);
  const act = useAction();

  const team = bots.filter((b) => !b.archived);
  const hiddenOrder = useHidden("order");
  const hiddenIntent = useHidden("intent");
  const hiddenRule = useHidden("automation");
  const orderList = (orders.data || []).filter((o) => !hiddenOrder(o.id));
  const intentList = (intents.data || []).filter((i) => !hiddenIntent(i.id));
  const ruleList = automations.filter((a) => !hiddenRule(a.id));
  const atlas = team.find((b) => b.id === "atlas") || team.find((b) => /coordin/i.test(b.role || "")) || team[0];
  const botOf = (id) => team.find((b) => b.id === id) || null;
  const openNew = () => { setChanging(null); setOpen(true); requestAnimationFrame(() => document.getElementById("nueva")?.scrollIntoView({ block: "start", behavior: "smooth" })); };
  const openChange = (ruleId) => { setOpen(false); setChanging(ruleId); setReloads((n) => n + 1); requestAnimationFrame(() => document.getElementById("nueva")?.scrollIntoView({ block: "start", behavior: "smooth" })); };
  const changingRule = changing ? automations.find((a) => a.id === changing) || null : null;

  const rows = [
    ...[...ruleList].sort((a, b) => Number(b.enabled) - Number(a.enabled) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).map((a) => ruleRow(a, botOf(a.botId), act, missions, openChange)),
    ...orderList.map((o) => orderRow(o, botOf(o.botId), automations, act, setEditing)),
    ...intentList.map((r) => intentRow(r, atlas, missions, act)),
  ];
  const list = rows.filter((r) => filter === "todas" || r.f === filter);
  const loading = !ready || (orders.loading && !orders.data) || (intents.loading && !intents.data);
  const editingOrder = editing ? orderList.find((o) => o.id === editing) : null;

  return (
    <Shell active="trabajo">
      <main style={trabajoMain("1140px")}>
        <TrabajoHeader tab="rutinas" action={{ label: "Nueva rutina", onClick: openNew }} />
        {open ? <RoutineBuilder team={team} skills={skills} missions={missions} initialWhat={query.texto || ""} initialWho={query.bot || null} onClose={() => setOpen(false)} /> : null}
        {changingRule ? <RoutineBuilder key={changing + ":" + reloads} team={team} skills={skills} missions={missions} rule={changingRule} onReload={() => setReloads((n) => n + 1)} onClose={() => setChanging(null)} /> : null}

        <section aria-labelledby="act-t" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
            <h2 id="act-t" style={{ margin: "0 10px 0 0", font: "600 22px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>Tus rutinas</h2>
            {FILTERS.map(([id, label]) => {
              const on = filter === id;
              return <button key={id} type="button" aria-pressed={on} onClick={() => setFilter(id)} style={{ height: "34px", padding: "0 13px", border: 0, borderRadius: "999px", background: on ? INK : "#FFFFFF", color: on ? "#FFFFFF" : "#3D404A", fontSize: "13.5px", fontWeight: 500, cursor: "pointer" }}>{id === "todas" ? `${label} · ${rows.length}` : label}</button>;
            })}
          </div>
          {act.error ? <p role="alert" style={{ margin: 0, fontSize: "14px", color: "#B4232A" }}>{act.error}</p> : null}

          {filter === "recordatorio" ? <ReminderForm /> : null}
          {filter === "encargo" && !orderForm && !editingOrder ? (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", padding: "14px 18px", borderRadius: "18px", background: "#F1F1EC", fontSize: "14px", lineHeight: 1.45 }}>
              <span style={{ flex: "1 1 320px", color: MUTED }}>Un encargo es algo que un bot atiende siempre que haga falta, con sus límites claros, como registrar las facturas que lleguen.</span>
              <button type="button" onClick={() => setOrderForm(true)} style={{ height: "38px", padding: "0 16px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", background: "#FFFFFF", fontSize: "14px", fontWeight: 500, cursor: "pointer" }}>Nuevo encargo</button>
            </div>
          ) : null}
          {orderForm ? <OrderForm team={team} onClose={() => setOrderForm(false)} /> : null}
          {editingOrder ? <OrderForm key={editingOrder.id} team={team} initial={editingOrder} onClose={() => setEditing(null)} /> : null}

          {loading && !list.length ? <div style={{ height: "88px", borderRadius: "22px", background: "#FFFFFF", animation: "shimmer 1.6s ease-in-out infinite" }} /> : null}
          {!loading && !rows.length && !open ? (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px", padding: "22px", borderRadius: "22px", background: "#FFFFFF" }}>
              <span style={{ flex: "1 1 300px", fontSize: "15px", lineHeight: 1.5 }}>Aún no hay rutinas. Empieza por algo que repites cada semana.</span>
              <button type="button" onClick={openNew} style={{ height: "40px", padding: "0 18px", border: 0, borderRadius: "999px", background: INK, color: "#FFFFFF", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>Nueva rutina</button>
            </div>
          ) : null}
          {list.length ? (
            <div style={{ display: "flex", flexDirection: "column", borderRadius: "22px", background: "#FFFFFF" }}>
              {list.map((r, i) => <RoutineRow key={r.key} r={r} first={i === 0} busy={act.busy} />)}
            </div>
          ) : !loading && rows.length ? <p style={{ margin: 0, padding: "16px 4px", fontSize: "14.5px", color: FAINT }}>{{ hora: "Ninguna rutina por horario.", algo: "Ninguna rutina que salte cuando pasa algo.", recordatorio: "Sin recordatorios por tema.", encargo: "Sin encargos." }[filter]}</p> : null}
          {filter === "recordatorio" ? <ReminderSample sample={intentList[0]} atlas={atlas} /> : null}
        </section>
      </main>
    </Shell>
  );
}

// ───────────────────────────────────────────────────────────── one row of «Tus rutinas»
function ruleRow(a, bot, act, missions, openChange) {
  const type = a.trigger?.type;
  const blocked = a.state === "blocked";
  const account = blocked && /cuenta de ia/i.test(a.error || "");
  const app = blocked && !account && /conect/i.test(a.error || "");
  const where = whereOf(a);
  const meta = blocked && a.error ? a.error
    : [a.nextRun && a.enabled ? "Próxima: " + when(a.nextRun) : !TIME_TYPES.includes(type) ? a.trigger?.sentence || a.subtitle : null, a.lastRun ? "última: " + ago(a.lastRun) : null, where !== "nueva" ? whereLabel(where, missions) : null].filter(Boolean).join(" · ") || a.subtitle || "";
  const status = !a.enabled ? ["En pausa", "#F1F1EC", MUTED] : account ? ["Falta la cuenta de IA", "#FFC93C", INK] : app ? ["Falta una app", "#FFC93C", INK] : blocked ? ["Atascada", "#FBE9EA", "#B4232A"] : a.state === "running" ? ["En marcha", "#EEF0F4", "#1F4FD1"] : null;
  const id = encodeURIComponent(a.id);
  return {
    key: "a:" + a.id, f: TIME_TYPES.includes(type) ? "hora" : "algo", bot, work: a.state === "running", text: a.name, meta, status, on: a.enabled,
    label: (a.enabled ? "Pausar: " : "Activar: ") + a.name,
    toggle: () => act.act(() => patch(`/automations/${id}`, { enabled: !a.enabled })),
    menu: [
      ["Cambiar la rutina", () => openChange(a.id)],
      ["Ver y cambiar los detalles", () => navigate(`/automatizaciones?id=${id}`)],
      ["Probar ahora", () => act.act(() => post(`/automations/${id}/test`, {}))],
      a.lastMissionId ? ["Ver la última vez", () => navigate(`/encargo/${encodeURIComponent(a.lastMissionId)}`)] : null,
      ["Borrar", () => later({ id: "automation:" + a.id, keys: ["automation:" + a.id], text: "Rutina borrada", error: "No se pudo borrar la rutina", run: () => act.act(() => del(`/automations/${id}`)) })],
    ].filter(Boolean),
  };
}
function orderRow(o, bot, automations, act, setEditing) {
  const rule = o.automationId ? automations.find((a) => a.id === o.automationId) : null;
  const id = encodeURIComponent(o.id);
  const meta = [
    `Encargo «${o.title}»`,
    o.stopWhen ? "para y te pregunta: " + low(o.stopWhen).replace(/\.$/, "") : "solo para en las líneas rojas",
    "avisos como mucho: " + (NOTIFY.find(([k]) => k === o.notifyMax)?.[1] || "cada vez").toLowerCase(),
    o.until ? (o.expired ? "terminó el " : "hasta el ") + longDate(o.until) : null,
  ].filter(Boolean).join(" · ");
  return {
    key: "o:" + o.id, f: "encargo", bot, text: `${bot?.name || "Un bot"} se encarga: ${low(o.what)}`, meta,
    status: o.expired ? ["Terminado", "#F1F1EC", MUTED] : !o.active ? ["En pausa", "#F1F1EC", MUTED] : null, on: o.active && !o.expired,
    label: (o.active ? "Pausar: " : "Reanudar: ") + o.title,
    toggle: () => act.act(() => patch(`/standing-orders/${id}`, { active: !o.active })),
    menu: [
      ["Editar", () => setEditing(o.id)],
      rule ? ["Ver la rutina que creó", () => navigate(`/automatizaciones?id=${encodeURIComponent(rule.id)}`)] : o.schedule ? ["Crear la rutina", () => act.act(() => post(`/standing-orders/${id}/automation`, {}))] : null,
      ["Borrar", () => later({ id: "order:" + o.id, keys: ["order:" + o.id], text: `Encargo «${o.title}» borrado`, error: "No se pudo borrar el encargo", run: () => act.act(() => del(`/standing-orders/${id}`)) })],
    ].filter(Boolean),
  };
}
function intentRow(r, atlas, missions, act) {
  const room = r.missionId ? missions.find((m) => m.id === r.missionId)?.title : null;
  const maxed = r.hits >= r.maxHits;
  const expired = r.expiresAt && Date.parse(r.expiresAt) <= Date.now();
  const said = !r.hits ? "aún no ha salido" : `lo recordó ${r.hits} ${r.hits === 1 ? "vez" : "veces"} de ${r.maxHits}`;
  const id = encodeURIComponent(r.id);
  return {
    key: "i:" + r.id, f: "recordatorio", bot: atlas,
    text: <>{"Cuando se hable de "}<strong style={{ fontWeight: 600 }}>{r.keywords.join(", ")}</strong>{", recuérdame "}{r.remind.replace(/\.$/, "")}{"."}</>,
    meta: ["Recordatorio", room ? "solo en #" + room : "en cualquier sala o chat", said].join(" · "),
    status: expired ? ["Caducado", "#F1F1EC", MUTED] : !r.active ? ["En pausa", "#F1F1EC", MUTED] : maxed ? ["Ya lo recordó", "#E3F4EC", "#0B6B4A"] : null,
    on: r.active && !maxed && !expired, label: (r.active ? "Pausar" : "Reactivar") + " este recordatorio",
    toggle: () => act.act(() => patch(`/intents/${id}`, { active: !(r.active && !maxed) })),
    menu: [["Borrar", () => later({ id: "intent:" + r.id, keys: ["intent:" + r.id], text: "Recordatorio borrado", error: "No se pudo borrar el recordatorio", run: () => act.act(() => del(`/intents/${id}`)) })]],
  };
}

function RoutineRow({ r, first, busy }) {
  const [menu, setMenu] = useState(false);
  const on = r.on;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 16px", padding: "16px 20px", borderTop: first ? 0 : "1px solid rgba(18,19,26,.06)", opacity: on ? 1 : 0.6, transition: "opacity .3s ease", animation: "fade .3s ease-out" }}>
      <span aria-hidden="true" style={{ flex: "none", width: "34px", height: "34px", display: "grid", placeItems: "center", borderRadius: "11px", background: "#F1F1EC" }}>{r.bot ? <BotDot bot={r.bot} size={18} work={r.work} /> : null}</span>
      <span style={{ flex: "1 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
        <span style={{ fontSize: "15px", lineHeight: 1.4 }}>{r.text}</span>
        <span style={{ fontSize: "13px", color: FAINT }}>{r.meta}</span>
      </span>
      {r.status ? <span style={{ flex: "none", height: "26px", padding: "0 10px", display: "inline-flex", alignItems: "center", borderRadius: "999px", background: r.status[1], color: r.status[2], fontSize: "12.5px", fontWeight: 600 }}>{r.status[0]}</span> : null}
      <button type="button" role="switch" aria-checked={on} aria-label={r.label} disabled={busy} onClick={r.toggle} style={{ flex: "none", position: "relative", width: "40px", height: "24px", padding: 0, border: 0, borderRadius: "12px", background: on ? INK : "#8A8D96", cursor: busy ? "wait" : "pointer", transition: "background .2s ease" }}>
        <span aria-hidden="true" style={{ position: "absolute", top: "3px", left: on ? "19px" : "3px", width: "18px", height: "18px", borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.3)", transition: "left .2s ease" }} />
      </button>
      <span style={{ position: "relative", flex: "none" }}>
        <button type="button" aria-label="Más opciones" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)} style={{ width: "34px", height: "34px", padding: 0, border: 0, borderRadius: "10px", background: menu ? "#F1F1EC" : "transparent", color: MUTED, cursor: "pointer" }}>···</button>
        {menu ? (
          <>
            <button type="button" aria-label="Cerrar el menú" onClick={() => setMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 15, border: 0, background: "transparent", cursor: "default" }} />
            <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 22, minWidth: "220px", padding: "6px", display: "flex", flexDirection: "column", gap: "2px", borderRadius: "14px", background: "#FFFFFF", boxShadow: "0 18px 40px rgba(18,19,26,.2)", animation: "rise .2s ease-out" }}>
              {r.menu.map(([label, fn]) => (
                <button key={label} type="button" role="menuitem" onClick={() => { setMenu(false); fn(); }} style={{ minHeight: "38px", padding: "0 12px", border: 0, borderRadius: "9px", background: "transparent", textAlign: "left", fontSize: "14px", cursor: "pointer", color: label === "Borrar" ? "#B4232A" : INK }}>{label}</button>
              ))}
            </div>
          </>
        ) : null}
      </span>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Nueva rutina
function Pills({ label, items, value, onPick }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", animation: "fade .3s ease-out" }}>
      <span style={{ fontSize: "13px", fontWeight: 500, color: MUTED }}>{label}</span>
      <div role="radiogroup" aria-label={label} style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {items.map(([v, text]) => {
          const on = value === v;
          return <button key={String(v)} type="button" role="radio" aria-checked={on} onClick={() => onPick(v)} style={{ minWidth: "44px", height: "38px", padding: "0 14px", border: `1.5px solid ${sel(on)}`, borderRadius: "12px", background: "#FFFFFF", cursor: "pointer", fontSize: "14px", fontWeight: on ? 600 : 500, color: INK }}>{text}</button>;
        })}
      </div>
    </div>
  );
}
function Field({ label, value, onChange, placeholder }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "8px", animation: "fade .3s ease-out" }}>
      <span style={{ fontSize: "13px", fontWeight: 500, color: MUTED }}>{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ height: "44px", padding: "0 14px", border: "1px solid rgba(18,19,26,.1)", borderRadius: "12px", outline: "none", background: "#FFFFFF", fontSize: "15px" }} />
    </label>
  );
}
/** «Cada cierto tiempo»: the usual intervals, or another number of minutes or hours (15 minutes at least). */
function EveryPicker({ n, unit, onPick }) {
  const usual = EVERY.some(([k, u]) => k === Number(n) && u === unit);
  const [other, setOther] = useState(!usual);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", animation: "fade .3s ease-out" }}>
      <span style={{ fontSize: "13px", fontWeight: 500, color: MUTED }}>Cada</span>
      <div role="radiogroup" aria-label="Cada cuánto" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {EVERY.map(([k, u]) => {
          const on = !other && k === Number(n) && u === unit;
          return <button key={k + u} type="button" role="radio" aria-checked={on} onClick={() => { setOther(false); onPick(k, u); }} style={{ minWidth: "44px", height: "38px", padding: "0 14px", border: `1.5px solid ${sel(on)}`, borderRadius: "12px", background: "#FFFFFF", cursor: "pointer", fontSize: "14px", fontWeight: on ? 600 : 500, color: INK }}>{everyLabel(k, u)}</button>;
        })}
        <button type="button" role="radio" aria-checked={other} onClick={() => setOther(true)} style={{ height: "38px", padding: "0 14px", border: `1.5px solid ${sel(other)}`, borderRadius: "12px", background: "#FFFFFF", cursor: "pointer", fontSize: "14px", fontWeight: other ? 600 : 500, color: INK }}>Otro</button>
      </div>
      {other ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
          <input type="number" aria-label="Cada cuántos" min={unit === "horas" ? 1 : MIN_EVERY} max={unit === "horas" ? 168 : 9999} value={n} onChange={(e) => onPick(Math.max(1, Math.round(Number(e.target.value) || 0)), unit)} style={{ width: "90px", height: "38px", padding: "0 12px", border: "1px solid rgba(18,19,26,.1)", borderRadius: "12px", outline: "none", background: "#FFFFFF", fontSize: "15px", color: INK }} />
          {[["minutos", "minutos"], ["horas", "horas"]].map(([u, label]) => {
            const on = unit === u;
            return <button key={u} type="button" aria-pressed={on} onClick={() => onPick(n, u)} style={{ height: "38px", padding: "0 14px", border: `1.5px solid ${sel(on)}`, borderRadius: "12px", background: "#FFFFFF", cursor: "pointer", fontSize: "14px", fontWeight: on ? 600 : 500, color: INK }}>{label}</button>;
          })}
          <span style={{ fontSize: "13px", color: everyMinutes(n, unit) < MIN_EVERY ? "#B4232A" : FAINT }}>Como poco, cada 15 minutos.</span>
        </div>
      ) : null}
    </div>
  );
}
const choice = (on) => ({ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "3px", minHeight: "56px", padding: "10px 14px", border: `1.5px solid ${sel(on)}`, borderRadius: "14px", background: "#FFFFFF", textAlign: "left", cursor: "pointer", color: INK });
const panel = { display: "flex", flexDirection: "column", gap: "14px", padding: "18px", borderRadius: "18px", background: SOFT, animation: "rise .3s ease-out" };

/** One-off dates offered for «Una sola vez»: tomorrow and the next Friday and Monday. */
function onceDates(now = new Date()) {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const list = [[ymd(tomorrow), "mañana"]];
  for (const dow of [5, 1]) {
    const d = nextDow(dow, now);
    if (!list.some(([k]) => k === ymd(d))) list.push([ymd(d), dateLabel(d)]);
  }
  return list;
}

/** «Cada lunes a las 9», «Cada 30 minutos», «Cuando llegue un correo»…, or undefined for a kind the builder has no card for. */
function whenOf(b, dates) {
  return {
    dia: `${b.workdays ? "Cada día laborable" : "Cada día"} a las ${hourLabel(b.hour)}`,
    semana: `Cada ${DAY[b.dow]} a las ${hourLabel(b.hour)}`,
    vez: `${cap(dates.find(([k]) => k === b.date)?.[1] || b.date)} a las ${hourLabel(b.hour)}`,
    cada: everyText(b.everyN, b.everyUnit),
    correo: `Cuando llegue un correo${b.from.trim() ? " de " + b.from.trim() : ""}`,
    archivo: `Cuando se suba un archivo${b.folder.trim() ? " a «" + b.folder.trim() + "»" : ""}`,
    evento: `${{ "15 minutos": "Quince minutos", "1 hora": "Una hora", "1 día": "Un día" }[b.before]} antes de ${b.meetWord.trim() ? "cada reunión de «" + b.meetWord.trim() + "»" : "cada reunión"}`,
    sala: `Cuando ${b.roomMode === "mencion" ? "te mencionen" : "alguien escriba"} en ${b.room ? "#" + b.room : "cualquier sala"}`,
    hoja: `Cuando cambie ${b.col.trim() ? "«" + b.col.trim() + "»" : "una fila"} en ${b.sheet.trim() || "la hoja"}`,
  }[b.type];
}
/** The routine's name; the default «una conversación nueva cada vez» is left out. */
function sentenceOf(b, whenText, who, out, missions) {
  const tail = b.where !== "nueva" ? ", " + whereLabel(b.where, missions) : "";
  return `${whenText}, ${who?.name || "alguien"} ${b.what} y ${out.label}${tail}.`;
}
const nameOf = (s) => (s.length > 100 ? s.slice(0, 99) + "…" : s);

/** Whether the builder's own words say exactly what a saved time trigger does (else its sentence is kept). */
function shownAsIs(a) {
  const t = a?.trigger;
  const c = t?.config || {};
  const hour = (h) => HOURS.includes(h) || /^\d{2}:00$/.test(h || "");
  if (t?.type === "dia") return ["1,2,3,4,5", "0,1,2,3,4,5,6"].includes([...(c.dias || [])].sort().join()) && (c.festivo || "saltar") === "saltar" && hour(c.hora);
  if (t?.type === "semana") return String(c.semCada ?? "1") === "1" && hour(c.semHora);
  if (t?.type === "vez") return hour(c.vezHora);
  return t?.type === "cada";
}

/** The builder's state for a saved routine (best effort: parts it cannot show keep their text). */
function fromRule(a, dates) {
  const c = a.trigger?.config || {};
  const lines = String(a.prompt || "").split("\n").map((s) => s.trim()).filter(Boolean);
  const out = OUTS.find((o) => o.prompt && lines.slice(1).includes(o.prompt)) || OUTS[0];
  const before = { "15|minutos": "15 minutos", "1|horas": "1 hora", "1|días": "1 día" }[`${c.antelacion}|${c.unidad}`] || "1 hora";
  return {
    type: a.trigger?.type || "semana", hour: c.hora || c.semHora || c.vezHora || "09:00", workdays: (c.dias || [1, 2, 3, 4, 5]).length !== 7,
    dow: c.semDia ?? 1, date: c.vezFecha || dates[0][0], everyN: Number(c.cadaN) || 1, everyUnit: c.cadaUnidad || "horas",
    from: c.deModo === "algunos" ? (c.remitentes || []).join(", ") : "", folder: c.carpeta || "", before,
    meetWord: c.eventoFiltro === "palabra" ? c.eventoPalabra || "" : "", room: c.sala && !["*", "cualquier sala"].includes(c.sala) ? c.sala : "",
    roomMode: c.salaModo === "todo" ? "todo" : "mencion", sheet: c.hoja || "", col: c.cambio === "columna" ? c.columna || "" : "",
    who: a.botId, what: low((lines[0] || a.name || "").replace(/\.$/, "")), custom: "", out: out.id,
    extra: lines.slice(1).filter((l) => l !== out.prompt), where: whereOf(a),
  };
}

// «Hacerlo una rutina» from a chat's «+»: what you wrote and who you wrote to come filled in.
// With `rule`, the same sentence changes a saved routine: only the parts you touch are sent, with
// the version it loaded (editedAt), so two editors never overwrite each other.
function RoutineBuilder({ team, skills, missions, onClose, initialWhat = "", initialWho = null, rule = null, onReload }) {
  const { run } = useStore();
  const editing = !!rule;
  const [loaded] = useState(rule);
  const [version, setVersion] = useState(rule?.editedAt ?? null);
  const rooms = missions.filter((m) => isRoom(m) && m.title).slice(0, 6);
  const homes = missions.filter((m) => isRoom(m) && m.title && !m.incognito).slice(0, 6);
  const dates = useMemo(() => {
    const list = onceDates();
    const own = loaded?.trigger?.config?.vezFecha;
    if (own && !list.some(([k]) => k === own)) { const [y, m, d] = own.split("-").map(Number); list.push([own, dateLabel(new Date(y, m - 1, d))]); }
    return list;
  }, [loaded]);
  const firstBot = team.find((b) => b.id === initialWho) || team.find((b) => !/coordin/i.test(b.role || "")) || team[0];
  const [b, setB] = useState(() => loaded ? fromRule(loaded, dates) : {
    type: "semana", hour: "09:00", workdays: true, dow: 1, date: dates[0][0], everyN: 1, everyUnit: "horas",
    from: "", folder: "", before: "1 hora", meetWord: "", room: rooms[0]?.title || "", roomMode: "mencion", sheet: "", col: "",
    who: firstBot?.id || null, what: initialWhat.trim() ? low(initialWhat.trim().replace(/\.$/, "")) : GENERIC_IDEAS[0][0], custom: "", out: "hoy", extra: [], where: "nueva",
  });
  const [dirty, setDirty] = useState({});
  const [open, setOpen] = useState(editing ? null : "when");
  const [msg, setMsg] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const act = useAction();
  const set = (p, part) => { setB((x) => ({ ...x, ...p })); setSavedId(null); if (part) setDirty((d) => ({ ...d, [part]: true })); };
  const setWhen = (p) => set(p, "when");
  const who = team.find((x) => x.id === b.who) || null;
  const out = OUTS.find((o) => o.id === b.out) || OUTS[0];
  const kind = TIME_TYPES.includes(b.type) ? "hora" : "algo";
  // Someone (another window, the details page) saved this routine after it was opened here; the
  // versions this editor saved itself may reach the store before their answer does.
  const mine = useRef(new Set());
  const changedElsewhere = editing && (rule?.editedAt ?? null) !== version && !mine.current.has(rule?.editedAt);

  const builtWhen = whenOf(b, dates);
  // A saved «when» the builder cannot show (every 2 weeks, a web page…) keeps its own words until you change it.
  const whenText = (editing && !dirty.when && !shownAsIs(loaded)) || !builtWhen ? "Cuando " + (loaded?.trigger?.sentence || "pase lo que elegiste") : builtWhen;
  const where = whereLabel(b.where, missions);
  // The name follows the sentence only while it still is the sentence it was made from.
  const autoName = useMemo(() => {
    if (!loaded) return true;
    const st = fromRule(loaded, dates);
    const o = OUTS.find((x) => x.id === st.out) || OUTS[0];
    return loaded.name === nameOf(sentenceOf(st, whenOf(st, dates), team.find((x) => x.id === st.who), o, missions));
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const trigger = () => {
    const t = b.type;
    const config = {
      dia: { hora: b.hour, dias: b.workdays ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6], festivo: "saltar" },
      semana: { semDia: b.dow, semHora: b.hour, semCada: "1" },
      vez: { vezFecha: b.date, vezHora: b.hour, vezAviso: true },
      cada: { cadaN: Number(b.everyN), cadaUnidad: b.everyUnit },
      correo: b.from.trim() ? { deModo: "algunos", remitentes: b.from.split(/[,;]/).map((x) => x.trim()).filter(Boolean).slice(0, 20) } : { deModo: "todos" },
      archivo: { carpeta: b.folder.trim() },
      evento: { antelacion: { "15 minutos": "15", "1 hora": "1", "1 día": "1" }[b.before], unidad: { "15 minutos": "minutos", "1 hora": "horas", "1 día": "días" }[b.before], ...(b.meetWord.trim() ? { eventoFiltro: "palabra", eventoPalabra: b.meetWord.trim() } : { eventoFiltro: "todos" }) },
      sala: { sala: b.room || "cualquier sala", salaModo: b.roomMode },
      hoja: { hoja: b.sheet.trim(), ...(b.col.trim() ? { cambio: "columna", columna: b.col.trim() } : { cambio: "fila" }) },
    }[t];
    return { type: t, config, sentence: whenText };
  };
  const tooOften = b.type === "cada" && everyMinutes(b.everyN, b.everyUnit) < MIN_EVERY;
  const problem = !who ? "Elige quién lo hace."
    : b.type === "archivo" && !b.folder.trim() ? "Escribe en qué carpeta mira."
    : b.type === "hoja" && !b.sheet.trim() ? "Escribe qué hoja vigila."
    : tooOften ? "Como poco, cada 15 minutos."
    : b.where.startsWith("sala:") && !missions.some((m) => m.id === b.where.slice(5)) ? "Esa conversación ya no existe. Elige otra."
    : null;
  const delivery = () => (b.where.startsWith("sala:") ? { mode: "sala", missionId: b.where.slice(5) } : { mode: b.where });
  const prompt = () => [cap(b.what) + ".", out.prompt, ...(b.extra || [])].filter(Boolean).join("\n");
  const body = (enabled) => ({
    name: nameOf(sentenceOf(b, whenText, who, out, missions)),
    botId: who.id,
    prompt: prompt(),
    trigger: trigger(), notify: out.notify, enabled, delivery: delivery(),
  });
  // Editing: only what you touched, with the version you loaded (a 409 means someone saved first).
  const changes = () => {
    const c = {};
    if (dirty.when) c.trigger = trigger();
    if (dirty.who) c.botId = who.id;
    if (dirty.what || dirty.out) c.prompt = prompt();
    if (dirty.out) c.notify = out.notify;
    if (dirty.where) c.delivery = delivery();
    if (autoName && Object.keys(c).length) c.name = nameOf(sentenceOf(b, whenText, who, out, missions));
    return c;
  };
  const [conflict, setConflict] = useState(false);
  const saveChanges = async (extra = {}) => {
    const c = { ...changes(), ...extra };
    if (!Object.keys(c).length) return loaded.id;
    try {
      const saved = await run(async () => {
        const res = await patch(`/automations/${encodeURIComponent(loaded.id)}`, { ...c, expectedEditedAt: version });
        mine.current.add(res?.editedAt);
        return res;
      });
      setVersion(saved?.editedAt ?? null);
      setDirty({});
      return loaded.id;
    } catch (error) {
      if (error.status === 409) setConflict(true);
      throw error;
    }
  };
  const save = async (enabled) => {
    if (problem) { setMsg({ text: problem, error: true }); return null; }
    if (editing) return saveChanges(enabled && !rule.enabled ? { enabled: true } : {});
    if (savedId) {
      await run(() => patch(`/automations/${encodeURIComponent(savedId)}`, { enabled }));
      return savedId;
    }
    const created = await run(() => post("/automations", body(enabled)));
    setSavedId(created?.id || null);
    return created?.id || null;
  };
  // A test runs the saved rule now: a new one is kept paused until you activate it.
  const onTest = () => act.act(async () => {
    setMsg({ text: "Probando…" });
    const id = await save(false);
    if (!id) return;
    const res = await post(`/automations/${encodeURIComponent(id)}/test`, {});
    setMsg({ text: res?.message || res?.summary || (res?.missionId ? `${who.name} ya está en ello.${editing ? "" : " Queda en pausa hasta que la actives."}` : "Prueba lanzada."), missionId: res?.missionId || null });
  });
  const onActivate = () => act.act(async () => {
    const id = await save(true);
    if (id) onClose();
  });

  const timeBased = TIME_TYPES.includes(b.type);
  const times = nextTimes(b.type, b);
  const preview = msg?.text
    || (editing && !dirty.when ? (loaded.nextRun && loaded.enabled ? `Próxima vez: ${when(loaded.nextRun)}.` : "Cambia la parte que quieras; lo demás se queda como está.")
      : b.type === "vez" ? `Se hará ${dates.find(([k]) => k === b.date)?.[1]} a las ${hourLabel(b.hour)} y se apagará sola.`
      : b.type === "cada" ? (tooOften ? "Como poco, cada 15 minutos." : `Próximas veces: ${listJoin(times.map((d) => (ymd(d) === ymd(new Date()) ? "" : dateLabel(d) + " a las ") + clock(d)))}.`)
      : timeBased ? `Próximas veces: ${listJoin(times.map((d, i) => (i === 0 && ymd(d) === ymd(new Date()) ? "hoy" : dateLabel(d))))}, a las ${hourLabel(b.hour)}.`
      : "Pruébala ahora para ver qué haría; se queda en pausa hasta que la actives.");

  const ideas = useMemo(() => {
    const own = skills.filter((s) => s.botId === who?.id && !["archived", "pending", "disabled"].includes(s.status)).slice(0, 4)
      .map((s) => [low(s.name), s.description || "Usa lo que ya sabe hacer"]);
    return [...own, ...GENERIC_IDEAS].slice(0, 6);
  }, [skills, who?.id]);
  const useCustom = () => { const t = b.custom.trim(); if (t) { set({ what: low(t).replace(/\.$/, ""), custom: "" }, "what"); setOpen("out"); } };
  const tokens = [["", whenText, "when"], [", ", who?.name || "alguien", "who"], [" ", b.what, "what"], [" y ", out.label, "out"], [", ", where, "where"]];
  const homeList = b.where.startsWith("sala:") && !homes.some((m) => "sala:" + m.id === b.where) ? [...homes, ...missions.filter((m) => "sala:" + m.id === b.where)] : homes;

  return (
    <section id="nueva" aria-labelledby="new-t" style={{ scrollMarginTop: "24px", display: "flex", flexDirection: "column", gap: "18px", padding: "26px 28px", borderRadius: "26px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 24px 56px -34px rgba(18,19,26,.4)", animation: "sheet .45s cubic-bezier(.2,.8,.2,1)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "10px" }}>
        <h2 id="new-t" style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>{editing ? "Cambiar la rutina" : "Nueva rutina"}</h2>
        <span style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13.5px", color: FAINT }}>
          Se lee como una frase. Toca cada parte para cambiarla.
          <button type="button" onClick={onClose} aria-label="Cerrar" style={{ width: "28px", height: "28px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "#F1F1EC", cursor: "pointer", color: INK }}><X size={13} aria-hidden="true" /></button>
        </span>
      </div>
      <p style={{ margin: 0, font: "500 clamp(24px, 2.6vw, 32px)/1.45 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>
        {tokens.map(([before, label, k]) => (
          <span key={k}>
            <span>{before}</span>
            <button type="button" onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k} style={{ padding: "0 8px", margin: "0 2px", border: 0, borderRadius: "10px", background: open === k ? "#E3EBFF" : "#F1F1EC", color: INK, font: "inherit", textDecoration: "underline", textDecorationColor: "rgba(18,19,26,.3)", textUnderlineOffset: "6px", cursor: "pointer" }}>{label}</button>
          </span>
        ))}
        .
      </p>

      {open === "when" ? (
        <div role="group" aria-label="Cuándo" style={panel}>
          <div role="tablist" aria-label="Tipo de rutina" style={{ display: "inline-flex", alignSelf: "flex-start", padding: "3px", gap: "2px", borderRadius: "999px", background: "#EBEBE6" }}>
            {[["hora", "A una hora", "semana"], ["algo", "Cuando pase algo", "correo"]].map(([id, label, first]) => {
              const on = kind === id;
              return <button key={id} type="button" role="tab" aria-selected={on} onClick={() => { if (!on) { setWhen({ type: first }); setMsg(null); } }} style={{ height: "32px", padding: "0 14px", border: 0, borderRadius: "999px", background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 2px rgba(18,19,26,.1)" : "none", fontSize: "13.5px", fontWeight: 500, cursor: "pointer" }}>{label}</button>;
            })}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(190px, 100%), 1fr))", gap: "8px" }}>
            {(kind === "hora" ? TIME_TYPES : EVENT_TYPES).map((id) => {
              const on = b.type === id;
              return (
                <button key={id} type="button" aria-pressed={on} onClick={() => { setWhen({ type: id }); setMsg(null); }} style={{ ...choice(on), minHeight: "64px" }}>
                  <span style={{ fontSize: "14.5px", fontWeight: 600 }}>{TRIGGER_CARDS[id][0]}</span>
                  <span style={{ fontSize: "12.5px", color: FAINT }}>{TRIGGER_CARDS[id][1]}</span>
                </button>
              );
            })}
          </div>
          {b.type === "dia" ? <Pills label="Días" value={b.workdays} onPick={(v) => setWhen({ workdays: v })} items={[[true, "Laborables"], [false, "Todos los días"]]} /> : null}
          {b.type === "semana" ? <Pills label="Día" value={b.dow} onPick={(v) => setWhen({ dow: v })} items={[1, 2, 3, 4, 5, 6, 0].map((d) => [d, DAY[d]])} /> : null}
          {b.type === "vez" ? <Pills label="Día" value={b.date} onPick={(v) => setWhen({ date: v })} items={dates} /> : null}
          {b.type === "cada" ? <EveryPicker n={b.everyN} unit={b.everyUnit} onPick={(everyN, everyUnit) => setWhen({ everyN, everyUnit })} /> : null}
          {timeBased && b.type !== "cada" ? <Pills label="Hora" value={b.hour} onPick={(v) => setWhen({ hour: v })} items={(HOURS.includes(b.hour) ? HOURS : [...HOURS, b.hour].sort()).map((h) => [h, hourLabel(h)])} /> : null}
          {b.type === "correo" ? <Field label="De quién (vacío: de cualquiera)" value={b.from} onChange={(v) => setWhen({ from: v })} placeholder="facturas@proveedor.es" /> : null}
          {b.type === "archivo" ? <Field label="A la carpeta" value={b.folder} onChange={(v) => setWhen({ folder: v })} placeholder="Facturas" /> : null}
          {b.type === "evento" ? (
            <>
              <Pills label="Cuánto antes" value={b.before} onPick={(v) => setWhen({ before: v })} items={["15 minutos", "1 hora", "1 día"].map((x) => [x, x])} />
              <Field label="Qué reuniones (una palabra del título; vacío: todas)" value={b.meetWord} onChange={(v) => setWhen({ meetWord: v })} placeholder="clientes" />
            </>
          ) : null}
          {b.type === "sala" ? (
            <>
              <Pills label="Sala" value={b.room} onPick={(v) => setWhen({ room: v })} items={[["", "Cualquier sala"], ...rooms.map((r) => [r.title, "#" + r.title])]} />
              <Pills label="Cuándo" value={b.roomMode} onPick={(v) => setWhen({ roomMode: v })} items={[["todo", "alguien escriba"], ["mencion", "te mencionen"]]} />
            </>
          ) : null}
          {b.type === "hoja" ? (
            <>
              <Field label="Hoja" value={b.sheet} onChange={(v) => setWhen({ sheet: v })} placeholder="Ventas 2026" />
              <Field label="Columna que vigilar (vacío: cualquier fila nueva)" value={b.col} onChange={(v) => setWhen({ col: v })} placeholder="Importe" />
            </>
          ) : null}
        </div>
      ) : null}

      {open === "who" ? (
        <div role="group" aria-label="Quién lo hace" style={{ ...panel, flexDirection: "row", flexWrap: "wrap", gap: "8px" }}>
          {team.map((x) => {
            const on = x.id === b.who;
            return (
              <button key={x.id} type="button" aria-pressed={on} onClick={() => { set({ who: x.id }, "who"); setOpen("what"); }} style={{ height: "44px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "10px", border: `1.5px solid ${sel(on)}`, borderRadius: "12px", background: "#FFFFFF", fontSize: "14px", cursor: "pointer" }}>
                <BotDot bot={x} size={18} />
                <span style={{ fontWeight: 600 }}>{x.name}</span>
                {x.role ? <span style={{ color: FAINT }}>{x.role.toLowerCase()}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {open === "what" ? (
        <div role="group" aria-label={`Qué hace ${who?.name || ""}`} style={panel}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {ideas.map(([label, d]) => (
              <button key={label} type="button" aria-pressed={label === b.what} onClick={() => { set({ what: label }, "what"); setOpen("out"); }} style={{ ...choice(label === b.what), minHeight: "44px", padding: "8px 14px", gap: "2px" }}>
                <span style={{ fontSize: "14px", fontWeight: 600 }}>{cap(label)}</span>
                <span style={{ fontSize: "12.5px", color: FAINT }}>{d}</span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 4px 4px 14px", borderRadius: "14px", background: "#FFFFFF", border: "1px solid rgba(18,19,26,.1)" }}>
            <input type="text" aria-label="Otra cosa" value={b.custom} onChange={(e) => setB((x) => ({ ...x, custom: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") useCustom(); }} placeholder="Otra cosa: escríbelo con tus palabras" style={{ flex: 1, minWidth: 0, height: "40px", border: 0, outline: "none", background: "transparent", fontSize: "15px" }} />
            <button type="button" onClick={useCustom} disabled={!b.custom.trim()} style={{ height: "36px", padding: "0 14px", border: 0, borderRadius: "999px", cursor: b.custom.trim() ? "pointer" : "default", fontSize: "14px", fontWeight: 600, background: b.custom.trim() ? INK : "rgba(18,19,26,.08)", color: b.custom.trim() ? "#FFFFFF" : "#8A8D96" }}>Usar</button>
          </div>
        </div>
      ) : null}

      {open === "out" ? (
        <div role="group" aria-label="Qué hace con el resultado" style={{ ...panel, flexDirection: "row", flexWrap: "wrap", gap: "8px" }}>
          {OUTS.map((o) => (
            <button key={o.id} type="button" aria-pressed={o.id === b.out} onClick={() => set({ out: o.id }, "out")} style={{ ...choice(o.id === b.out), minHeight: "44px", padding: "8px 14px", gap: "2px" }}>
              <span style={{ fontSize: "14px", fontWeight: 600 }}>{o.label}</span>
              <span style={{ fontSize: "12.5px", color: FAINT }}>{o.desc}</span>
            </button>
          ))}
        </div>
      ) : null}

      {open === "where" ? (
        <div role="group" aria-label="En qué conversación" style={panel}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {[...WHERE.map((w) => [w.id, w.title, w.desc]), ...homeList.map((m) => ["sala:" + m.id, "#" + m.title, "Una conversación que ya existe"])].map(([id, title, desc]) => (
              <button key={id} type="button" aria-pressed={id === b.where} onClick={() => set({ where: id }, "where")} style={{ ...choice(id === b.where), minHeight: "44px", padding: "8px 14px", gap: "2px" }}>
                <span style={{ fontSize: "14px", fontWeight: 600 }}>{title}</span>
                <span style={{ fontSize: "12.5px", color: FAINT }}>{desc}</span>
              </button>
            ))}
          </div>
          <span style={{ fontSize: "13px", lineHeight: 1.5, color: FAINT }}>
            {b.where === "nueva" ? "Cada vez se abre una conversación con lo de ese día." : "Si toca mientras esa conversación está ocupada, espera y lo que se junte llega en una sola entrega. Si Colmena estaba cerrada, se hace una vez al abrirla."}
          </span>
        </div>
      ) : null}

      {conflict || changedElsewhere ? (
        <div role="alert" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", padding: "12px 16px", borderRadius: "14px", background: "#F1F1EC", fontSize: "14px", lineHeight: 1.45 }}>
          <span style={{ flex: "1 1 300px" }}>Esta rutina ha cambiado mientras la editabas. Para no pisar esos cambios, ábrela otra vez con lo último y vuelve a hacer los tuyos.</span>
          <button type="button" onClick={onReload} style={{ height: "36px", padding: "0 14px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", background: "#FFFFFF", fontSize: "14px", fontWeight: 500, cursor: "pointer" }}>Ver lo último</button>
        </div>
      ) : null}
      <span role="status" style={{ fontSize: "13.5px", lineHeight: 1.5, color: msg?.error || (act.error && !conflict) ? "#B4232A" : MUTED }}>
        {(conflict ? null : act.error) || preview}
        {msg?.missionId ? <> <a href={`/encargo/${msg.missionId}`} onClick={go(`/encargo/${msg.missionId}`)} style={{ color: "#1F4FD1", fontWeight: 600 }}>Ver cómo va</a></> : null}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", paddingTop: "4px" }}>
        <span style={{ flex: "1 1 260px", fontSize: "13.5px", color: FAINT }}>Aunque la rutina diga otra cosa, enviar fuera, pagar, publicar y borrar siempre te preguntan.</span>
        <button type="button" onClick={onTest} disabled={act.busy} style={{ height: "44px", padding: "0 18px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", background: "#FFFFFF", fontSize: "15px", fontWeight: 500, cursor: act.busy ? "wait" : "pointer" }}>{savedId ? "Probar otra vez" : "Probar ahora"}</button>
        <button type="button" onClick={onActivate} disabled={act.busy || (editing && (conflict || changedElsewhere))} style={{ height: "44px", padding: "0 22px", border: 0, borderRadius: "999px", background: INK, color: "#FFFFFF", fontSize: "15px", fontWeight: 600, cursor: act.busy ? "wait" : "pointer", opacity: editing && (conflict || changedElsewhere) ? 0.5 : 1 }}>{editing ? "Guardar cambios" : "Activar"}</button>
      </div>
    </section>
  );
}

// ───────────────────────────────────────────────────────────── Encargos
const NOTIFY = [["cada", "Cada vez"], ["dia", "1 al día"], ["semana", "1 a la semana"]];
function untilOptions(now = new Date()) {
  const month = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59);
  const year = new Date(now.getFullYear(), 11, 31, 23, 59);
  return [[null, "Sin fecha"], [month.toISOString(), "Fin de mes"], [year.toISOString(), "Fin de año"]];
}
const longDate = (iso) => { const d = new Date(iso); return `${d.getDate()} de ${MONTH[d.getMonth()]}`; };
const inputBox = { padding: "12px 14px", border: "1px solid rgba(18,19,26,.1)", borderRadius: "12px", outline: "none", background: "#FFFFFF", fontSize: "15px", lineHeight: 1.5, resize: "vertical", fontFamily: "inherit", color: INK };

function OrderForm({ team, initial, onClose }) {
  const untils = useMemo(() => untilOptions(), []);
  const [f, setF] = useState(() => initial
    ? { title: initial.title, botId: initial.botId, what: initial.what, stopWhen: initial.stopWhen, when: initial.when, notifyMax: initial.notifyMax || "cada", until: initial.until }
    : { title: "", botId: team[0]?.id || null, what: "", stopWhen: "", when: "", notifyMax: "dia", until: null });
  const act = useAction();
  const ready = f.title.trim() && f.what.trim().length >= 3 && f.botId;
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const untilItems = initial?.until && !untils.some(([v]) => v === initial.until) ? [...untils, [initial.until, "Hasta el " + longDate(initial.until)]] : untils;
  const save = () => act.act(async () => {
    if (!ready) return;
    const data = { title: f.title.trim(), what: f.what.trim(), stopWhen: f.stopWhen.trim(), when: f.when.trim(), notifyMax: f.notifyMax, until: f.until };
    if (initial) await patch(`/standing-orders/${encodeURIComponent(initial.id)}`, data);
    else await post("/standing-orders", { ...data, botId: f.botId });
    onClose();
  });
  const label = (text) => <span style={{ fontSize: "13px", fontWeight: 500, color: MUTED }}>{text}</span>;
  return (
    <section aria-labelledby="of-t" style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "24px 26px", borderRadius: "22px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 24px 56px -34px rgba(18,19,26,.4)", animation: "sheet .45s cubic-bezier(.2,.8,.2,1)" }}>
      <h2 id="of-t" style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>{initial ? "Cambiar el encargo" : "Nuevo encargo"}</h2>
      <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {label("Nombre del encargo")}
        <input type="text" autoFocus value={f.title} maxLength={100} onChange={(e) => set({ title: e.target.value })} placeholder="Facturas de proveedores" style={{ ...inputBox, height: "44px", padding: "0 14px" }} />
      </label>
      {!initial ? <Pills label="Quién se encarga" value={f.botId} onPick={(v) => set({ botId: v })} items={team.map((b) => [b.id, b.name])} /> : null}
      <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {label("Qué hace")}
        <textarea rows="2" value={f.what} onChange={(e) => set({ what: e.target.value })} placeholder="Revisa las facturas que lleguen y apúntalas en la hoja de gastos." style={inputBox} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {label("Cuándo para y te pregunta")}
        <textarea rows="2" value={f.stopWhen} onChange={(e) => set({ stopWhen: e.target.value })} placeholder="Si el importe pasa de 500 € o falta algún dato." style={inputBox} />
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "20px" }}>
        <Pills label="Avisos como mucho" items={NOTIFY} value={f.notifyMax} onPick={(v) => set({ notifyMax: v })} />
        <Pills label="Hasta (opcional)" items={untilItems} value={f.until} onPick={(v) => set({ until: v })} />
      </div>
      <span style={{ fontSize: "13.5px", color: FAINT }}>Aunque el encargo diga otra cosa, enviar algo fuera, mover dinero, borrar archivos e instalar programas siempre te preguntan.</span>
      {act.error ? <p role="alert" style={{ margin: 0, fontSize: "14px", color: "#B4232A" }}>{act.error}</p> : null}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
        <button type="button" onClick={onClose} style={{ height: "42px", padding: "0 16px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", background: "#FFFFFF", cursor: "pointer", fontSize: "14.5px", fontWeight: 500 }}>Cancelar</button>
        <button type="button" onClick={save} disabled={!ready || act.busy} style={{ height: "42px", padding: "0 20px", border: 0, borderRadius: "999px", cursor: ready ? "pointer" : "default", fontSize: "14.5px", fontWeight: 600, background: ready ? INK : "rgba(18,19,26,.08)", color: ready ? "#FFFFFF" : "#8A8D96" }}>{initial ? "Guardar cambios" : "Guardar encargo"}</button>
      </div>
    </section>
  );
}

// ───────────────────────────────────────────────────────────── Recordatorios por tema
function ReminderForm() {
  const [topic, setTopic] = useState("");
  const [what, setWhat] = useState("");
  const act = useAction();
  const ready = topic.trim().length >= 2 && what.trim().length >= 3;
  const touched = topic || what;
  const add = () => act.act(async () => {
    if (!ready) return;
    const keywords = topic.split(/[,;]/).map((x) => x.trim()).filter((x) => x.length >= 2);
    await post("/intents", { keywords, remind: what.trim() });
    setTopic(""); setWhat("");
  });
  const input = { flex: 1, minWidth: 0, height: "44px", padding: "0 14px", border: "1px solid rgba(18,19,26,.1)", borderRadius: "12px", outline: "none", background: "#FFFFFF", font: "500 16px/1 'Geist', sans-serif", color: INK };
  return (
    <section aria-labelledby="rf-t" style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "20px 22px", borderRadius: "22px", background: SOFT }}>
      <h3 id="rf-t" style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>Nuevo recordatorio <span style={{ fontWeight: 400, color: FAINT }}>· vale en cualquier sala o chat</span></h3>
      <p style={{ margin: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", font: "500 clamp(19px, 2vw, 22px)/1.4 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.01em" }}>
        Cuando se hable de
        <label style={{ flex: "1 1 220px", display: "flex" }}>
          <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>Cuando se hable de</span>
          <input id="rf-topic" type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="contrato de limpieza, limpieza" style={input} />
        </label>
        , recuérdame
        <label style={{ flex: "2 1 280px", display: "flex" }}>
          <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>Recuérdame</span>
          <input type="text" value={what} onChange={(e) => setWhat(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="que el preaviso es de 30 días" style={input} />
        </label>
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        <span role="status" style={{ fontSize: "13px", color: act.error ? "#B4232A" : touched && !ready ? "#8A5A00" : FAINT }}>{act.error || (touched && !ready ? "Escribe al menos una palabra o frase en cada lado." : "Palabras o frases separadas por comas.")}</span>
        <button type="button" onClick={add} disabled={!ready || act.busy} style={{ height: "40px", padding: "0 18px", border: 0, borderRadius: "999px", cursor: ready ? "pointer" : "default", fontSize: "14px", fontWeight: 600, background: ready ? INK : "rgba(18,19,26,.08)", color: ready ? "#FFFFFF" : "#8A8D96" }}>Añadir</button>
      </div>
    </section>
  );
}
function ReminderSample({ sample, atlas }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px 20px", borderRadius: "20px", background: "rgba(255,255,255,.55)" }}>
      <span style={{ fontSize: "13px", fontWeight: 500, color: FAINT }}>Así aparece en una sala</span>
      <div style={{ display: "grid", gridTemplateColumns: "24px 1fr", gap: "12px", alignItems: "start" }}>
        {atlas ? <BotPresence bot={atlas} size={22} /> : <span />}
        <span style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ fontSize: "13px", color: FAINT }}><strong style={{ color: INK, fontWeight: 600 }}>{atlas?.name || "Colmena"}</strong>{" · recordatorio para ti"}</span>
          <span style={{ fontSize: "14.5px", lineHeight: 1.5 }}>{"Se está hablando de "}<strong style={{ fontWeight: 600 }}>{sample?.keywords[0] || "contrato de limpieza"}</strong>{". Me pediste que te recordara " + (sample?.remind.replace(/\.$/, "") || "que el preaviso es de 30 días") + "."}</span>
        </span>
      </div>
    </div>
  );
}
