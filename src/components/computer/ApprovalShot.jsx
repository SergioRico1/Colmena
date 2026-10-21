import { useEffect, useRef, useState } from "react";
import { get } from "../../lib/api.js";

// Capture + field list for a computer approval card (design/Bandeja.dc.html language).
// Renders nothing when the approval has no computer data.

const mono = "'Geist Mono', monospace";

function Field({ label, value }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(90px, 34%) 1fr", gap: "10px", padding: "7px 0", borderTop: "1px solid #E6E8EE", fontSize: "13px" }}>
      <span style={{ color: "#4A4F5C", overflowWrap: "anywhere" }}>{label}</span>
      <span style={{ fontFamily: mono, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{value === "" ? <span style={{ color: "#9DA2B0" }}>(vacío)</span> : value}</span>
    </div>
  );
}

function Zoom({ src, alt, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    // No close() on cleanup: it fires «close» (→ onClose) on StrictMode's re-run; removing
    // the element from the page closes it anyway.
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label="Captura ampliada"
      style={{ padding: 0, border: "2px solid #12131A", borderRadius: "16px", boxShadow: "8px 8px 0 #FFC93C", maxWidth: "min(1280px, 94vw)", background: "#12131A" }}
    >
      <img loading="lazy" decoding="async" src={src} alt={alt} style={{ display: "block", maxWidth: "100%", maxHeight: "86vh" }} />
      <form method="dialog" style={{ display: "flex", justifyContent: "flex-end", padding: "10px", background: "#FFFFFF" }}>
        <button type="submit" style={{ height: "40px", padding: "0 14px", background: "#12131A", color: "#FFFFFF", border: 0, borderRadius: "10px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>Cerrar</button>
      </form>
    </dialog>
  );
}

/** @param {{approvalId: string}} props */
export default function ApprovalShot({ approvalId }) {
  const [info, setInfo] = useState(null);
  const [zoom, setZoom] = useState(false);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let alive = true;
    setInfo(null);
    setBroken(false);
    if (!approvalId) return undefined;
    get("/computer/approval/" + encodeURIComponent(approvalId))
      .then((data) => alive && setInfo(data))
      .catch(() => alive && setInfo(null));
    return () => {
      alive = false;
    };
  }, [approvalId]);

  if (!info) return null;
  const src = "/api/computer/shot/" + encodeURIComponent(approvalId);
  const alt = "Captura de " + (info.domain || "la página") + (info.title ? " · " + info.title : "");
  const fields = info.fields || [];

  return (
    <section aria-label="Detalles de la acción en el ordenador" style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
      {info.domain || info.redLine ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
          {info.domain ? (
            <span style={{ display: "inline-flex", alignItems: "center", height: "26px", padding: "0 10px", background: info.redLine ? "#FFF1EE" : "#EEF0F4", color: info.redLine ? "#B4372A" : "#12131A", borderRadius: "13px", fontSize: "12px", fontWeight: 600 }}>
              {info.redLine ? "Dominio externo · " : ""}{info.domain}
            </span>
          ) : null}
          {info.button ? <span style={{ fontSize: "12px", color: "#4A4F5C" }}>Botón: «{info.button}»</span> : null}
        </div>
      ) : null}

      {info.hasShot && !broken ? (
        <button
          type="button"
          onClick={() => setZoom(true)}
          aria-label="Ver la captura en grande"
          style={{ padding: 0, border: "1px solid #DCE0E8", borderRadius: "14px", overflow: "hidden", background: "#12131A", cursor: "zoom-in", maxWidth: "520px", display: "block" }}
        >
          <img loading="lazy" decoding="async" src={src} alt={alt} onError={() => setBroken(true)} style={{ display: "block", width: "100%", height: "auto" }} />
        </button>
      ) : null}

      {fields.length ? (
        <div style={{ border: "1px solid #DCE0E8", borderRadius: "14px", padding: "4px 14px 6px", background: "#FFFFFF", maxWidth: "520px" }}>
          <div style={{ padding: "8px 0 4px", font: "600 11px/1 " + mono, letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}>
            {fields.length === 1 ? "1 campo" : fields.length + " campos"}
          </div>
          {fields.map((f, i) => <Field key={i} label={f.label} value={f.value} />)}
        </div>
      ) : null}

      {info.line ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxWidth: "620px" }}>
          <pre style={{ margin: 0, padding: "12px 14px", background: "#12131A", color: "#E6E8EE", borderRadius: "14px", font: "400 13px/1.6 " + mono, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{info.line}</pre>
          <span style={{ fontSize: "12px", color: "#4A4F5C" }}>
            En {info.folder || "la carpeta de la misión"}
            {info.resolvedProgram ? <> · <span style={{ fontFamily: mono }}>{info.resolvedProgram}</span></> : null}
          </span>
          {info.danger ? <span style={{ fontSize: "13px", color: "#B4372A", fontWeight: 600 }}>{info.danger}</span> : null}
        </div>
      ) : null}

      {info.file ? <span style={{ fontSize: "13px" }}>Archivo: <span style={{ fontFamily: mono }}>{info.file}</span>{info.folder ? " · " + info.folder : ""}</span> : null}
      {info.app ? <span style={{ fontSize: "13px" }}>Aplicación: <strong>{info.app}</strong></span> : null}

      {zoom ? <Zoom src={src} alt={alt} onClose={() => setZoom(false)} /> : null}
    </section>
  );
}
