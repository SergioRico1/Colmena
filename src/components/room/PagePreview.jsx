import { useEffect, useState } from "react";
import { isolatedPage } from "../../lib/isolatePage.js";

// «Vista previa» of a web page a bot made (the Canvas of OpenClaw for Mac): the page runs in
// an iframe with its own empty origin (no Colmena cookies, API or token) and a policy that
// lets it run its scripts and styles but reach nothing outside: no network, no forms sent,
// no external fonts. It is redrawn when the file changes.

export default function PagePreview({ html, title = "Vista previa" }) {
  const [shown, setShown] = useState(() => isolatedPage(html));
  // A short pause before redrawing, so a page written in parts does not flicker.
  useEffect(() => {
    const t = setTimeout(() => setShown(isolatedPage(html)), 150);
    return () => clearTimeout(t);
  }, [html]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: "1", minHeight: 0 }}>
      <iframe title={title} sandbox="allow-scripts allow-modals" srcDoc={shown}
        style={{ flex: "1", width: "100%", minHeight: "460px", border: "1px solid rgba(18,19,26,.08)", borderRadius: "16px", background: "#FFFFFF" }} />
      <span style={{ fontSize: "12px", color: "#6B6F7A" }}>{"Aislada: funciona sin internet y sin acceso a Colmena ni a tus datos."}</span>
    </div>
  );
}
