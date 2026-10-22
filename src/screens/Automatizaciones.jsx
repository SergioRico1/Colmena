import React, { useEffect, useMemo, useRef, useState } from "react";
import { BotPresence } from "../components/v2/Presence.jsx";
import { css } from "../design/css/Automatizaciones.js";
import Shell from "../components/v2/Shell.jsx";
import { SuggestionCard } from "../components/interaction/Ideas.jsx";
import Disparador, { TRIGGER_META } from "../components/Disparador.jsx";
import { useStore, useAction, useResource } from "../lib/store.jsx";
import { post, patch, del } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { avatarStyle, initial, botById } from "../lib/bots.js";
import { isRoom, time } from "../lib/format.js";
import { later } from "../lib/undoToast.js";

// 08 · Automatizaciones (canvas version, with <Disparador> as «Detalles»).
const TRIGGERS = [
  { header: true, label: "A una hora" },
  { id: "dia", label: "Cada día a una hora", desc: "Ej.: los laborables a las 08:00", keys: "dia diario hora mañana laborables cada dia" },
  { id: "semana", label: "Cada semana", desc: "Ej.: los lunes a las 09:00", keys: "semana semanal lunes martes miercoles jueves viernes sabado domingo" },
  { id: "vez", label: "Una sola vez", desc: "En una fecha y hora concretas", keys: "una vez fecha recordatorio dia concreto" },
  { header: true, label: "Cuando pase algo" },
  { id: "correo", label: "Llegue un correo", desc: "De alguien, con un asunto o con adjuntos", keys: "correo email mail factura adjunto remitente buzon" },
  { id: "archivo", label: "Se suba un archivo", desc: "A una carpeta compartida", keys: "archivo carpeta subir pdf documento fichero" },
  { id: "evento", label: "Se acerque un evento", desc: "Del calendario, con antelación", keys: "evento calendario reunion cita agenda" },
  { id: "sala", label: "Alguien escriba en una sala", desc: "O mencione a un bot", keys: "sala mensaje mencion chat escribir" },
  { id: "hoja", label: "Cambie una hoja de cálculo", desc: "Una fila nueva o un valor", keys: "hoja calculo excel fila columna valor tabla" },
  { id: "web", label: "Una página web cambia", desc: "Algo nuevo, un texto o un precio que baja", keys: "web pagina url internet precio baje oferta cambio vigilar tienda" },
];
const NOTIFY = [
  ["siempre", "cada vez que termine, con lo que ha hecho"],
  ["resultado", "solo cuando haya un resultado que revisar"],
  ["fallo", "solo si algo falla o necesita tu OK"],
];
const TOOL = {
  correo: { art: "al correo", chip: "Correo", lee: "leer el correo", escribe: "escribir en el correo" },
  calendario: { art: "al calendario", chip: "Calendario", lee: "leer el calendario", escribe: "escribir en el calendario" },
  carpeta: { art: "a la carpeta", chip: "Carpeta compartida", lee: "leer la carpeta", escribe: "escribir en la carpeta" },
  hojas: { art: "a las hojas de cálculo", chip: "Hojas de cálculo", lee: "leer hojas", escribe: "escribir en hojas" },
  chat: { art: "al chat", chip: "Chat", lee: "leer el chat", escribe: "escribir en el chat" },
  erp: { art: "al ERP", chip: "ERP", lee: "leer el ERP", escribe: "escribir en el ERP" },
};
const NEEDS_BY_TRIGGER = { correo: [{ tool: "correo", access: "lee" }], archivo: [{ tool: "carpeta", access: "lee" }], evento: [{ tool: "calendario", access: "lee" }], hoja: [{ tool: "hojas", access: "lee" }] };
const PROBE_LABEL = { dia: "Probar ahora", semana: "Probar ahora", vez: "Probar ahora", correo: "Probar con el último correo", archivo: "Probar con el último archivo", evento: "Probar con el próximo evento", sala: "Probar con el último mensaje", hoja: "Probar con el último cambio", web: "Probar con la última lectura" };

const fold = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const isCoordinator = (b) => b?.id === "atlas" || /coordin/i.test(b?.role || "");
const listJoin = (list) => (list.length <= 1 ? list[0] || "" : list.slice(0, -1).join(", ") + " y " + list[list.length - 1]);

function mergeNeeds(own = [], type) {
  const out = [];
  for (const n of [...(own || []), ...(NEEDS_BY_TRIGGER[type] || [])]) {
    if (!n?.tool) continue;
    const prev = out.find((x) => x.tool === n.tool);
    if (!prev) out.push({ tool: n.tool, access: n.access === "escribe" ? "escribe" : "lee" });
    else if (n.access === "escribe") prev.access = "escribe";
  }
  return out;
}
/** How well a bot covers the needs: blockers (no access) and lacking (needs your permission). */
function coverage(bot, needs) {
  const res = needs.map((n) => {
    if (!bot?.tools) return { ...n, state: "ok" }; // unknown permissions: don't block
    const lvl = bot.tools[n.tool] || "none";
    if (lvl === "none") return { ...n, state: "none" };
    if (lvl === "pide" || (n.access === "escribe" && lvl === "lee")) return { ...n, state: "permiso" };
    return { ...n, state: "ok" };
  });
  return { res, blocked: res.filter((r) => r.state === "none"), lacking: res.filter((r) => r.state === "permiso") };
}

function when(value) {
  if (!value) return "";
  const d = new Date(value);
  const now = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, now)) return "Hoy " + time(value);
  if (same(d, new Date(Date.now() - 864e5))) return "Ayer " + time(value);
  const w = d.toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "");
  if (now - d < 6 * 864e5) return w.charAt(0).toUpperCase() + w.slice(1) + " " + time(value);
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "") + " " + time(value);
}

