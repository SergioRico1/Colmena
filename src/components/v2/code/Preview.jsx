import { useEffect, useRef, useState } from "react";
import { ExternalLink, MonitorSmartphone, RefreshCw, MessageSquarePlus, Check, CircleAlert } from "lucide-react";
import { get, post } from "../../../lib/api.js";
import { C, MONO, MenuChip, MenuItem, SHEET, timeAgo } from "./parts.jsx";
import { addContext } from "./Extras.jsx";

// «Vista previa» (T3 Code preview + port scanner): the web servers this task started are found
// on their own (every few seconds while the tab is open) and shown here, desktop or phone size.
// A page its server sends as text would show its source code: that is said, with a way to ask
// Bruno to fix it. «Anotar» (T3 Code preview annotations): mark an area, write a note, and it goes
// into your next message with a capture of that area. Below, what Bruno saw the last time he
// looked at the page himself (console errors, failed loads).

const desktop = () => (typeof window !== "undefined" ? window.colmenaWindow : null);

/** The note under a marked area: it becomes a chip with the capture. */
function NoteBox({ box, onAdd, onCancel }) {
  const [note, setNote] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) onAdd(note.trim()); }} onMouseDown={(e) => e.stopPropagation()}
      style={{ position: "absolute", left: Math.max(8, box.x) + "px", top: box.y + box.h + 8 + "px", width: "280px", zIndex: 3, padding: "10px", display: "flex", flexDirection: "column", gap: "8px", borderRadius: "16px", background: C.white, boxShadow: SHEET, animation: "rise .2s ease-out" }}>
      <textarea autoFocus rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="¿Qué cambiarías aquí?"
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (note.trim()) onAdd(note.trim()); } if (e.key === "Escape") onCancel(); }}
        style={{ border: 0, outline: "none", resize: "none", background: "transparent", fontSize: "13px", lineHeight: 1.5 }} />
      <span style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
        <button type="button" onClick={onCancel} style={{ height: "30px", padding: "0 12px", border: 0, borderRadius: "999px", background: "transparent", cursor: "pointer", fontSize: "12px", fontWeight: 600, color: C.muted }}>Cancelar</button>
        <button type="submit" disabled={!note.trim()} style={{ height: "30px", padding: "0 14px", border: 0, borderRadius: "999px", background: note.trim() ? C.ink : "rgba(18,19,26,.12)", color: C.white, cursor: note.trim() ? "pointer" : "default", fontSize: "12px", fontWeight: 600 }}>Añadir al mensaje</button>
      </span>
    </form>
  );
}

