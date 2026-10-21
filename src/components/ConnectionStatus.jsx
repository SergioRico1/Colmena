import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store.jsx";

// What you see when the app cannot reach its local service:
//  - before the first data arrives: a calm start-up screen (after a while, what to do);
//  - later, if the live channel drops: a small pill «Sin conexión · reintentando…»,
//    then «Conectado de nuevo» for a moment. Nothing appears for blips under 2 s.
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

  // Colmena 2.0 · 35 (design/V2Estados.dc.html): start-up with the breathing mark; after 20 s
  // why it may take long and «Reintentar»; a pill at the top while the connection is lost.
  if (!ready && error) {
    return (
      <div role={slow ? "alert" : "status"} aria-live="polite" style={{ position: "fixed", inset: "0", zIndex: 2147482500, background: "#F5F5F2", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: slow ? "20px" : "22px", padding: "0 40px", textAlign: "center", animation: "fade .4s ease-out", WebkitAppRegion: "drag" }}>
        {slow ? (
          <>
            <img src="/colmena-icon-128.png" alt="" width="64" height="64" style={{ display: "block", width: "64px", height: "64px", opacity: ".9" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxWidth: "460px" }}>
              <strong style={{ font: "600 24px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Colmena está tardando en arrancar"}</strong>
              <span style={{ fontSize: "15px", lineHeight: "1.5", color: "#5C606C" }}>{"Suele pasar justo después de encender el ordenador o si el antivirus está revisando la app. Tus datos están a salvo."}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px", WebkitAppRegion: "no-drag" }}>
              <button type="button" onClick={() => location.reload()} style={{ height: "46px", padding: "0 22px", border: "0", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: "pointer", fontSize: "15px", fontWeight: "600" }}>{"Reintentar"}</button>
              {window.colmenaWindow?.openLog ? <button type="button" onClick={() => window.colmenaWindow.openLog()} style={{ height: "46px", padding: "0 18px", border: "0", borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "15px", fontWeight: "600" }}>{"Abrir el registro"}</button> : null}
            </div>
          </>
        ) : (
          <>
            <img src="/colmena-icon.png" alt="" width="96" height="96" style={{ display: "block", width: "96px", height: "96px", filter: "drop-shadow(0 12px 30px rgba(201,120,0,.35))", animation: "breathe 2.6s ease-in-out infinite" }} />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
              <strong style={{ font: "600 24px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Arrancando Colmena…"}</strong>
              <span style={{ fontSize: "15px", color: "#5C606C" }}>{"Preparando tu equipo en este ordenador."}</span>
            </div>
            <span aria-hidden="true" style={{ position: "relative", width: "180px", height: "3px", borderRadius: "2px", background: "rgba(18,19,26,.08)", overflow: "hidden" }}>
              <span style={{ position: "absolute", top: "0", bottom: "0", width: "40%", borderRadius: "2px", background: "#12131A", animation: "sweep 1.4s ease-in-out infinite" }} />
            </span>
          </>
        )}
      </div>
    );
  }
  if (!lost && !back) return null;
  return (
    <div role="status" aria-live="polite" style={{ position: "fixed", left: "calc(50% + 42px)", top: "18px", transform: "translateX(-50%)", zIndex: 2147482500, display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px", borderRadius: "999px", fontSize: "14px", fontWeight: "500", whiteSpace: "nowrap", boxShadow: "0 16px 34px -16px rgba(18,19,26,.45)", transition: "background .3s ease, color .3s ease", animation: "rise .35s ease-out", background: lost ? "#12131A" : "#E1F4EC", color: lost ? "#FFFFFF" : "#0B5A3E" }}>
      <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: lost ? "#FFC93C" : "#0B8A5F", animation: lost ? "halo 1.6s ease-out infinite" : "pop .4s ease-out" }} />
      {lost ? "Sin conexión con Colmena · reintentando…" : "Conectado de nuevo"}
    </div>
  );
}
