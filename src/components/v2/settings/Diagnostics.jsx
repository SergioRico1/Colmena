import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, ClipboardCopy } from "lucide-react";
import { api } from "../../../lib/api.js";
import { updates, useUpdates } from "../../../lib/updates.js";
import { useExpert } from "../../../lib/expert.js";
import { Go, LINE, MUTED, anchorOf, btn } from "./v3.jsx";

// Ajustes › Ayuda y diagnóstico (design/V3Ajustes.dc.html; «t3 doctor» for a person who is not
// technical): one click checks the AI accounts, the code engines, the database and the disk,
// the local service, the app connections and the updates, and says what fails and how to fix
// it — one line per group, every check under it in expert mode. GET /api/diagnostics
// (server/diagnostics.mjs); the updates are read here, from the desktop app.

const GROUPS = [
  ["ia", "Cuentas de IA", "diag-ia"],
  ["codigo", "Motores de código", "diag-codigo"],
  ["datos", "Base de datos y disco", "diag-datos"],
  ["apps", "Conexiones de apps", "diag-apps"],
  ["servidor", "Servicio local", "diag-servidor"],
  ["actualizaciones", "Actualizaciones", "diag-actualizaciones"],
];
const ORDER = { fail: 0, warn: 1, ok: 2, off: 3 };
const MARK = {
  ok: ["✓", "#E3F4EC", "#0B6B4A", "Bien"],
  warn: ["!", "#FFC93C", "#12131A", "Revisar"],
  fail: ["!", "#FBEAE7", "#B4232A", "Falla"],
  off: ["–", "#F1F1EC", "#5C606C", "Sin usar"],
};

// The last result lives outside the screen: the section list shows its count, and coming
// back to Ayuda shows it at once.
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
/** The tag of «Ayuda y diagnóstico» in the section list: how many things fail or need a look. */
export function diagnosticsDot(result) {
  const s = result?.summary;
  if (!s || !(s.fail || s.warn)) return null;
  const n = (s.fail || 0) + (s.warn || 0);
  return { text: String(n), color: s.fail ? "#B4232A" : MUTED, label: s.fail ? `${s.fail} ${s.fail === 1 ? "cosa falla" : "cosas fallan"}` : `${n} ${n === 1 ? "cosa que revisar" : "cosas que revisar"}` };
}

function updateCheck(u) {
  const base = { id: "updates", group: "actualizaciones", title: "Colmena" };
  if (!u) return { ...base, status: "off", text: "Las actualizaciones las lleva la app de escritorio." };
  if (u.status === "error") return { ...base, status: "warn", text: u.error || "No se pudo buscar la versión nueva.", fix: u.manual ? "Descárgala a mano." : "Vuelve a buscar.", to: "/ajustes/ayuda#actualizaciones" };
  if (u.status === "ready") return { ...base, status: "warn", text: `Hay una versión nueva: la ${u.version}${u.waiting ? ", que se instalará cuando el equipo termine" : ""}.`, fix: u.waiting ? null : "Reinicia Colmena para usarla.", to: "/ajustes/ayuda#actualizaciones" };
  if (u.status === "downloading") return { ...base, status: "ok", text: `Descargando la ${u.version}… ${u.percent || 0} %` };
  return { ...base, status: "ok", text: `Estás al día · Colmena ${u.current}${u.channel === "beta" ? " (beta)" : ""}.` };
}

function Command({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "2px", padding: "2px 2px 2px 10px", borderRadius: "var(--r-sm)", background: "var(--c-chip)", font: "500 var(--t-meta)/1.4 'Geist Mono', monospace", color: "var(--c-text)" }}>
      {text}
      <button type="button" onClick={copy} aria-label={copied ? "Copiado" : "Copiar la orden"} title="Copiar" style={{ width: "24px", height: "24px", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-sm)", background: "transparent", cursor: "pointer", color: copied ? "var(--c-ok-ink)" : "var(--c-text-3)" }}>
        {copied ? <Check size={13} strokeWidth={2.4} aria-hidden="true" /> : <ClipboardCopy size={13} strokeWidth={2.2} aria-hidden="true" />}
      </button>
    </span>
  );
}

