import { useState } from "react";
import { Calendar, Check, Lock, ShieldAlert } from "../../Icon.js";
import { get, post } from "../../../lib/api.js";
import { PeerAvatar } from "./PeerAvatar.jsx";

// The meeting being agreed in a conversation (design/V2Personas.dc.html, paso sala/pide;
// server/peers/meetings.mjs): who has looked at their calendar (only free or busy), the
// proposed slots, who said yes, and once everyone agrees, that it is in your calendar.
const INK = "#12131A";
const dayName = (iso) => new Date(iso).toLocaleDateString("es-ES", { weekday: "long", day: "numeric" }).replace(/^./, (c) => c.toUpperCase());
const shortDay = (iso) => new Date(iso).toLocaleDateString("es-ES", { weekday: "short", day: "numeric" }).replace(".", "");
const hhmm = (iso) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const range = (s) => `${hhmm(s.s)} – ${hhmm(s.e)}`;
const lastDay = (to) => new Date(Date.parse(to) - 1000).toISOString();
const NOTE = { shared: "solo libre u ocupado", waiting: "esperando…", declined: "no la comparte", nocal: "sin calendario conectado" };

export default function MeetingCard({ meeting: m, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  if (!m) return <div style={{ padding: "16px 18px", borderRadius: "var(--r-xl)", background: "var(--c-card)", color: "var(--c-text-3)", fontSize: "var(--t-ui)" }}>{"Preparando la reunión…"}</div>;
  const act = async (path, body = {}) => {
    setBusy(true);
    setError(null);
    try { onChange?.(await post(`/peers/meetings/${encodeURIComponent(m.id)}/${path}`, body)); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const look = async () => {
    try { setPreview(await get(`/peers/meetings/${encodeURIComponent(m.id)}/preview`)); } catch (e) { setError(e.message); }
  };
  const asking = !m.mine && m.ask === "pending";
  const voting = m.status === "voting";
  const others = m.people.filter((p) => !p.me);
  const yes = m.people.filter((p) => p.vote !== null && p.vote >= 0 && p.vote === m.myVote);
  const organizer = m.organizerName.split(" ")[0];
  const botName = m.bot?.name ? `${m.bot.name}${m.mine ? "" : ", el bot de " + organizer + ","}` : organizer;
  const steps = m.people.map((p) => ({ key: p.id, text: p.me ? "Tu agenda" : "La de " + p.name.split(" ")[0], note: NOTE[p.answer] || NOTE.waiting, done: p.answer !== "waiting", warn: p.answer === "declined" || p.answer === "nocal" }));
  const highlight = voting && m.myVote === null || asking;
  return (
    <div role="group" aria-label={m.title} style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "20px 22px 22px", borderRadius: "var(--r-2xl)", background: "var(--c-card)", boxShadow: highlight ? "0 10px 0 -4px #FFC93C" : "0 1px 2px rgba(18,19,26,.05), 0 10px 26px -16px rgba(18,19,26,.2)", border: highlight ? "1.5px solid " + INK : 0, animation: "rise .35s ease-out", maxWidth: "640px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <span aria-hidden="true" style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-md)", background: "var(--c-sunken)" }}><Calendar size={19} strokeWidth={2} /></span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
          <strong style={{ font: "600 var(--t-title)/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.01em" }}>{m.title}</strong>
          <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{`${m.minutes} minutos · del ${shortDay(m.from)} al ${shortDay(lastDay(m.to))} · de ${m.dayStart} a ${m.dayEnd}`}</span>
        </span>
        {m.mine && ["asking", "voting"].includes(m.status) ? <button type="button" disabled={busy} onClick={() => act("cancel")} style={{ height: "34px", padding: "0 12px", border: 0, borderRadius: "var(--r-pill)", background: "transparent", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text-3)" }}>{"Cancelar"}</button> : null}
      </div>

      {asking ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <span style={{ fontSize: "var(--t-body)", lineHeight: 1.5 }}>{`¿Le dejas a ${botName} ver cuándo estás libre del ${shortDay(m.from)} al ${shortDay(lastDay(m.to))}, de ${m.dayStart} a ${m.dayEnd}?`}</span>
          {preview ? <BusyPreview data={preview} /> : <button type="button" onClick={look} style={{ alignSelf: "flex-start", height: "34px", padding: "0 14px", border: 0, borderRadius: "var(--r-pill)", background: "rgb(var(--c-ink-rgb) / .05)", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600 }}>{"Ver lo que verá"}</button>}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <button type="button" disabled={busy} onClick={() => act("share")} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "50px", padding: "0 20px", border: 0, borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", cursor: "pointer", fontSize: "var(--t-body)", fontWeight: 600 }}>{"Sí, solo libre u ocupado"}<span style={{ fontSize: "var(--t-caption)", fontWeight: 600, color: "#FFC93C" }}>{"Recomendado"}</span></button>
            <button type="button" disabled={busy} onClick={() => act("share", { always: true })} style={{ height: "46px", padding: "0 20px", border: 0, borderRadius: "var(--r-pill)", background: "rgb(var(--c-ink-rgb) / .06)", cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: 600, textAlign: "left" }}>{`Sí, y no me preguntes más para ${organizer}`}</button>
            <button type="button" disabled={busy} onClick={() => act("decline")} style={{ height: "44px", padding: "0 20px", border: 0, borderRadius: "var(--r-pill)", background: "transparent", cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: 600, color: "var(--c-text-3)", textAlign: "left" }}>{"Ahora no"}</button>
          </div>
        </div>
      ) : (
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "10px" }}>
          {steps.map((s) => (
            <li key={s.key} style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "var(--t-body)", color: s.done ? "var(--c-text)" : "var(--c-text-3)" }}>
              <span aria-hidden="true" style={{ width: "22px", height: "22px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: s.done ? (s.warn ? "#C9CBD1" : "#1E9E6A") : "transparent", boxShadow: s.done ? "none" : "inset 0 0 0 1.5px rgba(18,19,26,.25)" }}>
                {s.done ? <Check size={11} strokeWidth={3.4} color="#FFFFFF" /> : null}
              </span>
              <span style={{ flex: 1 }}>{s.text}</span>
              <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{s.note}</span>
            </li>
          ))}
        </ol>
      )}

      {voting ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingTop: "14px", borderTop: "1px solid rgb(var(--c-ink-rgb) / .07)" }}>
          <span style={{ fontSize: "var(--t-ui)", fontWeight: 600 }}>{m.myVote === null ? `Elige uno: ${others.length === 1 ? others[0].name.split(" ")[0] + " también tiene" : "los demás también tienen"} que decir que sí.` : m.myVote === -1 ? "Has dicho que ninguno te va." : `Respondiste: ${dayName(m.slots[m.myVote].s)}, ${range(m.slots[m.myVote])}`}</span>
          <div role="radiogroup" aria-label="Huecos" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {m.slots.map((s, i) => {
              const on = m.myVote === i;
              const count = m.people.filter((p) => p.vote === i).length;
              return (
                <button key={s.s} type="button" role="radio" aria-checked={on ? "true" : "false"} disabled={busy} onClick={() => act("vote", { slot: i })} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "3px", minWidth: "150px", padding: "12px 16px", border: 0, borderRadius: "var(--r-xl)", cursor: "pointer", textAlign: "left", background: on ? "var(--c-btn)" : "var(--c-sunken)", color: on ? "var(--c-btn-text)" : "var(--c-text)", boxShadow: on ? "0 10px 24px -12px rgba(18,19,26,.6)" : "none" }}>
                  <strong style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>{dayName(s.s)}</strong>
                  <span style={{ fontSize: "var(--t-meta)", opacity: 0.8 }}>{range(s)}{count ? ` · ${count} sí` : ""}</span>
                  {s.calm ? <span style={{ marginTop: "4px", fontSize: "var(--t-caption)", fontWeight: 600, color: on ? "#FFC93C" : "var(--c-honey-text)" }}>{"Recomendado · el más tranquilo para todos"}</span> : null}
                </button>
              );
            })}
          </div>
          {m.myVote !== null && m.myVote >= 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={{ fontSize: "var(--t-ui)", fontWeight: 600 }}>{`${yes.length} de ${m.people.length} habéis dicho que sí`}</span>
              {m.people.map((p) => (
                <span key={p.id} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "var(--t-body)" }}>
                  <PeerAvatar person={p.me ? { me: true } : p} size={26} />
                  <span style={{ flex: 1 }}>{p.name}</span>
                  {p.vote === m.myVote ? <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-ok-ink)" }}><Check size={13} strokeWidth={3} aria-hidden="true" />{"Sí"}</span>
                    : p.vote === null ? <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{"esperando…"}</span>
                      : <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{p.vote === -1 ? "ninguno le va" : "prefiere otro"}</span>}
                </span>
              ))}
            </div>
          ) : null}
          <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.45, color: "var(--c-text-3)" }}>{"Si alguien dice que no, os propongo los siguientes huecos que van bien a todos."}</span>
          {m.myVote !== -1 ? <button type="button" disabled={busy} onClick={() => act("vote", { slot: -1 })} style={{ alignSelf: "flex-start", height: "34px", padding: "0 12px", border: 0, borderRadius: "var(--r-pill)", background: "transparent", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text-3)" }}>{"Ninguno me va"}</button> : null}
        </div>
      ) : null}

      {m.status === "confirmed" && m.confirmed ? (
        <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "14px 16px", borderRadius: "var(--r-xl)", background: "var(--c-ok-soft)", animation: "develop .5s ease-out" }}>
          <span aria-hidden="true" style={{ width: "30px", height: "30px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: "#1E9E6A" }}><Check size={14} strokeWidth={3.2} color="#FFFFFF" /></span>
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
            <strong style={{ fontSize: "var(--t-body)", fontWeight: 600, color: "var(--c-ok-ink)" }}>{`${dayName(m.confirmed.s)}, ${range(m.confirmed)} · lo habéis confirmado ${m.people.length === 2 ? "los dos" : m.people.length === 3 ? "los tres" : "todos"}`}</strong>
            <span style={{ fontSize: "var(--t-meta)", color: "#2F5F4B" }}>{m.created?.status === "done" ? "Está en tu calendario. Nadie ha enviado invitaciones por correo." : m.created?.status === "nocal" ? "Conecta Google Calendar en Ajustes › Apps para que se apunte solo." : m.created?.status === "failed" ? "No se pudo apuntar en tu calendario: " + (m.created.error || "inténtalo a mano.") : "Apuntándola en tu calendario…"}</span>
          </span>
        </div>
      ) : null}
      {m.status === "nofit" ? <span style={{ fontSize: "var(--t-body)", color: "var(--c-text-3)" }}>{"No hay ningún hueco que vaya bien a todos en esos días. Prueba con otros días u otra franja."}</span> : null}
      {m.status === "cancelled" ? <span style={{ fontSize: "var(--t-body)", color: "var(--c-text-3)" }}>{"Reunión cancelada."}</span> : null}
      {!m.mine && m.ask === "declined" && m.status === "asking" ? <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}><ShieldAlert size={15} strokeWidth={2.2} aria-hidden="true" />{"No compartes tu agenda para esta reunión."}</span> : null}

      {error ? <p role="alert" style={{ margin: 0, fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{error}</p> : null}
      <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}><Lock size={13} strokeWidth={2.2} aria-hidden="true" />{"Ninguno ve las citas del otro: solo si a esa hora está libre u ocupado."}</span>
    </div>
  );
}