function fromAutomation(a) {
  return {
    id: a.id, name: a.name || "", botId: a.botId || "atlas", prompt: a.prompt || "", enabled: a.enabled !== false,
    trigger: { type: TRIGGER_META[a.trigger?.type] ? a.trigger.type : "dia", config: a.trigger?.config || {}, sentence: a.trigger?.sentence || "" },
    notify: a.notify || "resultado", needs: a.needs || [],
  };
}
function blankDraft(extra = {}) {
  return { id: null, name: "Nueva automatización", botId: "atlas", prompt: "", enabled: true, trigger: { type: "dia", config: {}, sentence: "" }, notify: "resultado", needs: [], ...extra };
}
function fromDescribed(d, base = blankDraft()) {
  return {
    ...base,
    name: d?.name || base.name,
    prompt: d?.prompt || base.prompt,
    botId: d?.botId || base.botId,
    trigger: d?.trigger?.type && TRIGGER_META[d.trigger.type] ? { type: d.trigger.type, config: d.trigger.config || {}, sentence: d.trigger.sentence || "" } : base.trigger,
    needs: d?.needs || base.needs,
  };
}

const errStyle = { fontSize: "13px", fontWeight: "600", color: "#B4372A" };
const overlayBtn = { position: "fixed", inset: "0", zIndex: "15", background: "rgba(18,19,26,0.06)", border: "0", cursor: "default" };
const menuBox = { position: "absolute", left: "0", top: "calc(100% + 8px)", zIndex: "22", background: "#FFFFFF", border: "0", borderRadius: "16px", boxShadow: "0 18px 40px rgba(18,19,26,.22)", padding: "8px", display: "flex", flexDirection: "column", gap: "2px" };
const check = (color = "#12131A", w = 3, size = 16) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>;

