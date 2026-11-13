import { useEffect, useState } from "react";
import { Globe, Plus, SignIn } from "../../Icon.js";
import { useAction, useResource } from "../../../lib/store.jsx";
import { del, get, post } from "../../../lib/api.js";
import { Alert, Chip, Confirm, LINE, anchorOf, btn, danger, field, h3 } from "./v3.jsx";
import { Chevron } from "./rows.jsx";

// Ajustes › Navegador y dictado › «Sesiones del navegador» (server/computer/sessions.mjs): each
// session keeps its own signed-in accounts (its own Electron partition). «Principal» is the one
// every bot used before. You sign in by hand once in a session's window and the bots that use
// it stay signed in. Sessions never leave this computer.

function SessionRow({ s, first, available }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(null); // "clear" | "delete"
  const [sites, setSites] = useState(null);
  const { act, busy, error } = useAction();
  const loadSites = () => get(`/browser-sessions/${s.id}/sites`).then((d) => setSites(d.domains || []), () => setSites([]));
  useEffect(() => { if (open && available) loadSites(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const who = s.bots.length ? s.bots.map((b) => b.name).join(", ") : "Ningún bot";
  return (
    <div style={{ borderTop: first ? 0 : LINE }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={{ width: "100%", display: "flex", alignItems: "center", gap: "14px", minHeight: "64px", padding: "10px 22px", border: 0, background: "transparent", textAlign: "left", color: "var(--c-text)", cursor: "pointer" }}>
        <span aria-hidden="true" style={{ width: "32px", height: "32px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", background: "var(--c-chip)", color: "var(--c-text-2)" }}><Globe size={17} /></span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-body)", fontWeight: 500 }}>{s.name}{s.principal ? <Chip tone="grey">Por defecto</Chip> : null}</span>
          <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)", overflowWrap: "anywhere" }}>{"La usan: " + who}</span>
        </span>
        <Chevron open={open} />
      </button>
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "0 22px 16px 68px", animation: "fade .2s ease-out" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={{ fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text-2)" }}>Webs con la sesión abierta</span>
            {!available ? <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>Se ve en la app de escritorio.</span>
              : sites === null ? <span role="status" style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>Mirando…</span>
              : sites.length ? <span style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>{sites.map((d) => <Chip key={d} tone="grey">{d}</Chip>)}</span>
              : <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>Ninguna todavía.</span>}
          </div>
          <span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button type="button" disabled={!available || busy} title={available ? undefined : "Solo en la app de escritorio"} onClick={() => act(() => post(`/browser-sessions/${s.id}/open`, {}))} style={btn("dark", 34)}><SignIn size={15} aria-hidden="true" />Iniciar sesión a mano</button>
            <button type="button" disabled={!available || busy} onClick={() => setAsking("clear")} style={btn("outline", 34)}>Cerrar todas las sesiones…</button>
            {!s.principal ? <button type="button" disabled={busy} onClick={() => setAsking("delete")} style={danger(34)}>Borrar sesión…</button> : null}
          </span>
          <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.45, color: "var(--c-text-3)" }}>Se abre una ventana de esta sesión: entra en la web con tu usuario y pulsa «Listo». Los bots que la usan ya no tendrán que pedírtelo.</span>
          {asking === "clear" ? (
            <Confirm title={`¿Cerrar todas las sesiones de «${s.name}»?`} action="Cerrar las sesiones" busy={busy} onCancel={() => setAsking(null)}
              onConfirm={() => act(async () => { await post(`/browser-sessions/${s.id}/clear`, {}); setAsking(null); loadSites(); })}>
              Se borran sus cookies y datos de las webs. {who === "Ningún bot" ? "" : `${who} tendrá${s.bots.length === 1 ? "" : "n"} que volver a entrar en cada web.`} Tus contraseñas guardadas no se tocan.
            </Confirm>
          ) : null}
          {asking === "delete" ? (
            <Confirm title={`¿Borrar la sesión «${s.name}»?`} action="Borrar la sesión" busy={busy} onCancel={() => setAsking(null)}
              onConfirm={() => act(async () => { await del(`/browser-sessions/${s.id}`); setAsking(null); })}>
              Se cierran sus sesiones abiertas y {s.bots.length ? `${who} vuelve${s.bots.length === 1 ? "" : "n"} a la sesión Principal` : "ningún bot la usa"}. No se puede deshacer.
            </Confirm>
          ) : null}
          <Alert>{error}</Alert>
        </div>
      ) : null}
    </div>
  );
}

export default function SessionsCard() {
  const { data } = useResource("/browser-sessions");
  const [name, setName] = useState("");
  const { act, busy, error } = useAction();
  const sessions = data?.sessions || [];
  const available = !!data?.available;
  const create = (e) => {
    e.preventDefault();
    act(async () => { await post("/browser-sessions", { name }); setName(""); });
  };
  return (
    <section {...anchorOf("sesiones")} aria-labelledby="ses-t" style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)", overflow: "hidden", scrollMarginTop: "24px" }}>
      <span style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "18px 22px 10px" }}>
        <h3 id="ses-t" style={h3}>Sesiones del navegador</h3>
        <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.45, color: "var(--c-text-3)" }}>Cada sesión guarda sus propias cuentas abiertas, como perfiles de un navegador: «Trabajo», «Personal», un cliente. Cada bot usa la suya; elígela en su ficha. Las sesiones se quedan en este ordenador: nunca se comparten con tu equipo.</span>
      </span>
      {sessions.map((s, i) => <SessionRow key={s.id} s={s} first={i === 0} available={available} />)}
      <form onSubmit={create} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", padding: "12px 22px 16px", borderTop: LINE }}>
        <input aria-label="Nombre de la sesión nueva" placeholder="Nombre de una sesión nueva (por ejemplo, Cliente Acme)" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} style={{ ...field, flex: "1 1 260px", width: "auto" }} />
        <button type="submit" disabled={busy || !name.trim()} style={{ ...btn("outline", 34), opacity: busy || !name.trim() ? 0.6 : 1 }}><Plus size={15} aria-hidden="true" />Crear sesión</button>
        <span style={{ flexBasis: "100%" }}><Alert>{error}</Alert></span>
      </form>
    </section>
  );
}
