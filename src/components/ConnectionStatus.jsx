import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../lib/store.jsx";

// What you see when the app cannot reach its local service (Colmena 3, design/V3Estados.dc.html):
//  - before the first data arrives: «Arrancando Colmena…» with the breathing mark, no fake
//    progress bar; after 20 s why it may take long, «Reintentar» and «Abrir el registro»;
//  - later, if the live channel drops: a small ink pill «Sin conexión · reintentando…» at the
//    foot of the screen. Nothing blocks: what you write is kept and sent when it is back
//    (lib/unsent.js). Then «Conectado de nuevo» for a moment. Nothing for blips under 2 s.
const INK = "#12131A";

/** The start-up face, shared with the desktop splash (desktop/splash.html draws the same). */
export function StartingUp({ slow = false, onRetry = () => location.reload(), onOpenLog = null }) {
  return (
    <div role={slow ? "alert" : "status"} aria-live="polite" style={{ position: "fixed", inset: "0", zIndex: 2147482500, display: "grid", placeItems: "center", padding: "0 40px", background: INK, color: "#FFFFFF", fontFamily: "'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif", animation: "fade .4s ease-out", WebkitAppRegion: "drag" }}>
      {slow ? (
        <div style={{ width: "100%", maxWidth: "520px", display: "flex", flexDirection: "column", justifyContent: "center", gap: "14px" }}>
          <span style={{ font: "600 24px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Colmena está tardando en arrancar"}</span>
          <span style={{ fontSize: "14px", lineHeight: "1.5", color: "#C9CBD3" }}>{"Suele pasar justo después de encender el ordenador o si el antivirus revisa la app. Tus datos están a salvo."}</span>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", WebkitAppRegion: "no-drag" }}>
            <button type="button" onClick={onRetry} style={{ height: "42px", padding: "0 18px", border: "0", borderRadius: "999px", background: "#FFFFFF", color: INK, fontSize: "14px", fontWeight: "600", cursor: "pointer" }}>{"Reintentar"}</button>
            {onOpenLog ? <button type="button" onClick={onOpenLog} style={{ height: "42px", padding: "0 16px", border: "1px solid rgba(255,255,255,.25)", borderRadius: "999px", background: "transparent", color: "#FFFFFF", fontSize: "14px", fontWeight: "500", cursor: "pointer" }}>{"Abrir el registro"}</button> : null}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", textAlign: "center" }}>
          <img src="/colmena-icon-128.png" alt="" width="56" height="56" style={{ display: "block", width: "56px", height: "56px", animation: "breathe 2.4s ease-in-out infinite" }} />
          <span style={{ font: "600 24px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Arrancando Colmena…"}</span>
          <span style={{ fontSize: "14px", color: "#C9CBD3" }}>{"Despertando a tu equipo en este ordenador."}</span>
        </div>
      )}
    </div>
  );
}

/** Horizontal centre of the screen's content (beside the sidebar), so the pill sits under it. */
function useContentCentre(active) {
  const [x, setX] = useState(null);
  useLayoutEffect(() => {
    if (!active) return undefined;
    const measure = () => {
      const el = document.querySelector("[data-v2-content]");
      const r = el?.getBoundingClientRect();
      setX(r && r.width ? Math.round(r.left + r.width / 2) : null);
    };
    measure();
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  }, [active]);
  return x;
}

export default function ConnectionStatus() {
  const { ready, error, online } = useStore();
  const [slow, setSlow] = useState(false);
  const [lost, setLost] = useState(false);
  const [back, setBack] = useState(false);
  const wasLost = useRef(false);

  useEffect(() => {
    if (ready) return undefined;
    const t = setTimeout(() => setSlow(true), 20000);
    return () => clearTimeout(t);
  }, [ready]);

  // Timers live in refs so a quick flap (fail, retry, fail…) never cancels «Conectado de nuevo».
  const lostTimer = useRef(null);
  const backTimer = useRef(null);
  useEffect(() => {
    if (!ready) return;
    if (!online) {
      if (!lostTimer.current && !wasLost.current) lostTimer.current = setTimeout(() => { lostTimer.current = null; wasLost.current = true; setBack(false); setLost(true); }, 2000);
      return;
    }
    clearTimeout(lostTimer.current);
    lostTimer.current = null;
    if (wasLost.current) {
      wasLost.current = false;
      setLost(false);
      setBack(true);
      clearTimeout(backTimer.current);
      backTimer.current = setTimeout(() => setBack(false), 2500);
    }
  }, [online, ready]);
  useEffect(() => () => { clearTimeout(lostTimer.current); clearTimeout(backTimer.current); }, []);
  const centre = useContentCentre(lost || back);

  if (!ready && error) {
    const openLog = typeof window !== "undefined" && window.colmenaWindow?.openLog ? () => window.colmenaWindow.openLog() : null;
    return <StartingUp slow={slow} onOpenLog={openLog} />;
  }
  if (!lost && !back) return null;
  return (
    <div role="status" aria-live="polite" title={lost ? "Nada se bloquea: lo que escribas se guarda y se envía al volver." : undefined} style={{ position: "fixed", left: centre != null ? centre + "px" : "50%", bottom: "24px", transform: "translateX(-50%)", zIndex: 2147482500, display: "flex", alignItems: "center", gap: "10px", height: "40px", padding: "0 16px", borderRadius: "999px", fontSize: "14px", whiteSpace: "nowrap", boxShadow: "0 16px 34px -16px rgba(18,19,26,.45)", transition: "background .3s ease, color .3s ease", animation: "rise .35s ease-out", background: lost ? INK : "#E1F4EC", color: lost ? "#FFFFFF" : "#0B5A3E" }}>
      {lost
        ? <span aria-hidden="true" style={{ width: "14px", height: "14px", flex: "none", border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#FFFFFF", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
        : <span aria-hidden="true" style={{ width: "8px", height: "8px", flex: "none", borderRadius: "50%", background: "#0B8A5F", animation: "pop .4s ease-out" }} />}
      {lost ? "Sin conexión · reintentando…" : "Conectado de nuevo"}
    </div>
  );
}
