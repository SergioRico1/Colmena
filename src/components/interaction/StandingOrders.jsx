import { useState } from "react";
import { del, patch, post } from "../../lib/api.js";
import { useAction, useStore } from "../../lib/store.jsx";
import { Notice, Spinner, Switch } from "../team/common.jsx";
import { later, useHidden } from "../../lib/undoToast.js";

// Tarjeta «Tareas fijas» del perfil del bot (lo que antes se llamaba «Encargos»: esa palabra queda para lo que otra persona pide a tus bots) (OpenClaw standing orders + standing intents):
// what the bot does on its own, in plain words, and «Cuando se hable de X, recuérdame Y».
// Same language as the profile cards (Bot.jsx). The red lines always keep asking.

const sectionCard = { background: "var(--c-card)", border: "0", borderRadius: "var(--r-xl)", padding: "22px", display: "flex", flexDirection: "column" };
const h2 = { margin: 0, font: "600 var(--t-title)/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" };
const ghost = { height: "40px", padding: "0 12px", background: "transparent", border: "0", borderRadius: "var(--r-md)", cursor: "pointer", fontSize: "var(--t-ui)" };
const field = { width: "100%", padding: "10px 12px", background: "var(--c-hover)", border: "0", borderRadius: "var(--r-md)", fontSize: "var(--t-body)", lineHeight: "1.5", outlineColor: "var(--c-accent)" };
const labelText = { fontSize: "var(--t-ui)", fontWeight: "600" };
const hint = { fontSize: "var(--t-caption)", color: "var(--c-text-3)", lineHeight: "1.4" };
const dark = { display: "flex", alignItems: "center", gap: "8px", height: "44px", padding: "0 14px", background: "var(--c-btn)", color: "var(--c-btn-text)", border: 0, borderRadius: "var(--r-md)", cursor: "pointer", fontWeight: "600", fontSize: "var(--t-ui)" };
const RED_LINES = ["Enviar algo fuera", "Mover dinero", "Borrar archivos", "Instalar programas"];
const EMPTY = { title: "", what: "", when: "", needsOk: "", stopWhen: "" };

function Field({ label, help, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <span style={labelText}>{label}</span>
      {children}
      {help ? <span style={hint}>{help}</span> : null}
    </label>
  );
}

function OrderForm({ bot, initial, onDone }) {
  const [form, setForm] = useState(initial ? { ...EMPTY, ...initial } : EMPTY);
  const { act, busy, error } = useAction();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    const body = { title: form.title.trim(), what: form.what.trim(), when: form.when.trim(), needsOk: form.needsOk.trim(), stopWhen: form.stopWhen.trim() };
    const result = await act(() => (initial?.id ? patch(`/standing-orders/${initial.id}`, body) : post("/standing-orders", { ...body, botId: bot.id })));
    if (result) onDone(result);
  };
  return (
    <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "16px", border: "0", borderRadius: "var(--r-2xl)", background: "var(--c-card)" }}>
      <Field label="Nombre de la tarea fija"><input required maxLength={100} value={form.title} onChange={set("title")} placeholder="Facturas de proveedores" style={{ ...field, height: "44px" }} /></Field>
      <Field label="Qué haces" help={`Cuéntaselo a ${bot.name} como a un compañero nuevo.`}>
        <textarea required minLength={3} maxLength={4000} rows="2" value={form.what} onChange={set("what")} placeholder="Revisa las facturas que lleguen y apúntalas en la hoja de gastos." style={{ ...field, resize: "vertical", fieldSizing: "content", minHeight: "64px" }} />
      </Field>
      <Field label="Cuándo" help="Un día y una hora («cada lunes a las 9») o una situación («cuando llegue una factura»). Si es un día o una hora, podrás crear la automatización.">
        <input maxLength={300} value={form.when} onChange={set("when")} placeholder="Cada lunes a las 9" style={{ ...field, height: "44px" }} />
      </Field>
      <Field label="Qué necesita tu OK">
        <textarea maxLength={1000} rows="1" value={form.needsOk} onChange={set("needsOk")} placeholder="Antes de pagar algo o de escribir a un proveedor." style={{ ...field, resize: "vertical", fieldSizing: "content", minHeight: "44px" }} />
      </Field>
      <Field label="Cuándo para y te pregunta">
        <textarea maxLength={1000} rows="1" value={form.stopWhen} onChange={set("stopWhen")} placeholder="Si el importe pasa de 500 € o falta algún dato." style={{ ...field, resize: "vertical", fieldSizing: "content", minHeight: "44px" }} />
      </Field>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <span style={hint}>{"Aunque la tarea fija diga otra cosa, siempre te pide permiso para:"}</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {RED_LINES.map((r) => <span key={r} style={{ display: "flex", alignItems: "center", height: "30px", padding: "0 10px", background: "var(--c-btn)", color: "var(--c-btn-text)", borderRadius: "var(--r-pill)", fontSize: "var(--t-caption)" }}>{r}</span>)}
        </div>
      </div>
      {error ? <Notice>{error}</Notice> : null}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "8px" }}>
        <button type="button" onClick={() => onDone(null)} style={{ ...ghost, height: "44px" }}>Cancelar</button>
        <button type="submit" disabled={busy} style={dark}>{busy ? <Spinner size={14} /> : null}{initial?.id ? "Guardar tarea fija" : "Añadir tarea fija"}</button>
      </div>
    </form>
  );
}

