import { useMemo, useState } from "react";
import Shell from "../components/v2/Shell.jsx";
import { BotPresence } from "../components/v2/Presence.jsx";
import { useAction, useResource, useStore } from "../lib/store.jsx";
import { del, patch, post } from "../lib/api.js";
import { navigate, useRouter } from "../lib/router.jsx";
import { isRoom } from "../lib/format.js";

// Colmena 2.0 · Rutinas (design/V2Rutinas.dc.html). Three kinds of standing work, each read
// as a sentence: routines (automations with a trigger), encargos (standing orders a bot
// keeps in mind) and recordatorios por tema (intents: «cuando se hable de X, recuérdame Y»).

const INK = "#12131A";
const MUTED = "#5C606C";
const FAINT = "#6B6F7A";
const SOFT = "#F6F6F3";
const SHEET = "0 1px 2px rgba(18,19,26,.05), 0 30px 70px -36px rgba(18,19,26,.35)";

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

const TYPES = {
  dia: "Cada día", semana: "Cada semana", vez: "Una sola vez",
  correo: "Llegue un correo", archivo: "Se suba un archivo", evento: "Se acerque una reunión", sala: "Alguien escriba en una sala", hoja: "Cambie una hoja de cálculo",
};
const TIME_TYPES = ["dia", "semana", "vez"];

const OUTS = [
  { id: "hoy", label: "te lo deja en Hoy", title: "Te lo deja en Hoy", desc: "Lo verás al abrir Colmena", glyph: "☀", tint: "#FFF4D1", notify: "resultado", prompt: "" },
  { id: "correo", label: "te lo manda por correo", title: "Te lo manda por correo", desc: "Antes de enviarlo te pide permiso", glyph: "@", tint: "#EAF0FF", notify: "resultado", prompt: "Cuando acabes, mándame el resultado por correo." },
  { id: "archivo", label: "lo guarda en el Archivo", title: "Lo guarda en el Archivo", desc: "Sin avisarte; lo buscas cuando quieras", glyph: "▤", tint: "#EAF6F0", notify: "fallo", prompt: "Guarda el resultado como un archivo, sin avisarme salvo que algo falle." },
  { id: "ok", label: "te pide OK antes de hacer nada", title: "Te pide OK antes de nada", desc: "Te llega a Hoy como algo que te toca", glyph: "✓", tint: "#FFF4D1", notify: "siempre", prompt: "Antes de hacer nada que cambie algo, prepáralo y pídeme el OK." },
];

const GENERIC_IDEAS = [
  ["resume lo importante", "Correos, salas y documentos nuevos, en una página"],
  ["prepara el plan de la semana", "Repasa encargos y plazos y propone prioridades"],
  ["revisa lo pendiente y te avisa", "Lo que va con retraso o espera a alguien"],
];

