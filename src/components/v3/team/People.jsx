import Select from "../../Select.jsx";
import { useState } from "react";
import { ShieldCheck } from "../../Icon.js";
import { useAction } from "../../../lib/store.jsx";
import { del, patch, post } from "../../../lib/api.js";
import { later, useHidden } from "../../../lib/undoToast.js";
import { statusText } from "../../../lib/peers.js";
import { ago } from "../../../lib/format.js";
import { AcceptSheet, InviteSheet } from "../../v2/people/InviteSheets.jsx";
import { HELP_URL, INTRO_STEPS } from "../../v2/people/PeopleIntro.jsx";
import { Segmented } from "../../v2/settings/rows.jsx";
import { More } from "./parts.jsx";
import { C } from "../../../lib/theme.js";

// Equipo › Personas (design/V3Equipo.dc.html): people with their own Colmena. One row each
// (initials, a status dot, rooms in common, «Chatear»), the invitations not yet accepted
// («Reenviar» makes a new code), the dark «Invitar con un código» card and «Tu estado para
// los demás». A row opens what Ajustes › Personas showed: the safety words and what their bot
// may ask you. The mailbox and errand tools stay in Ajustes › Personas.
const UNDO_MS = 10000;
const ASKS = [
  ["libre", "Cuándo estás libre", "Solo libre u ocupado: nunca títulos, lugares ni personas.", [["pregunta", "Pregúntame"], ["siempre", "Siempre"], ["nunca", "Nunca"]]],
  ["bots", "Hablar con tus bots", "En conversaciones que compartís. Tus bots no usan tus cuentas por lo que pida.", [["mencion", "Si los menciona"], ["nunca", "Nunca"]]],
  ["archivos", "Ver tus archivos", "Solo los que compartas tú en una conversación.", [["pregunta", "Pregúntame"], ["nunca", "Nunca"]]],
  ["encargos", "Encargos a tus bots", "Su bot pide algo a uno de los tuyos y este lo hace con sus herramientas.", [["pregunta", "Pregúntame"], ["siempre", "Siempre"], ["nunca", "Nunca"]]],
];
const initialsOf = (name) => String(name || "?").trim().split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const first = (name) => String(name || "").split(" ")[0];
const sinceText = (iso) => {
  const a = ago(iso);
  if (!a) return "hace poco";
  if (a === "ahora") return "ahora mismo";
  const d = /^hace (\d+) d$/.exec(a);
  return d ? (d[1] === "1" ? "ayer" : `hace ${d[1]} días`) : a;
};

// «Tu estado»: the modes of server/peers (available, dnd, away) with the usual «until» choices.
const atHour = (h, addDays = 0) => { const d = new Date(); d.setDate(d.getDate() + addDays); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const nextMonday = () => { const d = new Date(); d.setHours(9, 0, 0, 0); d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7)); return d.toISOString(); };
const STATUS = [
  ["available", "Disponible", () => ({ mode: "available", until: null })],
  ["dnd-1h", "No molestar durante 1 hora", () => ({ mode: "dnd", until: new Date(Date.now() + 3600e3).toISOString() })],
  ["dnd-18", "No molestar hasta las 18:00", () => ({ mode: "dnd", until: atHour(18, new Date().getHours() >= 18 ? 1 : 0) })],
  ["dnd", "No molestar hasta que lo quite", () => ({ mode: "dnd", until: null })],
  ["away-1", "Fuera hasta mañana", () => ({ mode: "away", until: atHour(9, 1) })],
  ["away-mon", "Fuera hasta el lunes", () => ({ mode: "away", until: nextMonday() })],
  ["away", "Fuera hasta que lo quite", () => ({ mode: "away", until: null })],
];

function Avatar({ ini, dot, dashed = false }) {
  return (
    <span aria-hidden="true" style={{ position: "relative", flex: "none", width: "38px", height: "38px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", boxSizing: "border-box", background: "var(--c-chip)", fontSize: "var(--t-caption)", fontWeight: "600", border: dashed ? "1.5px dashed var(--c-text-4)" : "0" }}>
      {ini}
      <span style={{ position: "absolute", right: "-1px", bottom: "-1px", width: "11px", height: "11px", borderRadius: "var(--r-circle)", background: dot, boxShadow: dot === "transparent" ? "none" : "0 0 0 2px var(--c-cut)" }} />
    </span>
  );
}
const ctaStyle = { height: "32px", padding: "0 12px", display: "inline-flex", alignItems: "center", border: "1px solid rgb(var(--c-ink-rgb) / .14)", borderRadius: "var(--r-sm)", background: "var(--c-card)", color: "var(--c-text)", fontSize: "var(--t-ui)", fontWeight: "500", cursor: "pointer" };

