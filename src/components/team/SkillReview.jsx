import { useEffect, useMemo, useState } from "react";
import { X } from "../Icon.js";
import ReactMarkdown from "react-markdown";
import { patch } from "../../lib/api.js";
import { useAction, useResource, useStore } from "../../lib/store.jsx";
import { BotAvatar, Notice, Spinner, longDay } from "./common.jsx";
import { useDialogFocus } from "../../lib/useDialogFocus.js";
import { C } from "../../lib/theme.js";

// «Revisar pasos» of a skill: what the bot learned, step by step, and what changed
// since the previous version. Dialog language of the command palette mockup.

const stripFront = (text) => (text || "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();

/** Line diff (LCS) → [{ type: 'same'|'add'|'del', text }]. */
export function lineDiff(before, after) {
  const a = (before || "").split(/\r?\n/);
  const b = (after || "").split(/\r?\n/);
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: "same", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: "del", text: a[i++] });
    else out.push({ type: "add", text: b[j++] });
  }
  while (i < n) out.push({ type: "del", text: a[i++] });
  while (j < m) out.push({ type: "add", text: b[j++] });
  return out;
}

const ORIGIN = {
  learned: (s) => `Aprendida sola ${s.learnedFrom || "tras repetir tareas parecidas"}`,
  imported: (s) => `Importada${s.source ? ` de ${s.source}` : ""}`,
  shared: (s) => `Compartida${s.source ? ` por ${s.source}` : " por el equipo"}`,
};

const STATUS = {
  pending: { label: "Sin revisar", style: { background: "var(--c-honey-soft)", color: "var(--c-text)" } },
  active: { label: "Activa", style: { background: "var(--c-ok-soft)", color: "var(--c-ok-ink)" } },
  disabled: { label: "Descartada", style: { background: "var(--c-sunken)", color: "var(--c-text-3)" } },
  stale: { label: "Sin usar", style: { background: "var(--c-honey-soft)", color: "var(--c-text)" } },
  archived: { label: "Archivada", style: { background: "var(--c-sunken)", color: "var(--c-text-3)" } },
};

const MD_CSS = `
.colmena-skill-md{font-size:15px;line-height:1.6;color:var(--c-text-2)}
.colmena-skill-md>*:first-child{margin-top:0}.colmena-skill-md>*:last-child{margin-bottom:0}
.colmena-skill-md h1{font:700 20px/1.2 'Bricolage Grotesque',sans-serif;margin:0 0 10px;color:var(--c-text)}
.colmena-skill-md h2,.colmena-skill-md h3{font:700 16px/1.25 'Bricolage Grotesque',sans-serif;margin:18px 0 8px;color:var(--c-text)}
.colmena-skill-md p{margin:0 0 10px}
.colmena-skill-md ul{margin:0 0 10px;padding-left:20px}
.colmena-skill-md ol{counter-reset:paso;list-style:none;margin:0 0 12px;padding:0;display:flex;flex-direction:column;gap:8px}
.colmena-skill-md ol>li{counter-increment:paso;position:relative;padding:10px 12px 10px 50px;background:var(--c-hover);border:1px solid rgb(var(--c-ink-rgb) / .06);border-radius:12px}
.colmena-skill-md ol>li::before{content:counter(paso);position:absolute;left:12px;top:9px;width:26px;height:26px;border-radius:50%;background:var(--c-honey);border:2px solid var(--c-text);display:grid;place-items:center;font:700 12px/1 'Geist Mono',monospace;color:var(--c-text)}
.colmena-skill-md code{font:500 13px/1.4 'Geist Mono',monospace;padding:1px 5px;background:var(--c-sunken);border-radius:4px}
.colmena-skill-md pre{margin:0 0 10px;padding:12px;background:var(--c-hover);border:1px solid rgb(var(--c-ink-rgb) / .06);border-radius:12px;overflow:auto}
.colmena-skill-md pre code{padding:0;background:none}
.colmena-skill-md a{color:var(--c-accent-ink);text-decoration:underline}
`;

