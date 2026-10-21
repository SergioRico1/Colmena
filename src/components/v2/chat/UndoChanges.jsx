import { useEffect, useId, useRef, useState } from "react";
import { Check, FilePen, FilePlus2, FileX2, Undo2, X } from "lucide-react";
import { get, post } from "../../../lib/api.js";
import { cancel, schedule, useUndoable } from "../../../lib/undoable.js";
import { changesSummary, libraryLine, plural } from "../../../lib/undo.js";

// «Deshacer cambios» (server/checkpoints.mjs): under the answer of a turn that changed files,
// one quiet pill. It opens a short view of what that turn created, edited and deleted, and
// puts it back — that turn alone, or «Volver a este punto» with every later answer. As every
// decision in Colmena it waits ten seconds with «No, déjalo» before it happens.
const ICON = { created: FilePlus2, edited: FilePen, deleted: FileX2 };
const BACK = { created: "se borra", edited: "vuelve a como estaba", deleted: "vuelve a estar" };

export default function UndoChanges({ cp, missionId, bot, working = false, later = 0 }) {
  const [open, setOpen] = useState(false);
  const [doneAt, setDoneAt] = useState(null); // shown at once, before the chat refreshes
  const key = "restore:" + cp.id;
  const { waiting } = useUndoable(key);
  const name = bot?.name || "el bot";
  const restoredAt = cp.restoredAt || doneAt;
  if (restoredAt && !waiting) {
    const at = new Date(restoredAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    return (
      <span role="status" style={{ ...chip, cursor: "default", background: "transparent", color: "#6B6F7A", animation: "fade .3s ease-out" }}>
        <Check size={14} strokeWidth={2.4} aria-hidden="true" style={{ flex: "none", color: "#0B8A5F" }} />
        {`Cambios deshechos a las ${at}`}
      </span>
    );
  }
  if (!open && !waiting)
    return (
      <button type="button" className="rm-focus" onClick={() => setOpen(true)} aria-haspopup="dialog"
        title={`Ver los archivos que cambió ${name} y deshacerlo`} style={chip}>
        <Undo2 size={14} strokeWidth={2.4} aria-hidden="true" style={{ flex: "none" }} />
        <span>{"Deshacer cambios"}</span>
        <span style={{ fontWeight: 500, color: "#6B6F7A" }}>{"· " + (cp.total ? plural(cp.total, "archivo", "archivos") : changesSummary(cp))}</span>
      </button>
    );
  return <UndoSheet cp={cp} missionId={missionId} name={name} working={working} later={later} onClose={(done) => { setOpen(false); if (done) setDoneAt(new Date().toISOString()); }} undoKey={key} />;
}

function UndoSheet({ cp, missionId, name, working, later, onClose, undoKey }) {
  const [mode, setMode] = useState("turn");
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const { waiting } = useUndoable(undoKey);
  const titleId = useId();
  const first = useRef(null);
  useEffect(() => {
    let live = true;
    setPlan(null);
    setError(null);
    get(`/missions/${encodeURIComponent(missionId)}/checkpoints/${encodeURIComponent(cp.id)}?modo=${mode === "point" ? "punto" : "turno"}`)
      .then((p) => { if (live) setPlan(p); }, (e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [missionId, cp.id, mode, working]);
  useEffect(() => { first.current?.focus(); }, []);
  const close = () => { if (!waiting) onClose(false); };
  const busy = working ? `${name} está trabajando en este chat. Espera a que acabe para deshacer cambios.` : plan?.busy || null;
  const files = plan?.files || [];
  const lost = files.filter((f) => f.later);
  const restore = () => {
    setError(null);
    schedule(undoKey, async () => {
      try {
        await post(`/missions/${encodeURIComponent(missionId)}/checkpoints/${encodeURIComponent(cp.id)}/restore`, { mode });
        onClose(true);
      } catch (e) {
        setError(e.message);
      }
    });
  };
  const action = mode === "point" ? "Volver a este punto" : "Deshacer cambios";
  return (
    <section role="dialog" aria-labelledby={titleId} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}
      style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "22px", background: "#FFFFFF", borderRadius: "24px", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 20px 44px -26px rgba(18,19,26,.32)", animation: "rise .3s ease-out" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <h3 id={titleId} style={{ flex: 1, margin: 0, font: "600 20px/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{`Deshacer lo que hizo ${name}`}</h3>
        <button type="button" className="rm-focus" onClick={close} disabled={waiting} aria-label="Cerrar" style={{ ...iconButton, opacity: waiting ? 0.4 : 1 }}>
          <X size={16} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>
      {later > 0 ? (
        <div role="radiogroup" aria-label="Qué deshacer" style={{ alignSelf: "flex-start", display: "flex", gap: "4px", padding: "4px", borderRadius: "999px", background: "rgba(18,19,26,.06)" }}>
          {[["turn", "Solo esta respuesta"], ["point", "Volver a este punto"]].map(([value, label], i) => (
            <button key={value} ref={i === 0 ? first : null} type="button" role="radio" aria-checked={mode === value ? "true" : "false"} disabled={waiting} onClick={() => setMode(value)}
              style={{ height: "34px", padding: "0 14px", border: 0, borderRadius: "999px", background: mode === value ? "#FFFFFF" : "transparent", boxShadow: mode === value ? "0 1px 2px rgba(18,19,26,.1)" : "none", cursor: "pointer", fontSize: "14px", fontWeight: 600, color: mode === value ? "#12131A" : "#4A4F5C", transition: "background .15s ease" }}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <p style={{ margin: 0, fontSize: "15px", lineHeight: "1.55", color: "#3D404A" }}>
        {mode === "point"
          ? `Los archivos vuelven a como estaban antes de esta respuesta. También se deshace lo que ${later === 1 ? "cambió la respuesta siguiente" : `cambiaron las ${later} respuestas siguientes`}.`
          : "Estos archivos vuelven a como estaban antes de esta respuesta."}
      </p>
      {!plan && !error ? <span style={shimmerText}>{"Mirando los archivos…"}</span> : null}
      {plan && !files.length ? <span style={{ fontSize: "15px", color: "#3D404A" }}>{"Ya está todo como antes de esta respuesta: no hay nada que deshacer."}</span> : null}
      {files.length ? (
        <ul aria-label="Archivos" style={{ listStyle: "none", margin: 0, padding: "6px", display: "flex", flexDirection: "column", gap: "2px", maxHeight: "260px", overflowY: "auto", borderRadius: "18px", background: "#F6F6F3", animation: "fade .25s ease-out" }}>
          {files.map((f) => {
            const Icon = ICON[f.change] || FilePen;
            return (
              <li key={(f.folder || "") + "/" + f.path} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "38px", padding: "6px 10px", borderRadius: "12px" }}>
                <Icon size={16} strokeWidth={2} aria-hidden="true" style={{ flex: "none", color: "#4A4F5C" }} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span title={f.path} style={{ font: "500 13px/1.35 'Geist Mono', monospace", color: "#12131A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</span>
                  {f.folder || f.later ? (
                    <span style={{ fontSize: "12px", color: f.later ? "#B4372A" : "#6B6F7A" }}>
                      {[f.folder ? `en «${f.folder}»` : null, f.later ? (mode === "point" ? "cambió fuera de estas respuestas; ese cambio también se pierde" : "cambió después; ese cambio también se pierde") : null].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                </span>
                <span style={{ flex: "none", fontSize: "13px", color: "#6B6F7A" }}>{BACK[f.change] || "vuelve a como estaba"}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {lost.length ? <span style={{ fontSize: "14px", lineHeight: "1.5", color: "#B4372A" }}>{plural(lost.length, "archivo cambió", "archivos cambiaron") + (mode === "point" ? " fuera de estas respuestas (lo cambiaste tú u otro chat): al volver a este punto, " : " después de esta respuesta: al deshacer, ") + (lost.length === 1 ? "ese cambio se pierde." : "esos cambios se pierden.")}</span> : null}
      {plan?.deliverables?.length ? <span style={{ fontSize: "14px", lineHeight: "1.5", color: "#3D404A" }}>{libraryLine(plan.deliverables, files)}</span> : null}
      {plan?.skipped?.length ? (
        <span style={{ fontSize: "14px", lineHeight: "1.5", color: "#3D404A" }}>
          {[...new Set(plan.skipped.map((s) => (s.folder ? `«${s.folder}»` : "la carpeta del chat")))].join(", ") + ": no se guardó un punto de restauración (demasiado grande o no se pudo leer), así que sus archivos se quedan como están."}
        </span>
      ) : null}
      <span style={{ fontSize: "13px", lineHeight: "1.5", color: "#6B6F7A" }}>{plan?.outside || "Solo vuelven atrás los archivos de este ordenador: lo que salió fuera (correos, eventos, mensajes, cambios en tus apps) no se deshace."}</span>
      {busy ? <span role="status" style={{ fontSize: "14px", fontWeight: 500, color: "#3D404A" }}>{busy}</span> : null}
      {waiting ? (
        <Countdown id={undoKey} text={mode === "point" ? "Vuelve a este punto en" : "Se deshace en"} onUndo={() => cancel(undoKey)} />
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
          <button type="button" ref={later > 0 ? null : first} onClick={restore} disabled={!files.length || !!busy}
            style={{ height: "44px", padding: "0 20px", border: 0, borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: !files.length || busy ? "default" : "pointer", opacity: !files.length || busy ? 0.4 : 1, fontSize: "14px", fontWeight: 600 }}>
            {files.length ? `${action} · ${plural(files.length, "archivo", "archivos")}` : action}
          </button>
          <button type="button" onClick={close} style={{ height: "44px", padding: "0 20px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "14px", fontWeight: 600, color: "#12131A" }}>{"Cancelar"}</button>
        </div>
      )}
      {error ? <span role="alert" style={{ fontSize: "14px", color: "#B4372A" }}>{error}</span> : null}
    </section>
  );
}

function Countdown({ id, text, onUndo }) {
  const { secs, fraction } = useUndoable(id);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", animation: "fade .3s ease-out" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <span role="status" style={{ fontSize: "15px", fontWeight: 500 }}>{`${text} ${secs} s`}</span>
        <button type="button" onClick={onUndo} style={{ height: "40px", padding: "0 18px", border: 0, borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>{"No, déjalo"}</button>
      </div>
      <span style={{ height: "4px", borderRadius: "2px", background: "rgba(18,19,26,.08)", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", background: "#12131A", transition: "width .25s linear", width: Math.round(fraction * 100) + "%" }} />
      </span>
    </div>
  );
}

const chip = { alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "6px", minHeight: "30px", padding: "5px 12px 5px 10px", border: 0, borderRadius: "16px", background: "rgba(18,19,26,.05)", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#3D404A", textAlign: "left" };
const iconButton = { width: "32px", height: "32px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "rgba(18,19,26,.06)", cursor: "pointer", color: "#3D404A" };
const shimmerText = { alignSelf: "flex-start", fontSize: "15px", fontWeight: 500, background: "linear-gradient(90deg, #8A8D96 0%, #8A8D96 35%, #12131A 50%, #8A8D96 65%, #8A8D96 100%)", backgroundSize: "200% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "shimmer 2.2s linear infinite" };
