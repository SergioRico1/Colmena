// «Tu perfil» in team messaging (src/screens/Personas.jsx): what others see of you (title, time
// zone, status), whether you are around («Ausente», «No molestar» now or on a schedule), what
// reaches you (keywords, the mail digest) and the notifications on this device. Saved with
// PATCH /api/chat/me, which answers with your whole profile (server/cloud/chat.mjs › myProfile).
import { useEffect, useMemo, useState } from "react";
import Select from "../components/Select.jsx";
import { BellSlash, Bell, Check } from "../components/Icon.js";
import { chat } from "./api.js";
import { setMyProfile, useChat } from "./store.js";
import { whenOf } from "./ui.jsx";
import { disablePush, enablePush, pushState, refreshPush, testPush } from "./push.js";
import "./people.css";

// Emoji are content here (what others read beside your name), not icons.
const STATUS_PRESETS = [
  ["📅", "En una reunión"], ["📞", "En una llamada"], ["🎧", "Concentrado"], ["🏠", "Teletrabajando"],
  ["🚌", "De camino"], ["🍽️", "Comiendo"], ["☕", "En una pausa"], ["✈️", "De viaje"],
  ["🌴", "De vacaciones"], ["🤒", "De baja"], ["🎓", "En formación"], ["✅", "Disponible"],
];
const PRESET_TEXTS = new Set(STATUS_PRESETS.map(([, t]) => t));

const ZONES = [
  "Europe/Madrid", "Atlantic/Canary", "Europe/Lisbon", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Rome",
  "America/Mexico_City", "America/Bogota", "America/Lima", "America/Caracas", "America/Santiago", "America/Argentina/Buenos_Aires",
  "America/Sao_Paulo", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Africa/Casablanca", "Asia/Dubai", "Asia/Kolkata", "Asia/Shanghai", "Asia/Tokyo", "Australia/Sydney", "UTC",
];
const browserZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; } })();
function zoneLabel(tz) {
  const city = tz === "UTC" ? "UTC" : tz.split("/").pop().replace(/_/g, " ");
  let offset = "";
  try { offset = new Intl.DateTimeFormat("es-ES", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value || ""; } catch {}
  return offset && offset !== city ? `${city} (${offset})` : city;
}

const CLEAR = [["30m", "En 30 minutos"], ["1h", "En 1 hora"], ["4h", "En 4 horas"], ["today", "Al acabar el día"], ["never", "Nunca"]];
function clearAt(choice, keep) {
  const now = Date.now();
  if (choice === "keep") return keep || null;
  if (choice === "30m") return now + 30 * 60000;
  if (choice === "1h") return now + 60 * 60000;
  if (choice === "4h") return now + 4 * 60 * 60000;
  if (choice === "today") { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); }
  return null;
}
function tomorrowAt8() { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d.getTime(); }
// Monday first, as a Spanish calendar; 0 is Sunday on the server.
const DAYS = [[1, "L", "lunes"], [2, "M", "martes"], [3, "X", "miércoles"], [4, "J", "jueves"], [5, "V", "viernes"], [6, "S", "sábado"], [0, "D", "domingo"]];