export default function Automatizaciones({ query = {} }) {
  const { automations, suggestions, bots, folders, missions, connectors, ready, run } = useStore();
  const [selId, setSelId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [open, setOpen] = useState(null); // 'cuando' | 'quien' | 'avisa'
  const [search, setSearch] = useState("");
  const [describe, setDescribe] = useState(null); // { text, busy, error }
  const [preparing, setPreparing] = useState(null); // { text, error }
  const [msg, setMsg] = useState(null); // { text, missionId, error }
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const toggle = useAction();
  const suggest = useAction();
  const loadedFor = useRef(undefined);
  const handled = useRef(null);

  const rooms = useMemo(() => missions.filter(isRoom).map((m) => ({ id: m.id, room: m.room })).filter((r, i, all) => r.room && all.findIndex((x) => x.room === r.room) === i), [missions]);
  const team = bots.filter((b) => b.enabled !== false);
  const sel = selId ? automations.find((a) => a.id === selId) : null;

  const select = (id, { replace = true } = {}) => {
    const a = automations.find((x) => x.id === id);
    setSelId(id);
    setDraft(a ? fromAutomation(a) : null);
    loadedFor.current = id;
    setOpen(null); setConfirmDelete(false); setMsg(null); setDescribe(null);
    navigate(`/automatizaciones?id=${encodeURIComponent(id)}`, { replace });
  };
  const startNew = (extra) => {
    setSelId(null);
    setDraft(blankDraft(extra));
    loadedFor.current = "new";
    setOpen(null); setConfirmDelete(false); setMsg(null); setDescribe(null);
  };

  // Entry points: ?desde=disparador (reference page), ?nueva=<texto> (Atlas describe), ?id=<rule>, default first rule.
  useEffect(() => {
    if (!ready) return;
    const key = JSON.stringify(query);
    if (handled.current === key) return;
    if (query.desde === "disparador") {
      handled.current = key;
      let t = null;
      try { t = JSON.parse(sessionStorage.getItem("colmena:trigger-draft") || "null"); } catch { t = null; }
      sessionStorage.removeItem("colmena:trigger-draft");
      startNew(t?.type ? { trigger: { type: t.type, config: t.config || {}, sentence: t.sentence || "" } } : {});
      navigate("/automatizaciones", { replace: true });
      handled.current = JSON.stringify({});
      return;
    }
    if (query.nueva) {
      handled.current = key;
      const text = query.nueva;
      startNew();
      setPreparing({ text, error: null });
      post("/automations/describe", { text })
        .then((d) => { setDraft((cur) => fromDescribed(d, cur || blankDraft())); setPreparing(null); })
        .catch((e) => setPreparing({ text, error: e.message }));
      return;
    }
    if (query.id) {
      handled.current = key;
      if (loadedFor.current !== query.id) {
        const a = automations.find((x) => x.id === query.id);
        if (a) { setSelId(a.id); setDraft(fromAutomation(a)); loadedFor.current = a.id; }
        else handled.current = null; // wait for the store to contain it
      }
      return;
    }
    if (loadedFor.current === undefined) {
      handled.current = key;
      if (automations.length) { setSelId(automations[0].id); setDraft(fromAutomation(automations[0])); loadedFor.current = automations[0].id; }
      else startNew();
    }
  }, [ready, query, automations]); // eslint-disable-line react-hooks/exhaustive-deps

  // If the selected rule disappears (deleted elsewhere), fall back.
  useEffect(() => {
    if (selId && ready && !automations.some((a) => a.id === selId)) {
      if (automations.length) { setSelId(automations[0].id); setDraft(fromAutomation(automations[0])); loadedFor.current = automations[0].id; }
      else startNew();
    }
  }, [automations]); // eslint-disable-line react-hooks/exhaustive-deps

  const runs = useResource(selId ? `/automations/${encodeURIComponent(selId)}/runs` : null);
  const isNew = !draft?.id;
  const type = draft?.trigger?.type || "dia";
  const needs = mergeNeeds(draft?.needs, type);
  const set = (p) => setDraft((d) => ({ ...d, ...p }));

  // ── Quién ──
  const ranked = team.filter((b) => !isCoordinator(b)).map((b) => ({ b, c: coverage(b, needs) }));
  const recommended = needs.length ? (ranked.filter((x) => !x.c.blocked.length).sort((x, y) => x.c.lacking.length - y.c.lacking.length)[0]?.b?.id || null) : null;
  const whoItems = [...team.filter(isCoordinator), ...team.filter((b) => !isCoordinator(b))].map((b) => {
    const coord = isCoordinator(b);
    const c = coverage(b, needs);
    const ok = coord || !c.blocked.length;
    const desc = coord ? "Elige cada vez al bot que mejor encaje"
      : c.blocked.length ? `No tiene acceso ${TOOL[c.blocked[0].tool]?.art || c.blocked[0].tool}`
      : c.lacking.length ? `Le falta permiso para ${listJoin(c.lacking.map((n) => TOOL[n.tool]?.[n.access] || n.tool))}.`
      : needs.length ? "Tiene todo lo que hace falta." : b.role || "";
    return { b, coord, ok, desc, name: coord ? `Que decida ${b.name}` : `${b.name}${b.role ? " · " + b.role : ""}`, short: coord ? `${b.name} decide` : b.name };
  });
  const who = whoItems.find((x) => x.b.id === draft?.botId) || null;
  const whoBot = who?.b || botById(bots, draft?.botId);
  const whoCoverage = who && !who.coord ? coverage(who.b, needs) : null;
  const firstBlocked = whoItems.map((x) => (x.coord ? null : coverage(x.b, needs).blocked[0])).find(Boolean);

  // ── Cuando (search) ──
  const q = fold(search.trim());
  const matches = (t) => !q || fold(`${t.label} ${t.desc} ${t.keys}`).includes(q);
  const visible = TRIGGERS.filter((t, i) => {
    if (!t.header) return matches(t);
    const group = [];
    for (let j = i + 1; j < TRIGGERS.length && !TRIGGERS[j].header; j++) group.push(TRIGGERS[j]);
    return group.some(matches);
  });
  const pickTrigger = (id) => {
    setDraft((d) => ({ ...d, trigger: d.trigger.type === id ? d.trigger : { type: id, config: {}, sentence: "" } }));
    setOpen(null);
    setSearch("");
  };
  const runDescribe = async (text) => {
    if (!text.trim()) return;
    setDescribe({ text, busy: true, error: null });
    try {
      const d = await post("/automations/describe", { text });
      setDraft((cur) => {
        if (!cur?.id) return fromDescribed(d, { ...cur, name: cur?.name && cur.name !== "Nueva automatización" ? cur.name : cur?.name, prompt: cur?.prompt || "" });
        return { ...cur, trigger: d?.trigger?.type && TRIGGER_META[d.trigger.type] ? { type: d.trigger.type, config: d.trigger.config || {}, sentence: d.trigger.sentence || "" } : cur.trigger, prompt: cur.prompt || d?.prompt || "" };
      });
      setDescribe(null);
      setOpen(null);
      setSearch("");
    } catch (e) {
      setDescribe({ text, busy: false, error: e.message });
    }
  };

  // ── Guardar / probar / eliminar ──
  const validate = () => {
    if (!draft.name.trim()) return "Ponle un nombre.";
    if (!draft.prompt.trim()) return "Escribe qué tiene que hacer.";
    if (type === "dia" && !(draft.trigger.config?.dias || []).length) return "Elige al menos un día.";
    return null;
  };
  const body = () => ({
    name: draft.name.trim(), botId: draft.botId, prompt: draft.prompt.trim(),
    trigger: { type, config: draft.trigger.config || {}, sentence: draft.trigger.sentence || "" },
    notify: draft.notify, needs,
  });
  /** Runs a mutation, refreshes the store and reports { ok, value, error } (never throws). */
  const call = async (fn) => {
    setSaving(true);
    setSaveError(null);
    try {
      return { ok: true, value: await run(fn) };
    } catch (e) {
      setSaveError(e.message);
      return { ok: false, error: e.message };
    } finally {
      setSaving(false);
    }
  };
  const persist = async () => {
    const problem = validate();
    if (problem) { setSaveError(problem); return { ok: false, error: problem }; }
    const res = await call(() => (isNew ? post("/automations", { ...body(), enabled: draft.enabled }) : patch(`/automations/${encodeURIComponent(draft.id)}`, body())));
    if (!res.ok) return res;
    const created = res.value;
    if (isNew) {
      if (!created?.id) return { ok: false, error: "El servidor no devolvió la automatización creada." };
      setSelId(created.id);
      setDraft(fromAutomation({ ...body(), enabled: draft.enabled, ...created }));
      loadedFor.current = created.id;
      handled.current = JSON.stringify({ id: created.id });
      navigate(`/automatizaciones?id=${encodeURIComponent(created.id)}`, { replace: true });
      return { ok: true, id: created.id };
    }
    return { ok: true, id: draft.id };
  };
  const onSave = async () => {
    setMsg(null);
    const res = await persist();
    if (res.ok) setMsg({ text: isNew ? "Automatización creada." : "Cambios guardados." });
  };
  // Tests always run against the saved rule: unsaved or changed drafts are saved first.
  const runTest = async () => {
    const clean = draft.id && JSON.stringify(body()) === JSON.stringify(fromAutomationBody(sel));
    const saved = clean ? { ok: true, id: draft.id } : await persist();
    if (!saved.ok) throw new Error(saved.error || "Guárdala antes de probarla.");
    return run(() => post(`/automations/${encodeURIComponent(saved.id)}/test`, {}));
  };
  const describeResult = (res) => res?.message || res?.summary || (res?.missionId ? "Prueba en marcha: el bot ya está trabajando." : "Prueba lanzada.");
  const onTest = async () => {
    setMsg({ text: "Probando…" });
    try {
      const res = await runTest();
      setMsg({ text: describeResult(res), missionId: res?.missionId || null });
    } catch (e) {
      setMsg({ text: e.message, error: true });
    }
  };
  const onProbar = async () => describeResult(await runTest());
  // No «¿Eliminar?» question: it leaves the list now and is deleted after the five-second «Deshacer».
  const onDelete = () => {
    const gone = draft;
    later({ id: "automation:" + gone.id, keys: ["automation:" + gone.id], text: `Rutina «${gone.name}» eliminada`, error: "No se pudo eliminar la rutina", run: () => run(() => del(`/automations/${encodeURIComponent(gone.id)}`)), undone: () => select(gone.id) });
    const rest = automations.filter((a) => a.id !== gone.id);
    if (rest.length) select(rest[0].id);
    else { startNew(); navigate("/automatizaciones", { replace: true }); handled.current = JSON.stringify({}); }
  };

  const autoSuggestions = suggestions.filter((s) => s.kind === "automation");
  const anyOpen = open !== null;
  const cuandoOpen = open === "cuando";
  const quienOpen = open === "quien";
  const avisaOpen = open === "avisa";
  const notifyLabel = (NOTIFY.find(([id]) => id === draft?.notify) || NOTIFY[1])[1];

  const row = (a) => {
    const bot = botById(bots, a.botId);
    const on = a.enabled !== false;
    const edited = a.id === selId;
    const sub = a.subtitle || a.trigger?.sentence || "";
    const waiting = a.state === "waiting";
    const avatar = <BotPresence bot={bot} size={30} />;
    return (
      <div key={a.id} onClick={(e) => { if (!e.target.closest("button,a")) select(a.id); }} style={{ display: "grid", gridTemplateColumns: "30px 1fr auto", alignItems: "center", gap: "12px", padding: "14px", cursor: "pointer", ...(on ? { background: "#FFFFFF", border: "0", boxShadow: edited ? "0 0 0 2px #12131A" : "0 1px 2px rgba(18,19,26,.05)" } : { background: "rgba(255,255,255,.55)", border: "0", boxShadow: edited ? "0 0 0 2px #12131A" : "none" }), borderRadius: "22px" }}>
        {avatar}
        <span style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: "0" }}>
          <a href={`/automatizaciones?id=${encodeURIComponent(a.id)}`} aria-current={edited ? "true" : undefined} onClick={(e) => { e.preventDefault(); select(a.id); }} style={{ fontSize: "15px", fontWeight: "700", ...(on ? {} : { color: "#5C606C" }) }}>{a.name}</a>
          <span style={{ fontSize: "13px", color: "#5C606C" }}>
            {waiting ? <>{sub.replace(/\s*·?\s*Te espera\s*$/i, "") + " · "}<span style={{ padding: "2px 6px", background: "#FFF4D1", borderRadius: "4px", color: "#12131A", fontWeight: "600" }}>{"Te espera"}</span></> : sub}
          </span>
        </span>
        <button type="button" role="switch" aria-checked={on ? "true" : "false"} aria-label={a.name} disabled={toggle.busy} onClick={() => toggle.act(() => patch(`/automations/${encodeURIComponent(a.id)}`, { enabled: !on }))} style={on ? { width: "52px", height: "32px", padding: "3px", background: "#0B8A5F", border: "0", borderRadius: "16px", cursor: "pointer", display: "flex", justifyContent: "flex-end" } : { width: "52px", height: "32px", padding: "3px", background: "rgba(18,19,26,.14)", border: "0", borderRadius: "16px", cursor: "pointer", display: "flex", justifyContent: "flex-start" }}>
          <span style={on ? { width: "26px", height: "26px", borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 2px 4px rgba(18,19,26,.2)" } : { width: "26px", height: "26px", borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 2px 4px rgba(18,19,26,.2)" }} />
        </button>
      </div>
    );
  };

  const runStatus = (r) => {
    const st = r.status;
    if (["completed", "done", "ok", "saved"].includes(st)) return <span style={{ display: "flex", alignItems: "center", gap: "4px", color: "#0B6B4A", fontWeight: "600" }}>{check("currentColor", 2.6, 14)}{r.statusLabel || "Hecha"}</span>;
    if (["waiting", "awaiting_choice", "awaiting_plan", "notified"].includes(st)) return <span style={{ padding: "3px 8px", background: "#FFF4D1", borderRadius: "6px", fontWeight: "600" }}>{r.statusLabel || "Te espera"}</span>;
    if (["running", "queued", "planning"].includes(st)) return <span style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#0B8A5F", boxShadow: "0 0 0 4px #D6F0E4" }} />{r.statusLabel || "En marcha"}</span>;
    if (["failed", "error", "blocked"].includes(st)) return <span style={{ color: "#B4372A", fontWeight: "600" }}>{r.statusLabel || (st === "blocked" ? "Bloqueada" : "Falló")}</span>;
    return <span style={{ color: "#5C606C" }}>{r.statusLabel || (st === "cancelled" ? "Cancelada" : st === "paused" ? "En pausa" : "Ignorado")}</span>;
  };
  const runList = Array.isArray(runs.data) ? runs.data : runs.data?.runs || [];

  return (
    <Shell active="rutinas" extraCss={css}>
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
        <a href="C:/Program Files/Git/rutinas" onClick={(e) => { e.preventDefault(); navigate("C:/Program Files/Git/rutinas"); }} style={{ display: "flex", alignItems: "center", gap: "6px", height: "36px", margin: "32px clamp(20px, 4vw, 48px) 0", padding: "0 14px 0 10px", alignSelf: "flex-start", borderRadius: "999px", background: "rgba(18,19,26,.05)", fontSize: "14px", fontWeight: "500", color: "#12131A" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
          Rutinas
        </a>
        <main style={{ flex: "999 1 560px", minWidth: "0", display: "flex", flexWrap: "wrap", alignItems: "stretch" }}>
          <section aria-labelledby="auto-t" style={{ flex: "1 1 440px", minWidth: "0", padding: "28px clamp(16px, 3vw, 32px) 48px", display: "flex", flexDirection: "column", gap: "18px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <h1 id="auto-t" style={{ margin: "0", font: "600 36px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", letterSpacing: "-0.02em" }}>{"Automatizaciones"}</h1>
                <p style={{ margin: "0", fontSize: "15px", color: "#5C606C" }}>{"Trabajo que pasa solo, a una hora o cuando ocurre algo."}</p>
              </div>
              <button type="button" onClick={() => { startNew(); navigate("/automatizaciones", { replace: true }); handled.current = JSON.stringify({}); }} style={{ display: "flex", alignItems: "center", gap: "8px", height: "48px", padding: "0 22px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "15px" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                {"Nueva"}
              </button>
            </div>
            {autoSuggestions.map((s) => <SuggestionCard key={s.id} s={s} bots={bots} fallbackCta="Sí, automatízalo" />)}
            {suggest.error ? <span role="alert" style={errStyle}>{suggest.error}</span> : null}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {automations.map(row)}
              {ready && automations.length === 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "30px 1fr", alignItems: "center", gap: "12px", padding: "14px", background: "#F6F6F3", border: "0", borderRadius: "14px" }}>
                  <span aria-hidden="true" style={{ width: "30px", height: "30px", display: "grid", placeItems: "center", background: "radial-gradient(circle at 32% 26%, rgba(255,255,255,.62), rgba(255,255,255,0) 54%), #FFC93C", clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)", font: "600 13px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }} />
                  <span style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <strong style={{ fontSize: "15px", color: "#5C606C" }}>{"Aún no hay automatizaciones"}</strong>
                    <span style={{ fontSize: "13px", color: "#5C606C" }}>{"Prepara la primera a la derecha o pide a Atlas que la monte con tus palabras."}</span>
                  </span>
                </div>
              ) : null}
              {toggle.error ? <span role="alert" style={errStyle}>{toggle.error}</span> : null}
            </div>
          </section>

          {anyOpen ? <button type="button" aria-label="Cerrar el menú" onClick={() => { setOpen(null); setDescribe(null); }} style={overlayBtn} /> : null}

          <section aria-labelledby="regla-t" style={{ position: "relative", zIndex: "16", flex: "1.3 1 520px", minWidth: "0", background: "#FFFFFF", borderLeft: "1px solid rgba(18,19,26,.1)", padding: "28px clamp(16px, 3vw, 32px) 48px", display: "flex", flexDirection: "column", gap: "22px" }}>
            {!draft ? <p style={{ margin: "0", fontSize: "15px", color: "#5C606C" }}>{ready ? "Elige una automatización de la lista o crea una nueva." : "Cargando…"}</p> : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#6B6F7A" }}>{isNew ? "Nueva automatización" : "Editar automatización"}</span>
                  <h2 id="regla-t" style={{ margin: "0", font: "600 26px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", letterSpacing: "-0.015em" }}>
                    <input type="text" aria-label="Nombre de la automatización" value={draft.name} onChange={(e) => set({ name: e.target.value })} style={{ width: "100%", padding: "0", margin: "0", border: "0", background: "transparent", font: "inherit", letterSpacing: "inherit", color: "#12131A" }} />
                  </h2>
                </div>
                {preparing ? (
                  <div role="status" style={{ display: "flex", gap: "12px", padding: "14px 16px", background: "#E7EEFF", border: "1px solid #B4C8FF", borderRadius: "14px", fontSize: "14px", lineHeight: "1.45" }}>
                    <span aria-hidden="true" style={{ width: "30px", height: "30px", flex: "none", display: "grid", placeItems: "center", background: "radial-gradient(circle at 32% 26%, rgba(255,255,255,.62), rgba(255,255,255,0) 54%), #FFC93C", clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)", font: "600 13px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }} />
                    <span style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {preparing.error ? <><span><strong>{"Atlas no ha podido prepararla"}</strong>{` a partir de «${preparing.text}».`}</span><span style={errStyle}>{preparing.error}</span><span>{"Puedes rellenarla tú mismo aquí abajo."}</span></>
                        : <span><strong>{"Atlas la está preparando"}</strong>{` a partir de «${preparing.text}»…`}</span>}
                    </span>
                  </div>
                ) : null}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {/* Cuando */}
                  <div style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: "12px", alignItems: "center" }}>
                    <span style={{ font: "600 18px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Cuando"}</span>
                    <div style={{ position: "relative", minWidth: "0" }}>
                      <button type="button" aria-haspopup="listbox" aria-expanded={cuandoOpen ? "true" : "false"} onClick={() => setOpen(cuandoOpen ? null : "cuando")} style={{ position: "relative", zIndex: "21", width: "100%", minHeight: "52px", padding: "10px 12px", textAlign: "left", background: cuandoOpen ? "#FFFFFF" : "#F6F6F3", border: "1.5px solid #12131A", borderRadius: "12px", cursor: "pointer", fontSize: "15px", lineHeight: "1.4", display: "flex", alignItems: "center", gap: "10px" }}>
                        <span aria-hidden="true" style={{ width: "30px", height: "30px", flex: "none", display: "grid", placeItems: "center", background: "#FFFFFF", border: "0", borderRadius: "8px" }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={TRIGGER_META[type][1]} /></svg>
                        </span>
                        <span style={{ flex: "1" }}>{draft.trigger.sentence || TRIGGER_META[type][0]}</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ flex: "none" }}><path d={cuandoOpen ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
                      </button>
                      {cuandoOpen ? (
                        <div role="listbox" aria-label="Cuándo se pone en marcha" style={{ ...menuBox, right: "0" }}>
                          <label style={{ display: "flex", alignItems: "center", gap: "8px", height: "44px", margin: "2px 2px 6px", padding: "0 12px", background: "#F6F6F3", border: "0", borderRadius: "999px" }}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></svg>
                            <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Buscar disparador"}</span>
                            <input type="text" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(null); }} placeholder="Busca: «factura», «lunes», «carpeta»…" style={{ flex: "1", minWidth: "0", border: "0", outline: "none", background: "transparent", fontSize: "14px" }} />
                          </label>
                          {visible.map((o) => (o.header ? (
                            <span key={o.label} style={{ display: "block", padding: "10px 10px 4px", font: "600 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#6B6F7A" }}>{o.label}</span>
                          ) : (
                            <button key={o.id} type="button" role="option" aria-selected={o.id === type ? "true" : "false"} onClick={() => pickTrigger(o.id)} style={{ width: "100%", display: "grid", gridTemplateColumns: "32px 1fr 20px", gap: "10px", alignItems: "center", minHeight: "52px", padding: "6px 10px", textAlign: "left", border: "0", borderRadius: "10px", cursor: "pointer", background: o.id === type ? "#FFF4D1" : "#FFFFFF" }}>
                              <span aria-hidden="true" style={{ width: "32px", height: "32px", display: "grid", placeItems: "center", background: "#F4F4F0", borderRadius: "8px" }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={TRIGGER_META[o.id][1]} /></svg>
                              </span>
                              <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                <strong style={{ fontSize: "14px" }}>{o.label}</strong>
                                <span style={{ fontSize: "12px", color: "#5C606C" }}>{o.desc}</span>
                              </span>
                              {o.id === type ? check() : <span />}
                            </button>
                          )))}
                          {visible.length === 0 ? <span style={{ display: "block", padding: "10px", fontSize: "14px", color: "#5C606C" }}>{`Nada coincide con «${search.trim()}».`}</span> : null}
                          {describe ? (
                            <form onSubmit={(e) => { e.preventDefault(); runDescribe(describe.text); }} style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "6px", padding: "10px 12px", background: "#FFF4D1", border: "0", borderRadius: "10px", fontSize: "14px" }}>
                              <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontWeight: "600", fontSize: "13px" }}>
                                {"Cuéntale a Atlas cuándo debe ponerse en marcha"}
                                <textarea autoFocus rows={2} value={describe.text} onChange={(e) => setDescribe({ ...describe, text: e.target.value })} placeholder="P. ej.: el último viernes de cada mes, si nadie ha enviado el informe" style={{ padding: "10px 12px", border: "0", borderRadius: "10px", fontFamily: "inherit", fontSize: "15px", fontWeight: "400", background: "#FFFFFF", resize: "vertical" }} />
                              </label>
                              {describe.error ? <span role="alert" style={errStyle}>{describe.error}</span> : null}
                              <span style={{ display: "flex", gap: "8px" }}>
                                <button type="submit" disabled={describe.busy || !describe.text.trim()} style={{ height: "38px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "13px" }}>{describe.busy ? "Atlas lo está preparando…" : "Que Atlas lo prepare"}</button>
                                <button type="button" onClick={() => setDescribe(null)} style={{ height: "38px", padding: "0 12px", background: "transparent", border: "0", cursor: "pointer", fontSize: "13px", color: "#3D404A" }}>{"Cancelar"}</button>
                              </span>
                            </form>
                          ) : (
                            <button type="button" onClick={() => setDescribe({ text: search.trim(), busy: false, error: null })} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "48px", marginTop: "6px", padding: "0 12px", background: "#FFF4D1", border: "0", borderRadius: "10px", cursor: "pointer", fontSize: "14px", textAlign: "left" }}>
                              <span aria-hidden="true" style={{ width: "22px", height: "22px", flex: "none", display: "grid", placeItems: "center", background: "radial-gradient(circle at 32% 26%, rgba(255,255,255,.62), rgba(255,255,255,0) 54%), #FFC93C", clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)", font: "600 10px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }} />
                              <span>{"¿No está? "}<strong>{"Descríbelo con tus palabras"}</strong>{" y Atlas lo prepara"}</span>
                            </button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {/* Detalles */}
                  <div style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: "12px", alignItems: "start" }}>
                    <span style={{ paddingTop: "18px", font: "500 12px/1.3 'Geist Mono', monospace", letterSpacing: "0.04em", textTransform: "uppercase", color: "#6B6F7A" }}>{"Detalles"}</span>
                    <div style={{ minWidth: "0", display: "flex", flexDirection: "column", gap: "10px" }}>
                      {sel?.error && sel.trigger?.type === type ? (
                        <div role="note" style={sel.state === "paused" || sel.state === "blocked"
                          ? { display: "flex", alignItems: "flex-start", gap: "12px", padding: "12px 14px", background: "#FBE7DF", border: "1.5px solid #B4372A", borderRadius: "12px", fontSize: "14px", lineHeight: "1.45", color: "#12131A" }
                          : { display: "flex", alignItems: "flex-start", gap: "12px", padding: "12px 14px", background: "#FFF4D1", borderRadius: "12px", fontSize: "13px", lineHeight: "1.45", color: "#3D404A" }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ flex: "none", marginTop: "2px" }}><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></svg>
                          <span>{sel.error}</span>
                        </div>
                      ) : null}
                      <Disparador tipo={type} value={draft.trigger.config} sentence={draft.trigger.sentence} folders={folders} rooms={rooms} connectors={connectors} bots={bots} onProbar={onProbar}
                        onChange={(config, sentence) => setDraft((d) => (d && d.trigger.type === type ? { ...d, trigger: { type, config, sentence } } : d))} />
                    </div>
                  </div>
                  {/* Quién */}
                  <div style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: "12px", alignItems: "center" }}>
                    <span style={{ font: "600 18px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Quién"}</span>
                    <div style={{ position: "relative", minWidth: "0" }}>
                      <button type="button" aria-haspopup="listbox" aria-expanded={quienOpen ? "true" : "false"} onClick={() => setOpen(quienOpen ? null : "quien")} style={{ position: "relative", zIndex: "21", minHeight: "52px", padding: "8px 12px 8px 8px", background: quienOpen ? "#FFFFFF" : "#E1F4EC", border: "1.5px solid #12131A", borderRadius: "12px", cursor: "pointer", fontSize: "15px", display: "flex", alignItems: "center", gap: "10px" }}>
                        <BotPresence bot={whoBot} size={32} />
                        <strong>{who?.short || whoBot?.name || "Elige un bot"}</strong>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d={quienOpen ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
                      </button>
                      {quienOpen ? (
                        <div role="listbox" aria-label="Qué bot lo hace" style={{ ...menuBox, width: "min(460px, 82vw)" }}>
                          <div style={{ margin: "2px 2px 6px", padding: "10px 12px", background: "#F6F6F3", borderRadius: "10px", fontSize: "13px", lineHeight: "1.45", color: "#3D404A" }}>
                            <strong>{"Para esto hace falta:"}</strong>
                            {needs.length ? ` ${listJoin(needs.map((n) => TOOL[n.tool]?.[n.access] || n.tool))}.` : " nada especial; cualquier bot puede hacerlo."}
                          </div>
                          {whoItems.map((x) => {
                            const on = x.b.id === draft.botId;
                            return (
                              <button key={x.b.id} type="button" role="option" aria-selected={on ? "true" : "false"} aria-disabled={x.ok ? "false" : "true"} disabled={!x.ok} onClick={() => { if (x.ok) { set({ botId: x.b.id }); setOpen(null); } }} style={{ width: "100%", display: "grid", gridTemplateColumns: "34px 1fr auto", gap: "10px", alignItems: "center", minHeight: "58px", padding: "6px 10px", textAlign: "left", border: "0", borderRadius: "10px", background: on ? "#FFF4D1" : "#FFFFFF", cursor: x.ok ? "pointer" : "not-allowed", opacity: x.ok ? "1" : "0.55" }}>
                                <BotPresence bot={x.b} size={32} />
                                <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                  <strong style={{ fontSize: "14px" }}>{x.name}</strong>
                                  <span style={{ fontSize: "12px", lineHeight: "1.35", color: x.ok ? "#5C606C" : "#B4372A" }}>{x.desc}</span>
                                </span>
                                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                  {x.b.id === recommended ? <span style={{ padding: "4px 8px", background: "#FFC93C", borderRadius: "6px", font: "600 11px/1 'Geist Mono', monospace" }}>{"Recomendado"}</span> : null}
                                  {on ? check() : null}
                                </span>
                              </button>
                            );
                          })}
                          {firstBlocked ? <a href="/ajustes/conexiones" style={{ display: "flex", alignItems: "center", minHeight: "44px", marginTop: "6px", padding: "0 12px", borderTop: "1px solid rgba(18,19,26,.06)", fontSize: "14px", fontWeight: "600", color: "#1F4FD1" }}>{`Dar acceso ${TOOL[firstBlocked.tool]?.art || firstBlocked.tool} a otro bot`}</a> : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {/* Hace */}
                  <div style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: "12px", alignItems: "start" }}>
                    <span style={{ font: "600 18px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", paddingTop: "16px" }}>{"Hace"}</span>
                    <textarea aria-label="Qué hace" value={draft.prompt} onChange={(e) => set({ prompt: e.target.value })} rows={draft.prompt ? Math.max(2, Math.ceil(draft.prompt.length / 55)) : 3} placeholder="Qué tiene que hacer, con tus palabras. P. ej.: guarda el PDF en la carpeta de facturas y apunta proveedor, fecha e importe en la hoja de gastos." style={{ minHeight: "52px", width: "100%", padding: "12px 14px", background: "#F6F6F3", border: "1.5px solid #12131A", borderRadius: "12px", fontSize: "15px", lineHeight: "1.5", fontFamily: "inherit", resize: "vertical" }} />
                  </div>
                  {/* Avísame */}
                  <div style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: "12px", alignItems: "start" }}>
                    <span style={{ font: "600 18px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", paddingTop: "16px" }}>{"Avísame"}</span>
                    <div style={{ position: "relative", minWidth: "0" }}>
                      <button type="button" aria-haspopup="listbox" aria-expanded={avisaOpen ? "true" : "false"} onClick={() => setOpen(avisaOpen ? null : "avisa")} style={{ position: "relative", zIndex: "21", width: "100%", minHeight: "52px", padding: "12px 14px", textAlign: "left", background: "#FFF4D1", border: "1.5px solid #12131A", borderRadius: "12px", cursor: "pointer", fontSize: "15px", lineHeight: "1.5", display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ flex: "1" }}>{notifyLabel}</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ flex: "none" }}><path d={avisaOpen ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
                      </button>
                      {avisaOpen ? (
                        <div role="listbox" aria-label="Cuándo te avisa" style={{ ...menuBox, right: "0" }}>
                          {NOTIFY.map(([id, label]) => {
                            const on = draft.notify === id;
                            return (
                              <button key={id} type="button" role="option" aria-selected={on ? "true" : "false"} onClick={() => { set({ notify: id }); setOpen(null); }} style={{ width: "100%", display: "grid", gridTemplateColumns: "1fr 20px", gap: "10px", alignItems: "center", minHeight: "52px", padding: "6px 12px", textAlign: "left", border: "0", borderRadius: "10px", cursor: "pointer", background: on ? "#FFF4D1" : "#FFFFFF", fontSize: "14px" }}>
                                <span>{label}</span>
                                {on ? check() : <span />}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "14px 16px", background: "#F6F6F3", borderRadius: "12px" }}>
                  <span style={{ fontSize: "14px", fontWeight: "600" }}>{who?.coord || !whoBot ? `El bot que elija ${whoBot?.name || "Atlas"} necesitará` : `${whoBot.name} necesitará`}</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", fontSize: "13px" }}>
                    {needs.length === 0 ? <span style={{ color: "#5C606C" }}>{"Nada especial: con lo que ya tiene le basta."}</span> : null}
                    {needs.map((n) => {
                      const st = whoCoverage?.res.find((r) => r.tool === n.tool)?.state || "neutral";
                      const label = `${TOOL[n.tool]?.chip || n.tool} · ${n.access === "escribe" ? "escribir" : "leer"}`;
                      if (st === "permiso" || st === "none") return <span key={n.tool} style={{ display: "flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 10px", background: "#FFF4D1", border: "0", borderRadius: "15px", fontWeight: "600" }}>{`${label} · ${st === "none" ? "sin acceso" : "falta tu permiso"}`}</span>;
                      return <span key={n.tool} style={{ display: "flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 10px", background: "#FFFFFF", border: "0", borderRadius: "15px" }}>{st === "ok" ? check("#0B6B4A", 3, 13) : null}{label}</span>;
                    })}
                  </div>
                  {whoCoverage && (whoCoverage.lacking.length || whoCoverage.blocked.length) && whoBot ? <a href={`/equipo/${encodeURIComponent(whoBot.id)}`} style={{ fontSize: "13px", fontWeight: "600", color: "#1F4FD1" }}>{`Revisar los permisos de ${whoBot.name}`}</a> : null}
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  <button type="button" onClick={onTest} disabled={saving} style={{ height: "46px", padding: "0 16px", background: "rgba(18,19,26,.06)", border: "0", borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "14px" }}>{PROBE_LABEL[type]}</button>
                  <button type="button" onClick={onSave} disabled={saving} style={{ height: "46px", padding: "0 18px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "14px" }}>{saving ? "Guardando…" : isNew ? "Crear automatización" : "Guardar cambios"}</button>
                  <span style={{ flex: "1" }} />
                  {isNew ? (
                    <button type="button" onClick={() => (automations.length ? select(automations[0].id) : startNew())} style={{ height: "46px", padding: "0 12px", background: "transparent", border: "0", cursor: "pointer", fontSize: "14px", color: "#3D404A" }}>{"Descartar"}</button>
                  ) : (
                    <button type="button" onClick={onDelete} style={{ height: "46px", padding: "0 12px", background: "transparent", border: "0", cursor: "pointer", fontWeight: "600", fontSize: "14px", color: "#B4372A" }}>{"Eliminar"}</button>
                  )}
                </div>
                {saveError ? <span role="alert" style={errStyle}>{saveError}</span> : null}
                {msg ? (
                  <span role="status" style={msg.error ? errStyle : { fontSize: "14px", color: "#3D404A" }}>
                    {msg.text}{msg.missionId ? <>{" "}<a href={`/misiones/${encodeURIComponent(msg.missionId)}`} style={{ fontWeight: "600", textDecoration: "underline" }}>{"Ver la misión"}</a></> : null}
                  </span>
                ) : null}

                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <h3 style={{ margin: "0 0 8px", font: "600 18px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Últimas veces"}</h3>
                  {isNew ? <div style={{ display: "flex", alignItems: "center", minHeight: "50px", borderTop: "1px solid rgba(18,19,26,.06)", borderBottom: "1px solid rgba(18,19,26,.06)", fontSize: "14px", color: "#5C606C" }}>{"Aún no se ha puesto en marcha: guárdala para empezar."}</div>
                    : runs.error ? <div role="alert" style={{ display: "flex", alignItems: "center", minHeight: "50px", borderTop: "1px solid rgba(18,19,26,.06)", borderBottom: "1px solid rgba(18,19,26,.06)", ...errStyle }}>{`No se pudo cargar el historial: ${runs.error}`}</div>
                    : runList.length === 0 ? <div style={{ display: "flex", alignItems: "center", minHeight: "50px", borderTop: "1px solid rgba(18,19,26,.06)", borderBottom: "1px solid rgba(18,19,26,.06)", fontSize: "14px", color: "#5C606C" }}>{runs.loading ? "" : "Aún no se ha puesto en marcha."}</div>
                    : runList.slice(0, 10).map((r, i, all) => (
                      <div key={r.missionId || r.at || i} style={{ display: "grid", gridTemplateColumns: "80px 1fr auto", alignItems: "center", gap: "12px", minHeight: "50px", borderTop: "1px solid rgba(18,19,26,.06)", ...(i === all.length - 1 ? { borderBottom: "1px solid rgba(18,19,26,.06)" } : {}), fontSize: "14px" }}>
                        <span style={{ font: "500 13px/1 'Geist Mono', monospace", color: "#6B6F7A" }}>{when(r.at)}</span>
                        {r.missionId ? <a href={`/misiones/${encodeURIComponent(r.missionId)}`}>{r.title || "Ejecución"}</a> : <span>{r.title || "Ejecución"}</span>}
                        {runStatus(r)}
                      </div>
                    ))}
                </div>
              </>
            )}
          </section>
        </main>
      </div>
    </Shell>
  );
}

function fromAutomationBody(a) {
  if (!a) return null;
  const d = fromAutomation(a);
  return { name: d.name.trim(), botId: d.botId, prompt: d.prompt.trim(), trigger: { type: d.trigger.type, config: d.trigger.config || {}, sentence: d.trigger.sentence || "" }, notify: d.notify, needs: mergeNeeds(d.needs, d.trigger.type) };
}
