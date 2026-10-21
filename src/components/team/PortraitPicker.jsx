import { useEffect, useRef, useState } from "react";
import { ImagePlus, RotateCcw, Trash2, X } from "lucide-react";
import { del, post, put } from "../../lib/api.js";
import { avatarStyle } from "../../lib/bots.js";

// «Darle un retrato» (OpenClaw BOOTSTRAP.md avatar step): one image with four options in a 2×2
// sheet, you choose 1–4 (never chosen for you), the browser crops that quarter (half width ×
// half height) to 384 px and it becomes the bot's portrait, inside its shape. «Otras cuatro»
// draws a new sheet; «Quitar el retrato» goes back to the shape and initial.
const SIDE = 384;
const CORNERS = ["arriba a la izquierda", "arriba a la derecha", "abajo a la izquierda", "abajo a la derecha"];

async function cropQuarter(src, n) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const half = Math.floor(img.naturalWidth / 2);
  const canvas = document.createElement("canvas");
  canvas.width = SIDE;
  canvas.height = SIDE;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  // A few pixels in from each edge, so a seam of the sheet never shows.
  const inset = Math.round(half * 0.02);
  ctx.drawImage(img, (n % 2) * half + inset, Math.floor(n / 2) * half + inset, half - 2 * inset, half - 2 * inset, 0, 0, SIDE, SIDE);
  return canvas.toDataURL("image/png");
}

