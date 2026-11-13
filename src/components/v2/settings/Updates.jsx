import { useEffect, useState } from "react";
import { updates, useUpdates } from "../../../lib/updates.js";
import { runDiagnostics, useDiagnostics } from "./Diagnostics.jsx";
import { Pills, Row, anchorOf, btn } from "./v3.jsx";

// Ajustes › Actualizaciones: the version you have, a new one when it is there (downloaded by the
// desktop app, installed when you restart or when the team finishes), its notes, and the channel.
// Outside the desktop app there is nothing to update, and it says so.

const hm = (iso) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
function updateLine(u) {
  if (u.status === "checking") return "Buscando una versión nueva…";
  if (u.status === "downloading") return `Descargando la ${u.version}… ${u.percent || 0} %`;
  if (u.status === "ready") return u.waiting ? `La ${u.version} se instalará cuando el equipo termine lo que está haciendo.` : `La ${u.version} está lista. Se instala al reiniciar Colmena; tus chats y tus bots siguen igual.`;
  if (u.status === "error") return u.error || "No se pudo buscar la versión nueva.";
  return u.checkedAt ? "Estás al día · comprobado a las " + hm(u.checkedAt) : "Estás al día.";
}

export default function UpdatesSection() {
  const u = useUpdates();
  const { result } = useDiagnostics();
  const [notes, setNotes] = useState(false);
  // Outside the desktop app the version comes from the local service (a read-only check).
  useEffect(() => { if (!updates && !result) runDiagnostics(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const version = u?.current || /Colmena (\S+)/.exec(result?.checks?.find((c) => c.id === "server:version")?.text || "")?.[1] || "—";
  const busy = u && (u.status === "checking" || u.status === "downloading");
  return (
    <section aria-label="Versión" style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-md)", background: "var(--c-card)", border: "1px solid var(--c-line)", overflow: "hidden" }}>
      <Row first anchor="version" title={`Colmena ${version}`} sub={u ? updateLine(u) : "Las actualizaciones las descarga e instala la app de escritorio. Aquí, en el navegador, no hay nada que actualizar."} subColor={u?.status === "error" ? "var(--c-error)" : u?.status === "ready" ? "var(--c-ok-ink)" : undefined} strong min="76px">
        <span {...anchorOf("actualizaciones")} style={{ display: "inline-flex", gap: "8px", scrollMarginTop: "24px" }}>
          {!u ? null
            : u.status === "ready" && !u.waiting ? <button type="button" onClick={() => updates.restart()} style={btn("dark", 40)}>Reiniciar y actualizar</button>
            : u.status === "error" && u.manual ? <button type="button" onClick={() => updates.download()} style={btn("dark", 40)}>Descargarla a mano</button>
            : u.status === "ready" ? null
            : <button type="button" disabled={busy || !u.supported} title={u.supported ? undefined : "Esta instalación no se actualiza sola"} onClick={() => updates.check()} style={btn("outline", 40)}>{busy ? "Buscando…" : "Buscar ahora"}</button>}
        </span>
      </Row>
      {u?.notes && u.version ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "0 22px 16px" }}>
          <button type="button" aria-expanded={notes} onClick={() => setNotes(!notes)} style={{ ...btn("ghost", 32), alignSelf: "flex-start", padding: 0, color: "var(--c-text)" }}>{(notes ? "Ocultar" : "Ver") + " las novedades de la " + u.version}</button>
          {notes ? <p style={{ margin: 0, fontSize: "var(--t-ui)", lineHeight: 1.55, color: "var(--c-text-2)", whiteSpace: "pre-wrap", animation: "fade .25s ease-out" }}>{u.notes}</p> : null}
        </div>
      ) : null}
      {u ? (
        <Row anchor="canal" title="Canal" sub={u.channel === "beta" ? "Beta: las novedades llegan antes y pueden traer algún fallo." : "Estable: solo versiones ya probadas."} min="68px">
          <Pills label="Canal de actualizaciones" items={[["stable", "Estable"], ["beta", "Beta"]]} value={u.channel === "beta" ? "beta" : "stable"} onPick={(c) => c !== (u.channel === "beta" ? "beta" : "stable") && updates.setChannel(c)} />
        </Row>
      ) : null}
    </section>
  );
}
