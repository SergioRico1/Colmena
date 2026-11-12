import { useEffect, useState, useSyncExternalStore } from "react";
import { FileText, X } from "lucide-react";
import { btn } from "./parts.jsx";
import { freshCompletions } from "../../../lib/completion.js";
import { post } from "../../../lib/api.js";
import { navigate } from "../../../lib/router.jsx";
import { useStore } from "../../../lib/store.jsx";

// A visible end when work finishes (lib/completion.js): a calm card on Inicio and a line in
// the conversation, for what finished while you were in the app. What was delivered, how long
// it took and one next action («Abrir», plus the bot's own suggestions). It arrives with the
// usual short rise, which «reduce motion» switches off (styles/base.css); nothing else moves.

// When this window opened, the runs seen to start (for «en 14 min») and what you closed.
const tracker = { since: Date.now(), started: new Map(), dismissed: new Set() };
const subs = new Set();
let version = 0;
const WORKING = new Set(["queued", "planning", "running"]);

export function dismissCompletion(summary) {
  tracker.dismissed.add(summary.id + ":" + summary.at);
  version++;
  for (const fn of subs) fn();
}

/** The summaries of what finished while you were here, newest first. */
export function useCompletions() {
  const store = useStore();
  useSyncExternalStore((fn) => { subs.add(fn); return () => subs.delete(fn); }, () => version, () => version);
  const [now, setNow] = useState(() => Date.now());
  // A run seen working keeps the time it started; a new turn of a chat starts again.
  useEffect(() => {
    for (const m of store.missions || []) {
      if (WORKING.has(m.status)) { if (!tracker.started.has(m.id) || tracker.started.get(m.id) < (Date.parse(m.completedAt || 0) || 0)) tracker.started.set(m.id, Date.now()); }
    }
  }, [store.missions]);
  const list = freshCompletions(store, { since: tracker.since, now, dismissed: tracker.dismissed, started: tracker.started });
  // They leave by themselves after a while: look again once a minute while any is up.
  useEffect(() => {
    if (!list.length) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [list.length]);
  return list;
}

const go = (href) => (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); navigate(href); };
const Check = ({ size = 22 }) => (
  <span aria-hidden="true" style={{ width: size + "px", height: size + "px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: "#0B8A5F" }}>
    <svg width={size / 2} height={size / 2} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
  </span>
);
const fileChip = { display: "inline-flex", alignItems: "center", gap: "8px", maxWidth: "100%", height: "34px", padding: "0 12px", borderRadius: "10px", background: "#F3F3EF", fontSize: "13.5px", color: "#12131A" };
const meta = (s) => [s.who, s.took ? "en " + s.took : null].filter(Boolean).join(" · ");

function Deliverables({ list }) {
  if (!list.length) return null;
  return (
    <ul aria-label="Lo que ha entregado" style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {list.map((d) => (
        <li key={d.id} style={{ minWidth: 0 }}>
          <a href={d.href} onClick={go(d.href)} style={fileChip}>
            <FileText size={14} strokeWidth={2} aria-hidden="true" style={{ flex: "none", color: "#5C606C" }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Inicio: one calm card per piece of work that finished while you were here. */
export function CompletionCards() {
  const list = useCompletions();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  if (!list.length) return null;
  // A suggestion is the next thing to ask in that same conversation: it is sent there.
  const follow = async (s, text) => {
    if (busy) return;
    setBusy(s.id + text);
    setError(null);
    try { await post(`/missions/${s.id}/messages`, { text }); dismissCompletion(s); navigate(s.href); } catch (e) { setError(e?.message || "No se pudo enviar."); } finally { setBusy(null); }
  };
  return (
    <section aria-label="Terminado" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {list.map((s) => (
        <article key={s.id + s.at} aria-label={`Terminado: ${s.title}`} style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "18px 20px", borderRadius: "20px", background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(18,19,26,.08)", animation: "rise .4s ease-out" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
            <Check />
            <div role="status" style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
              <span style={{ fontSize: "16.5px", fontWeight: "600", lineHeight: "1.3", overflowWrap: "anywhere" }}>{`Terminado: ${s.title}`}</span>
              <span style={{ fontSize: "13.5px", color: "#5C606C" }}>{meta(s)}</span>
            </div>
            <button type="button" aria-label={`Cerrar el aviso de «${s.title}»`} onClick={() => dismissCompletion(s)} style={{ width: "32px", height: "32px", flex: "none", display: "grid", placeItems: "center", border: "0", borderRadius: "50%", background: "transparent", color: "#5C606C", cursor: "pointer" }}>
              <X size={15} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
          {s.line ? <p style={{ margin: "0", fontSize: "14.5px", lineHeight: "1.5", color: "#3D404A", maxWidth: "72ch" }}>{s.line + "."}</p> : null}
          <Deliverables list={s.deliverables} />
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
            <a href={s.open.href} onClick={go(s.open.href)} style={btn.dark}>{s.open.label}</a>
            {s.suggestions.map((t) => (
              <button key={t} type="button" disabled={!!busy} onClick={() => follow(s, t)} style={{ ...btn.line, maxWidth: "100%", fontSize: "14px" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t}</span>
              </button>
            ))}
          </div>
          {error ? <span role="alert" style={{ fontSize: "13.5px", color: "#B4232A" }}>{error}</span> : null}
        </article>
      ))}
    </section>
  );
}

/**
 * In the conversation, under the answer that closed the work: «Terminado en 14 min», what it
 * delivered and «Abrir». The bot's suggestions follow it there as usual.
 */
export function CompletionNote({ missionId }) {
  const summary = useCompletions().find((s) => s.id === missionId) || null;
  if (!summary) return null;
  return (
    <section role="status" aria-label="Terminado" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px 16px", borderRadius: "16px", background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(18,19,26,.08)", animation: "rise .3s ease-out" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
        <Check size={20} />
        <span style={{ flex: "1", minWidth: "180px", fontSize: "14.5px", lineHeight: "1.4" }}>
          <strong style={{ fontWeight: "600" }}>{summary.took ? `Terminado en ${summary.took}` : "Terminado"}</strong>
          {summary.deliverables.length ? <span style={{ color: "#5C606C" }}>{summary.deliverables.length === 1 ? " · 1 entrega" : ` · ${summary.deliverables.length} entregas`}</span> : null}
        </span>
        <a href={summary.open.href} onClick={go(summary.open.href)} className="rm-focus" style={{ ...btn.dark, height: "34px", padding: "0 14px", fontSize: "13.5px" }}>{summary.open.label}</a>
      </div>
      <Deliverables list={summary.deliverables} />
    </section>
  );
}