function formOf(p = {}) {
  const s = p.dnd?.schedule || null;
  return {
    title: p.title || "", tz: p.tz || "",
    emoji: p.statusEmoji || "", text: p.statusText || "", clear: p.statusUntil && p.statusUntil > Date.now() ? "keep" : "never",
    away: !!p.away,
    schedOn: !!s?.on, from: s?.from || "22:00", to: s?.to || "08:00", days: s?.days?.length ? [...s.days].sort() : [1, 2, 3, 4, 5],
    keywords: (p.keywords || []).join(", "), digest: p.digest !== false,
  };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default function ProfileEditor() {
  const s = useChat();
  const profile = s.me?.profile || {};
  const [base, setBase] = useState(() => formOf(profile));
  const [form, setForm] = useState(base);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(null); // { ok, text }
  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setNote(null); };
  const dirty = !same(form, base);

  const zones = useMemo(() => {
    const list = [...ZONES];
    for (const z of [browserZone, profile.tz]) if (z && !list.includes(z)) list.unshift(z);
    return [["", "Sin zona horaria"], ...list.map((z) => [z, zoneLabel(z) + (z === browserZone ? " · este dispositivo" : "")])];
  }, [profile.tz]);
  const clearOptions = useMemo(() => [
    ...(profile.statusUntil && profile.statusUntil > Date.now() ? [["keep", "Como está (" + whenOf(profile.statusUntil) + ")"]] : []),
    ...CLEAR,
  ], [profile.statusUntil]);

  async function save(patch, { reset = false } = {}) {
    setSaving(true);
    setNote(null);
    try {
      const next = await chat.patch("/me", patch);
      setMyProfile(next);
      if (reset) { const f = formOf(next); setBase(f); setForm(f); }
      setNote({ ok: true, text: "Guardado." });
      return next;
    } catch (error) {
      setNote({ ok: false, text: error.message || "No se pudo guardar." });
      return null;
    } finally { setSaving(false); }
  }

  function submit(e) {
    e.preventDefault();
    if (!dirty || saving) return;
    const hasStatus = !!(form.emoji || form.text.trim());
    const untilNow = profile.dnd?.until && profile.dnd.until > Date.now() ? profile.dnd.until : null;
    save({
      title: form.title.trim(),
      tz: form.tz || null,
      statusEmoji: hasStatus ? form.emoji : "",
      statusText: hasStatus ? form.text.trim() : "",
      statusUntil: hasStatus ? clearAt(form.clear, profile.statusUntil) : null,
      away: form.away,
      // Both parts go together: the server takes a missing `until` as «no pause».
      dnd: { until: untilNow, schedule: { on: form.schedOn, from: form.from, to: form.to, days: form.days } },
      keywords: form.keywords.split(/[,\n]/).map((k) => k.trim()).filter(Boolean),
      digest: form.digest,
    }, { reset: true });
  }

  // «No molestar» right now: saved at once, the rest of the form stays as you left it.
  const pause = (until) => save({ dnd: { until } });
  const resume = () => save({ dnd: { until: null } });
  const pausedUntil = profile.dnd?.until && profile.dnd.until > Date.now() ? profile.dnd.until : null;
  const dndLine = pausedUntil
    ? "Avisos en pausa hasta " + whenOf(pausedUntil) + "."
    : profile.dndNow ? "Avisos en pausa por tu horario." : "Recibes los avisos con normalidad.";

  const pickEmoji = (emoji, label) => {
    if (form.emoji === emoji) return set({ emoji: "" });
    set({ emoji, ...(!form.text.trim() || PRESET_TEXTS.has(form.text.trim()) ? { text: label } : {}) });
  };
  const toggleDay = (d) => set({ days: form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d].sort() });

  return (
    <form className="pp-editor" onSubmit={submit} noValidate>
      <div className="pp-editor-body">
        <h3 className="pp-group-title">Sobre ti</h3>
        <label className="ch-field">Cargo o función
          <input className="ch-input" value={form.title} maxLength={80} placeholder="Por ejemplo, Diseño de producto" onChange={(e) => set({ title: e.target.value })} />
        </label>
        <div className="ch-field">
          <span>Zona horaria</span>
          <Select aria-label="Zona horaria" value={form.tz} options={zones} onChange={(e) => set({ tz: e.target.value })} className="pp-select" />
          <small>Los demás ven tu hora local junto a tu nombre.</small>
        </div>

        <h3 className="pp-group-title">Estado</h3>
        <div className="pp-emoji-grid" role="group" aria-label="Emoji del estado">
          {STATUS_PRESETS.map(([emoji, label]) => (
            <button key={emoji} type="button" className="pp-emoji" aria-pressed={form.emoji === emoji} aria-label={label} title={label} onClick={() => pickEmoji(emoji, label)}>
              <span aria-hidden="true">{emoji}</span>
            </button>
          ))}
        </div>
        <label className="ch-field">Texto del estado
          <input className="ch-input" value={form.text} maxLength={100} placeholder="¿Qué estás haciendo?" onChange={(e) => set({ text: e.target.value })} />
        </label>
        <div className="pp-row-2 r-stack">
          <div className="ch-field r-grow">
            <span>Borrar después de</span>
            <Select aria-label="Borrar el estado después de" value={form.clear} options={clearOptions} onChange={(e) => set({ clear: e.target.value })} disabled={!form.emoji && !form.text.trim()} className="pp-select" />
          </div>
          {form.emoji || form.text ? <button type="button" className="ch-btn pp-row-2-btn" onClick={() => set({ emoji: "", text: "" })}>Quitar estado</button> : null}
        </div>

        <h3 className="pp-group-title">Disponibilidad</h3>
        <label className="ch-check">
          <input type="checkbox" checked={form.away} onChange={(e) => set({ away: e.target.checked })} />
          <span>Aparecer como ausente<small className="pp-check-hint">Aunque tengas Colmena abierto.</small></span>
        </label>

        <div className="pp-dnd">
          <p className="pp-dnd-state">
            {profile.dndNow ? <BellSlash size={16} /> : <Bell size={16} />}
            <span>{dndLine}</span>
          </p>
          <div className="ch-row-actions">
            {pausedUntil
              ? <button type="button" className="ch-btn" disabled={saving} onClick={resume}>Reanudar avisos</button>
              : null}
            <button type="button" className="ch-btn" disabled={saving} onClick={() => pause(Date.now() + 30 * 60000)}>30 min</button>
            <button type="button" className="ch-btn" disabled={saving} onClick={() => pause(Date.now() + 60 * 60000)}>1 h</button>
            <button type="button" className="ch-btn" disabled={saving} onClick={() => pause(Date.now() + 2 * 60 * 60000)}>2 h</button>
            <button type="button" className="ch-btn" disabled={saving} onClick={() => pause(tomorrowAt8())}>Hasta mañana a las 8:00</button>
          </div>
          {profile.dndNow && !pausedUntil ? <p className="ch-hint pp-mt">Para recibirlos ahora, desactiva el horario de abajo.</p> : null}
        </div>

        <label className="ch-check">
          <input type="checkbox" checked={form.schedOn} onChange={(e) => set({ schedOn: e.target.checked })} />
          <span>Pausar los avisos cada día con un horario</span>
        </label>
        {form.schedOn ? (
          <div className="pp-schedule">
            <div className="pp-times">
              <label className="ch-field">Desde
                <input className="ch-input" type="time" value={form.from} onChange={(e) => set({ from: e.target.value || "22:00" })} />
              </label>
              <label className="ch-field">Hasta
                <input className="ch-input" type="time" value={form.to} onChange={(e) => set({ to: e.target.value || "08:00" })} />
              </label>
            </div>
            <div className="pp-days" role="group" aria-label="Días">
              {DAYS.map(([d, short, long]) => (
                <button key={d} type="button" className="pp-day" aria-pressed={form.days.includes(d)} aria-label={long} title={long} onClick={() => toggleDay(d)}>{short}</button>
              ))}
            </div>
            <p className="ch-hint">{form.tz ? "Con la hora de tu zona horaria." : "Sin zona horaria, se usa la hora UTC."}{form.days.length ? "" : " Sin días elegidos, se aplica todos los días."}</p>
          </div>
        ) : null}

        <h3 className="pp-group-title">Lo que te avisa</h3>
        <label className="ch-field">Palabras clave
          <input className="ch-input" value={form.keywords} placeholder="presupuesto, entrega, cliente" onChange={(e) => set({ keywords: e.target.value })} />
          <small>Separadas por comas. Te avisamos cuando alguien las escribe en tus canales, como si te mencionara (hasta 20).</small>
        </label>
        <label className="ch-check">
          <input type="checkbox" checked={form.digest} onChange={(e) => set({ digest: e.target.checked })} />
          <span>Resumen por correo de lo que no has leído<small className="pp-check-hint">Menciones y mensajes directos que siguen sin leer al cabo de un rato.</small></span>
        </label>

        <h3 className="pp-group-title">Avisos en este dispositivo</h3>
        <DevicePush publicKey={s.push?.publicKey || null} />
      </div>

      <div className="pp-editor-foot">
        <p className={"pp-save-note" + (note && !note.ok ? " is-error" : "")} role="status" aria-live="polite">
          {note ? (note.ok ? <><Check size={14} />{note.text}</> : note.text) : dirty ? "Cambios sin guardar." : ""}
        </p>
        {dirty ? <button type="button" className="ch-btn" disabled={saving} onClick={() => { setForm(base); setNote(null); }}>Descartar</button> : null}
        <button type="submit" className="ch-btn is-primary" disabled={!dirty || saving}>{saving ? "Guardando…" : "Guardar cambios"}</button>
      </div>
    </form>
  );
}

