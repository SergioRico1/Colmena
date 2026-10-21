// Animated verb icons of design/EnVivo.dc.html (keyframes come from that design's css).
// size "chip" = status strip, "card" = chip inside a work card.

export const VERB_LABEL = {
  pensando: "Pensando",
  leyendo: "Leyendo",
  escribiendo: "Escribiendo",
  programando: "Programando",
  "creando imagen": "Creando imagen",
  calculando: "Calculando",
  "hablando con otro bot": "Hablando con otro bot",
  navegando: "Navegando",
  "rellenando un formulario": "Rellenando un formulario",
  "usando el ordenador": "Usando el ordenador",
  "ejecutando una tarea": "Ejecutando una tarea",
};

export const VERB_3RD = {
  pensando: "piensa",
  leyendo: "lee",
  escribiendo: "escribe",
  programando: "programa",
  "creando imagen": "crea una imagen",
  calculando: "calcula",
  "hablando con otro bot": "habla con otro bot",
  navegando: "navega",
  "rellenando un formulario": "rellena un formulario",
  "usando el ordenador": "usa el ordenador",
  "ejecutando una tarea": "ejecuta una tarea",
};

export function normalizeVerb(verb) {
  const v = String(verb || "").toLowerCase();
  if (v.startsWith("naveg")) return "navegando";
  if (v.startsWith("rellen")) return "rellenando un formulario";
  if (v.startsWith("usando el ordenador")) return "usando el ordenador";
  if (v.startsWith("ejecut")) return "ejecutando una tarea";
  if (v.startsWith("escrib") || v.startsWith("redact") || v.startsWith("repas")) return "escribiendo";
  if (v.startsWith("program") || v.includes("código") || v.includes("codigo")) return "programando";
  if (v.includes("imagen") || v.startsWith("dibuj") || v.startsWith("diseñ")) return "creando imagen";
  if (v.startsWith("ley") || v.startsWith("le") || v.startsWith("busc")) return "leyendo";
  if (v.startsWith("calcul") || v.startsWith("analiz")) return "calculando";
  if (v.startsWith("habl")) return "hablando con otro bot";
  return "pensando";
}

export default function VerbIcon({ verb, size = "chip" }) {
  const chip = size === "chip";
  const px = chip ? 14 : 13;
  const line = { fill: "none", stroke: "#12131A", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (verb) {
    case "navegando":
      return <svg width={px} height={px} viewBox="0 0 24 24" aria-hidden="true" {...line}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></svg>;
    case "rellenando un formulario":
      return <svg width={px} height={px} viewBox="0 0 24 24" aria-hidden="true" {...line}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h5" /><path d="M8 17h2" style={{ animation: "blink 1s steps(1) infinite" }} /></svg>;
    case "usando el ordenador":
      return <svg width={px} height={px} viewBox="0 0 24 24" aria-hidden="true" {...line}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>;
    case "ejecutando una tarea":
      return <svg width={px} height={px} viewBox="0 0 24 24" aria-hidden="true" {...line}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></svg>;
    case "escribiendo":
      return (
        <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "flex-end", gap: "2px" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            <span style={{ width: chip ? "12px" : "11px", height: "2px", background: "#12131A" }} />
            <span style={{ width: chip ? "8px" : "7px", height: "2px", background: "#12131A" }} />
          </span>
          <span style={{ width: "2px", height: chip ? "12px" : "11px", background: "#12131A", animation: "blink 1s steps(1) infinite" }} />
        </span>
      );
    case "creando imagen":
      return (
        <span aria-hidden="true" style={{ position: "relative", width: chip ? "16px" : "14px", height: chip ? "16px" : "14px", borderRadius: chip ? "4px" : "3px", background: "#C9CED8", overflow: "hidden" }}>
          <span style={{ position: "absolute", inset: "0", background: "linear-gradient(90deg, transparent, rgba(255,255,255,.95), transparent)", animation: "shimmer 1.2s linear infinite" }} />
        </span>
      );
    case "programando":
      return (
        <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", font: "700 12px/1 'Geist Mono', monospace" }}>
          {"</>"}
          <span style={{ width: chip ? "6px" : "5px", height: chip ? "12px" : "11px", marginLeft: "2px", background: "#12131A", animation: "blink 1s steps(1) infinite" }} />
        </span>
      );
    case "leyendo":
      return (
        <span aria-hidden="true" style={{ position: "relative", width: "13px", height: "16px", border: "2px solid #12131A", borderRadius: "3px", overflow: "hidden" }}>
          <span style={{ position: "absolute", left: "0", right: "0", height: "3px", background: "#2F6BFF", animation: "sweep 1.4s ease-in-out infinite alternate" }} />
        </span>
      );
    case "calculando":
      return (
        <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "flex-end", gap: "2px", height: "14px" }}>
          <span style={{ width: "3px", height: "14px", background: "#12131A", transformOrigin: "bottom", animation: "bars 1s ease-in-out infinite" }} />
          <span style={{ width: "3px", height: "14px", background: "#12131A", transformOrigin: "bottom", animation: "bars 1s ease-in-out .2s infinite" }} />
          <span style={{ width: "3px", height: "14px", background: "#12131A", transformOrigin: "bottom", animation: "bars 1s ease-in-out .4s infinite" }} />
        </span>
      );
    case "hablando con otro bot":
      return (
        <span aria-hidden="true" style={{ position: "relative", width: "26px", height: "10px" }}>
          <span style={{ position: "absolute", left: "0", top: "1px", width: "8px", height: "8px", borderRadius: "50%", background: "#12131A", animation: "pass 1.4s ease-in-out infinite" }} />
          <span style={{ position: "absolute", right: "0", top: "1px", width: "8px", height: "8px", borderRadius: "2px", background: "#8C91A0", animation: "passback 1.4s ease-in-out infinite" }} />
        </span>
      );
    case "pregunta":
      return <span aria-hidden="true" style={{ width: "9px", height: "9px", borderRadius: "2px", background: "#C98A00", animation: "ring 1.4s ease-out infinite" }} />;
    default:
      return (
        <span aria-hidden="true" style={{ position: "relative", width: "14px", height: "14px", animation: "orbit 1.4s linear infinite" }}>
          <span style={{ position: "absolute", left: "4.5px", top: "0", width: "5px", height: "5px", borderRadius: "50%", background: "#12131A" }} />
          <span style={{ position: "absolute", left: "0", bottom: "1px", width: "5px", height: "5px", borderRadius: "50%", background: "#12131A", opacity: ".55" }} />
          <span style={{ position: "absolute", right: "0", bottom: "1px", width: "5px", height: "5px", borderRadius: "50%", background: "#12131A", opacity: ".25" }} />
        </span>
      );
  }
}
