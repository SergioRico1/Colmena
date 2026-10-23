import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, CircleCheck, CircleMinus, CircleX, ClipboardCopy, RefreshCw, TriangleAlert } from "lucide-react";
import { api } from "../../../lib/api.js";
import { navigate } from "../../../lib/router.jsx";
import { updates, useUpdates } from "../../../lib/updates.js";
import { FAINT, Group, INK, LINE, MUTED, anchorOf, pill } from "./rows.jsx";

// Ajustes › Diagnóstico («t3 doctor» for a person who is not technical): one click checks
// the AI accounts, the code engines, the database and the disk, the server's stalls, the
// app connections and the updates, and says what fails and how to fix it.
// GET /api/diagnostics (server/diagnostics.mjs); the updates are read here, from the app.

const GROUPS = [
  ["ia", "Cuentas de IA", "diag-ia"],
  ["codigo", "Motores de código", "diag-codigo"],
  ["datos", "Base de datos y disco", "diag-datos"],
  ["servidor", "Servidor", "diag-servidor"],
  ["apps", "Conexiones de apps", "diag-apps"],
  ["actualizaciones", "Actualizaciones", "diag-actualizaciones"],
];
const LOOK = {
  ok: { Icon: CircleCheck, color: "#0B8A5F", word: "Bien" },
  warn: { Icon: TriangleAlert, color: "#A86A00", word: "Revisar" },
  fail: { Icon: CircleX, color: "#B4372A", word: "Falla" },
  off: { Icon: CircleMinus, color: "#9A9DA6", word: "Sin usar" },
};

// The last result lives outside the screen: the section list shows its dot, and coming back
// to Diagnóstico shows it at once.
let last = null;
let running = null;
const subs = new Set();
const tell = () => { for (const fn of subs) fn(); };
export function runDiagnostics() {
  running ||= api("/diagnostics").then((r) => { last = { ...r, error: null }; return last; }, (e) => { last = { ...(last || {}), error: e.message }; return last; }).finally(() => { running = null; tell(); });
  tell();
  return running;
}
export function useDiagnostics() {
  useSyncExternalStore((fn) => { subs.add(fn); return () => subs.delete(fn); }, () => (running ? "r" : "") + (last?.at || ""), () => "");
  return { result: last, running: !!running };
}
/** The dot of Diagnóstico in the section list: red if something fails, amber to review. */
export function diagnosticsDot(result) {
  if (!result?.summary) return null;
  if (result.summary.fail) return { color: "#B4372A", label: `Diagnóstico: ${result.summary.fail} ${result.summary.fail === 1 ? "cosa falla" : "cosas fallan"}` };
  return null;
}

function updateCheck(u) {
  const base = { id: "updates", group: "actualizaciones", title: "Colmena" };
  if (!u) return { ...base, status: "off", text: "Las actualizaciones las lleva la app de escritorio." };
  if (u.status === "error") return { ...base, status: "warn", text: u.error || "No se pudo buscar la versión nueva.", fix: u.manual ? "Descárgala a mano desde Acerca de." : "Vuelve a buscar en Acerca de.", to: "/ajustes/acerca#actualizaciones" };
  if (u.status === "ready") return { ...base, status: "warn", text: `La ${u.version} está lista${u.waiting ? " y se instalará cuando el equipo termine" : ""}.`, fix: u.waiting ? null : "Reinicia Colmena para usarla.", to: "/ajustes/acerca#actualizaciones" };
  if (u.status === "downloading") return { ...base, status: "ok", text: `Descargando la ${u.version}… ${u.percent || 0} %` };
  return { ...base, status: "ok", text: `Estás al día · Colmena ${u.current}${u.channel === "beta" ? " (beta)" : ""}.` };
}

function Command({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 3px 3px 10px", borderRadius: "10px", background: "#F4F4F0", font: "500 13px/1.4 'Geist Mono', monospace", color: INK }}>
      {text}
      <button type="button" onClick={copy} aria-label={copied ? "Copiado" : "Copiar la orden"} title="Copiar" style={{ width: "26px", height: "26px", display: "grid", placeItems: "center", border: 0, borderRadius: "8px", background: "transparent", cursor: "pointer", color: copied ? "#0B8A5F" : MUTED }}>
        {copied ? <Check size={14} strokeWidth={2.4} aria-hidden="true" /> : <ClipboardCopy size={14} strokeWidth={2.2} aria-hidden="true" />}
      </button>
    </span>
  );
}

function CheckRow({ c, last: isLast }) {
  const look = LOOK[c.status] || LOOK.off;
  const { Icon } = look;
  const mono = c.id === "data:folder";
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", minHeight: "64px", padding: "14px 20px", borderBottom: isLast ? 0 : LINE, animation: "fade .3s ease-out" }}>
      <Icon size={20} strokeWidth={2.2} color={look.color} aria-hidden="true" style={{ flex: "none", marginTop: "1px" }} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "2px 10px" }}>
          <strong style={{ fontSize: "15px", fontWeight: 600 }}>{c.title}</strong>
          <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{look.word}</span>
        </span>
        <span style={{ fontSize: "14px", lineHeight: 1.5, color: c.status === "fail" ? "#8F1D22" : MUTED, overflowWrap: "anywhere", ...(mono ? { font: "500 12px/1.5 'Geist Mono', monospace" } : {}) }}>{c.text}</span>
        {c.fix || c.command || c.to ? (
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px", marginTop: "4px", fontSize: "14px", lineHeight: 1.5, color: INK }}>
            {c.fix ? <span>{c.fix}</span> : null}
            {c.command ? <Command text={c.command} /> : null}
            {c.to ? <a href={c.to} onClick={(e) => { e.preventDefault(); navigate(c.to); }} style={{ fontSize: "14px", fontWeight: 600, color: "#1F4FD1", textDecoration: "none", whiteSpace: "nowrap" }}>{c.status === "off" ? "Ir allí" : "Arreglarlo"}</a> : null}
          </span>
        ) : null}
      </span>
    </div>
  );
}