export default function EquipoPeople({ peers }) {
  const act = useAction();
  const hiddenPeer = useHidden("peer");
  const hiddenInvite = useHidden("invite");
  const [sheet, setSheet] = useState(null); // { kind: "invitar" | "aceptar", name }
  const [open, setOpen] = useState(null);
  const relayOff = peers?.relay?.status === "off";
  const contacts = (peers?.contacts || []).filter((c) => !hiddenPeer(c.id));
  const invites = (peers?.invites || []).filter((i) => !hiddenInvite(i.id));
  const shares = peers?.shares || [];
  const rooms = (c) => shares.filter((s) => s.kind !== "dm" && !s.left && s.members?.some((m) => m.id === c.id)).length;
  const remove = (c) => later({ id: "peer:" + c.id, keys: ["peer:" + c.id], ms: UNDO_MS, text: `Has dejado de hablar con ${first(c.name)}`, error: "No se pudo quitar", run: () => del(`/peers/contacts/${encodeURIComponent(c.id)}`) });
  const cancel = (inv) => later({ id: "invite:" + inv.id, keys: ["invite:" + inv.id], ms: UNDO_MS, text: "Invitación cancelada", error: "No se pudo cancelar", run: () => del(`/peers/invites/${encodeURIComponent(inv.id)}`) });
  const row = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", minHeight: "64px", padding: "10px 18px", borderTop: "1px solid rgb(var(--c-ink-rgb) / .05)" };
  return (
    <section aria-labelledby="ppl-t" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "12px" }}>
        <h2 id="ppl-t" style={{ margin: "0", font: "600 var(--t-read)/1.3 'Geist', sans-serif" }}>{"Personas"}</h2>
        <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{"Gente con su propia Colmena. Chateáis cifrado y vuestros bots pueden colaborar."}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", alignItems: "flex-start" }}>
        <div style={{ flex: "999 1 480px", minWidth: "0", display: "flex", flexDirection: "column", borderRadius: "var(--r-lg)", background: "var(--c-card)", border: "1px solid var(--c-line)", overflow: "hidden" }}>
          {!peers?.me ? <div style={{ ...row, borderTop: "0", color: "var(--c-text-3)", fontSize: "var(--t-ui)" }}>{"Preparando «Personas»: Colmena está creando las claves de este ordenador…"}</div> : null}
          {peers?.me && !contacts.length && !invites.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "20px 22px" }}>
              <span style={{ fontSize: "var(--t-body)", fontWeight: "600" }}>{"Aún no hablas con nadie desde Colmena"}</span>
              {INTRO_STEPS.map(([Icon, title, text]) => (
                <span key={title} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                  <span aria-hidden="true" style={{ width: "32px", height: "32px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-md)", background: "var(--c-chip)" }}><Icon size={15} strokeWidth={2} /></span>
                  <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}><span style={{ fontSize: "var(--t-ui)", fontWeight: "600" }}>{title}</span><span style={{ fontSize: "var(--t-meta)", lineHeight: "1.45", color: "var(--c-text-3)" }}>{text}</span></span>
                </span>
              ))}
              <a href={HELP_URL} style={{ fontSize: "var(--t-ui)", fontWeight: "600", color: "var(--c-accent-ink)" }}>{"Cómo funciona"}</a>
            </div>
          ) : null}
          {contacts.map((c, i) => {
            const isOpen = open === c.id;
            const n = rooms(c);
            const note = c.status === "pending" ? "Aún no ha abierto Colmena desde que aceptaste" : c.status === "known" ? "Os conocéis por una conversación" : [c.verifiedAt ? "Palabras comprobadas" : "Palabras sin comprobar", n ? `${n} ${n === 1 ? "sala" : "salas"} en común` : null].filter(Boolean).join(" · ");
            const status = c.away ? statusText(c.away) : c.online ? "En línea" : c.status === "pending" ? "Esperando" : c.lastSeenAt ? cap(sinceText(c.lastSeenAt)) : "En su Colmena";
            const dot = c.online && !c.away ? "var(--c-ok)" : c.status === "pending" ? "transparent" : C.lineStrong;
            return (
              <div key={c.id} id={c.id} style={{ borderTop: i ? "1px solid rgb(var(--c-ink-rgb) / .05)" : "0" }}>
                <div style={{ ...row, borderTop: "0" }}>
                  <button type="button" aria-expanded={isOpen ? "true" : "false"} onClick={() => setOpen(isOpen ? null : c.id)} style={{ flex: "1 1 260px", minWidth: "0", display: "flex", alignItems: "center", gap: "14px", padding: "0", border: "0", background: "transparent", textAlign: "left", cursor: "pointer" }}>
                    <Avatar ini={c.initials || initialsOf(c.name)} dot={dot} dashed={c.status === "pending"} />
                    <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "2px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "var(--t-body)", fontWeight: "600" }}>{c.name}{c.verifiedAt ? <ShieldCheck size={14} strokeWidth={2.2} color={C.ok} aria-label="Palabras comprobadas" /> : null}</span>
                      <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{note}</span>
                    </span>
                  </button>
                  <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-2)" }}>{status}</span>
                  {c.dm ? <a href={`/con/${encodeURIComponent(c.dm)}`} style={ctaStyle}>{"Chatear"}</a> : c.status === "known" ? <button type="button" disabled={relayOff} onClick={() => setSheet({ kind: "invitar", name: c.name })} style={ctaStyle}>{"Invitar"}</button> : null}
                </div>
                {isOpen ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "2px 18px 20px 70px", animation: "rise .2s ease-out" }}>
                    {c.words?.length ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "14px 16px", borderRadius: "var(--r-lg)", background: "var(--c-hover)" }}>
                        <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{`Vuestras palabras de seguridad. ${first(c.name)} tiene que ver las mismas:`}</span>
                        <strong style={{ font: "600 var(--t-title)/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.01em" }}>{c.words.join(" · ")}</strong>
                        <button type="button" disabled={act.busy} onClick={() => act.act(() => patch(`/peers/contacts/${encodeURIComponent(c.id)}`, { verified: !c.verifiedAt }))} style={{ ...ctaStyle, alignSelf: "flex-start", background: c.verifiedAt ? "var(--c-card)" : "var(--c-btn)", color: c.verifiedAt ? "var(--c-text)" : "var(--c-btn-text)", border: c.verifiedAt ? ctaStyle.border : "0", fontWeight: "600" }}>{c.verifiedAt ? "Comprobadas · deshacer" : "Las hemos comprobado"}</button>
                      </div>
                    ) : null}
                    {c.status !== "known" ? <span style={{ fontSize: "var(--t-meta)", fontWeight: "600", color: "var(--c-text-2)" }}>{"Lo que puede pedirte su bot"}</span> : null}
                    {c.status !== "known" ? ASKS.map(([key, title, sub, items]) => (
                      <div key={key} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px" }}>
                        <span style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: "2px" }}><span style={{ fontSize: "var(--t-body)", fontWeight: "500" }}>{title}</span><span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{sub}</span></span>
                        <span style={{ flex: "0 1 300px" }}><Segmented label={title} items={items} value={c.asks?.[key]} busy={act.busy} onPick={(v) => act.act(() => patch(`/peers/contacts/${encodeURIComponent(c.id)}`, { asks: { [key]: v } }))} /></span>
                      </div>
                    )) : null}
                    <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{"Enviar, comprar, publicar o pagar por algo que pida otra persona o su bot siempre te pregunta, aunque digas «Siempre»."}</span>
                    <button type="button" onClick={() => remove(c)} style={{ alignSelf: "flex-start", height: "32px", padding: "0", border: "0", background: "transparent", color: "var(--c-error)", fontSize: "var(--t-ui)", cursor: "pointer" }}>{"Dejar de hablar con " + first(c.name)}</button>
                  </div>
                ) : null}
              </div>
            );
          })}
          {invites.map((inv, i) => (
            <div key={inv.id} style={{ ...row, borderTop: contacts.length || i ? row.borderTop : "0" }}>
              <Avatar ini={initialsOf(inv.name)} dot="transparent" dashed />
              <span style={{ flex: "1 1 200px", minWidth: "0", display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "var(--t-body)", fontWeight: "600" }}>{inv.name}</span>
                <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{"Invitación enviada " + sinceText(inv.createdAt)}</span>
              </span>
              <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-2)" }}>{"Esperando"}</span>
              <button type="button" disabled={relayOff} onClick={() => setSheet({ kind: "invitar", name: inv.name })} style={ctaStyle}>{"Reenviar"}</button>
              <More label={`Más sobre la invitación a ${inv.name}`} items={[{ label: "Cancelar la invitación", run: () => cancel(inv), danger: true }]} />
            </div>
          ))}
        </div>
        <aside style={{ flex: "1 1 280px", minWidth: "0", display: "flex", flexDirection: "column", gap: "12px" }}>
          <InviteCard disabled={!peers?.me || relayOff} onAccept={() => setSheet({ kind: "aceptar" })} />
          {peers?.me ? <StatusCard status={peers.me.status} act={act} /> : null}
          <a href="/ajustes/contactos#buzon" style={{ padding: "0 6px", fontSize: "var(--t-ui)", color: "var(--c-accent-ink)" }}>{"El buzón y los encargos de otras personas, en Ajustes"}</a>
          {act.error ? <p role="alert" style={{ margin: "0", fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{act.error}</p> : null}
        </aside>
      </div>
      {sheet?.kind === "invitar" ? <InviteSheet initialName={sheet.name || ""} onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === "aceptar" ? <AcceptSheet onClose={() => setSheet(null)} /> : null}
    </section>
  );
}
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// «Invitar con un código»: Colmena never sends it; you copy it and send it yourself.
function InviteCard({ disabled, onAccept }) {
  const [name, setName] = useState("");
  const [made, setMade] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const make = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setError(null);
    try { setMade(await post("/peers/invites", { name: name.trim() })); setCopied(false); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(made.text); setCopied(true); } catch { setError("No se pudo copiar. Selecciona el código y cópialo tú."); }
  };
  const white = { height: "36px", border: "1px solid var(--c-btn)", borderRadius: "var(--r-sm)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-ui)", fontWeight: "600", cursor: "pointer" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px 18px", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)", color: "var(--c-text)" }}>
      <h3 style={{ margin: "0", fontSize: "var(--t-body)", fontWeight: "600" }}>{"Invitar con un código"}</h3>
      <p style={{ margin: "0", fontSize: "var(--t-meta)", lineHeight: "1.5", color: C.text3 }}>{"Le mandas un código de un solo uso. Al aceptarlo, los dos veréis las mismas cuatro palabras: así sabéis que sois vosotros."}</p>
      {made ? (
        <>
          <span style={{ padding: "10px 12px", borderRadius: "var(--r-md)", background: "var(--c-sunken)", border: "1px solid var(--c-line)", font: "500 var(--t-ui)/1.3 'Geist Mono', monospace", letterSpacing: ".04em", userSelect: "all", overflowWrap: "anywhere" }}>{made.code}</span>
          <span style={{ fontSize: "var(--t-meta)", color: C.text3 }}>{`Para ${made.name || name}. Caduca en 24 horas.`}</span>
          <button type="button" onClick={copy} style={white}>{copied ? "Copiada" : "Copiar invitación"}</button>
          <button type="button" onClick={() => { setMade(null); setName(""); }} style={{ height: "30px", border: "0", background: "transparent", color: C.text3, fontSize: "var(--t-meta)", cursor: "pointer" }}>{"Invitar a otra persona"}</button>
        </>
      ) : (
        <>
          <label style={{ display: "flex" }}>
            <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Nombre de la persona"}</span>
            <input className="c-quiet" type="text" value={name} maxLength={80} disabled={disabled} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") make(); }} placeholder="¿Cómo se llama?" style={{ flex: "1", minWidth: "0", height: "36px", padding: "0 10px", border: "1px solid var(--c-line-strong)", borderRadius: "var(--r-sm)", background: "var(--c-card)", color: C.text, fontSize: "var(--t-ui)" }} />
          </label>
          <button type="button" disabled={disabled || !name.trim() || busy} onClick={make} style={{ ...white, opacity: disabled || !name.trim() ? 0.6 : 1 }}>{busy ? "Creando…" : "Crear la invitación"}</button>
        </>
      )}
      <button type="button" disabled={disabled} onClick={onAccept} style={{ height: "30px", border: "0", background: "transparent", color: C.accentInk, fontSize: "var(--t-meta)", fontWeight: "500", cursor: "pointer" }}>{"Tengo una invitación"}</button>
      {error ? <span role="alert" style={{ fontSize: "var(--t-meta)", color: C.error }}>{error}</span> : null}
    </div>
  );
}

function StatusCard({ status, act }) {
  const mode = status?.mode || "available";
  const current = mode === "available" ? "available" : "now";
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "16px 18px", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)", fontSize: "var(--t-ui)", fontWeight: "600" }}>
      {"Tu estado para los demás"}
      <Select label="Tu estado para los demás" value={current} disabled={act.busy} onChange={(e) => { const s = STATUS.find((x) => x[0] === e.target.value); if (s) act.act(() => patch("/peers/status", s[2]())); }} style={{ height: "40px", padding: "0 12px", border: "1px solid rgb(var(--c-ink-rgb) / .14)", borderRadius: "var(--r-md)", background: "var(--c-card)", fontSize: "var(--t-ui)", fontWeight: "400" }} options={[...(mode !== "available" ? [["now", statusText(status)]] : []), ...STATUS]} />
      <span style={{ fontSize: "var(--t-meta)", fontWeight: "400", color: "var(--c-text-3)" }}>{mode === "available" ? "Lo ven las personas con las que hablas." : "Mientras tanto no te salta ni te suena ningún aviso."}</span>
    </label>
  );
}
