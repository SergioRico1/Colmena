// Static legend «Estados de un bot» copied verbatim from design/EnVivo.dc.html (lines 806-1016 of src/design/EnVivo.jsx).
import { X } from "lucide-react";

// Shown on demand («Qué significa cada estado» in the live bar), with its own close button.
export default function StatesLegend({ onClose }) {
  return (
            <aside aria-labelledby="estados-t" style={{flex: "1 1 340px", minWidth: "0", background: "#F7F8FA", borderLeft: "1px solid #DCE0E8", padding: "22px 20px 32px", display: "flex", flexDirection: "column", gap: "16px"}}>
              <div style={{display: "flex", flexDirection: "column", gap: "6px"}}>
                <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px"}}>
                  <h2 id="estados-t" style={{margin: "0", font: "700 20px/1.1 'Bricolage Grotesque', sans-serif"}}>
                    {"Estados de un bot"}
                  </h2>
                  {onClose ? <button type="button" className="rm-focus" onClick={onClose} aria-label="Cerrar la leyenda" title="Cerrar" style={{width: "36px", height: "36px", flex: "none", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "10px", cursor: "pointer", color: "#12131A"}}><X size={16} strokeWidth={2.2} aria-hidden="true" /></button> : null}
                </div>
                <p style={{margin: "0", fontSize: "13px", lineHeight: "1.5", color: "#4A4F5C"}}>
                  {"Cada estado tiene un icono que se mueve, un verbo y, si te necesita, un color. Mientras trabajan, en gris; solo se colorea lo que pide tu atención."}
                </p>
              </div>
              <div style={{display: "flex", flexDirection: "column", gap: "2px"}}>
                <span style={{padding: "6px 0", font: "600 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68"}}>
                  {"Trabajando"}
                </span>
                <div style={{display: "grid", gridTemplateColumns: "40px 1fr", gap: "12px", alignItems: "center", minHeight: "52px", borderTop: "1px solid #E6E8EE"}}>
                  <span aria-hidden="true" style={{width: "36px", height: "36px", display: "grid", placeItems: "center", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "10px"}}>
                    <span style={{position: "relative", width: "18px", height: "18px", animation: "orbit 1.4s linear infinite"}}>
                      <span style={{position: "absolute", left: "6px", top: "0", width: "6px", height: "6px", borderRadius: "50%", background: "#12131A"}} />
                      <span style={{position: "absolute", left: "0", bottom: "1px", width: "6px", height: "6px", borderRadius: "50%", background: "#12131A", opacity: ".55"}} />
                      <span style={{position: "absolute", right: "0", bottom: "1px", width: "6px", height: "6px", borderRadius: "50%", background: "#12131A", opacity: ".25"}} />
                    </span>
                  </span>
                  <span style={{display: "flex", flexDirection: "column", gap: "2px"}}>
                    <strong style={{fontSize: "14px"}}>
                      {"Pensando"}
                    </strong>
                    <span style={{fontSize: "12px", color: "#4A4F5C"}}>
                      {"Decide cómo hacerlo o reparte el trabajo"}
                    </span>
                  </span>
                </div>
                <div style={{display: "grid", gridTemplateColumns: "40px 1fr", gap: "12px", alignItems: "center", minHeight: "52px", borderTop: "1px solid #E6E8EE"}}>
                  <span aria-hidden="true" style={{width: "36px", height: "36px", display: "grid", placeItems: "center", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "10px"}}>
                    <span style={{position: "relative", width: "15px", height: "19px", border: "2px solid #12131A", borderRadius: "3px", overflow: "hidden"}}>
                      <span style={{position: "absolute", left: "0", right: "0", height: "3px", background: "#2F6BFF", animation: "sweep 1.4s ease-in-out infinite alternate"}} />
                    </span>
                  </span>
                  <span style={{display: "flex", flexDirection: "column", gap: "2px"}}>
                    <strong style={{fontSize: "14px"}}>
                      {"Leyendo"}
                    </strong>
                    <span style={{fontSize: "12px", color: "#4A4F5C"}}>
                      {"Documentos, webs o correos; dice la página"}
                    </span>
                  </span>
                </div>
                <div style={{display: "grid", gridTemplateColumns: "40px 1fr", gap: "12px", alignItems: "center", minHeight: "52px", borderTop: "1px solid #E6E8EE"}}>
                  <span aria-hidden="true" style={{width: "36px", height: "36px", display: "grid", placeItems: "center", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "10px"}}>
                    <span style={{display: "inline-flex", alignItems: "flex-end", gap: "2px"}}>
                      <span style={{display: "flex", flexDirection: "column", gap: "3px"}}>
                        <span style={{width: "13px", height: "2px", background: "#12131A"}} />
                        <span style={{width: "13px", height: "2px", background: "#12131A"}} />
                        <span style={{width: "8px", height: "2px", background: "#12131A"}} />
                      </span>
                      <span style={{width: "2px", height: "14px", background: "#7B4DFF", animation: "blink 1s steps(1) infinite"}} />
                    </span>
                  </span>
                  <span style={{display: "flex", flexDirection: "column", gap: "2px"}}>
                    <strong style={{fontSize: "14px"}}>
                      {"Escribiendo"}
                    </strong>
                    <span style={{fontSize: "12px", color: "#4A4F5C"}}>
                      {"El texto aparece en directo, palabra a palabra"}
                    </span>
                  </span>
                </div>
                <div style={{display: "grid", gridTemplateColumns: "40px 1fr", gap: "12px", alignItems: "center", minHeight: "52px", borderTop: "1px solid #E6E8EE"}}>
                  <span aria-hidden="true" style={{width: "36px", height: "36px", display: "grid", placeItems: "center", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "10px", font: "700 12px/1 'Geist Mono', monospace"}}>
                    {"</>"}
                    <span style={{width: "4px", height: "11px", marginLeft: "1px", background: "#FF7A1A", animation: "blink 1s steps(1) infinite"}} />
                  </span>
                  <span style={{display: "flex", flexDirection: "column", gap: "2px"}}>
                    <strong style={{fontSize: "14px"}}>
                      {"Programando"}
                    </strong>
                    <span style={{fontSize: "12px", color: "#4A4F5C"}}>
                      {"Código en directo y pruebas que van pasando"}
                    </span>
                  </span>
                </div>
                <div style={{display: "grid", gridTemplateColumns: "40px 1fr", gap: "12px", alignItems: "center", minHeight: "52px", borderTop: "1px solid #E6E8EE"}}>
                  <span aria-hidden="true" style={{width: "36px", height: "36px", display: "grid", placeItems: "center", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "10px"}}>
                    <span style={{position: "relative", width: "20px", height: "20px", borderRadius: "5px", background: "#FFB3D4", overflow: "hidden"}}>
                      <span style={{position: "absolute", inset: "0", background: "linear-gradient(90deg, transparent, rgba(255,255,255,.95), transparent)", animation: "shimmer 1.2s linear infinite"}} />
                    </span>
                  </span>
                  <span style={{display: "flex", flexDirection: "column", gap: "2px"}}>
                    <strong style={{fontSize: "14px"}}>
                      {"Creando imagen"}
                    </strong>
                    <span style={{fontSize: "12px", color: "#4A4F5C"}}>
                      {"La imagen se enfoca por fases; ves el porcentaje"}
                    </span>
                  </span>
                </div>
                <div style={{display: "grid", gridTemplateColumns: "40px 1fr", gap: "12px", alignItems: "center", minHeight: "52px", borderTop: "1px solid #E6E8EE"}}>
                  <span aria-hidden="true" style={{width: "36px", height: "36px", display: "grid", placeItems: "center", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "10px"}}>
                    <span style={{display: "inline-flex", alignItems: "flex-end", gap: "2px", height: "16px"}}>
                      <span style={{width: "4px", height: "16px", background: "#12131A", transformOrigin: "bottom", animation: "bars 1s ease-in-out infinite"}} />
                      <span style={{width: "4px", height: "16px", background: "#0B8A5F", transformOrigin: "bottom", animation: "bars 1s ease-in-out .2s infinite"}} />
                      <span style={{width: "4px", height: "16px", background: "#12131A", transformOrigin: "bottom", animation: "bars 1s ease-in-out .4s infinite"}} />
                    </span>
                  </span>
                  <span style={{display: "flex", flexDirection: "column", gap: "2px"}}>
                    <strong style={{fontSize: "14px"}}>
                      {"Calculando"}
                    </strong>
                    <span style={{fontSize: "12px", color: "#4A4F5C"}}>
                      {"Hojas, cifras y escenarios"}
                    </span>
                  </span>
                </div>
                <div style={{display: "grid", gridTemplateColumns: "40px 1fr", gap: "12px", alignItems: "center", minHeight: "52px", borderTop: "1px solid #E6E8EE"}}>
                  <span aria-hidden="true" style={{width: "36px", height: "36px", display: "grid", placeItems: "center", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "10px"}}>
                    <span style={{position: "relative", width: "26px", height: "10px"}}>
                      <span style={{position: "absolute", left: "0", top: "1px", width: "8px", height: "8px", borderRadius: "50%", background: "#12131A", animation: "pass 1.4s ease-in-out infinite"}} />
                      <span style={{position: "absolute", right: "0", top: "1px", width: "8px", height: "8px", borderRadius: "2px", background: "#8C91A0", animation: "passback 1.4s ease-in-out infinite"}} />
                    </span>
                  </span>
                  <span style={{display: "flex", flexDirection: "column", gap: "2px"}}>
                    <strong style={{fontSize: "14px"}}>
                      {"Hablando con otro bot"}
                    </strong>
                    <span style={{fontSize: "12px", color: "#4A4F5C"}}>
                      {"Va a un hilo; lo abres si quieres"}
                    </span>
                  </span>
                </div>
                <span style={{padding: "14px 0 6px", font: "600 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68"}}>
                  {"Necesitan algo"}
                </span>
                <div style={{display: "grid", gridTemplateColumns: "40px 1fr", gap: "12px", alignItems: "center", minHeight: "52px", borderTop: "1px solid #E6E8EE"}}>
                  <span aria-hidden="true" style={{width: "36px", height: "36px", display: "grid", placeItems: "center", background: "#FFF4D1", border: "1.5px solid #12131A", borderRadius: "10px"}}>
                    <span style={{width: "11px", height: "11px", borderRadius: "3px", background: "#C98A00", animation: "ring 1.4s ease-out infinite"}} />
                  </span>
                  <span style={{display: "flex", flexDirection: "column", gap: "2px"}}>
                    <strong style={{fontSize: "14px"}}>
                      {"Te espera"}
                    </strong>
                    <span style={{fontSize: "12px", color: "#4A4F5C"}}>
                      {"Una pregunta o un permiso; va a la Bandeja"}
                    </span>
                  </span>
                </div>
                <div style={{display: "grid", gridTemplateColumns: "40px 1fr", gap: "12px", alignItems: "center", minHeight: "52px", borderTop: "1px solid #E6E8EE"}}>
                  <span aria-hidden="true" style={{width: "36px", height: "36px", display: "grid", placeItems: "center", background: "#FBE7DF", border: "1.5px solid #B4372A", borderRadius: "10px"}}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#B4372A" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3 2 20h20z" />
                      <path d="M12 10v4M12 17v.5" />
                    </svg>
                  </span>
                  <span style={{display: "flex", flexDirection: "column", gap: "2px"}}>
                    <strong style={{fontSize: "14px"}}>
                      {"Bloqueado"}
                    </strong>
                    <span style={{fontSize: "12px", color: "#4A4F5C"}}>
                      {"No puede seguir y dice por qué: «sin acceso a la carpeta»"}
                    </span>
                  </span>
                </div>
                <span style={{padding: "14px 0 6px", font: "600 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68"}}>
                  {"En reposo"}
                </span>
                <div style={{display: "grid", gridTemplateColumns: "40px 1fr", gap: "12px", alignItems: "center", minHeight: "52px", borderTop: "1px solid #E6E8EE"}}>
                  <span aria-hidden="true" style={{width: "36px", height: "36px", display: "grid", placeItems: "center", background: "#E1F4EC", border: "1px solid #9ED4BC", borderRadius: "10px"}}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B6B4A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{strokeDasharray: "24", animation: "draw 2.4s ease-out infinite"}}>
                      <path d="m5 12 5 5 9-10" />
                    </svg>
                  </span>
                  <span style={{display: "flex", flexDirection: "column", gap: "2px"}}>
                    <strong style={{fontSize: "14px"}}>
                      {"Hecho"}
                    </strong>
                    <span style={{fontSize: "12px", color: "#4A4F5C"}}>
                      {"Deja el entregable en la sala y en la Biblioteca"}
                    </span>
                  </span>
                </div>
                <div style={{display: "grid", gridTemplateColumns: "40px 1fr", gap: "12px", alignItems: "center", minHeight: "52px", borderTop: "1px solid #E6E8EE"}}>
                  <span aria-hidden="true" style={{width: "36px", height: "36px", display: "grid", placeItems: "center", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "10px"}}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#8C91A0">
                      <rect x="6" y="5" width="4" height="14" rx="1" />
                      <rect x="14" y="5" width="4" height="14" rx="1" />
                    </svg>
                  </span>
                  <span style={{display: "flex", flexDirection: "column", gap: "2px"}}>
                    <strong style={{fontSize: "14px"}}>
                      {"En pausa"}
                    </strong>
                    <span style={{fontSize: "12px", color: "#4A4F5C"}}>
                      {"Lo paraste tú; conserva lo que llevaba"}
                    </span>
                  </span>
                </div>
                <div style={{display: "grid", gridTemplateColumns: "40px 1fr", gap: "12px", alignItems: "center", minHeight: "52px", borderTop: "1px solid #E6E8EE", borderBottom: "1px solid #E6E8EE"}}>
                  <span aria-hidden="true" style={{width: "36px", height: "36px", display: "grid", placeItems: "center", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "10px"}}>
                    <span style={{width: "12px", height: "12px", borderRadius: "50%", border: "2px solid #8C91A0"}} />
                  </span>
                  <span style={{display: "flex", flexDirection: "column", gap: "2px"}}>
                    <strong style={{fontSize: "14px"}}>
                      {"Libre"}
                    </strong>
                    <span style={{fontSize: "12px", color: "#4A4F5C"}}>
                      {"Disponible; dice cuándo vuelve si tiene algo programado"}
                    </span>
                  </span>
                </div>
              </div>
              <p style={{margin: "0", padding: "12px 14px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "12px", fontSize: "12px", lineHeight: "1.5", color: "#4A4F5C"}}>
                {"Si el sistema tiene activado «reducir movimiento», las animaciones se detienen y queda el icono fijo con su verbo."}
              </p>
            </aside>
  );
}
