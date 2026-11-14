import { useState } from "react";
import { Clock, Plus, Repeat, ShieldCheck, Trash2, Users } from "../Icon.js";
import { MenuButton } from "../Menu.js";
import Select from "../Select.jsx";
import { useResource } from "../../lib/store.jsx";
import { del, post, put } from "../../lib/api.js";
import { ago } from "../../lib/format.js";

// A routine's red lines, under its editor (screens/RutinasV2.jsx):
//   - «Quién decide sus líneas rojas»: you, or also a person you talk to in Colmena
//     (server/peers/delegation.mjs). You can always still decide; what arrives first counts.
//   - «Aprobado por adelantado»: what it may do at its time with nobody there
//     (server/preapprovals.mjs). «Añadir» offers only what this routine asked for in past runs;
//     money never. Each entry says who it reaches or which command, «Solo la próxima vez» or
//     «Siempre» («Usada» once a next-time one was spent), how often it was used and «Quitar».

const section = { display: "flex", flexDirection: "column", gap: "14px", padding: "22px 24px", borderRadius: "var(--r-lg)", background: "var(--c-card)", border: "1px solid var(--c-line)" };
const h2 = { margin: 0, display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-body)", fontWeight: 600 };
const note = { margin: 0, fontSize: "var(--t-ui)", lineHeight: 1.5, color: "var(--c-text-2)" };
const quiet = { fontSize: "var(--t-meta)", color: "var(--c-text-3)" };
const line = { height: "34px", padding: "0 12px", display: "inline-flex", alignItems: "center", gap: "6px", border: "1px solid var(--c-line-strong)", borderRadius: "var(--r-sm)", background: "var(--c-card)", color: "var(--c-text)", fontSize: "var(--t-ui)", fontWeight: 500, cursor: "pointer" };
const chip = (on) => ({ flex: "none", height: "24px", padding: "0 10px", display: "inline-flex", alignItems: "center", gap: "5px", borderRadius: "var(--r-pill)", background: on ? "var(--c-chip)" : "transparent", border: on ? "0" : "1px solid var(--c-line)", color: on ? "var(--c-text)" : "var(--c-text-2)", fontSize: "var(--t-meta)", fontWeight: 600 });
const USES = { next: ["Solo la próxima vez", Clock], always: ["Siempre", Repeat] };
const times = (n) => (n === 1 ? "1 vez" : `${n} veces`);