/** What your Colmena would send: your busy blocks, day by day, with no titles. */
function BusyPreview({ data }) {
  if (!data.calendar) return <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{"No tienes el calendario conectado: solo dirá que no lo sabe."}</span>;
  const days = [];
  for (let d = new Date(data.from); d < new Date(data.to); d.setDate(d.getDate() + 1)) if (d.getDay() > 0 && d.getDay() < 6) days.push(new Date(d));
  const [h0] = data.dayStart.split(":").map(Number), [h1] = data.dayEnd.split(":").map(Number);
  const hours = Array.from({ length: Math.max(1, h1 - h0 + (data.dayEnd.endsWith(":00") ? 0 : 1)) }, (_, i) => h0 + i);
  const busyAt = (day, h) => data.blocks.some((b) => { const s = new Date(day); s.setHours(h, 0, 0, 0); const e = new Date(s.getTime() + 3600000); return Date.parse(b.s) < e.getTime() && Date.parse(b.e) > s.getTime(); });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={{ fontSize: "var(--t-meta)", fontWeight: 500, color: "var(--c-text-3)" }}>{"Esto es todo lo que verá"}</span>
      <div role="img" aria-label="Tus horas ocupadas, sin títulos" style={{ display: "grid", gridTemplateColumns: `34px repeat(${days.length}, 1fr)`, gap: "4px", padding: "14px", borderRadius: "var(--r-xl)", background: "var(--c-sunken)" }}>
        <span />
        {days.map((d) => <span key={d.toISOString()} style={{ textAlign: "center", fontSize: "var(--t-caption)", fontWeight: 600, color: "var(--c-text-3)" }}>{d.toLocaleDateString("es-ES", { weekday: "narrow", day: "numeric" })}</span>)}
        {hours.map((h) => [
          <span key={"h" + h} style={{ font: "500 var(--t-micro)/22px 'Geist Mono', monospace", color: "var(--c-text-3)" }}>{h}</span>,
          ...days.map((d) => <span key={d.toISOString() + h} style={{ height: "22px", borderRadius: "var(--r-sm)", background: busyAt(d, h) ? "#3D404A" : "var(--c-card)" }} />),
        ])}
      </div>
      <span style={{ display: "flex", alignItems: "center", gap: "14px", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><span aria-hidden="true" style={{ width: "12px", height: "12px", borderRadius: "var(--r-xs)", background: "#3D404A" }} />{"Ocupado"}</span>
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><span aria-hidden="true" style={{ width: "12px", height: "12px", borderRadius: "var(--r-xs)", background: "var(--c-card)", boxShadow: "inset 0 0 0 1px rgb(var(--c-ink-rgb) / .12)" }} />{"Libre"}</span>
        <span>{"Sin títulos, lugares ni personas."}</span>
      </span>
    </div>
  );
}
