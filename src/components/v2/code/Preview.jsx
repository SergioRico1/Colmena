import { useEffect, useState } from "react";
import { ExternalLink, MonitorSmartphone, RefreshCw } from "lucide-react";
import { get } from "../../../lib/api.js";
import { C, MONO, MenuChip, MenuItem } from "./parts.jsx";

// «Vista previa» (T3 Code preview + port scanner): the web servers this task started are found
// on their own (every few seconds while the tab is open) and shown here, desktop or phone size.
// A page its server sends as text would show its source code: that is said, with a way to ask
// Bruno to fix it.

export default function Preview({ task, onAsk = null }) {
  const [ports, setPorts] = useState(null);
  const [port, setPort] = useState(null);
  const [asked, setAsked] = useState(false);
  const [reload, setReload] = useState(0);
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (!task) return undefined;
    let alive = true, timer = null;
    const scan = () => get("/code/tasks/" + task.id + "/ports").then((d) => { if (alive) setPorts(d.ports || []); }, () => alive && setPorts([])).finally(() => { if (alive) timer = setTimeout(scan, 4000); });
    scan();
    return () => { alive = false; clearTimeout(timer); };
  }, [task?.id]);
  useEffect(() => {
    if (!ports?.length) return;
    if (!port || !ports.some((p) => p.port === port)) setPort(ports[0].port);
  }, [ports]);
  const url = port ? "http://127.0.0.1:" + port + "/" : null;
  const current = ports?.find((p) => p.port === port) || null;
  useEffect(() => { if (!current?.source) setAsked(false); }, [current?.source]);
  const open = () => { if (url) window.open(url, "_blank", "noopener"); };
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", animation: "fade .25s ease-out" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", background: "#F7F7F4", borderBottom: "1px solid rgba(18,19,26,.06)" }}>
        <button type="button" onClick={() => setReload((r) => r + 1)} disabled={!url} aria-label="Recargar" title="Recargar" style={{ width: "30px", height: "30px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "transparent", cursor: url ? "pointer" : "default", color: C.muted }}><RefreshCw size={14} strokeWidth={2.2} aria-hidden="true" /></button>
        <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "8px", height: "32px", padding: "0 12px", borderRadius: "10px", background: C.white, font: `400 12.5px/1 ${MONO}`, color: url ? C.text : C.quiet, overflow: "hidden", whiteSpace: "nowrap" }}>
          <span aria-hidden="true" style={{ width: "7px", height: "7px", flex: "none", borderRadius: "50%", background: url ? C.green : "#C9CBD1" }} />{url ? url.replace("http://", "") : "Sin servidor en marcha"}
        </span>
        {ports && ports.length > 1 ? (
          <MenuChip up={false} align="right" width={240} title="Servidores de esta tarea" label={<span style={{ font: `500 12px/1 ${MONO}` }}>{ports.map((p) => p.port).join(" · ")}</span>}>
            {(close) => ports.map((p) => <MenuItem key={p.port} title={"127.0.0.1:" + p.port} text={p.name} on={p.port === port} onClick={() => { setPort(p.port); close(); }} />)}
          </MenuChip>
        ) : null}
        <button type="button" onClick={() => setPhone(!phone)} aria-pressed={phone} aria-label="Ver como en el móvil" title="Ver como en el móvil" style={{ width: "30px", height: "30px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: phone ? C.ink : "transparent", color: phone ? C.white : C.muted, cursor: "pointer" }}><MonitorSmartphone size={15} strokeWidth={2} aria-hidden="true" /></button>
        <button type="button" onClick={open} disabled={!url} aria-label="Abrir en el navegador" title="Abrir en el navegador" style={{ width: "30px", height: "30px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "transparent", color: C.muted, cursor: url ? "pointer" : "default" }}><ExternalLink size={14} strokeWidth={2} aria-hidden="true" /></button>
      </div>
      {current?.source ? (
        <div role="status" style={{ flex: "none", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px", padding: "12px 14px", background: "#FFF4D1", borderBottom: "1px solid rgba(255,201,60,.5)", fontSize: "13px", lineHeight: 1.45, color: "#5C4300" }}>
          <span style={{ flex: "1 1 220px" }}>Ves el código porque el servidor de la app envía la página como texto ({current.contentType}), no como web.</span>
          {onAsk ? (
            <button type="button" disabled={asked} onClick={() => { setAsked(true); onAsk(`La vista previa en ${url} enseña el código fuente en vez de la página: el servidor la envía con Content-Type ${current.contentType}. Arréglalo para que envíe el HTML como text/html (y CSS y JS con su tipo) y comprueba que se ve como página.`); }}
              style={{ height: "32px", padding: "0 14px", border: 0, borderRadius: "999px", background: C.ink, color: C.white, cursor: asked ? "default" : "pointer", fontSize: "13px", fontWeight: 600, opacity: asked ? 0.6 : 1 }}>
              {asked ? "Se lo has pedido" : "Pedir a Bruno que lo arregle"}
            </button>
          ) : null}
        </div>
      ) : null}
      <div style={{ position: "relative", flex: 1, minHeight: 0, background: "#FAFAF8", display: "flex", justifyContent: "center" }}>
        {url ? (
          <iframe key={url + reload} src={url} title="Vista previa" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            style={{ width: phone ? "390px" : "100%", maxWidth: "100%", height: "100%", border: 0, background: C.white, boxShadow: phone ? "0 0 0 1px rgba(18,19,26,.08), 0 30px 60px -30px rgba(18,19,26,.4)" : "none", animation: "develop .6s ease-out" }} />
        ) : (
          <div style={{ alignSelf: "center", padding: "28px", maxWidth: "340px", textAlign: "center", display: "flex", flexDirection: "column", gap: "8px" }}>
            <strong style={{ fontSize: "15px" }}>{ports === null ? "Buscando servidores…" : "Aún no hay nada que ver"}</strong>
            <span style={{ fontSize: "13px", lineHeight: 1.5, color: C.faint }}>Cuando Bruno arranque la app de este proyecto, aparecerá aquí sola. También puedes pedírselo: «arráncala para que la vea».</span>
          </div>
        )}
      </div>
    </div>
  );
}
