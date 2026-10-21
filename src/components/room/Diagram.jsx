import { useEffect, useId, useState } from "react";
import { Copy, Network } from "lucide-react";

// ```mermaid blocks drawn as diagrams (OpenClaw): flows, timelines, org charts… in Colmena's
// colours. Mermaid loads only the first time a diagram appears; strict mode sanitizes its SVG.
// While the bot is still writing the block (or if it is wrong) you see the code instead.

let loader = null;
function loadMermaid() {
  loader ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: "Geist, system-ui, sans-serif",
      themeVariables: {
        fontFamily: "Geist, system-ui, sans-serif",
        fontSize: "14px",
        primaryColor: "#FFF4D1",
        primaryBorderColor: "#12131A",
        primaryTextColor: "#12131A",
        secondaryColor: "#E7EEFF",
        secondaryBorderColor: "#1F4FD1",
        tertiaryColor: "#F7F8FA",
        tertiaryBorderColor: "#DCE0E8",
        lineColor: "#4A4F5C",
        textColor: "#12131A",
        noteBkgColor: "#FFF4D1",
        noteBorderColor: "#C98A00",
        clusterBkg: "#F7F8FA",
        clusterBorder: "#DCE0E8",
        edgeLabelBackground: "#FFFFFF",
      },
      flowchart: { curve: "basis", padding: 12 },
    });
    return mermaid;
  });
  return loader;
}

export default function Diagram({ source }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState(null);
  const [failed, setFailed] = useState(false);
  const [showCode, setShowCode] = useState(false);
  useEffect(() => {
    let alive = true;
    // Wait for the block to settle while it streams in.
    const timer = setTimeout(async () => {
      try {
        const mermaid = await loadMermaid();
        await mermaid.parse(source);
        const { svg: out } = await mermaid.render("dg" + uid + Date.now().toString(36), source);
        if (alive) { setSvg(out); setFailed(false); }
      } catch {
        if (alive) setFailed(true);
      }
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [source, uid]);
  const code = (
    <pre style={{ margin: 0, padding: "14px 16px", background: "#1D1F27", color: "#E6E8EE", borderRadius: "12px", font: "400 13px/1.7 'Geist Mono', monospace", overflowX: "auto", whiteSpace: "pre" }}><code>{source}</code></pre>
  );
  if (failed && !svg) return code;
  return (
    <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
      {showCode ? code : (
        <div role="img" aria-label="Diagrama" className={svg ? "c-enter" : undefined}
          style={{ padding: "16px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "12px", overflowX: "auto", display: "flex", justifyContent: "center", minHeight: svg ? undefined : "72px", alignItems: "center", color: "#555A68", fontSize: "13px" }}
          {...(svg ? { dangerouslySetInnerHTML: { __html: svg } } : { children: "Dibujando el diagrama…" })} />
      )}
      {svg ? (
        <figcaption style={{ display: "flex", gap: "12px", fontSize: "12px" }}>
          <button type="button" onClick={() => setShowCode((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: 0, background: "transparent", border: 0, cursor: "pointer", color: "#4A4F5C", fontWeight: "600" }}>
            <Network size={13} strokeWidth={2.2} aria-hidden="true" />{showCode ? "Ver el diagrama" : "Ver el código"}
          </button>
          <button type="button" onClick={() => navigator.clipboard?.writeText(source).catch(() => {})} style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: 0, background: "transparent", border: 0, cursor: "pointer", color: "#4A4F5C", fontWeight: "600" }}>
            <Copy size={13} strokeWidth={2.2} aria-hidden="true" />{"Copiar"}
          </button>
        </figcaption>
      ) : null}
    </figure>
  );
}