export default function SkillReview({ skillId, onClose }) {
  const { bots } = useStore();
  // One quiet retry: a skill that was just updated (or Colmena restarting) can miss the first time.
  const [attempt, setAttempt] = useState(0);
  const { data: skill, error, loading } = useResource(skillId ? `/skills/${skillId}${attempt ? "?r=" + attempt : ""}` : null);
  useEffect(() => {
    if (!error || skill || attempt) return undefined;
    const t = setTimeout(() => setAttempt(1), 800);
    return () => clearTimeout(t);
  }, [error, skill, attempt]);
  const missing = error && !skill && attempt && /no encontrad/i.test(error);
  const { act, busy, error: actionError } = useAction();
  const dialog = useDialogFocus({ onEscape: onClose });

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const body = useMemo(() => stripFront(skill?.content), [skill?.content]);
  const diff = useMemo(() => (skill?.previous ? lineDiff(stripFront(skill.previous.content), body) : null), [skill?.previous, body]);
  const bot = bots.find((b) => b.id === skill?.botId);
  const origin = skill ? (ORIGIN[skill.origin] || ORIGIN.learned)(skill) : "";
  const status = STATUS[skill?.status] || STATUS.pending;

  const setStatus = async (next) => {
    const done = await act(() => patch(`/skills/${skillId}`, { status: next }));
    if (done !== undefined) onClose();
  };

  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 50, background: "var(--c-scrim)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "96px 16px 32px", overflowY: "auto" }}>
      <style>{MD_CSS}</style>
      <div ref={dialog} tabIndex={-1} data-autofocus="" role="dialog" aria-modal="true" aria-labelledby="skill-review-t" style={{ width: "min(720px, 100%)", maxHeight: "calc(100vh - 128px)", background: "var(--c-card)", border: "0", borderRadius: "var(--r-md)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", padding: "20px 22px 16px", borderBottom: "1px solid rgb(var(--c-ink-rgb) / .06)" }}>
          {bot ? <BotAvatar bot={bot} size={40} /> : null}
          <div style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={{ font: "500 var(--t-micro)/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--c-text-3)" }}>Revisar pasos{bot ? ` · ${bot.name}` : ""}</span>
            <h2 id="skill-review-t" style={{ margin: 0, font: "600 var(--t-read)/1.3 'Geist', sans-serif" }}>{skill?.name || (loading ? "Cargando…" : "Habilidad")}</h2>
            {skill ? (
              <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>
                {origin}{skill.createdAt ? ` · ${longDay(skill.createdAt)}` : ""}
                <span style={{ padding: "3px 8px", borderRadius: "var(--r-sm)", font: "600 var(--t-micro)/1.4 'Geist Mono', monospace", letterSpacing: "0.04em", textTransform: "uppercase", ...status.style }}>{status.label}</span>
                {skill.version ? <span style={{ font: "500 var(--t-caption)/1 'Geist Mono', monospace", color: "var(--c-text-3)" }}>v{skill.version}</span> : null}
              </span>
            ) : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "var(--r-md)", cursor: "pointer" }}><X size={16} /></button>
        </div>

        <div style={{ flex: "1", minHeight: 0, overflowY: "auto", padding: "18px 22px", display: "flex", flexDirection: "column", gap: "18px" }}>
          {missing ? <Notice>{"No encuentro esta habilidad: puede que se haya actualizado o borrado mientras la mirabas. Cierra y vuelve a abrirla desde la lista."}</Notice> : error && attempt ? <Notice>{error}</Notice> : null}
          {skill?.description ? <p style={{ margin: 0, fontSize: "var(--t-body)", lineHeight: "1.5", color: "var(--c-text-2)" }}>{skill.description}</p> : null}
          {skill && ["stale", "archived"].includes(skill.status) ? (
            <p style={{ margin: 0, padding: "12px 14px", background: "var(--c-hover)", border: "1px solid rgb(var(--c-ink-rgb) / .06)", borderRadius: "var(--r-md)", fontSize: "var(--t-ui)", lineHeight: "1.5" }}>
              <strong>{skill.status === "stale" ? "Lleva un mes sin usarse." : "Archivada por falta de uso."}</strong> Ya no se ofrece a los bots; no se ha borrado nada. Reactívala si la quieres de nuevo.
            </p>
          ) : null}
          {skill && skill.status === "pending" ? (
            <p style={{ margin: 0, padding: "12px 14px", background: "var(--c-honey-soft)", border: "0", borderRadius: "var(--r-md)", fontSize: "var(--t-ui)", lineHeight: "1.5" }}>
              <strong>Aún no la usa.</strong> Revisa los pasos: solo la aplicará cuando la actives.
            </p>
          ) : null}
          {skill ? (
            body ? <div className="colmena-skill-md"><ReactMarkdown>{body}</ReactMarkdown></div> : <p style={{ margin: 0, fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>Esta habilidad no tiene pasos escritos.</p>
          ) : null}
          {diff ? (
            <section aria-labelledby="skill-diff-t" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "8px" }}>
                <h3 id="skill-diff-t" style={{ margin: 0, font: "600 var(--t-lead)/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>Qué cambia respecto a la versión {skill.previous.version}</h3>
                <span style={{ display: "flex", gap: "10px", font: "500 var(--t-caption)/1 'Geist Mono', monospace", color: "var(--c-text-3)" }}>
                  <span><span style={{ padding: "1px 5px", background: "var(--c-ok-soft)", borderRadius: "var(--r-xs)", color: "var(--c-ok-ink)" }}>+ {diff.filter((d) => d.type === "add").length}</span></span>
                  <span><span style={{ padding: "1px 5px", background: "var(--c-error-soft)", borderRadius: "var(--r-xs)", color: "var(--c-error)" }}>− {diff.filter((d) => d.type === "del").length}</span></span>
                </span>
              </div>
              <div role="list" aria-label="Diferencias línea a línea" style={{ border: "1px solid rgb(var(--c-ink-rgb) / .06)", borderRadius: "var(--r-md)", overflow: "hidden", font: "400 var(--t-meta)/1.55 'Geist Mono', monospace" }}>
                {diff.map((d, i) => (
                  <div key={i} role="listitem" style={{ display: "grid", gridTemplateColumns: "24px 1fr", padding: "1px 10px", background: d.type === "add" ? "var(--c-ok-soft)" : d.type === "del" ? "var(--c-error-soft)" : "var(--c-card)", color: d.type === "del" ? "var(--c-error)" : d.type === "add" ? "var(--c-ok-ink)" : C.text3 }}>
                    <span aria-label={d.type === "add" ? "Añadida" : d.type === "del" ? "Quitada" : undefined}>{d.type === "add" ? "+" : d.type === "del" ? "−" : ""}</span>
                    <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", textDecoration: d.type === "del" ? "line-through" : "none" }}>{d.text || " "}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {actionError ? <Notice>{actionError}</Notice> : null}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: "8px", padding: "14px 22px", borderTop: "1px solid rgb(var(--c-ink-rgb) / .06)", background: "var(--c-hover)" }}>
          <button type="button" onClick={onClose} style={{ height: "36px", padding: "0 14px", background: "transparent", border: "0", borderRadius: "var(--r-sm)", cursor: "pointer", fontSize: "var(--t-ui)", textDecoration: "underline", color: "var(--c-text-3)" }}>Cerrar</button>
          {skill && skill.status !== "disabled" ? (
            <button type="button" disabled={busy} onClick={() => setStatus("disabled")} style={{ height: "36px", padding: "0 14px", background: "rgb(var(--c-ink-rgb) / .06)", border: "0", borderRadius: "var(--r-sm)", cursor: busy ? "wait" : "pointer", fontWeight: "600", fontSize: "var(--t-ui)" }}>{skill.status === "active" ? "Desactivar" : "Descartar"}</button>
          ) : null}
          {skill && skill.status !== "active" ? (
            <button type="button" disabled={busy} onClick={() => setStatus("active")} style={{ display: "flex", alignItems: "center", gap: "8px", height: "36px", padding: "0 14px", background: "var(--c-honey)", color: "var(--c-honey-ink)", border: "0", borderRadius: "var(--r-sm)", cursor: busy ? "wait" : "pointer", fontWeight: "700", fontSize: "var(--t-ui)" }}>{busy ? <Spinner size={14} /> : null}{["stale", "archived"].includes(skill.status) ? "Reactivar" : "Activar"}</button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