function IntentForm({ bot, onDone }) {
  const [keywords, setKeywords] = useState("");
  const [remind, setRemind] = useState("");
  const [until, setUntil] = useState("");
  const [max, setMax] = useState(3);
  const { act, busy, error, setError } = useAction();
  const save = async (e) => {
    e.preventDefault();
    const list = keywords.split(/[,;\n]/).map((k) => k.trim()).filter(Boolean);
    if (!list.length) return setError("Escribe al menos una palabra o frase.");
    const expiresAt = until ? new Date(until + "T23:59:59").toISOString() : null;
    const result = await act(() => post("/intents", { keywords: list, remind: remind.trim(), botId: bot.id, expiresAt, maxHits: Number(max) || 3 }));
    if (result) onDone(result);
  };
  return (
    <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "16px", border: "0", borderRadius: "var(--r-2xl)", background: "var(--c-card)" }}>
      <Field label="Cuando se hable de" help="Palabras o frases separadas por comas. Vale en cualquier sala o chat.">
        <input required value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="renovación, contrato de Iberdrola" style={{ ...field, height: "44px" }} />
      </Field>
      <Field label="Recuérdame">
        <textarea required minLength={3} maxLength={600} rows="1" value={remind} onChange={(e) => setRemind(e.target.value)} placeholder="Que el preaviso es de 30 días y hay que pedir dos presupuestos." style={{ ...field, resize: "vertical", fieldSizing: "content", minHeight: "44px" }} />
      </Field>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
        <Field label="Hasta (opcional)">
          <input type="date" value={until} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setUntil(e.target.value)} style={{ ...field, height: "44px", width: "190px" }} />
        </Field>
        <Field label="Avisos como mucho">
          <input type="number" min="1" max="20" value={max} onChange={(e) => setMax(e.target.value)} style={{ ...field, height: "44px", width: "110px" }} />
        </Field>
      </div>
      {error ? <Notice>{error}</Notice> : null}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "8px" }}>
        <button type="button" onClick={() => onDone(null)} style={{ ...ghost, height: "44px" }}>Cancelar</button>
        <button type="submit" disabled={busy} style={dark}>{busy ? <Spinner size={14} /> : null}Guardar recordatorio</button>
      </div>
    </form>
  );
}

const day = (v) => (v ? new Date(v).toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "") : "");