/** Web Push on this browser: honest about what the browser and the server allow. */
function DevicePush({ publicKey }) {
  const [state, setState] = useState("checking");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }

  useEffect(() => {
    let live = true;
    pushState().then((st) => {
      if (!live) return;
      setState(st);
      if (st === "on" && publicKey) refreshPush();
    });
    return () => { live = false; };
  }, [publicKey]);

  const act = async (fn) => {
    setBusy(true);
    setMsg(null);
    try { await fn(); } catch (error) { setMsg({ ok: false, text: error.message || "No se pudo." }); if (error.state) setState(error.state); }
    finally { setBusy(false); }
  };
  const on = () => act(async () => { setState(await enablePush(publicKey)); setMsg({ ok: true, text: "Activados. Prueba a enviarte uno." }); });
  const off = () => act(async () => { setState(await disablePush()); setMsg({ ok: true, text: "Desactivados en este dispositivo." }); });
  const test = () => act(async () => {
    const r = await testPush();
    setMsg(r?.sent ? { ok: true, text: r.sent === 1 ? "Enviado. Debería aparecer en unos segundos." : `Enviado a ${r.sent} dispositivos.` } : { ok: false, text: "No llegó a ningún dispositivo. Desactívalos y vuelve a activarlos." });
  });

  let line, actions = null;
  if (state === "checking") line = "Comprobando…";
  else if (state === "unsupported") line = "Tu navegador no admite avisos.";
  else if (!publicKey) line = "Sin configurar en el servidor: quien administra Colmena tiene que activarlos.";
  else if (state === "denied") line = "Bloqueados en el navegador: permítelos en los ajustes del sitio.";
  else if (state === "on") {
    line = "Activados: te avisamos aquí cuando no estás conectado, salvo en «No molestar».";
    actions = <>
      <button type="button" className="ch-btn" disabled={busy} onClick={test}>Probar</button>
      <button type="button" className="ch-btn" disabled={busy} onClick={off}>Desactivar</button>
    </>;
  } else {
    line = "Recibe avisos de menciones y mensajes directos aunque no tengas Colmena abierto.";
    actions = <button type="button" className="ch-btn is-primary" disabled={busy} onClick={on}>{busy ? "Activando…" : "Activar"}</button>;
  }
  return (
    <div className="pp-push">
      <p className="pp-push-line">{line}</p>
      {actions ? <div className="ch-row-actions">{actions}</div> : null}
      {msg ? <p className={msg.ok ? "ch-ok pp-mt" : "ch-error pp-mt"} role="status">{msg.text}</p> : null}
    </div>
  );
}