export default function RutinasV2() {
  const { query } = useRouter();
  const { automations = [], bots = [], missions = [], skills = [], ready } = useStore();
  const orders = useResource("/standing-orders");
  const intents = useResource("/intents");
  const [tab, setTab] = useState({ encargos: "ord", recordatorios: "rem" }[query.pestana] || "rut");
  const [open, setOpen] = useState(query.nueva === "1");
  const [orderForm, setOrderForm] = useState(false);

  const team = bots.filter((b) => !b.archived);
  const orderList = orders.data || [];
  const intentList = intents.data || [];
  const tabs = [["rut", "Rutinas", automations.length], ["ord", "Encargos", orderList.length], ["rem", "Recordatorios por tema", intentList.length]];
  const desc = {
    rut: "Lo que tu colmena hace sola, cuando toca. Se leen como una frase.",
    ord: "Trabajos de fondo que un bot atiende siempre que hace falta, con sus límites claros.",
    rem: "«Cuando se hable de X, recuérdame Y». Te avisa y lo deja anotado en la sala.",
  }[tab];
  const newLabel = { rut: "Nueva rutina", ord: "Nuevo encargo", rem: "Nuevo recordatorio" }[tab];
  const onNew = () => {
    if (tab === "rut") setOpen(true);
    else if (tab === "ord") setOrderForm(true);
    else document.getElementById("rf-topic")?.focus();
  };

  return (
    <Shell active="rutinas">
      <main style={{ maxWidth: "1000px", margin: "0 auto", padding: "64px clamp(20px, 4vw, 48px) 40px", display: "flex", flexDirection: "column", gap: "40px" }}>
        <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "20px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <h1 style={{ margin: 0, font: "600 clamp(48px, 7vw, 84px)/0.95 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.05em" }}>Rutinas</h1>
            <p style={{ margin: 0, maxWidth: "620px", fontSize: "17px", lineHeight: 1.5, color: MUTED }}>{desc}</p>
          </div>
          <button type="button" onClick={onNew} style={{ display: "flex", alignItems: "center", gap: "10px", height: "52px", padding: "0 24px", border: 0, borderRadius: "999px", background: INK, color: "#FFFFFF", cursor: "pointer", fontSize: "15px", fontWeight: 600 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            {newLabel}
          </button>
        </header>
        <div role="tablist" aria-label="Qué ver" style={{ alignSelf: "flex-start", marginTop: "-14px", display: "flex", flexWrap: "wrap", gap: "2px", padding: "4px", borderRadius: "999px", background: "rgba(18,19,26,.05)" }}>
          {tabs.map(([id, label, n]) => {
            const on = tab === id;
            return (
              <button key={id} type="button" role="tab" aria-selected={on} onClick={() => setTab(id)} style={{ display: "flex", alignItems: "center", gap: "8px", height: "44px", padding: "0 18px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "15px", fontWeight: 600, transition: "all .2s ease", background: on ? "#FFFFFF" : "transparent", color: INK, boxShadow: on ? "0 1px 3px rgba(18,19,26,.15)" : "none" }}>
                {label}
                <span style={{ font: "500 12px/1 'Geist Mono', monospace", color: FAINT }}>{ready ? n : "·"}</span>
              </button>
            );
          })}
        </div>
        {tab === "rut" ? (
          <>
            {open ? <RoutineBuilder team={team} skills={skills} missions={missions} initialWhat={query.texto || ""} initialWho={query.bot || null} onClose={() => setOpen(false)} /> : null}
            <RoutineList automations={automations} bots={team} ready={ready} onNew={() => setOpen(true)} open={open} />
          </>
        ) : null}
        {tab === "ord" ? <Orders team={team} list={orderList} loading={orders.loading && !orders.data} form={orderForm} setForm={setOrderForm} automations={automations} /> : null}
        {tab === "rem" ? <Reminders list={intentList} loading={intents.loading && !intents.data} missions={missions} bots={team} /> : null}
      </main>
    </Shell>
  );
}

// ───────────────────────────────────────────────────────────── Rutinas
function Chevron({ open }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", opacity: 0.45, transition: "transform .2s ease", transform: open ? "rotate(180deg)" : "none" }}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
function Token({ id, panel, setPanel, popup = "listbox", children }) {
  const open = panel === id;
  return (
    <button type="button" aria-haspopup={popup} aria-expanded={open} onClick={() => setPanel(open ? null : id)} style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "0 8px", border: 0, borderRadius: "12px", cursor: "pointer", font: "inherit", letterSpacing: "inherit", color: "inherit", textDecoration: "underline", textDecorationColor: "#FFC93C", textDecorationThickness: "4px", textUnderlineOffset: "8px", background: open ? "rgba(255,201,60,.28)" : "transparent", transition: "background .2s ease" }}>
      {children}
      <Chevron open={open} />
    </button>
  );
}
function Check({ on }) {
  return (
    <span aria-hidden="true" style={{ width: "22px", height: "22px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: on ? INK : "transparent", boxShadow: on ? "none" : "inset 0 0 0 1.5px rgba(18,19,26,.2)" }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: on ? 1 : 0 }}><path d="m5 12 5 5 9-10" /></svg>
    </span>
  );
}
function Pills({ label, items, value, onPick }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", animation: "fade .3s ease-out" }}>
      <span style={{ fontSize: "13px", fontWeight: 500, color: MUTED }}>{label}</span>
      <div role="radiogroup" aria-label={label} style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {items.map(([v, text]) => {
          const on = value === v;
          return (
            <button key={String(v)} type="button" role="radio" aria-checked={on} onClick={() => onPick(v)} style={{ minWidth: "44px", height: "42px", padding: "0 16px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "14px", fontWeight: 500, transition: "all .2s ease", background: on ? INK : "#FFFFFF", color: on ? "#FFFFFF" : INK, boxShadow: on ? "none" : "0 1px 2px rgba(18,19,26,.06)" }}>
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
function Field({ label, value, onChange, placeholder }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "10px", animation: "fade .3s ease-out" }}>
      <span style={{ fontSize: "13px", fontWeight: 500, color: MUTED }}>{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ height: "50px", padding: "0 18px", border: 0, borderRadius: "16px", outline: "none", background: "#FFFFFF", fontSize: "16px", boxShadow: "0 1px 2px rgba(18,19,26,.06)" }} />
    </label>
  );
}
function PanelHead({ id, title, hint }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "8px", padding: "0 8px" }}>
      <h3 id={id} style={{ margin: 0, font: "600 20px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{title}</h3>
      <span style={{ fontSize: "13px", color: FAINT }}>{hint}</span>
    </div>
  );
}
const optionStyle = (on, minHeight = "64px") => ({ display: "flex", alignItems: "center", gap: "14px", minHeight, padding: "10px 14px", border: 0, borderRadius: "18px", cursor: "pointer", textAlign: "left", transition: "background .2s ease, box-shadow .2s ease", background: on ? "#FFFFFF" : "transparent", boxShadow: on ? `0 0 0 2px ${INK}` : "none", color: INK });

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

// «Hacerlo una rutina» from a chat's «+»: what you wrote and who you wrote to come filled in.
function RoutineBuilder({ team, skills, missions, onClose, initialWhat = "", initialWho = null }) {
  const { run } = useStore();
  const rooms = missions.filter((m) => isRoom(m) && m.title).slice(0, 6);
  const dates = useMemo(() => onceDates(), []);
  const firstBot = team.find((b) => b.id === initialWho) || team.find((b) => !/coordin/i.test(b.role || "")) || team[0];
  const [b, setB] = useState({
    type: "semana", hour: "09:00", workdays: true, dow: 1, date: dates[0][0],
    from: "", folder: "", before: "1 hora", meetWord: "", room: rooms[0]?.title || "", roomMode: "mencion", sheet: "", col: "",
    who: firstBot?.id || null, what: initialWhat.trim() ? low(initialWhat.trim().replace(/\.$/, "")) : GENERIC_IDEAS[0][0], custom: "", out: "hoy",
  });
  const [panel, setPanel] = useState("when");
  const [msg, setMsg] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const act = useAction();
  const set = (p) => { setB((x) => ({ ...x, ...p })); setSavedId(null); };
  const who = team.find((x) => x.id === b.who) || null;
  const out = OUTS.find((o) => o.id === b.out) || OUTS[0];

  const whenText = {
    dia: `${b.workdays ? "Cada día laborable" : "Cada día"} a las ${hourLabel(b.hour)}`,
    semana: `Cada ${DAY[b.dow]} a las ${hourLabel(b.hour)}`,
    vez: `${cap(dates.find(([k]) => k === b.date)?.[1] || b.date)} a las ${hourLabel(b.hour)}`,
    correo: `Cuando llegue un correo${b.from.trim() ? " de " + b.from.trim() : ""}`,
    archivo: `Cuando se suba un archivo${b.folder.trim() ? " a «" + b.folder.trim() + "»" : ""}`,
    evento: `${{ "15 minutos": "Quince minutos", "1 hora": "Una hora", "1 día": "Un día" }[b.before]} antes de ${b.meetWord.trim() ? "cada reunión de «" + b.meetWord.trim() + "»" : "cada reunión"}`,
    sala: `Cuando ${b.roomMode === "mencion" ? "te mencionen" : "alguien escriba"} en ${b.room ? "#" + b.room : "cualquier sala"}`,
    hoja: `Cuando cambie ${b.col.trim() ? "«" + b.col.trim() + "»" : "una fila"} en ${b.sheet.trim() || "la hoja"}`,
  }[b.type];
  const sentence = `${whenText}, ${who?.name || "alguien"} ${b.what} y ${out.label}.`;

  const trigger = () => {
    const t = b.type;
    const config = {
      dia: { hora: b.hour, dias: b.workdays ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6], festivo: "saltar" },
      semana: { semDia: b.dow, semHora: b.hour, semCada: "1" },
      vez: { vezFecha: b.date, vezHora: b.hour, vezAviso: true },
      correo: b.from.trim() ? { deModo: "algunos", remitentes: b.from.split(/[,;]/).map((x) => x.trim()).filter(Boolean).slice(0, 20) } : { deModo: "todos" },
      archivo: { carpeta: b.folder.trim() },
      evento: { antelacion: { "15 minutos": "15", "1 hora": "1", "1 día": "1" }[b.before], unidad: { "15 minutos": "minutos", "1 hora": "horas", "1 día": "días" }[b.before], ...(b.meetWord.trim() ? { eventoFiltro: "palabra", eventoPalabra: b.meetWord.trim() } : { eventoFiltro: "todos" }) },
      sala: { sala: b.room || "cualquier sala", salaModo: b.roomMode },
      hoja: { hoja: b.sheet.trim(), ...(b.col.trim() ? { cambio: "columna", columna: b.col.trim() } : { cambio: "fila" }) },
    }[t];
    return { type: t, config, sentence: whenText };
  };
  const problem = !who ? "Elige quién lo hace."
    : b.type === "archivo" && !b.folder.trim() ? "Escribe en qué carpeta mira."
    : b.type === "hoja" && !b.sheet.trim() ? "Escribe qué hoja vigila."
    : null;
  const body = (enabled) => ({
    name: sentence.length > 100 ? sentence.slice(0, 99) + "…" : sentence,
    botId: who.id,
    prompt: [cap(b.what) + ".", out.prompt].filter(Boolean).join("\n"),
    trigger: trigger(), notify: out.notify, enabled,
  });
  const save = async (enabled) => {
    if (problem) { setMsg({ text: problem, error: true }); return null; }
    if (savedId) {
      await run(() => patch(`/automations/${encodeURIComponent(savedId)}`, { enabled }));
      return savedId;
    }
    const created = await run(() => post("/automations", body(enabled)));
    setSavedId(created?.id || null);
    return created?.id || null;
  };
  // A test runs the saved rule now: it is kept paused until you activate it.
  const onTest = () => act.act(async () => {
    setMsg({ text: "Probando…" });
    const id = await save(false);
    if (!id) return;
    const res = await post(`/automations/${encodeURIComponent(id)}/test`, {});
    setMsg({ text: res?.message || res?.summary || (res?.missionId ? `${who.name} ya está en ello. Queda en pausa hasta que la actives.` : "Prueba lanzada."), missionId: res?.missionId || null });
  });
  const onActivate = () => act.act(async () => {
    const id = await save(true);
    if (id) onClose();
  });

  const timeBased = TIME_TYPES.includes(b.type);
  const times = nextTimes(b.type, b);
  const preview = msg?.text
    || (b.type === "vez" ? `Se hará ${dates.find(([k]) => k === b.date)?.[1]} a las ${hourLabel(b.hour)} y se apagará sola.`
      : timeBased ? `Próximas veces: ${listJoin(times.map((d, i) => (i === 0 && ymd(d) === ymd(new Date()) ? "hoy" : dateLabel(d))))}, a las ${hourLabel(b.hour)}.`
      : "Pruébala ahora para ver qué haría; se queda en pausa hasta que la actives.");

  const ideas = useMemo(() => {
    const own = skills.filter((s) => s.botId === who?.id && !["archived", "pending", "disabled"].includes(s.status)).slice(0, 4)
      .map((s) => [low(s.name), s.description || "Usa lo que ya sabe hacer"]);
    return [...own, ...GENERIC_IDEAS].slice(0, 6);
  }, [skills, who?.id]);
  const useCustom = () => { const t = b.custom.trim(); if (t) { set({ what: low(t).replace(/\.$/, ""), custom: "" }); setPanel("out"); } };

  return (
    <section aria-labelledby="new-t" style={{ position: "relative", padding: "34px 34px 28px", background: "#FFFFFF", borderRadius: "34px", boxShadow: SHEET, display: "flex", flexDirection: "column", gap: "22px", animation: "sheet .45s cubic-bezier(.2,.8,.2,1)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <h2 id="new-t" style={{ margin: 0, fontSize: "13px", fontWeight: 500, color: FAINT }}>Nueva rutina · toca cada parte para cambiarla</h2>
        <button type="button" onClick={onClose} aria-label="Cerrar" style={{ width: "36px", height: "36px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "rgba(18,19,26,.05)", cursor: "pointer", color: INK }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <p style={{ margin: 0, font: "600 clamp(26px, 3.2vw, 36px)/1.45 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em", color: INK }}>
        <Token id="when" panel={panel} setPanel={setPanel} popup="dialog">{whenText}</Token>
        {", "}
        <Token id="who" panel={panel} setPanel={setPanel}>
          {who ? <BotPresence bot={who} size={24} /> : null}
          {who?.name || "alguien"}
        </Token>
        {" "}
        <Token id="what" panel={panel} setPanel={setPanel}>{b.what}</Token>
        {" y "}
        <Token id="out" panel={panel} setPanel={setPanel}>{out.label}</Token>
        {"."}
      </p>

      {panel === "when" ? (
        <div role="dialog" aria-label="Cuándo" style={{ display: "flex", flexWrap: "wrap", borderRadius: "26px", background: SOFT, overflow: "hidden", animation: "rise .3s ease-out" }}>
          <div role="radiogroup" aria-label="Tipo" style={{ flex: "1 1 260px", padding: "14px", display: "flex", flexDirection: "column", gap: "2px", borderRight: "1px solid rgba(18,19,26,.06)" }}>
            {[["A una hora", TIME_TYPES], ["Cuando pase algo", ["correo", "archivo", "evento", "sala", "hoja"]]].map(([head, ids], gi) => (
              <div key={head} style={{ display: "contents" }}>
                <span style={{ padding: gi ? "12px 12px 8px" : "8px 12px", fontSize: "12px", fontWeight: 500, color: FAINT }}>{head}</span>
                {ids.map((id) => {
                  const on = b.type === id;
                  return (
                    <button key={id} type="button" role="radio" aria-checked={on} onClick={() => { set({ type: id }); setMsg(null); }} style={{ display: "flex", alignItems: "center", minHeight: "44px", padding: "0 14px", border: 0, borderRadius: "14px", cursor: "pointer", textAlign: "left", fontSize: "15px", fontWeight: 500, background: on ? "#FFFFFF" : "transparent", color: INK, boxShadow: on ? "0 1px 2px rgba(18,19,26,.08)" : "none" }}>
                      {TYPES[id]}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div style={{ flex: "2 1 380px", padding: "24px 26px", display: "flex", flexDirection: "column", gap: "20px" }}>
            {b.type === "dia" ? <Pills label="Días" value={b.workdays} onPick={(v) => set({ workdays: v })} items={[[true, "Laborables"], [false, "Todos los días"]]} /> : null}
            {b.type === "semana" ? <Pills label="Día" value={b.dow} onPick={(v) => set({ dow: v })} items={[1, 2, 3, 4, 5, 6, 0].map((d) => [d, DAY[d]])} /> : null}
            {b.type === "vez" ? <Pills label="Día" value={b.date} onPick={(v) => set({ date: v })} items={dates} /> : null}
            {timeBased ? <Pills label="Hora" value={b.hour} onPick={(v) => set({ hour: v })} items={HOURS.map((h) => [h, hourLabel(h)])} /> : null}
            {b.type === "correo" ? <Field label="De quién (vacío: de cualquiera)" value={b.from} onChange={(v) => set({ from: v })} placeholder="facturas@proveedor.es" /> : null}
            {b.type === "archivo" ? <Field label="A la carpeta" value={b.folder} onChange={(v) => set({ folder: v })} placeholder="Facturas" /> : null}
            {b.type === "evento" ? (
              <>
                <Pills label="Cuánto antes" value={b.before} onPick={(v) => set({ before: v })} items={["15 minutos", "1 hora", "1 día"].map((x) => [x, x])} />
                <Field label="Qué reuniones (una palabra del título; vacío: todas)" value={b.meetWord} onChange={(v) => set({ meetWord: v })} placeholder="clientes" />
              </>
            ) : null}
            {b.type === "sala" ? (
              <>
                <Pills label="Sala" value={b.room} onPick={(v) => set({ room: v })} items={[["", "Cualquier sala"], ...rooms.map((r) => [r.title, "#" + r.title])]} />
                <Pills label="Cuándo" value={b.roomMode} onPick={(v) => set({ roomMode: v })} items={[["todo", "alguien escriba"], ["mencion", "te mencionen"]]} />
              </>
            ) : null}
            {b.type === "hoja" ? (
              <>
                <Field label="Hoja" value={b.sheet} onChange={(v) => set({ sheet: v })} placeholder="Ventas 2026" />
                <Field label="Columna que vigilar (vacío: cualquier fila nueva)" value={b.col} onChange={(v) => set({ col: v })} placeholder="Importe" />
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {panel === "who" ? (
        <div role="dialog" aria-labelledby="who-h" style={{ padding: "18px", borderRadius: "26px", background: SOFT, display: "flex", flexDirection: "column", gap: "12px", animation: "rise .3s ease-out" }}>
          <PanelHead id="who-h" title="¿Quién lo hace?" hint="Elige el bot que mejor sabe hacerlo" />
          <div role="listbox" aria-labelledby="who-h" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "6px" }}>
            {team.map((x) => {
              const on = x.id === b.who;
              return (
                <button key={x.id} type="button" role="option" aria-selected={on} onClick={() => { set({ who: x.id }); setPanel("what"); }} style={optionStyle(on, "68px")}>
                  <BotPresence bot={x} size={34} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                    <strong style={{ fontSize: "15px", fontWeight: 600 }}>{x.name}</strong>
                    <span style={{ fontSize: "13px", color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.role || "Sin papel todavía"}</span>
                  </span>
                  <Check on={on} />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {panel === "what" ? (
        <div role="dialog" aria-labelledby="what-h" style={{ padding: "18px", borderRadius: "26px", background: SOFT, display: "flex", flexDirection: "column", gap: "12px", animation: "rise .3s ease-out" }}>
          <PanelHead id="what-h" title={`¿Qué hace ${who?.name || ""}?`} hint="Ideas según lo que sabe hacer" />
          <div role="listbox" aria-labelledby="what-h" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {ideas.map(([label, d]) => {
              const on = label === b.what;
              return (
                <button key={label} type="button" role="option" aria-selected={on} onClick={() => { set({ what: label }); setPanel("out"); }} style={optionStyle(on, "54px")}>
                  <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
                    <strong style={{ fontSize: "15px", fontWeight: 600 }}>{cap(label)}</strong>
                    <span style={{ fontSize: "13px", color: MUTED }}>{d}</span>
                  </span>
                  <Check on={on} />
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 6px 6px 18px", borderRadius: "18px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.06)" }}>
            <input type="text" aria-label="Otra cosa" value={b.custom} onChange={(e) => setB((x) => ({ ...x, custom: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") useCustom(); }} placeholder="Otra cosa: escríbelo con tus palabras" style={{ flex: 1, minWidth: 0, height: "44px", border: 0, outline: "none", background: "transparent", fontSize: "15px" }} />
            <button type="button" onClick={useCustom} disabled={!b.custom.trim()} style={{ height: "40px", padding: "0 16px", border: 0, borderRadius: "999px", cursor: b.custom.trim() ? "pointer" : "default", fontSize: "14px", fontWeight: 600, background: b.custom.trim() ? INK : "rgba(18,19,26,.08)", color: b.custom.trim() ? "#FFFFFF" : "#8A8D96" }}>Usar</button>
          </div>
        </div>
      ) : null}

      {panel === "out" ? (
        <div role="dialog" aria-labelledby="out-h" style={{ padding: "18px", borderRadius: "26px", background: SOFT, display: "flex", flexDirection: "column", gap: "12px", animation: "rise .3s ease-out" }}>
          <PanelHead id="out-h" title="¿Qué hace con el resultado?" hint="Dónde lo verás" />
          <div role="listbox" aria-labelledby="out-h" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "6px" }}>
            {OUTS.map((o) => {
              const on = o.id === b.out;
              return (
                <button key={o.id} type="button" role="option" aria-selected={on} onClick={() => set({ out: o.id })} style={optionStyle(on)}>
                  <span aria-hidden="true" style={{ width: "36px", height: "36px", flex: "none", display: "grid", placeItems: "center", borderRadius: "11px", font: "600 15px/1 'Geist', sans-serif", background: o.tint }}>{o.glyph}</span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                    <strong style={{ fontSize: "15px", fontWeight: 600 }}>{o.title}</strong>
                    <span style={{ fontSize: "13px", color: MUTED }}>{o.desc}</span>
                  </span>
                  <Check on={on} />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {panel ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "-8px" }}>
          <button type="button" onClick={() => setPanel(null)} style={{ height: "42px", padding: "0 20px", border: 0, borderRadius: "999px", background: INK, color: "#FFFFFF", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>Listo</button>
        </div>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "14px", paddingTop: "6px", borderTop: "1px solid rgba(18,19,26,.06)" }}>
        <span role="status" style={{ flex: "1 1 320px", paddingTop: "14px", fontSize: "14px", lineHeight: 1.5, color: msg?.error || act.error ? "#B4231A" : MUTED }}>
          {act.error || preview}
          {msg?.missionId ? <> <button type="button" onClick={() => navigate(`/encargo/${msg.missionId}`)} style={{ border: 0, padding: 0, background: "none", color: INK, fontWeight: 600, textDecoration: "underline", cursor: "pointer", font: "inherit" }}>Ver cómo va</button></> : null}
        </span>
        <span style={{ display: "flex", gap: "8px", paddingTop: "14px" }}>
          <button type="button" onClick={onTest} disabled={act.busy} style={{ height: "48px", padding: "0 20px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: act.busy ? "wait" : "pointer", fontSize: "15px", fontWeight: 600, color: INK }}>
            {savedId ? "Probar otra vez" : "Probar ahora"}
          </button>
          <button type="button" onClick={onActivate} disabled={act.busy} style={{ height: "48px", padding: "0 24px", border: 0, borderRadius: "999px", background: INK, color: "#FFFFFF", cursor: act.busy ? "wait" : "pointer", fontSize: "15px", fontWeight: 600 }}>Activar</button>
        </span>
      </div>
    </section>
  );
}

function Switch({ on, label, onClick, busy }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} disabled={busy} style={{ width: "52px", height: "32px", flex: "none", padding: "3px", border: 0, borderRadius: "16px", cursor: busy ? "wait" : "pointer", transition: "background .25s ease", background: on ? "#0B8A5F" : "rgba(18,19,26,.14)" }}>
      <span style={{ display: "block", width: "26px", height: "26px", borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 2px 4px rgba(18,19,26,.2)", transition: "transform .25s cubic-bezier(.2,.8,.2,1)", transform: on ? "translateX(20px)" : "translateX(0)" }} />
    </button>
  );
}

function RoutineList({ automations, bots, ready, onNew, open }) {
  const act = useAction();
  const sorted = [...automations].sort((a, b) => Number(b.enabled) - Number(a.enabled) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return (
    <section aria-labelledby="list-t" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <h2 id="list-t" style={{ margin: "0 0 4px", font: "600 30px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>Activas</h2>
      {act.error ? <p role="alert" style={{ margin: 0, fontSize: "14px", color: "#B4231A" }}>{act.error}</p> : null}
      {!ready ? <div style={{ height: "88px", borderRadius: "28px", background: "#FFFFFF", animation: "shimmer 1.6s ease-in-out infinite" }} /> : null}
      {ready && !sorted.length && !open ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "14px", padding: "28px", borderRadius: "28px", background: "rgba(255,255,255,.55)" }}>
          <span style={{ fontSize: "17px", lineHeight: 1.5 }}>Aún no hay rutinas. Empieza por algo que repites cada semana.</span>
          <button type="button" onClick={onNew} style={{ height: "44px", padding: "0 20px", border: 0, borderRadius: "999px", background: INK, color: "#FFFFFF", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>Nueva rutina</button>
        </div>
      ) : null}
      {sorted.map((a) => {
        const bot = bots.find((x) => x.id === a.botId);
        const on = a.enabled;
        const blocked = a.state === "blocked";
        return (
          <article key={a.id} style={{ display: "flex", alignItems: "center", gap: "22px", padding: "24px 26px", background: "#FFFFFF", borderRadius: "28px", transition: "opacity .3s ease", opacity: on ? 1 : 0.55 }}>
            {bot ? <BotPresence bot={bot} size={40} state={a.state === "running" ? "work" : null} /> : <span style={{ width: 40 }} />}
            <button type="button" onClick={() => navigate(`/automatizaciones?id=${encodeURIComponent(a.id)}`)} title="Ver y cambiar los detalles" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "6px", padding: 0, border: 0, background: "none", textAlign: "left", cursor: "pointer", color: INK }}>
              <span style={{ fontSize: "18px", lineHeight: 1.45, letterSpacing: "-0.01em" }}>{a.name}</span>
              <span style={{ fontSize: "13px", color: blocked ? "#8A5A00" : FAINT }}>{[bot?.name, blocked && a.error ? a.error : a.subtitle].filter(Boolean).join(" · ")}</span>
            </button>
            <Switch on={on} busy={act.busy} label={(on ? "Pausar: " : "Activar: ") + a.name} onClick={() => act.act(() => patch(`/automations/${encodeURIComponent(a.id)}`, { enabled: !on }))} />
          </article>
        );
      })}
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

function Segmented({ label, items, value, onPick }) {
  return (
    <div style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={{ fontSize: "13px", fontWeight: 500, color: MUTED }}>{label}</span>
      <div role="radiogroup" aria-label={label} style={{ display: "flex", gap: "2px", padding: "3px", borderRadius: "999px", background: "rgba(18,19,26,.05)" }}>
        {items.map(([v, text]) => {
          const on = value === v;
          return (
            <button key={String(v)} type="button" role="radio" aria-checked={on} onClick={() => onPick(v)} style={{ flex: 1, height: "38px", padding: "0 10px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: 600, background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 3px rgba(18,19,26,.15)" : "none", color: INK }}>
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
const inputBox = { padding: "14px 18px", border: 0, borderRadius: "16px", outline: "none", background: "#F4F4F0", fontSize: "16px", lineHeight: 1.5, resize: "vertical", fontFamily: "inherit", color: INK };

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
    <section aria-labelledby="of-t" style={{ padding: "30px 32px 26px", background: "#FFFFFF", borderRadius: "34px", boxShadow: SHEET, display: "flex", flexDirection: "column", gap: "20px", animation: "sheet .45s cubic-bezier(.2,.8,.2,1)" }}>
      <h2 id="of-t" style={{ margin: 0, font: "600 28px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{initial ? "Cambiar el encargo" : "Nuevo encargo"}</h2>
      <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {label("Nombre del encargo")}
        <input type="text" autoFocus value={f.title} maxLength={100} onChange={(e) => set({ title: e.target.value })} placeholder="Facturas de proveedores" style={{ ...inputBox, height: "52px", padding: "0 18px" }} />
      </label>
      {!initial ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {label("Quién se encarga")}
          <div role="radiogroup" aria-label="Quién se encarga" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {team.map((b) => {
              const on = f.botId === b.id;
              return (
                <button key={b.id} type="button" role="radio" aria-checked={on} onClick={() => set({ botId: b.id })} style={{ display: "flex", alignItems: "center", gap: "8px", height: "42px", padding: "0 16px 0 12px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "14px", fontWeight: 600, background: on ? INK : "rgba(18,19,26,.05)", color: on ? "#FFFFFF" : INK }}>
                  <BotPresence bot={b} size={16} />
                  {b.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {label("Qué hace")}
        <textarea rows="2" value={f.what} onChange={(e) => set({ what: e.target.value })} placeholder="Revisa las facturas que lleguen y apúntalas en la hoja de gastos." style={inputBox} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {label("Cuándo para y te pregunta")}
        <textarea rows="2" value={f.stopWhen} onChange={(e) => set({ stopWhen: e.target.value })} placeholder="Si el importe pasa de 500 € o falta algún dato." style={inputBox} />
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "20px" }}>
        <Segmented label="Avisos como mucho" items={NOTIFY} value={f.notifyMax} onPick={(v) => set({ notifyMax: v })} />
        <Segmented label="Hasta (opcional)" items={untilItems} value={f.until} onPick={(v) => set({ until: v })} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px 18px", borderRadius: "20px", background: SOFT }}>
        <span style={{ fontSize: "14px", lineHeight: 1.45 }}>Aunque el encargo diga otra cosa, siempre te pide permiso para:</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {["Enviar algo fuera", "Mover dinero", "Borrar archivos", "Instalar programas"].map((t) => (
            <span key={t} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 12px", borderRadius: "999px", background: "#FFFFFF", fontSize: "13px", fontWeight: 500 }}>{"🔒 " + t}</span>
          ))}
        </div>
      </div>
      {act.error ? <p role="alert" style={{ margin: 0, fontSize: "14px", color: "#B4231A" }}>{act.error}</p> : null}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
        <button type="button" onClick={onClose} style={{ height: "48px", padding: "0 20px", border: 0, borderRadius: "999px", background: "transparent", cursor: "pointer", fontSize: "15px", fontWeight: 600, color: INK }}>Cancelar</button>
        <button type="button" onClick={save} disabled={!ready || act.busy} style={{ height: "48px", padding: "0 24px", border: 0, borderRadius: "999px", cursor: ready ? "pointer" : "default", fontSize: "15px", fontWeight: 600, background: ready ? INK : "rgba(18,19,26,.08)", color: ready ? "#FFFFFF" : "#8A8D96" }}>
          {initial ? "Guardar cambios" : "Guardar encargo"}
        </button>
      </div>
    </section>
  );
}

function Orders({ team, list, loading, form, setForm, automations }) {
  const [editing, setEditing] = useState(null);
  const act = useAction();
  const toRoutine = (o) => act.act(() => post(`/standing-orders/${encodeURIComponent(o.id)}/automation`, {}));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px", animation: "fade .3s ease-out" }}>
      {form ? <OrderForm team={team} onClose={() => setForm(false)} /> : null}
      {act.error ? <p role="alert" style={{ margin: 0, fontSize: "14px", color: "#B4231A" }}>{act.error}</p> : null}
      {loading ? <div style={{ height: "160px", borderRadius: "30px", background: "#FFFFFF", animation: "shimmer 1.6s ease-in-out infinite" }} /> : null}
      {!loading && !list.length && !form ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "14px", padding: "28px", borderRadius: "28px", background: "rgba(255,255,255,.55)" }}>
          <span style={{ fontSize: "17px", lineHeight: 1.5 }}>Sin encargos. Un encargo es algo que un bot atiende siempre que haga falta, como registrar las facturas que lleguen.</span>
          <button type="button" onClick={() => setForm(true)} style={{ height: "44px", padding: "0 20px", border: 0, borderRadius: "999px", background: INK, color: "#FFFFFF", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>Nuevo encargo</button>
        </div>
      ) : null}
      {list.map((o) => {
        if (editing === o.id) return <OrderForm key={o.id} team={team} initial={o} onClose={() => setEditing(null)} />;
        const bot = team.find((b) => b.id === o.botId);
        const rule = o.automationId ? automations.find((a) => a.id === o.automationId) : null;
        const foot = [
          "Avisos como mucho: " + (NOTIFY.find(([k]) => k === o.notifyMax)?.[1] || "cada vez").toLowerCase(),
          o.until ? (o.expired ? "terminó el " : "hasta el ") + longDate(o.until) : "sin fecha de fin",
          o.when ? "cuándo: " + o.when : null,
          !o.active ? "en pausa" : null,
        ].filter(Boolean).join(" · ");
        return (
          <article key={o.id} style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "26px 28px", background: "#FFFFFF", borderRadius: "30px", opacity: o.active && !o.expired ? 1 : 0.6, transition: "opacity .3s ease" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px" }}>
              {bot ? <BotPresence bot={bot} size={36} /> : null}
              <span style={{ flex: "1 1 240px", display: "flex", flexDirection: "column", gap: "3px" }}>
                <strong style={{ font: "600 22px/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{o.title}</strong>
                <span style={{ fontSize: "14px", color: MUTED }}>{(bot?.name || "Un bot") + " se encarga"}</span>
              </span>
              <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
                <button type="button" onClick={() => setEditing(o.id)} style={{ height: "40px", padding: "0 16px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "14px", fontWeight: 600, color: INK }}>Editar</button>
                {rule ? (
                  <button type="button" onClick={() => navigate(`/automatizaciones?id=${encodeURIComponent(rule.id)}`)} style={{ height: "40px", padding: "0 16px", border: 0, borderRadius: "999px", background: "transparent", boxShadow: "inset 0 0 0 1.5px rgba(11,138,95,.35)", color: "#0B6B4A", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>Automatización creada ✓</button>
                ) : o.schedule ? (
                  <button type="button" onClick={() => toRoutine(o)} disabled={act.busy} style={{ height: "40px", padding: "0 16px", border: 0, borderRadius: "999px", background: "transparent", boxShadow: "inset 0 0 0 1.5px rgba(18,19,26,.15)", cursor: "pointer", fontSize: "14px", fontWeight: 600, color: INK }}>Crear la automatización</button>
                ) : null}
                <Switch on={o.active} busy={act.busy} label={(o.active ? "Pausar: " : "Reanudar: ") + o.title} onClick={() => act.act(() => patch(`/standing-orders/${encodeURIComponent(o.id)}`, { active: !o.active }))} />
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "16px", borderRadius: "18px", background: SOFT }}>
                <span style={{ fontSize: "12px", fontWeight: 500, color: FAINT }}>Qué hace</span>
                <span style={{ fontSize: "15px", lineHeight: 1.5 }}>{o.what}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "16px", borderRadius: "18px", background: SOFT }}>
                <span style={{ fontSize: "12px", fontWeight: 500, color: FAINT }}>Para y te pregunta</span>
                <span style={{ fontSize: "15px", lineHeight: 1.5 }}>{o.stopWhen || "Solo en las líneas rojas."}</span>
              </div>
            </div>
            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px", fontSize: "13px", color: FAINT }}>
              {foot}
              <button type="button" onClick={() => { if (window.confirm(`¿Borrar el encargo «${o.title}»?`)) act.act(() => del(`/standing-orders/${encodeURIComponent(o.id)}`)); }} style={{ border: 0, padding: 0, background: "none", cursor: "pointer", fontSize: "13px", color: FAINT, textDecoration: "underline" }}>Borrar</button>
            </span>
          </article>
        );
      })}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Recordatorios por tema
function Reminders({ list, loading, missions, bots }) {
  const [topic, setTopic] = useState("");
  const [what, setWhat] = useState("");
  const [fresh, setFresh] = useState(null);
  const act = useAction();
  const ready = topic.trim().length >= 2 && what.trim().length >= 3;
  const touched = topic || what;
  const add = () => act.act(async () => {
    if (!ready) return;
    const keywords = topic.split(/[,;]/).map((x) => x.trim()).filter((x) => x.length >= 2);
    const r = await post("/intents", { keywords, remind: what.trim() });
    setFresh(r?.id || null);
    setTopic(""); setWhat("");
  });
  const roomName = (id) => missions.find((m) => m.id === id)?.title;
  const meta = (r) => {
    if (!r.active) return "En pausa";
    if (r.expiresAt && Date.parse(r.expiresAt) <= Date.now()) return "Caducado";
    if (r.hits >= r.maxHits) return `Ya lo recordó ${r.hits} ${r.hits === 1 ? "vez" : "veces"}`;
    if (!r.hits) return fresh === r.id ? "Recién añadido" : "Aún no ha salido";
    return `Lo recordó ${r.hits} ${r.hits === 1 ? "vez" : "veces"} de ${r.maxHits}`;
  };
  const sample = list[0];
  const atlas = bots.find((b) => /coordin/i.test(b.role || "")) || bots[0];
  const input = { flex: 1, minWidth: 0, height: "50px", padding: "0 16px", border: 0, borderRadius: "14px", outline: "none", background: "#F4F4F0", font: "500 17px/1 'Geist', sans-serif", letterSpacing: "normal", color: INK };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px", animation: "fade .3s ease-out" }}>
      <section aria-labelledby="rf-t" style={{ padding: "26px 28px", background: "#FFFFFF", borderRadius: "30px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <h2 id="rf-t" style={{ margin: 0, fontSize: "13px", fontWeight: 500, color: FAINT }}>Nuevo recordatorio · vale en cualquier sala o chat</h2>
        <p style={{ margin: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", font: "600 clamp(22px, 2.6vw, 28px)/1.4 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>
          Cuando se hable de
          <label style={{ flex: "1 1 260px", display: "flex" }}>
            <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>Cuando se hable de</span>
            <input id="rf-topic" type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="contrato de limpieza, limpieza" style={input} />
          </label>
          , recuérdame
          <label style={{ flex: "2 1 320px", display: "flex" }}>
            <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>Recuérdame</span>
            <input type="text" value={what} onChange={(e) => setWhat(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="que el preaviso es de 30 días" style={input} />
          </label>
          .
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <span role="status" style={{ fontSize: "13px", color: act.error ? "#B4231A" : touched && !ready ? "#8A5A00" : FAINT }}>
            {act.error || (touched && !ready ? "Escribe al menos una palabra o frase en cada lado." : "Palabras o frases separadas por comas.")}
          </span>
          <button type="button" onClick={add} disabled={!ready || act.busy} style={{ height: "46px", padding: "0 22px", border: 0, borderRadius: "999px", cursor: ready ? "pointer" : "default", fontSize: "15px", fontWeight: 600, background: ready ? INK : "rgba(18,19,26,.08)", color: ready ? "#FFFFFF" : "#8A8D96" }}>Añadir</button>
        </div>
      </section>
      {loading ? <div style={{ height: "80px", borderRadius: "24px", background: "#FFFFFF", animation: "shimmer 1.6s ease-in-out infinite" }} /> : null}
      {list.map((r) => (
        <div key={r.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 18px", padding: "20px 24px", background: "#FFFFFF", borderRadius: "24px", animation: fresh === r.id ? "pop .45s ease-out" : "none", opacity: r.active ? 1 : 0.6 }}>
          <span style={{ flex: "1 1 360px", fontSize: "18px", lineHeight: 1.5 }}>
            {"Cuando se hable de "}
            <strong style={{ fontWeight: 600, boxShadow: "inset 0 -0.38em 0 rgba(255,201,60,.45)" }}>{r.keywords.join(", ")}</strong>
            {", recuérdame "}
            <strong style={{ fontWeight: 600 }}>{r.remind.replace(/\.$/, "")}</strong>
            {"."}
          </span>
          <span style={{ fontSize: "13px", color: FAINT }}>{[meta(r), r.missionId && roomName(r.missionId) ? "solo en #" + roomName(r.missionId) : null].filter(Boolean).join(" · ")}</span>
          {!r.active || r.hits >= r.maxHits ? (
            <button type="button" onClick={() => act.act(() => patch(`/intents/${encodeURIComponent(r.id)}`, { active: true }))} style={{ height: "36px", padding: "0 14px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: INK }}>Reactivar</button>
          ) : null}
          <button type="button" onClick={() => act.act(() => del(`/intents/${encodeURIComponent(r.id)}`))} aria-label="Borrar este recordatorio" style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "rgba(18,19,26,.05)", cursor: "pointer", color: INK }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
      ))}
      {!loading && !list.length ? <p style={{ margin: 0, padding: "20px", textAlign: "center", fontSize: "15px", color: FAINT }}>Sin recordatorios por tema.</p> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "20px 24px", borderRadius: "24px", background: "rgba(255,255,255,.55)" }}>
        <span style={{ fontSize: "13px", fontWeight: 500, color: FAINT }}>Así aparece en una sala</span>
        <div style={{ display: "grid", gridTemplateColumns: "30px 1fr", gap: "12px", alignItems: "start" }}>
          <span style={{ display: "grid", placeItems: "center", width: "30px", height: "30px" }}>{atlas ? <BotPresence bot={atlas} size={24} /> : null}</span>
          <span style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "13px", color: FAINT }}><strong style={{ color: INK, fontWeight: 600 }}>{atlas?.name || "Colmena"}</strong>{" · recordatorio para ti"}</span>
            <span style={{ fontSize: "15px", lineHeight: 1.5 }}>
              {"Se está hablando de "}<strong style={{ fontWeight: 600 }}>{sample?.keywords[0] || "contrato de limpieza"}</strong>{". Me pediste que te recordara " + (sample?.remind.replace(/\.$/, "") || "que el preaviso es de 30 días") + "."}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