const Mark = ({ status }) => {
  const [glyph, bg, ink, word] = MARK[status] || MARK.off;
  return (
    <>
      <span aria-hidden="true" style={{ flex: "none", width: "22px", height: "22px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: bg, color: ink, fontSize: "var(--t-micro)", fontWeight: 700 }}>{glyph}</span>
      <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{word}</span>
    </>
  );
};

/** One group in one line: the worst of its checks decides the mark, the note and the fix. */
function GroupRow({ label, anchor, list, expert }) {
  const sorted = [...list].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const worst = sorted[0];
  const bad = worst.status === "fail" || worst.status === "warn";
  const used = sorted.filter((c) => c.status !== "off");
  const titles = used.map((c) => c.title);
  const one = used[0] || worst;
  const note = bad ? worst.text
    : used.length > 1 ? `${titles.slice(0, -1).join(", ")} y ${titles.at(-1)}: todo bien.`
    : one.title === label ? one.text : `${one.title}: ${one.text}`;
  return (
    <div {...anchorOf(anchor)} style={{ display: "flex", flexDirection: "column", borderTop: LINE, scrollMarginTop: "24px" }}>
      <div style={{ position: "relative", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px", minHeight: "48px", padding: "8px 0" }}>
        <Mark status={worst.status} />
        <span style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
          <span style={{ fontSize: "var(--t-body)", fontWeight: 500 }}>{label}</span>
          <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.45, color: worst.status === "fail" ? "var(--c-error)" : "var(--c-text-3)", overflowWrap: "anywhere" }}>{note}{bad && worst.fix ? " " + worst.fix : ""}</span>
          {bad && worst.command ? <span style={{ marginTop: "4px" }}><Command text={worst.command} /></span> : null}
        </span>
        {bad && worst.to ? <Go to={worst.to} style={btn("outline", 34)}>Arreglarlo</Go> : null}
      </div>
      {expert && sorted.length > 1 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "0 0 10px 34px" }}>
          {sorted.map((c) => (
            <span key={c.id} style={{ position: "relative", display: "flex", alignItems: "baseline", gap: "8px", fontSize: "var(--t-meta)", lineHeight: 1.5, color: "var(--c-text-3)" }}>
              <span aria-hidden="true" style={{ flex: "none", width: "6px", height: "6px", borderRadius: "var(--r-circle)", background: (MARK[c.status] || MARK.off)[2], transform: "translateY(-1px)" }} />
              <span><strong style={{ fontWeight: 600, color: "var(--c-text-2)" }}>{c.title}</strong> · {c.text}{c.command ? <span style={{ fontFamily: "'Geist Mono', monospace" }}>{" — " + c.command}</span> : null}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The report as plain text, to paste in an email to whoever helps you. */
function reportText(checks, at) {
  const lines = [`Diagnóstico de Colmena · ${new Date(at).toLocaleString("es-ES")}`, ""];
  for (const [g, label] of GROUPS) {
    const list = checks.filter((c) => c.group === g);
    if (!list.length) continue;
    lines.push(label);
    for (const c of list) lines.push(`  [${(MARK[c.status] || MARK.off)[3]}] ${c.title}: ${c.text}${c.fix ? " → " + c.fix : ""}${c.command ? " (" + c.command + ")" : ""}`);
    lines.push("");
  }
  return lines.join("\n");
}

const hm = (iso) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
function updateLine(u) {
  if (u.status === "checking") return "Buscando…";
  if (u.status === "downloading") return `Descargando la ${u.version}… ${u.percent || 0} %`;
  if (u.status === "ready") return u.waiting ? "Se actualizará cuando el equipo termine." : `La ${u.version} está lista. Se instala al reiniciar.`;
  if (u.status === "error") return u.error;
  return u.checkedAt ? "Al día · comprobado a las " + hm(u.checkedAt) : "Al día";
}

export default function HelpSection() {
  const { result, running } = useDiagnostics();
  const [expert] = useExpert();
  const u = useUpdates();
  const [copied, setCopied] = useState(false);
  const [notes, setNotes] = useState(false);
  // The first visit checks at once; afterwards it is your click.
  useEffect(() => { if (!last && !running) runDiagnostics(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const checks = result?.checks ? [...result.checks, updateCheck(u)] : null;
  const version = u?.current || /Colmena (\S+)/.exec(result?.checks?.find((c) => c.id === "server:version")?.text || "")?.[1] || "—";
  const copy = () => checks && navigator.clipboard?.writeText(reportText(checks, result.at)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
  const busy = u && (u.status === "checking" || u.status === "downloading");
  const label = running ? "Comprobando…" : result?.at ? `Comprobado a las ${hm(result.at)}` : "Comprobar ahora";
  return (
    <>
      <section {...anchorOf("comprobar")} aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "20px 22px", borderRadius: "var(--r-xl)", background: "var(--c-card)", scrollMarginTop: "24px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
          <span style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: "2px" }}>
            <span style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>Comprueba que todo funciona</span>
            {result?.error ? <span role="alert" style={{ fontSize: "var(--t-meta)", color: "var(--c-error)" }}>{"No pude comprobarlo: " + result.error}</span> : <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>Tarda unos segundos y no cambia nada: solo lee.</span>}
          </span>
          <button type="button" onClick={() => { runDiagnostics(); updates?.check?.(); }} disabled={running} title={result?.at ? "Comprobar otra vez" : undefined}
            style={{ ...btn("dark", 42), padding: "0 18px", fontSize: "var(--t-body)", cursor: running ? "wait" : "pointer" }}>
            {running ? <span aria-hidden="true" style={{ width: "14px", height: "14px", borderRadius: "var(--r-circle)", border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#FFFFFF", animation: "spin .9s linear infinite" }} /> : null}{label}
          </button>
        </div>
        {checks ? GROUPS.map(([g, groupLabel, anchor]) => {
          const list = checks.filter((c) => c.group === g);
          return list.length ? <GroupRow key={g} label={groupLabel} anchor={anchor} list={list} expert={expert} /> : null;
        }) : running ? <span style={{ height: "48px", borderRadius: "var(--r-md)", background: "linear-gradient(90deg, #F6F6F3, #EEEEEA, #F6F6F3)", backgroundSize: "200% 100%", animation: "shimmer 1.4s linear infinite" }} /> : null}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: "10px" }}>
        <div {...anchorOf("version")} style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "18px 20px", borderRadius: "var(--r-xl)", background: "var(--c-card)", scrollMarginTop: "24px" }}>
          <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>Versión</span>
          <span style={{ font: "600 var(--t-heading)/1 'Bricolage Grotesque', sans-serif" }}>{version}</span>
          {u ? (
            <>
              <span {...anchorOf("canal")} style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>
                {u.channel === "beta" ? "Canal beta · " : "Canal estable · "}
                <button type="button" onClick={() => updates.setChannel(u.channel === "beta" ? "stable" : "beta")} style={{ padding: 0, border: 0, background: "none", font: "inherit", color: "var(--c-accent-ink)", cursor: "pointer" }}>{u.channel === "beta" ? "volver a estable" : "cambiar a beta"}</button>
              </span>
              <span {...anchorOf("actualizaciones")} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", fontSize: "var(--t-meta)", color: u.status === "error" ? "var(--c-error)" : u.status === "ready" ? "var(--c-ok-ink)" : "var(--c-text-3)" }}>
                {updateLine(u)}
                {u.status === "ready" && !u.waiting ? <button type="button" onClick={() => updates.restart()} style={btn("dark", 30)}>Reiniciar</button>
                  : u.status === "error" && u.manual ? <button type="button" onClick={() => updates.download()} style={btn("dark", 30)}>Descargar</button>
                  : u.status === "ready" ? null
                  : <button type="button" disabled={busy || !u.supported} onClick={() => updates.check()} style={btn("outline", 30)}>{busy ? "Buscando…" : "Buscar"}</button>}
              </span>
              {u.notes && u.version ? (
                <>
                  <button type="button" aria-expanded={notes} onClick={() => setNotes(!notes)} style={{ alignSelf: "flex-start", padding: 0, border: 0, background: "none", font: "inherit", fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text)", cursor: "pointer" }}>{(notes ? "Ocultar" : "Ver") + " las novedades de la " + u.version}</button>
                  {notes ? <p style={{ margin: 0, fontSize: "var(--t-meta)", lineHeight: 1.55, color: "var(--c-text-3)", whiteSpace: "pre-wrap", animation: "fade .25s ease-out" }}>{u.notes}</p> : null}
                </>
              ) : null}
            </>
          ) : <span {...anchorOf("actualizaciones")} style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>Las actualizaciones las lleva la app de escritorio.</span>}
        </div>
        <button type="button" {...anchorOf("comentarios")} onClick={copy} disabled={!checks} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "6px", padding: "18px 20px", border: 0, borderRadius: "var(--r-xl)", background: "var(--c-card)", textAlign: "left", color: "var(--c-text)", cursor: checks ? "pointer" : "default", scrollMarginTop: "24px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "var(--t-body)", fontWeight: 600 }}>{copied ? <Check size={15} strokeWidth={2.4} color="#0B6B4A" aria-hidden="true" /> : null}{copied ? "Informe copiado" : "Enviar comentarios"}</span>
          <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>Copia el informe de la comprobación para pegarlo en un correo a quien te ayude.</span>
        </button>
      </div>
    </>
  );
}
