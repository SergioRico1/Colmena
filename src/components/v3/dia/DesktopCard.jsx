import { useState } from "react";
import { Laptop, X } from "../../Icon.js";
import { Downloads } from "../../DesktopRoute.jsx";
import { C } from "../../../lib/theme.js";
import { B, CARD, H2 } from "../../../lib/ui4.js";

// Inicio › «Usa Colmena en el escritorio» (hosted only; the owner's rule: recommend the desktop
// app over the web). Shown to people who can lend a computer and have none paired; «×» puts it
// away on this browser. Quiet: one line of what it adds, the downloads, nothing else.
const KEY = "colmena.desktopCard";

export default function DesktopCard({ store }) {
  const [gone, setGone] = useState(() => { try { return localStorage.getItem(KEY) === "closed"; } catch { return false; } });
  const role = store.cloud?.me?.role;
  if (!store.cloud || store.cloud.hasDesktop || role === "guest" || gone || window.colmenaWindow) return null;
  const close = () => { setGone(true); try { localStorage.setItem(KEY, "closed"); } catch {} };
  return (
    <section aria-labelledby="desk-t" style={{ ...CARD, display: "flex", flexDirection: "column", gap: "12px", padding: "14px 12px 16px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <Laptop size={20} aria-hidden="true" style={{ flex: "none", color: C.text3 }} />
        <h2 id="desk-t" style={{ ...H2, flex: 1 }}>{"Usa Colmena en el escritorio"}</h2>
        <button type="button" className="u4-ghost" onClick={close} aria-label="Cerrar «Usa Colmena en el escritorio»" title="Cerrar" style={{ ...B.icon, width: "28px", height: "28px" }}><X size={15} /></button>
      </div>
      <p style={{ margin: 0, fontSize: "var(--t-ui)", lineHeight: 1.5, color: C.text2 }}>{"La misma empresa, con avisos y «Pregunta rápida», y tus bots pueden usar tus carpetas, tu navegador con tus sesiones y tu gestor de contraseñas. Tu suscripción de ChatGPT o Claude funciona allí, en tu ordenador."}</p>
      <Downloads small />
    </section>
  );
}
