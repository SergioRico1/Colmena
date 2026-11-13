import { useEffect, useId, useState } from "react";
import { Copy, Network } from "../Icon.js";

// ```mermaid blocks drawn as diagrams (OpenClaw): flows, timelines, org charts… in Colmena's
// colours. Mermaid loads only the first time a diagram appears; strict mode sanitizes its SVG.
// While the bot is still writing the block (or if it is wrong) you see the code instead.

let loader = null;
// Mermaid needs real colour values, not var(): the theme tokens are read when a diagram is drawn
// (src/styles/base.css), so it follows light and dark. Honey is not used: it only means «te necesita».
const TOKENS = {
  primaryColor: "accent-soft", primaryBorderColor: "text", primaryTextColor: "text",
  secondaryColor: "sunken", secondaryBorderColor: "accent-ink",
  tertiaryColor: "sunken", tertiaryBorderColor: "line",
  lineColor: "text-3", textColor: "text",
  noteBkgColor: "chip", noteBorderColor: "line-strong",
  clusterBkg: "sunken", clusterBorder: "line", edgeLabelBackground: "card",
};
function themeVariables() {
  const css = getComputedStyle(document.documentElement);
  const vars = { fontFamily: "Geist, system-ui, sans-serif", fontSize: "14px" };
  for (const [key, token] of Object.entries(TOKENS)) { const v = css.getPropertyValue("--c-" + token).trim(); if (v) vars[key] = v; }
  return vars;
}
function loadMermaid() {
  loader ??= import("mermaid").then(({ default: mermaid }) => mermaid);
  return loader.then((mermaid) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: "Geist, system-ui, sans-serif",
      themeVariables: themeVariables(),
      flowchart: { curve: "basis", padding: 12 },
    });
    return mermaid;
  });
}
/** The resolved theme («light» | «dark»), followed while the diagram is on screen. */
function useTheme() {
  const [theme, setTheme] = useState(() => (typeof document === "undefined" ? "light" : document.documentElement.dataset.theme || "light"));
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(root.dataset.theme || "light"));
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export default function Diagram({ source }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState(null);
  const [failed, setFailed] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const theme = useTheme();
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
  }, [source, uid, theme]);
  const code = (
    <pre style={{ margin: 0, padding: "14px 16px", background: "var(--c-sunken)", color: "var(--c-text)", border: "1px solid var(--c-line)", borderRadius: "var(--r-md)", font: "400 var(--t-meta)/1.7 'Geist Mono', monospace", overflowX: "auto", whiteSpace: "pre" }}><code>{source}</code></pre>
  );
  if (failed && !svg) return code;
  return (
    <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
      {showCode ? code : (
        <div role="img" aria-label="Diagrama" className={svg ? "c-enter" : undefined}
          style={{ padding: "16px", background: "var(--c-card)", border: "1px solid var(--c-line)", borderRadius: "var(--r-md)", overflowX: "auto", display: "flex", justifyContent: "center", minHeight: svg ? undefined : "72px", alignItems: "center", color: "var(--c-text-3)", fontSize: "var(--t-meta)" }}
          {...(svg ? { dangerouslySetInnerHTML: { __html: svg } } : { children: "Dibujando el diagrama…" })} />
      )}
      {svg ? (
        <figcaption style={{ display: "flex", gap: "12px", fontSize: "var(--t-caption)" }}>
          <button type="button" onClick={() => setShowCode((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: 0, background: "transparent", border: 0, cursor: "pointer", color: "var(--c-text-2)", fontWeight: "600" }}>
            <Network size={13} strokeWidth={2.2} aria-hidden="true" />{showCode ? "Ver el diagrama" : "Ver el código"}
          </button>
          <button type="button" onClick={() => navigator.clipboard?.writeText(source).catch(() => {})} style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: 0, background: "transparent", border: 0, cursor: "pointer", color: "var(--c-text-2)", fontWeight: "600" }}>
            <Copy size={13} strokeWidth={2.2} aria-hidden="true" />{"Copiar"}
          </button>
        </figcaption>
      ) : null}
    </figure>
  );
}
