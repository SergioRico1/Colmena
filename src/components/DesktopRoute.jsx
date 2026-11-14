import { ArrowRight, Download, Hexagon } from "./Icon.js";

// «Recomendado: la app de escritorio» (the owner's standing rule: recommend the desktop app over
// the web). Shared by the hosted onboarding (src/cloud/Setup.jsx), Ajustes › Tu cuenta de IA and
// Inicio. Only what is true today (docs/CLOUD.md › Phase 5): the app opens the company's same
// workspace, with the tray, notices and «Pregunta rápida», and lends the person's cloud bots this
// computer's folders, browser with its sessions, 1Password or Bitwarden, and Claude Code. A
// subscription works there on the computer; the company's cloud bots thinking with it through the
// computer is not built yet, and the copy says «muy pronto».

export const DOWNLOADS = Object.freeze([
  { id: "windows", label: "Descargar para Windows", short: "Windows", href: "https://colmena.team/descargar/windows" },
  { id: "mac", label: "Descargar para Mac (Apple)", short: "Mac (Apple)", href: "https://colmena.team/descargar/mac" },
  { id: "mac-intel", label: "Descargar para Mac (Intel)", short: "Mac (Intel)", href: "https://colmena.team/descargar/mac-intel" },
]);

/** The visitor's system, to make its download the main button (Apple chips are the default Mac). */
export function detectOs() {
  if (typeof navigator === "undefined") return "windows";
  const ua = String(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || "");
  if (/win/i.test(ua)) return "windows";
  if (/mac/i.test(ua)) return "mac";
  return "windows";
}

/** What the app adds, in the product's words. */
export const DESKTOP_GAINS = Object.freeze([
  "Tu suscripción de ChatGPT o Claude funciona en tu propio ordenador (que la usen también los bots de la empresa llega muy pronto).",
  "Tus bots usan tus carpetas, tu navegador con tus sesiones y 1Password o Bitwarden.",
  "Avisos del sistema y «Pregunta rápida» con un atajo de teclado.",
  "Abre la misma empresa que ves aquí: todo sigue en la nube.",
]);

const btn = (strong) => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px", minHeight: "40px", padding: "0 16px", borderRadius: "var(--r-pill)", border: strong ? 0 : "1px solid var(--c-line-strong)", background: strong ? "var(--c-btn)" : "transparent", color: strong ? "var(--c-btn-text)" : "var(--c-text)", font: "600 var(--t-ui)/1 'Geist', sans-serif", textDecoration: "none", whiteSpace: "nowrap" });

/** The three downloads, the visitor's own first and strongest. */
export function Downloads({ small = false }) {
  const os = detectOs();
  const list = [...DOWNLOADS].sort((a, b) => (a.id === os ? -1 : b.id === os ? 1 : 0));
  return (
    <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
      {list.map((d, i) => (
        <a key={d.id} href={d.href} rel="noopener" style={{ ...btn(i === 0), ...(small || i ? { minHeight: "36px", padding: "0 12px", fontSize: "var(--t-meta)" } : {}) }}>
          {i === 0 ? <Download size={16} aria-hidden="true" /> : null}{i === 0 ? d.label : d.short}
        </a>
      ))}
    </span>
  );
}

/**
 * `compact`: the subscription route inside «Conecta tu IA» (one line, the downloads, «Ya la tengo»).
 * Otherwise the full panel: what the app adds and the downloads. `devicesHref`: where pairing
 * this computer starts (Ajustes › Tus dispositivos).
 */
export default function DesktopRoute({ plan = null, compact = false, devicesHref = "/ajustes/dispositivos" }) {
  const note = { margin: 0, fontSize: "var(--t-meta)", lineHeight: 1.5, color: "var(--c-text-2)" };
  if (compact)
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <p style={note}>{`En la app de escritorio, tu suscripción de ${plan || "ChatGPT o Claude"} funciona en tu ordenador. Que los bots de esta empresa piensen con ella mientras tu ordenador esté encendido llega muy pronto.`}</p>
        <Downloads small />
        <a href={devicesHref} style={{ display: "inline-flex", alignItems: "center", gap: "6px", alignSelf: "flex-start", minHeight: "32px", fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-accent-ink)", textUnderlineOffset: "3px" }}>Ya la tengo: conectar mi ordenador<ArrowRight size={14} aria-hidden="true" /></a>
      </div>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
        {DESKTOP_GAINS.map((g) => (
          <li key={g} style={{ display: "flex", gap: "10px", alignItems: "flex-start", fontSize: "var(--t-ui)", lineHeight: 1.45, color: "var(--c-text-2)" }}>
            <Hexagon size={14} aria-hidden="true" style={{ flex: "none", marginTop: "3px", color: "var(--c-text-3)" }} />{g}
          </li>
        ))}
      </ul>
      <Downloads />
    </div>
  );
}