export default function StandingOrdersCard({ bot }) {
  const { standingOrders = [], intents = [] } = useStore();
  const hiddenOrder = useHidden("order");
  const hiddenIntent = useHidden("intent");
  const orders = standingOrders.filter((o) => o.botId === bot.id && !hiddenOrder(o.id));
  const reminders = intents.filter((i) => i.botId === bot.id && !hiddenIntent(i.id));
  const [editing, setEditing] = useState(null); // 'new' | order id
  const [addingIntent, setAddingIntent] = useState(false);
  const action = useAction();

  return (
    <section id="encargos" aria-labelledby="enc-t" style={{ ...sectionCard, gap: "14px", scrollMarginTop: "16px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <h2 id="enc-t" style={h2}>Tareas fijas</h2>
          <p style={{ margin: 0, fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{`Lo que ${bot.name} se ocupa de hacer siempre, sin que se lo pidas cada vez.`}</p>
        </div>
        {editing === null ? <button type="button" onClick={() => setEditing("new")} style={{ ...ghost, display: "flex", alignItems: "center", gap: "6px", flex: "none" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Nuevo</button> : null}
      </div>
      {editing === "new" ? <OrderForm bot={bot} onDone={() => setEditing(null)} /> : null}
      {orders.map((o) => (editing === o.id ? (
        <OrderForm key={o.id} bot={bot} initial={o} onDone={() => setEditing(null)} />
      ) : (
        <div key={o.id} style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "14px", border: o.active ? "1px solid rgb(var(--c-ink-rgb) / .1)" : "1px dashed var(--c-line-strong)", borderRadius: "var(--r-lg)", background: o.active ? "var(--c-card)" : "var(--c-hover)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
            <strong style={{ fontSize: "var(--t-read)", color: o.active ? "var(--c-text)" : "var(--c-text-3)" }}>{o.title}</strong>
            <Switch on={o.active} label={`Tarea fija «${o.title}» ${o.active ? "activa" : "en pausa"}`} disabled={action.busy} onClick={() => action.act(() => patch(`/standing-orders/${o.id}`, { active: !o.active }))} />
          </div>
          <span style={{ fontSize: "var(--t-ui)", lineHeight: "1.5", color: "var(--c-text-2)", whiteSpace: "pre-wrap" }}>{o.what}</span>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 10px", fontSize: "var(--t-meta)", lineHeight: "1.45" }}>
            {o.when ? <><dt style={{ color: "var(--c-text-3)" }}>Cuándo</dt><dd style={{ margin: 0 }}>{o.when}</dd></> : null}
            {o.needsOk ? <><dt style={{ color: "var(--c-text-3)" }}>Necesita tu OK</dt><dd style={{ margin: 0 }}>{o.needsOk}</dd></> : null}
            {o.stopWhen ? <><dt style={{ color: "var(--c-text-3)" }}>Para y pregunta</dt><dd style={{ margin: 0 }}>{o.stopWhen}</dd></> : null}
          </dl>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", paddingTop: "4px" }}>
            {o.automationId ? (
              <a href={`/automatizaciones?id=${encodeURIComponent(o.automationId)}`} style={{ display: "flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 12px", background: "var(--c-ok-soft)", border: "0", borderRadius: "var(--r-pill)", fontSize: "var(--t-meta)", fontWeight: "600", color: "var(--c-ok-ink)" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                Automatizado · ver
              </a>
            ) : o.schedule ? (
              <button type="button" disabled={action.busy} onClick={() => action.act(() => post(`/standing-orders/${o.id}/automation`))} title={`Se pondrá en marcha cuando ${o.schedule.sentence}`} style={{ height: "36px", padding: "0 12px", background: "var(--c-honey)", color: "var(--c-honey-ink)", border: "0", borderRadius: "var(--r-pill)", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: "700" }}>Crear la automatización</button>
            ) : null}
            {!o.automationId && o.schedule ? <span style={hint}>{`Cuando ${o.schedule.sentence}`}</span> : null}
            <span style={{ flex: "1" }} />
            <button type="button" onClick={() => setEditing(o.id)} style={{ ...ghost, height: "36px" }}>Editar</button>
            <button type="button" aria-label={`Borrar la tarea fija «${o.title}»`} disabled={action.busy} onClick={() => later({ id: "order:" + o.id, keys: ["order:" + o.id], text: `Tarea fija «${o.title}» borrada`, error: "No se pudo borrar la tarea fija", run: () => action.act(() => del(`/standing-orders/${o.id}`)) })} style={{ width: "36px", height: "36px", display: "grid", placeItems: "center", background: "transparent", border: 0, borderRadius: "var(--r-md)", cursor: "pointer", color: "var(--c-text-3)" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" /></svg></button>
          </div>
        </div>
      )))}
      {!orders.length && editing === null ? <p style={{ margin: 0, fontSize: "var(--t-ui)", lineHeight: "1.5", color: "var(--c-text-3)" }}>{`Aún no tiene tareas fijas. Por ejemplo: «Cada lunes a las 9, resume los correos de clientes y dime cuáles piden respuesta».`}</p> : null}

      <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingTop: "10px", borderTop: "1px solid rgb(var(--c-ink-rgb) / .06)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <span style={labelText}>Recordatorios por tema</span>
            <span style={hint}>«Cuando se hable de X, recuérdame Y». Te avisa y lo deja anotado en la sala.</span>
          </span>
          {!addingIntent ? <button type="button" onClick={() => setAddingIntent(true)} style={{ ...ghost, flex: "none" }}>Añadir</button> : null}
        </div>
        {addingIntent ? <IntentForm bot={bot} onDone={() => setAddingIntent(false)} /> : null}
        {reminders.map((i) => {
          const spent = !i.active && i.hits >= i.maxHits;
          const expired = i.expiresAt && Date.parse(i.expiresAt) <= Date.now();
          return (
            <div key={i.id} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "56px", padding: "8px 0", borderTop: "1px solid rgb(var(--c-ink-rgb) / .06)" }}>
              <span style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                  {i.keywords.map((k) => <span key={k} style={{ padding: "2px 8px", background: "var(--c-accent-soft)", border: "1px solid #B4C8FF", borderRadius: "var(--r-md)", fontSize: "var(--t-caption)", fontWeight: "600" }}>{k}</span>)}
                </span>
                <span style={{ fontSize: "var(--t-ui)", lineHeight: "1.4" }}>{i.remind}</span>
                <span style={hint}>{[`${i.hits} de ${i.maxHits} avisos`, i.expiresAt ? (expired ? "caducado" : `hasta el ${day(i.expiresAt)}`) : null, spent ? "agotado" : null].filter(Boolean).join(" · ")}</span>
              </span>
              <Switch on={i.active && !expired} label={`Recordatorio ${i.keywords.join(", ")}`} disabled={action.busy || expired} onClick={() => action.act(() => patch(`/intents/${i.id}`, { active: !i.active }))} />
              <button type="button" aria-label="Borrar este recordatorio" disabled={action.busy} onClick={() => later({ id: "intent:" + i.id, keys: ["intent:" + i.id], text: "Recordatorio borrado", error: "No se pudo borrar el recordatorio", run: () => action.act(() => del(`/intents/${i.id}`)) })} style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", background: "transparent", border: 0, borderRadius: "var(--r-md)", cursor: "pointer", color: "var(--c-text-3)" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" /></svg></button>
            </div>
          );
        })}
        {!reminders.length && !addingIntent ? <p style={{ margin: 0, fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>Sin recordatorios por tema.</p> : null}
      </div>
      {action.error ? <Notice>{action.error}</Notice> : null}
    </section>
  );
}