export default function Preview({ task, onAsk = null }) {
  const [ports, setPorts] = useState(null);
  const [port, setPort] = useState(null);
  const [asked, setAsked] = useState(false);
  const [reload, setReload] = useState(0);
  const [phone, setPhone] = useState(false);
  const [marking, setMarking] = useState(false);
  const [box, setBox] = useState(null); // {x, y, w, h, done}
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState(null);
  const area = useRef(null);
  const start = useRef(null);
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
  useEffect(() => { setBox(null); setMarking(false); }, [task?.id, url, phone]);
  useEffect(() => {
    if (!marking) return undefined;
    const esc = (e) => { if (e.key === "Escape" && !box?.done) { setMarking(false); setBox(null); } };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [marking, box?.done]);
  const open = () => { if (url) window.open(url, "_blank", "noopener"); };

  // Marking: drag a rectangle over the page (the page itself is another site: Colmena draws on top).
  const point = (e) => { const r = area.current.getBoundingClientRect(); return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) }; };
  const down = (e) => { if (box?.done) return; start.current = point(e); setBox({ ...start.current, w: 0, h: 0 }); };
  const move = (e) => { if (!start.current) return; const p = point(e), s = start.current; setBox({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) }); };
  const up = () => { if (!start.current) return; start.current = null; setBox((b) => (b && b.w > 8 && b.h > 8 ? { ...b, done: true } : null)); };
  const addNote = async (note) => {
    const r = area.current.getBoundingClientRect();
    let image;
    try {
      // Colmena de escritorio: a capture of just that area (without the marking on top).
      if (desktop()?.captureRect) {
        const keep = box;
        setBox(null);
        await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
        const dataUrl = await desktop().captureRect({ x: r.left + keep.x, y: r.top + keep.y, width: keep.w, height: keep.h });
        setBox(keep);
        if (dataUrl) image = (await post("/code/attachments", { name: "vista-previa.png", data: dataUrl.split(",")[1] })).attachment.path;
      }
    } catch (e) { setProblem("Sin captura: " + e.message); }
    addContext(task.id, {
      kind: "preview", label: "Vista previa · " + (note.length > 28 ? note.slice(0, 28) + "…" : note), note, url, image,
      text: `Zona marcada en ${url}: desde (${Math.round(box.x)}, ${Math.round(box.y)}), ${Math.round(box.w)}×${Math.round(box.h)} px, en una vista de ${Math.round(r.width)}×${Math.round(r.height)} px${phone ? " (tamaño móvil)" : ""}.`,
    });
    setBox(null);
    setMarking(false);
  };

  const check = task?.previewCheck;
  const look = async () => {
    setChecking(true); setProblem(null);
    try { await post("/code/tasks/" + task.id + "/preview/check", { port }); } catch (e) { setProblem(e.message); } finally { setChecking(false); }
  };
  const passErrors = () => addContext(task.id, { kind: "preview", label: "Vista previa · " + (check.loadError ? "no carga" : check.errors === 1 ? "1 error" : check.errors + " errores"), url: check.url, note: "Esto sale en la consola de la vista previa: arréglalo y vuelve a mirarla.", text: check.loadError || check.first || "" });
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
        <button type="button" onClick={() => { setMarking(!marking); setBox(null); }} disabled={!url} aria-pressed={marking} title="Marca una zona y escribe qué cambiarías: va a tu próximo mensaje con una captura"
          style={{ display: "flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 11px", border: 0, borderRadius: "999px", background: marking ? C.ink : "transparent", color: marking ? C.white : url ? C.text : C.quiet, cursor: url ? "pointer" : "default", fontSize: "12px", fontWeight: 600 }}>
          <MessageSquarePlus size={14} strokeWidth={2} aria-hidden="true" />Anotar
        </button>
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
      {marking ? <div role="status" style={{ flex: "none", padding: "8px 14px", background: C.ink, color: "#E6E7EC", fontSize: "12px" }}>Arrastra sobre la página para marcar una zona y escribe qué cambiarías. Esc para salir.</div> : null}
      <div ref={area} style={{ position: "relative", flex: 1, minHeight: 0, background: "#FAFAF8", display: "flex", justifyContent: "center" }}>
        {url ? (
          <iframe key={url + reload} src={url} title="Vista previa" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            style={{ width: phone ? "390px" : "100%", maxWidth: "100%", height: "100%", border: 0, background: C.white, boxShadow: phone ? "0 0 0 1px rgba(18,19,26,.08), 0 30px 60px -30px rgba(18,19,26,.4)" : "none", animation: "develop .6s ease-out" }} />
        ) : (
          <div style={{ alignSelf: "center", padding: "28px", maxWidth: "340px", textAlign: "center", display: "flex", flexDirection: "column", gap: "8px" }}>
            <strong style={{ fontSize: "15px" }}>{ports === null ? "Buscando servidores…" : "Aún no hay nada que ver"}</strong>
            <span style={{ fontSize: "13px", lineHeight: 1.5, color: C.faint }}>Cuando Bruno arranque la app de este proyecto, aparecerá aquí sola. También puedes pedírselo: «arráncala para que la vea».</span>
          </div>
        )}
        {marking && url ? (
          <div onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up} onKeyDown={(e) => { if (e.key === "Escape") { setMarking(false); setBox(null); } }} tabIndex={-1}
            style={{ position: "absolute", inset: 0, zIndex: 2, cursor: box?.done ? "default" : "crosshair", background: "rgba(18,19,26,.04)" }}>
            {box ? <span aria-hidden="true" style={{ position: "absolute", left: box.x + "px", top: box.y + "px", width: box.w + "px", height: box.h + "px", borderRadius: "8px", boxShadow: "0 0 0 2px #FF7A1A, 0 0 0 6px rgba(255,122,26,.18)", background: "rgba(255,122,26,.06)" }} /> : null}
            {box?.done ? <NoteBox box={box} onAdd={addNote} onCancel={() => setBox(null)} /> : null}
          </div>
        ) : null}
      </div>
      {url ? (
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: "8px", padding: "9px 12px 9px 14px", borderTop: "1px solid rgba(18,19,26,.06)", fontSize: "12px", color: check && (check.errors || check.loadError) ? C.red : check ? C.greenText : C.faint }}>
          {check ? (check.errors || check.loadError ? <CircleAlert size={13} strokeWidth={2.4} aria-hidden="true" /> : <Check size={13} strokeWidth={2.6} aria-hidden="true" />) : null}
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={check?.first || ""}>
            {problem || (!check ? "Bruno revisa la página después de cada cambio." : check.loadError ? "No cargó: " + check.loadError : check.errors ? `${check.errors === 1 ? "1 error" : check.errors + " errores"} en la consola: ${check.first || ""}` : "Consola sin errores · Bruno la revisó " + ((t) => (/min$/.test(t) ? "hace " + t : t === "ahora" ? "ahora" : "a las " + t))(timeAgo(check.at)))}
          </span>
          {check && (check.errors || check.loadError) ? <button type="button" onClick={passErrors} style={{ height: "26px", padding: "0 10px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "12px", fontWeight: 600, color: C.ink, whiteSpace: "nowrap" }}>Pasar a Bruno</button> : null}
          {desktop() ? <button type="button" onClick={look} disabled={checking} style={{ height: "26px", padding: "0 10px", border: 0, borderRadius: "999px", background: "transparent", cursor: checking ? "default" : "pointer", fontSize: "12px", fontWeight: 600, color: C.muted, whiteSpace: "nowrap" }}>{checking ? "Mirando…" : "Revisar ahora"}</button> : null}
        </div>
      ) : null}
    </div>
  );
}