export default function PortraitPicker({ bot, onClose, onSaved }) {
  const dialog = useRef(null);
  const [sheet, setSheet] = useState(null);
  const [pick, setPick] = useState(null);
  const [state, setState] = useState("idle"); // idle | drawing | saving
  const [error, setError] = useState(null);
  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);
  const draw = async () => {
    setState("drawing");
    setError(null);
    setPick(null);
    try {
      const r = await post(`/bots/${encodeURIComponent(bot.id)}/portrait/sheet`, {});
      setSheet(r.sheet);
    } catch (e) {
      setError(e.message);
    } finally {
      setState("idle");
    }
  };
  const save = async () => {
    if (pick === null || !sheet) return;
    setState("saving");
    setError(null);
    try {
      const image = await cropQuarter(sheet, pick);
      const r = await put(`/bots/${encodeURIComponent(bot.id)}/portrait`, { image: image.replace(/^data:image\/png;base64,/, "") });
      onSaved?.(r.portrait);
      dialog.current.close();
    } catch (e) {
      setError(e.message);
      setState("idle");
    }
  };
  const remove = async () => {
    setState("saving");
    try {
      await del(`/bots/${encodeURIComponent(bot.id)}/portrait`);
      onSaved?.(null);
      dialog.current.close();
    } catch (e) {
      setError(e.message);
      setState("idle");
    }
  };
  const btn = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", height: "44px", padding: "0 16px", borderRadius: "12px", cursor: "pointer", fontSize: "14px", fontWeight: 700 };
  const drawing = state === "drawing";

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="pp-t"
      style={{ width: "min(560px, 94vw)", padding: 0, border: "0", borderRadius: "32px", boxShadow: "0 60px 120px -40px rgba(18,19,26,.5), 0 2px 6px rgba(18,19,26,.06)", background: "#FFFFFF", color: "#12131A" }}>
      <header style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "20px 22px 12px" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
          <h2 id="pp-t" style={{ margin: 0, font: "700 22px/1.15 'Bricolage Grotesque', sans-serif" }}>{`Un retrato para ${bot.name}`}</h2>
          <p style={{ margin: 0, fontSize: "14px", lineHeight: "1.5", color: "#4A4F5C" }}>
            {sheet ? "Elige el que más te guste. Se verá dentro de su forma en todo Colmena." : "Dibujamos cuatro opciones con tu cuenta de ChatGPT y eliges una. Tarda un minuto, más o menos."}
          </p>
        </div>
        <button type="button" className="rm-focus" aria-label="Cerrar" onClick={() => dialog.current.close()} style={{ width: "36px", height: "36px", display: "grid", placeItems: "center", background: "transparent", border: 0, borderRadius: "10px", cursor: "pointer", color: "#4A4F5C" }}><X size={18} strokeWidth={2.2} aria-hidden="true" /></button>
      </header>
      <div style={{ padding: "6px 22px 18px", display: "flex", flexDirection: "column", gap: "14px" }}>
        {error ? <p role="alert" style={{ margin: 0, padding: "10px 12px", background: "#FDECEC", border: "1px solid #F1B5B7", borderRadius: "10px", fontSize: "13px", color: "#8F1D22" }}>{error}</p> : null}
        <div role={sheet ? "radiogroup" : undefined} aria-label={sheet ? "Opciones de retrato" : undefined}
          style={{ position: "relative", aspectRatio: "1 / 1", borderRadius: "14px", overflow: "hidden", background: "#F7F8FA", border: "1px solid #E6E8EE", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" }}>
          {sheet ? <img src={sheet} alt="" aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} /> : null}
          {[0, 1, 2, 3].map((n) => sheet ? (
            <button key={n} type="button" role="radio" aria-checked={pick === n ? "true" : "false"} aria-label={`Opción ${n + 1}, ${CORNERS[n]}`} onClick={() => setPick(n)} className="rm-focus"
              style={{ position: "relative", padding: 0, border: 0, cursor: "pointer", background: pick !== null && pick !== n ? "rgba(255,255,255,.55)" : "transparent", boxShadow: pick === n ? "inset 0 0 0 4px #12131A, inset 0 0 0 7px #FFC93C" : "none", transition: "background .15s ease" }}>
              <span style={{ position: "absolute", top: "8px", left: "8px", width: "26px", height: "26px", display: "grid", placeItems: "center", borderRadius: "8px", background: pick === n ? "#FFC93C" : "#FFFFFF", border: "1.5px solid #12131A", font: "700 13px/1 'Geist Mono', monospace", color: "#12131A" }}>{n + 1}</span>
            </button>
          ) : (
            <span key={n} aria-hidden="true" style={{ display: "grid", placeItems: "center", borderRight: n % 2 === 0 ? "1px dashed #DCE0E8" : 0, borderBottom: n < 2 ? "1px dashed #DCE0E8" : 0 }}>
              <span className={drawing ? "colmena-skeleton" : undefined} style={{ width: "54%", aspectRatio: "1 / 1", ...avatarStyle({ ...bot, portrait: null }, 120), opacity: drawing ? 1 : 0.35 }} />
            </span>
          ))}
          {drawing ? <span role="status" style={{ position: "absolute", left: "50%", bottom: "14px", transform: "translateX(-50%)", padding: "6px 12px", background: "#12131A", color: "#FFFFFF", borderRadius: "16px", fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap" }}>{"Dibujando cuatro opciones…"}</span> : null}
        </div>
      </div>
      <footer style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", padding: "14px 22px 18px", borderTop: "1px solid #E6E8EE" }}>
        {bot.portrait ? (
          <button type="button" disabled={state !== "idle"} onClick={remove} style={{ ...btn, marginRight: "auto", padding: "0 12px", background: "transparent", color: "#4A4F5C", border: "1px solid #DCE0E8", fontWeight: 600 }}>
            <Trash2 size={15} strokeWidth={2} aria-hidden="true" />{"Quitar el retrato"}
          </button>
        ) : <span style={{ marginRight: "auto" }} />}
        {sheet ? (
          <>
            <button type="button" disabled={state !== "idle"} onClick={draw} style={{ ...btn, background: "#FFFFFF", color: "#12131A", border: "1px solid #12131A" }}><RotateCcw size={15} strokeWidth={2.2} aria-hidden="true" />{"Otras cuatro"}</button>
            <button type="button" disabled={pick === null || state !== "idle"} onClick={save} className="c-press" style={{ ...btn, background: "#FFC93C", color: "#12131A", border: "2px solid #12131A", opacity: pick === null ? 0.5 : 1 }}>
              {state === "saving" ? "Guardando…" : pick === null ? "Elige una" : `Usar la ${pick + 1}`}
            </button>
          </>
        ) : (
          <button type="button" disabled={drawing} onClick={draw} className="c-press" style={{ ...btn, background: "#FFC93C", color: "#12131A", border: "2px solid #12131A" }}>
            <ImagePlus size={16} strokeWidth={2.2} aria-hidden="true" />{drawing ? "Dibujando…" : "Dibujar cuatro opciones"}
          </button>
        )}
      </footer>
    </dialog>
  );
}
