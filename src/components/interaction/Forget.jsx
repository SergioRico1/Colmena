import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { get, post } from "../../lib/api.js";
import { useStore } from "../../lib/store.jsx";

// «Olvidar lo aprendido aquí» (OpenClaw memory provenance): preview of the memories and
// skills born in a mission (missionId) and, after you confirm, they are removed and never
// extracted again. Dialog language of «Revisar pasos» (SkillReview).

const sr = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" };

export function ForgetDialog({ missionId, title, onClose, onDone }) {
  const { run } = useStore();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState({});
  const [done, setDone] = useState(null);
  const box = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    let alive = true;
    get(`/missions/${encodeURIComponent(missionId)}/learned`)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setPicked(Object.fromEntries([...d.memories, ...d.skills].map((x) => [x.id, true])));
      })
      .catch((e) => alive && setError(e.message));
    box.current?.focus();
    const key = (e) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", key);
    return () => {
      alive = false;
      document.removeEventListener("keydown", key);
    };
  }, [missionId]);
  const memories = data?.memories || [];
  const skills = data?.skills || [];
  const chosenMemories = memories.filter((m) => picked[m.id]).map((m) => m.id);
  const chosenSkills = skills.filter((s) => picked[s.id]).map((s) => s.id);
  const total = chosenMemories.length + chosenSkills.length;
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await run(() => post(`/missions/${encodeURIComponent(missionId)}/forget`, { memoryIds: chosenMemories, skillIds: chosenSkills }));
      setDone(result);
      onDone?.(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const row = (item, text, sub) => (
    <label key={item.id} style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: "10px", alignItems: "start", padding: "10px 12px", background: picked[item.id] ? "#FFFFFF" : "#F6F6F3", border: picked[item.id] ? "1.5px solid #12131A" : "1px solid rgba(18,19,26,.06)", borderRadius: "12px", cursor: "pointer" }}>
      <input type="checkbox" checked={!!picked[item.id]} onChange={() => setPicked((p) => ({ ...p, [item.id]: !p[item.id] }))} style={{ width: "18px", height: "18px", marginTop: "2px", accentColor: "#12131A" }} />
      <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" }}>
        <span style={{ fontSize: "14px", lineHeight: "1.45", overflowWrap: "anywhere" }}>{text}</span>
        {sub ? <span style={{ fontSize: "12px", color: "#6B6F7A" }}>{sub}</span> : null}
      </span>
    </label>
  );
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(18, 19, 26, 0.55)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "96px 16px 32px" }}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="olvidar-t" style={{ width: "min(560px, 100%)", maxHeight: "calc(100vh - 128px)", background: "#FFFFFF", border: "0", borderRadius: "20px", overflow: "hidden", display: "flex", flexDirection: "column", outline: "none", color: "#12131A" }}>
        <div style={{ padding: "20px 22px 14px", borderBottom: "1px solid rgba(18,19,26,.06)", display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={{ font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#6B6F7A" }}>{title ? `«${title}»` : "Esta misión"}</span>
          <h2 id="olvidar-t" style={{ margin: "0", font: "600 22px/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Olvidar lo aprendido aquí"}</h2>
          <p style={{ margin: "0", fontSize: "14px", lineHeight: "1.5", color: "#5C606C" }}>{"Los bots dejarán de usar lo que marques y no lo volverán a sacar de esta misión. Lo que tú les dijiste a mano no se toca."}</p>
        </div>
        <div style={{ flex: "1 1 auto", minHeight: "0", overflowY: "auto", overscrollBehavior: "contain", padding: "16px 22px", display: "flex", flexDirection: "column", gap: "8px" }}>
          {!data && !error ? <p style={{ margin: "0", fontSize: "14px", color: "#6B6F7A" }}>{"Buscando lo que se aprendió aquí…"}</p> : null}
          {done ? (
            <p role="status" style={{ margin: "0", padding: "12px 14px", background: "#E1F4EC", border: "1px solid #A8DCC5", borderRadius: "12px", fontSize: "14px", color: "#0B5E41" }}>
              {`Hecho: ${done.memories === 1 ? "1 recuerdo" : `${done.memories} recuerdos`} y ${done.skills === 1 ? "1 habilidad" : `${done.skills} habilidades`} olvidados. No se volverán a aprender de aquí.`}
            </p>
          ) : null}
          {data && !done && !memories.length && !skills.length ? <p style={{ margin: "0", fontSize: "14px", lineHeight: "1.5", color: "#5C606C" }}>{data.forgotten ? "Ya olvidaste lo aprendido aquí. Esta misión no se volverá a revisar." : "De esta misión no salió ningún recuerdo ni habilidad. No hay nada que olvidar."}</p> : null}
          {!done && memories.length ? <span style={{ fontSize: "14px", fontWeight: "600", paddingTop: "2px" }}>{`Recuerdos (${memories.length})`}</span> : null}
          {!done ? memories.map((m) => row(m, m.text, m.sourceLabel)) : null}
          {!done && skills.length ? <span style={{ fontSize: "14px", fontWeight: "600", paddingTop: "8px" }}>{`Habilidades (${skills.length})`}</span> : null}
          {!done ? skills.map((s) => row(s, s.name, s.description)) : null}
          {error ? <p role="alert" style={{ margin: "0", fontSize: "13px", color: "#B4372A", fontWeight: "600" }}>{error}</p> : null}
        </div>
        <div style={{ padding: "14px 22px 18px", borderTop: "1px solid rgba(18,19,26,.06)", display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "8px" }}>
          <button type="button" onClick={onClose} style={{ height: "44px", padding: "0 14px", background: "transparent", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "14px" }}>{done ? "Cerrar" : "Cancelar"}</button>
          {!done && (memories.length || skills.length) ? (
            <button type="button" onClick={confirm} disabled={busy || !total} aria-busy={busy ? "true" : undefined} style={{ height: "44px", padding: "0 16px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "999px", cursor: busy ? "progress" : "pointer", fontWeight: "600", fontSize: "14px", opacity: total ? 1 : 0.55 }}>
              {total ? `Olvidar ${total === 1 ? "1 cosa" : `${total} cosas`}` : "Marca qué olvidar"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Button that opens the preview. `variant`: "header", "menu" (Misión › Más) or "row" (Historial). */
export default function ForgetButton({ missionId, title, variant = "header", count = null, onDone }) {
  const [open, setOpen] = useState(false);
  const style = variant === "menu"
    ? { width: "100%", display: "flex", alignItems: "center", gap: "10px", minHeight: "40px", padding: "0 12px", background: "transparent", color: "#12131A", border: "0", borderRadius: "8px", cursor: "pointer", fontSize: "14px", textAlign: "left" }
    : variant === "row"
    ? { height: "36px", padding: "0 10px", background: "transparent", border: "0", borderRadius: "9px", cursor: "pointer", fontSize: "13px", whiteSpace: "nowrap" }
    : { display: "flex", alignItems: "center", gap: "8px", height: "44px", padding: "0 16px", background: "#FFFFFF", color: "#12131A", border: "0", borderRadius: "12px", cursor: "pointer", fontWeight: "600", fontSize: "14px" };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" style={style} title="Ver y quitar los recuerdos y habilidades que salieron de aquí">
        {variant === "row" ? null : <Eraser size={15} strokeWidth={2} aria-hidden="true" />}
        {"Olvidar lo aprendido aquí"}
        {count ? <span style={sr}>{` (${count})`}</span> : null}
      </button>
      {open ? <ForgetDialog missionId={missionId} title={title} onClose={() => setOpen(false)} onDone={onDone} /> : null}
    </>
  );
}