const verdict = (s) => (!s ? null
  : s.fail ? { title: s.fail === 1 ? "Hay una cosa que falla" : `Hay ${s.fail} cosas que fallan`, color: "#B4372A", Icon: CircleX }
  : s.warn ? { title: s.warn === 1 ? "Todo funciona, con una cosa que revisar" : `Todo funciona, con ${s.warn} cosas que revisar`, color: "#A86A00", Icon: TriangleAlert }
  : { title: "Todo funciona", color: "#0B8A5F", Icon: CircleCheck });

/** The report as plain text, to paste in an email to whoever helps you. */
function reportText(checks, at) {
  const lines = [`Diagnóstico de Colmena · ${new Date(at).toLocaleString("es-ES")}`, ""];
  for (const [g, label] of GROUPS) {
    const list = checks.filter((c) => c.group === g);
    if (!list.length) continue;
    lines.push(label);
    for (const c of list) lines.push(`  [${(LOOK[c.status] || LOOK.off).word}] ${c.title}: ${c.text}${c.fix ? " → " + c.fix : ""}${c.command ? " (" + c.command + ")" : ""}`);
    lines.push("");
  }
  return lines.join("\n");
}

export default function DiagnosticsSection() {
  const { result, running } = useDiagnostics();
  const u = useUpdates();
  const [copied, setCopied] = useState(false);
  // The first visit checks at once; afterwards it is your click.
  useEffect(() => { if (!last && !running) runDiagnostics(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const checks = result?.checks ? [...result.checks, updateCheck(u)] : null;
  const summary = checks ? checks.reduce((s, c) => ({ ...s, [c.status]: (s[c.status] || 0) + 1 }), {}) : null;
  const v = verdict(summary);
  const copy = () => navigator.clipboard?.writeText(reportText(checks, result.at)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
  return (
    <>
      <section {...anchorOf("comprobar")} aria-live="polite" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px 20px", padding: "24px", borderRadius: "26px", background: "#FFFFFF", scrollMarginTop: "24px" }}>
        <span style={{ flex: "1 1 260px", minWidth: 0, display: "flex", alignItems: "center", gap: "16px" }}>
          {running && !v ? (
            <span aria-hidden="true" style={{ width: "40px", height: "40px", flex: "none", borderRadius: "50%", border: "3px solid rgba(18,19,26,.1)", borderTopColor: INK, animation: "spin .9s linear infinite" }} />
          ) : v ? <v.Icon size={40} strokeWidth={1.8} color={v.color} aria-hidden="true" style={{ flex: "none" }} /> : null}
          <span style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
            <strong style={{ font: "600 24px/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{running && !v ? "Comprobando…" : v ? v.title : "Sin comprobar todavía"}</strong>
            <span style={{ fontSize: "14px", color: result?.error ? "#B4372A" : FAINT }}>
              {result?.error ? "No pude comprobarlo: " + result.error
                : running ? "Mirando cuentas, motores, datos y conexiones…"
                : result?.at ? `Comprobado a las ${new Date(result.at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} · tardó ${(result.ms / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} s` : "Tarda unos segundos y no cambia nada."}
            </span>
          </span>
        </span>
        <span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {checks ? <button type="button" onClick={copy} style={pill(false)}>{copied ? <Check size={16} strokeWidth={2.4} aria-hidden="true" /> : <ClipboardCopy size={16} strokeWidth={2.2} aria-hidden="true" />}{copied ? "Copiado" : "Copiar el informe"}</button> : null}
          <button type="button" onClick={() => { runDiagnostics(); updates?.check?.(); }} disabled={running} style={{ ...pill(true), cursor: running ? "wait" : "pointer", opacity: running ? 0.7 : 1 }}>
            <RefreshCw size={16} strokeWidth={2.2} aria-hidden="true" style={{ animation: running ? "spin .9s linear infinite" : "none" }} />{running ? "Comprobando…" : "Comprobar ahora"}
          </button>
        </span>
      </section>
      {checks ? GROUPS.map(([g, label, anchor]) => {
        const list = checks.filter((c) => c.group === g);
        if (!list.length) return null;
        // What fails first, then what to review; «sin usar» last.
        const order = { fail: 0, warn: 1, ok: 2, off: 3 };
        const sorted = [...list].sort((a, b) => order[a.status] - order[b.status]);
        return (
          <Group key={g} id={"dg-" + g} title={label} anchor={anchor}>
            {sorted.map((c, i) => <CheckRow key={c.id} c={c} last={i === sorted.length - 1} />)}
          </Group>
        );
      }) : null}
      {checks ? <p style={{ margin: "0 20px", fontSize: "13px", lineHeight: 1.5, color: FAINT }}>Comprobar no cambia nada: solo lee. La base de datos se revisa con una copia aparte de solo lectura, sin pararla.</p> : null}
    </>
  );
}