export default function RoutineApprovals({ rule }) {
  const path = `/automations/${encodeURIComponent(rule.id)}/preapprovals`;
  const { data, error: loadError, setData } = useResource(path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { setData(await fn()); } catch (e) { setError(e?.message || "No se pudo guardar."); } finally { setBusy(false); }
  };
  const entries = data?.entries || [];
  const candidates = data?.candidates || [];
  const people = data?.people || [];
  const approver = data?.approver || null;
  const add = (c, uses) => run(() => post(path, { approvalId: c.approvalId, uses }));
  const addItems = () => candidates.map((c) => ({
    label: c.label, hint: c.recipients?.length ? "Para " + c.recipients.join(", ") : c.command || undefined,
    items: [
      { label: "Solo la próxima vez", icon: Clock, onSelect: () => add(c, "next") },
      { label: "Siempre", icon: Repeat, onSelect: () => add(c, "always") },
    ],
  }));
  const who = [["", "Solo tú"], ...people.map((p) => [p.id, `${p.name} y tú`]), ...(approver && !people.some((p) => p.id === approver.contactId) ? [[approver.contactId, `${approver.name} y tú (ya no habláis)`]] : [])];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px", animation: "fade .3s ease-out" }}>
      <section id="decide" aria-labelledby="decide-t" style={section}>
        <h2 id="decide-t" style={h2}><Users size={18} aria-hidden="true" />{"Quién decide sus líneas rojas"}</h2>
        <p style={note}>{"Cuando esta rutina necesite tu OK para enviar, publicar o borrar, también se lo puede pedir a alguien de tu equipo. Tú siempre puedes decidir; vale lo que llegue antes."}</p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
          <Select label="Quién decide sus líneas rojas" value={approver?.contactId || ""} disabled={busy || !data} options={who}
            onChange={(e) => run(() => put(`/automations/${encodeURIComponent(rule.id)}/approver`, { contactId: e.target.value || null }))}
            style={{ ...line, minWidth: "220px", justifyContent: "space-between" }} />
          {!people.length ? <span style={quiet}>{"Cuando hables con alguien en Personas, podrás pedirle que decida también."}</span>
            : approver ? <span style={quiet}>{`A ${approver.name} le llega lo que esté pendiente, sin claves ni contraseñas.`}</span> : null}
        </div>
      </section>

      <section id="adelantado" aria-labelledby="adelantado-t" style={section}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
          <h2 id="adelantado-t" style={{ ...h2, flex: "1 1 auto" }}><ShieldCheck size={18} aria-hidden="true" />{"Aprobado por adelantado"}</h2>
          <MenuButton label="Añadir" menuLabel="Lo que esta rutina ha pedido" disabled={busy || !candidates.length} items={addItems} style={line}
            title={candidates.length ? "Elige algo que esta rutina ya te pidió" : "Aún no ha pedido nada que se pueda aprobar por adelantado"}>
            <Plus size={15} aria-hidden="true" /><span>{"Añadir"}</span>
          </MenuButton>
        </div>
        <p style={note}>{"Lo que esta rutina puede hacer a su hora aunque no estés. Solo puedes añadir algo que ya te pidió. Pagar, comprar o mover dinero siempre te pregunta."}</p>
        {!data && !loadError ? <div style={{ height: "56px", borderRadius: "var(--r-md)", background: "var(--c-chip)", animation: "shimmer 1.6s ease-in-out infinite" }} /> : null}
        {data && !entries.length ? <p style={{ ...note, color: "var(--c-text-3)" }}>{"Nada aprobado por adelantado: cada línea roja te pregunta."}</p> : null}
        {entries.length ? (
          <ul aria-label="Aprobado por adelantado" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", borderRadius: "var(--r-md)", border: "1px solid var(--c-line)" }}>
            {entries.map((e, i) => {
              const [usesLabel, UsesIcon] = e.spent ? ["Usada", Clock] : USES[e.uses] || USES.always;
              return (
                <li key={e.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", padding: "12px 14px", borderTop: i ? "1px solid var(--c-line)" : 0 }}>
                  <span style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                    <span style={{ fontSize: "var(--t-body)", fontWeight: 500, overflowWrap: "anywhere", color: e.spent ? "var(--c-text-2)" : "var(--c-text)" }}>{e.label}</span>
                    {e.recipients?.length ? <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-2)", overflowWrap: "anywhere" }}>{"Para " + e.recipients.join(", ")}</span> : null}
                    {e.command ? <code style={{ font: "var(--t-meta)/1.5 'Geist Mono', monospace", color: "var(--c-text-2)", overflowWrap: "anywhere" }}>{e.command}</code> : null}
                    <span style={quiet}>{e.usedCount ? `Usada ${times(e.usedCount)} · la última ${ago(e.lastUsedAt)}` : "Aún no se ha usado"}</span>
                  </span>
                  <span style={chip(!e.spent)}><UsesIcon size={12} aria-hidden="true" />{usesLabel}</span>
                  <button type="button" disabled={busy} onClick={() => run(() => del(`${path}/${encodeURIComponent(e.id)}`))} aria-label={`Quitar «${e.label}»`} style={{ ...line, height: "32px" }}>
                    <Trash2 size={14} aria-hidden="true" />{"Quitar"}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {data && !candidates.length && !entries.length ? <span style={quiet}>{"Cuando esta rutina te pida algo que se pueda dejar aprobado, podrás añadirlo aquí."}</span> : null}
      </section>
      {error || loadError ? <p role="alert" style={{ margin: 0, fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{error || loadError}</p> : null}
    </div>
  );
}
