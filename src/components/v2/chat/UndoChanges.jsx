import { useEffect, useId, useRef, useState } from "react";
import { Check, FilePen, FilePlus2, FileX2, Undo2, X } from "../../Icon.js";
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
      <span role="status" style={{ ...chip, cursor: "default", background: "transparent", color: "var(--c-text-3)", animation: "fade .3s ease-out" }}>
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
        <span style={{ fontWeight: 500, color: "var(--c-text-3)" }}>{"· " + (cp.total ? plural(cp.total, "archivo", "archivos") : changesSummary(cp))}</span>
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
      style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "22px", background: "var(--c-card)", borderRadius: "var(--r-2xl)", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 20px 44px -26px rgba(18,19,26,.32)", animation: "rise .3s ease-out" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <h3 id={titleId} style={{ flex: 1, margin: 0, font: "600 var(--t-title)/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{`Deshacer lo que hizo ${name}`}</h3>
        <button type="button" className="rm-focus" onClick={close} disabled={waiting} aria-label="Cerrar" style={{ ...iconButton, opacity: waiting ? 0.4 : 1 }}>
          <X size={16} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>
      {later > 0 ? (
        <div role="radiogroup" aria-label="Qué deshacer" style={{ alignSelf: "flex-start", display: "flex", gap: "4px", padding: "4px", borderRadius: "var(--r-pill)", background: "rgb(var(--c-ink-rgb) / .06)" }}>
          {[["turn", "Solo esta respuesta"], ["point", "Volver a este punto"]].map(([value, label], i) => (
            <button key={value} ref={i === 0 ? first : null} type="button" role="radio" aria-checked={mode === value ? "true" : "false"} disabled={waiting} onClick={() => setMode(value)}
              style={{ height: "34px", padding: "0 14px", border: 0, borderRadius: "var(--r-pill)", background: mode === value ? "var(--c-card)" : "transparent", boxShadow: mode === value ? "0 1px 2px rgba(18,19,26,.1)" : "none", cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: 600, color: mode === value ? "var(--c-text)" : "var(--c-text-2)", transition: "background .15s ease" }}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <p style={{ margin: 0, fontSize: "var(--t-body)", lineHeight: "1.55", color: "var(--c-text-2)" }}>
        {mode === "point"
          ? `Los archivos vuelven a como estaban antes de esta respuesta. También se deshace lo que ${later === 1 ? "cambió la respuesta siguiente" : `cambiaron las ${later} respuestas siguientes`}.`
          : "Estos archivos vuelven a como estaban antes de esta respuesta."}
      </p>
      {!plan && !error ? <span style={shimmerText}>{"Mirando los archivos…"}</span> : null}
      {plan && !files.length ? <span style={{ fontSize: "var(--t-body)", color: "var(--c-text-2)" }}>{"Ya está todo como antes de esta respuesta: no hay nada que deshacer."}</span> : null}
      {files.length ? (
        <ul aria-label="Archivos" style={{ listStyle: "none", margin: 0, padding: "6px", display: "flex", flexDirection: "column", gap: "2px", maxHeight: "260px", overflowY: "auto", borderRadius: "var(--r-xl)", background: "var(--c-hover)", animation: "fade .25s ease-out" }}>
          {files.map((f) => {
            const Icon = ICON[f.change] || FilePen;
            return (
              <li key={(f.folder || "") + "/" + f.path} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "38px", padding: "6px 10px", borderRadius: "var(--r-md)" }}>
                <Icon size={16} strokeWidth={2} aria-hidden="true" style={{ flex: "none", color: "var(--c-text-2)" }} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span title={f.path} style={{ font: "500 var(--t-meta)/1.35 'Geist Mono', monospace", color: "var(--c-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</span>
                  {f.folder || f.later ? (
                    <span style={{ fontSize: "var(--t-caption)", color: f.later ? "var(--c-error)" : "var(--c-text-3)" }}>
                      {[f.folder ? `en «${f.folder}»` : null, f.later ? (mode === "point" ? "cambió fuera de estas respuestas; ese cambio también se pierde" : "cambió después; ese cambio también se pierde") : null].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                </span>
                <span style={{ flex: "none", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{BACK[f.change] || "vuelve a como estaba"}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {lost.length ? <span style={{ fontSize: "var(--t-ui)", lineHeight: "1.5", color: "var(--c-error)" }}>{plural(lost.length, "archivo cambió", "archivos cambiaron") + (mode === "point" ? " fuera de estas respuestas (lo cambiaste tú u otro chat): al volver a este punto, " : " después de esta respuesta: al deshacer, ") + (lost.length === 1 ? "ese cambio se pierde." : "esos cambios se pierden.")}</span> : null}
      {plan?.deliverables?.length ? <span style={{ fontSize: "var(--t-ui)", lineHeight: "1.5", color: "var(--c-text-2)" }}>{libraryLine(plan.deliverables, files)}</span> : null}
      {plan?.skipped?.length ? (
        <span style={{ fontSize: "var(--t-ui)", lineHeight: "1.5", color: "var(--c-text-2)" }}>
          {[...new Set(plan.skipped.map((s) => (s.folder ? `«${s.folder}»` : "la carpeta del chat")))].join(", ") + ": no se guardó un punto de restauración (demasiado grande o no se pudo leer), así que sus archivos se quedan como están."}
        </span>
      ) : null}
      <span style={{ fontSize: "var(--t-meta)", lineHeight: "1.5", color: "var(--c-text-3)" }}>{plan?.outside || "Solo vuelven atrás los archivos de este ordenador: lo que salió fuera (correos, eventos, mensajes, cambios en tus apps) no se deshace."}</span>
      {busy ? <span role="status" style={{ fontSize: "var(--t-ui)", fontWeight: 500, color: "var(--c-text-2)" }}>{busy}</span> : null}
      {waiting ? (
        <Countdown id={undoKey} text={mode === "point" ? "Vuelve a este punto en" : "Se deshace en"} onUndo={() => cancel(undoKey)} />
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
          <button type="button" ref={later > 0 ? null : first} onClick={restore} disabled={!files.length || !!busy}
            style={{ height: "44px", padding: "0 20px", border: 0, borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", cursor: !files.length || busy ? "default" : "pointer", opacity: !files.length || busy ? 0.4 : 1, fontSize: "var(--t-ui)", fontWeight: 600 }}>
            {files.length ? `${action} · ${plural(files.length, "archivo", "archivos")}` : action}
          </button>
          <button type="button" onClick={close} style={{ height: "44px", padding: "0 20px", border: 0, borderRadius: "var(--r-pill)", background: "rgb(var(--c-ink-rgb) / .06)", cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: 600, color: "var(--c-text)" }}>{"Cancelar"}</button>
        </div>
      )}
      {error ? <span role="alert" style={{ fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{error}</span> : null}
    </section>
  );
}

function Countdown({ id, text, onUndo }) {
  const { secs, fraction } = useUndoable(id);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", animation: "fade .3s ease-out" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <span role="status" style={{ fontSize: "var(--t-body)", fontWeight: 500 }}>{`${text} ${secs} s`}</span>
        <button type="button" onClick={onUndo} style={{ height: "40px", padding: "0 18px", border: 0, borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: 600 }}>{"No, déjalo"}</button>
      </div>
      <span style={{ height: "4px", borderRadius: "var(--r-xs)", background: "rgb(var(--c-ink-rgb) / .08)", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", background: "#12131A", transition: "width .25s linear", width: Math.round(fraction * 100) + "%" }} />
      </span>
    </div>
  );
}

const chip = { alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "6px", minHeight: "30px", padding: "5px 12px 5px 10px", border: 0, borderRadius: "var(--r-lg)", background: "rgb(var(--c-ink-rgb) / .05)", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text-2)", textAlign: "left" };
const iconButton = { width: "32px", height: "32px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-circle)", background: "rgb(var(--c-ink-rgb) / .06)", cursor: "pointer", color: "var(--c-text-2)" };
const shimmerText = { alignSelf: "flex-start", fontSize: "var(--t-body)", fontWeight: 500, background: "linear-gradient(90deg, #6B6F7A 0%, #6B6F7A 35%, #12131A 50%, #6B6F7A 65%, #6B6F7A 100%)", backgroundSize: "200% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "shimmer 2.2s linear infinite" };
