import { useEffect, useState } from "react";
import { Cpu, SquareTerminal, Server, CornerDownRight } from "lucide-react";
import { get, post } from "../../../lib/api.js";
import { C, MONO } from "./parts.jsx";
import { leftoverPids, uptime } from "./panels.js";

// «Procesos» (DeepSeek Harness background processes): what runs for this task — Bruno's engine,
// your terminals and what they started, the servers with their port, and what Bruno left running.
// Looked at every few seconds while the tab is open (nothing when it is closed). «Parar» stops
// that process and what hangs from it; the server checks the PID is this task's.

const EVERY = 4000;

const KIND = {
  engine: { icon: Cpu, text: (r, name) => name + " · " + (r.label || "motor") },
  terminal: { icon: SquareTerminal, text: (r) => "Terminal · " + (r.label || "Terminal") },
  family: { icon: Server, text: (_r, name) => "Lo arrancó " + name },
  server: { icon: Server, text: () => "Servidor en la carpeta de la tarea" },
  child: { icon: CornerDownRight, text: () => null },
};

const pill = { height: "28px", padding: "0 12px", flex: "none", display: "inline-flex", alignItems: "center", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", background: C.white, color: C.ink, cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 500, whiteSpace: "nowrap" };

function Row({ row, name, busy, onStop }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return undefined; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  const kind = KIND[row.kind] || KIND.child;
  const Icon = kind.icon;
  const label = kind.text(row, name);
  // Bruno's engine and your shells ask twice: stopping them ends his work or your terminal.
  const careful = row.depth === 0 && (row.kind === "engine" || row.kind === "terminal");
  const stop = () => { if (careful && !armed) { setArmed(true); return; } setArmed(false); onStop(row); };
  const age = uptime(row.started);
  return (
    <div role="listitem" className="code-hover" style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "52px", padding: "8px 12px 8px " + (12 + Math.min(row.depth, 6) * 18) + "px", borderTop: "1px solid " + C.rule }}>
      <Icon size={15} strokeWidth={2} aria-hidden="true" style={{ flex: "none", color: row.depth ? C.quiet : C.muted }} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: "8px", minWidth: 0 }}>
          <strong style={{ flex: "none", fontSize: "var(--t-ui)", fontWeight: 600, color: C.ink }}>{row.name || "proceso"}</strong>
          {label ? <span style={{ minWidth: 0, fontSize: "var(--t-meta)", color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span> : null}
          {row.ports.map((p) => <span key={p} style={{ flex: "none", font: `500 var(--t-caption)/1 ${MONO}`, color: C.blue }} title={"Escucha en http://127.0.0.1:" + p + "/"}>:{p}</span>)}
        </span>
        <span title={row.command} style={{ font: `400 var(--t-caption)/1.3 ${MONO}`, color: C.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.command || "—"}</span>
      </span>
      <span style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", font: `400 var(--t-caption)/1 ${MONO}`, color: C.quiet }}>
        <span>PID {row.pid}</span>
        {age ? <span title={new Date(row.started).toLocaleString("es-ES")}>{age}</span> : null}
      </span>
      <button type="button" onClick={stop} disabled={busy} aria-label={armed ? "Pulsa otra vez para parar " + (row.name || "el proceso") : "Parar " + (row.name || "el proceso") + " (PID " + row.pid + ")"}
        title={armed ? (row.kind === "engine" ? "Pulsa otra vez: " + name + " deja lo que está haciendo" : "Pulsa otra vez: se cierra la terminal (su historial se queda)") : "Para este proceso y lo que arrancó"}
        style={{ ...pill, ...(armed ? { background: C.ink, color: C.white, borderColor: C.ink } : {}), opacity: busy ? 0.5 : 1, cursor: busy ? "default" : "pointer" }}>
        {armed ? "¿Parar?" : "Parar"}
      </button>
    </div>
  );
}

export default function Processes({ task, name = "Bruno" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!task) return undefined;
    let alive = true, timer = null;
    const look = () => get("/code/tasks/" + task.id + "/processes")
      .then((d) => { if (alive) { setData(d); setError(null); } }, (e) => alive && setError(e.message))
      .finally(() => { if (alive) timer = setTimeout(look, EVERY); });
    look();
    return () => { alive = false; clearTimeout(timer); };
  }, [task?.id, tick]);
  const rows = data?.processes || [];
  const leftovers = leftoverPids(rows);
  const act = async (key, fn) => {
    setBusy(key); setError(null);
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(null); setTick((t) => t + 1); }
  };
  const stop = (row) => act(row.pid, () => post("/code/tasks/" + task.id + "/processes/" + row.pid + "/stop", {}));
  const stopAll = () => act("all", () => post("/code/tasks/" + task.id + "/processes/stop-all", {}));
  const working = !!data?.working || !!task?.running;
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: "12px", animation: "fade .25s ease-out" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "32px" }}>
        <span style={{ flex: 1, fontSize: "var(--t-meta)", color: C.muted }}>
          {!data ? "Mirando qué hay en marcha…" : rows.length ? (rows.length === 1 ? "1 proceso en marcha" : rows.length + " procesos en marcha") + (rows.some((r) => r.ports.length) ? " · los puertos se ven en «Vista previa»" : "") : null}
        </span>
        {!working && leftovers.length ? (
          <button type="button" onClick={stopAll} disabled={!!busy} title={"Para los servidores y lo que quedó en segundo plano (" + name + " y tus terminales siguen abiertos)"} style={{ ...pill, height: "32px", opacity: busy ? 0.5 : 1 }}>
            {busy === "all" ? "Parando…" : "Parar todo"}
          </button>
        ) : null}
      </div>
      {error ? <p role="alert" onClick={() => setError(null)} style={{ margin: 0, fontSize: "var(--t-meta)", color: C.red }}>{error}</p> : null}
      {data && !rows.length ? (
        <div style={{ padding: "48px 28px", textAlign: "center", display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
          <strong style={{ fontSize: "var(--t-body)" }}>No hay nada en marcha para esta tarea.</strong>
          <span style={{ fontSize: "var(--t-meta)", color: C.faint, maxWidth: "320px", lineHeight: 1.5 }}>Aquí verás lo que arranquen {name} o tus terminales: servidores, tests y procesos en segundo plano.</span>
        </div>
      ) : null}
      {rows.length ? (
        <div role="list" aria-label="Procesos de la tarea" style={{ borderRadius: "14px", background: C.white, border: "1px solid rgba(18,19,26,.08)", overflow: "hidden" }}>
          {rows.map((row, k) => <div key={row.pid} style={k ? undefined : { marginTop: "-1px" }}><Row row={row} name={name} busy={!!busy} onStop={stop} /></div>)}
        </div>
      ) : null}
    </div>
  );
}
