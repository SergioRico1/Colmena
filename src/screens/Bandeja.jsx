import { freshness, leave } from "../lib/motion.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, Check, CheckCheck, CircleAlert, Clock3, Euro, Globe, Lock, RotateCcw, ShieldCheck, Trash2, Users, X, Zap } from "lucide-react";
import { addUnsent, useUnsent } from "../lib/unsent.js";
import ApprovalShot from "../components/computer/ApprovalShot.jsx";
import Markdown from "../components/room/Markdown.jsx";
import { css } from "../design/css/Bandeja.js";
import Sidebar from "../components/Sidebar.jsx";
import { Avatar, Emph, KIND_LABEL, isToday, sortPending } from "../components/home/shared.jsx";
import SecretPrompt from "../components/room/SecretPrompt.jsx";
import { ExpiryChip } from "../components/room/InlineApprovals.jsx";
import { unshowSent, useAction, useStore } from "../lib/store.jsx";
import { post } from "../lib/api.js";
import { botById } from "../lib/bots.js";
import { ago, plural, roomUrl, time } from "../lib/format.js";
import { navigate } from "../lib/router.jsx";
import ApprovalConflict, { ExpiredActions } from "../components/room/ApprovalConflict.jsx";

const FILTERS = [
  { id: "todo", label: "Todo" },
  { id: "preguntas", label: "Preguntas" },
  { id: "envios", label: "Envíos" },
  { id: "permisos", label: "Permisos" },
];
const inFilter = (f, a) => f === "todo" || (f === "preguntas" && a.kind === "question") || (f === "envios" && a.kind === "send") || (f === "permisos" && !["question", "send"].includes(a.kind));

// Badge colours per kind (ENVÍO, PREGUNTA, PERMISO from the mockup; the rest reuse PERMISO).
const BADGE = {
  send: { background: "#EEE8FF", color: "#3E1FA3" },
  question: { background: "#E1F4EC", color: "#0B5A3E" },
  other: { background: "#FFEBDC", color: "#8A3A00" },
  expired: { background: "#EEF0F4", color: "#4A4F5C" },
};

// What a red line affects, in one sentence (server/impact.mjs): warm when it leaves your
// organisation, costs money, is public or deletes; quiet when it stays inside.
const IMPACT = {
  external: { Icon: Users, warm: true }, internal: { Icon: Users, warm: false },
  money: { Icon: Euro, warm: true }, public: { Icon: Globe, warm: true },
  private: { Icon: Lock, warm: false }, delete: { Icon: Trash2, warm: true },
};
function ImpactLine({ impact, full = false }) {
  if (!impact?.headline) return null;
  const { Icon, warm } = IMPACT[impact.tone] || IMPACT.external;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", padding: full ? "10px 16px" : "8px 10px", background: warm ? BADGE.other.background : "#EEF0F4", color: warm ? BADGE.other.color : "#4A4F5C", borderRadius: full ? "0" : "8px", fontSize: "14px", lineHeight: "1.4", ...(full ? { borderBottom: "1px solid #E6E8EE" } : { alignSelf: "flex-start" }) }}>
      <Icon size={16} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", marginTop: "1px" }} />
      <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <strong style={{ fontWeight: "600" }}>{impact.headline}</strong>
        {full ? (impact.details || []).map((d, i) => <span key={i} style={{ fontSize: "13px" }}>{d}</span>) : null}
      </span>
    </div>
  );
}

const ERROR = { margin: "0", fontSize: "13px", color: "#B4372A", fontWeight: "600" };

// Only permissions that stay inside Colmena can be decided together; questions, plans,
// sends and red lines (money, publishing, anything leaving) are always reviewed one by one.
const batchable = (a) => a.status === "pending" && !["question", "send", "plan", "skill", "soul"].includes(a.kind) && !a.redLine && !a.external && a.tool !== "apps_execute";

/** «Permitir las N» / «Denegar las N» for several local permissions at once. */
function BatchBar({ items }) {
  const { refresh } = useStore();
  const [ask, setAsk] = useState(null); // "approved" | "denied"
  const [busy, setBusy] = useState(null); // { done, total }
  const [result, setResult] = useState(null);
  if (items.length < 2 && !result) return null;
  const run = async (decision) => {
    setAsk(null);
    setResult(null);
    let ok = 0, changed = 0;
    for (let i = 0; i < items.length; i++) {
      setBusy({ done: i, total: items.length });
      try {
        await post(`/approvals/${items[i].id}`, { decision, revision: items[i].revision });
        ok++;
      } catch (e) {
        changed++; // changed meanwhile (409) or no longer pending: left for you to review
      }
    }
    setBusy(null);
    await refresh();
    const verb = decision === "approved" ? "Permitidas" : "Denegadas";
    setResult(`${verb}: ${ok}.${changed ? ` ${changed} cambiaron mientras tanto y siguen aquí para revisarlas.` : ""}`);
    setTimeout(() => setResult(null), 6000);
  };
  const box = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", padding: "12px 14px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "14px", fontSize: "14px" };
  if (result) return <p role="status" style={{ ...box, margin: 0, background: "#E1F4EC", borderColor: "#A8DCC5", color: "#0B5E41", fontWeight: "600" }}>{result}</p>;
  return (
    <div role="group" aria-label="Decidir varias a la vez" style={box}>
      <span style={{ flex: "1 1 260px", color: "#2B2D36" }}>
        <strong>{`${items.length} permisos`}</strong>{" que no salen de Colmena. Puedes decidirlos de una vez; lo que sale fuera se revisa siempre uno a uno."}
      </span>
      {busy ? <span role="status" style={{ fontWeight: "600" }}>{`Decidiendo ${busy.done + 1} de ${busy.total}…`}</span>
        : ask ? (
          <>
            <span style={{ fontWeight: "600" }}>{ask === "approved" ? `¿Permitir los ${items.length}?` : `¿Denegar los ${items.length}?`}</span>
            <button type="button" onClick={() => run(ask)} style={{ height: "38px", padding: "0 14px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "10px", cursor: "pointer", fontWeight: "600" }}>{ask === "approved" ? "Sí, permitir" : "Sí, denegar"}</button>
            <button type="button" onClick={() => setAsk(null)} style={{ height: "38px", padding: "0 12px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "10px", cursor: "pointer" }}>Cancelar</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setAsk("approved")} style={{ height: "38px", padding: "0 14px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "10px", cursor: "pointer", fontWeight: "600" }}>{`Permitir los ${items.length}`}</button>
            <button type="button" onClick={() => setAsk("denied")} style={{ height: "38px", padding: "0 12px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "10px", cursor: "pointer" }}>{`Denegar los ${items.length}`}</button>
          </>
        )}
    </div>
  );
}
const CARD = { background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "16px", padding: "18px", display: "grid", gridTemplateColumns: "40px 1fr", gap: "14px" };
const CARD_ON = { background: "#FFFFFF", border: "2px solid #12131A", borderRadius: "16px", boxShadow: "6px 6px 0 #FFC93C", padding: "18px", display: "grid", gridTemplateColumns: "40px 1fr", gap: "14px" };
const BTN_DARK = { height: "42px", padding: "0 16px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "10px", cursor: "pointer", fontWeight: "600", fontSize: "14px" };
const BTN_LIGHT = { height: "42px", padding: "0 14px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "10px", cursor: "pointer", fontSize: "14px" };
const BTN_GHOST = { height: "42px", padding: "0 14px", background: "transparent", border: "0", borderRadius: "10px", cursor: "pointer", fontSize: "14px", color: "#4A4F5C" };
const LINK_ROOM = { display: "flex", alignItems: "center", height: "42px", padding: "0 10px", fontSize: "14px", fontWeight: "600", color: "#1F4FD1" };

function roomOf(a, missions) {
  const m = missions.find((x) => x.id === a.missionId);
  return m ? roomUrl(m) : a.missionId ? `/sala/${a.missionId}` : null;
}

export default function Bandeja({ query = {} }) {
  const { approvals, missions, bots, suggestions } = useStore();
  const [filter, setFilter] = useState("todo");
  // Links from rooms and notices open the exact request (/bandeja?aprobacion=<id>).
  const [selectedId, setSelectedId] = useState(query.aprobacion || null);
  useEffect(() => {
    if (query.aprobacion) setSelectedId(query.aprobacion);
  }, [query.aprobacion]);
  const cards = useRef({});

  const expired = useMemo(() => approvals.filter((a) => a.status === "expired"), [approvals]);
  const pending = useMemo(() => [...sortPending(approvals), ...expired], [approvals, expired]);
  const resolved = useMemo(
    () => approvals.filter((a) => !["pending", "expired"].includes(a.status) && isToday(a.decidedAt)).sort((a, b) => Date.parse(b.decidedAt) - Date.parse(a.decidedAt)),
    [approvals],
  );
  const counts = {
    todo: pending.length,
    preguntas: pending.filter((a) => inFilter("preguntas", a)).length,
    envios: pending.filter((a) => inFilter("envios", a)).length,
    permisos: pending.filter((a) => inFilter("permisos", a)).length,
  };
  // Only the kinds that have something; no filters at all when there is a single kind.
  const filters = FILTERS.filter((f) => f.id === "todo" || counts[f.id] > 0);
  const showFilters = filters.length > 2;
  const list = pending.filter((a) => inFilter(showFilters ? filter : "todo", a));
  const selIndex = Math.max(0, list.findIndex((a) => a.id === selectedId));
  const selected = list[selIndex] || null;
  const always = suggestions.find((s) => s.kind === "always-approve");

  // Keyboard (OpenClaw approvals): deciding needs Ctrl — Ctrl+Intro allows once,
  // Ctrl+Mayús+Intro always, Ctrl+D denies (asks why) — so a letter typed by mistake never
  // approves anything; nothing fires from a text field. J/K move.
  const approveRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.repeat) return;
      if (fromTextEntry(e)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (!mod && !e.altKey && (key === "j" || key === "k") && list.length) {
        e.preventDefault();
        const next = Math.min(list.length - 1, Math.max(0, selIndex + (key === "j" ? 1 : -1)));
        setSelectedId(list[next].id);
        cards.current[list[next].id]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else if (mod && !e.altKey && key === "enter" && selected) {
        e.preventDefault();
        approveRef.current?.(e.shiftKey ? "always" : "once");
      } else if (mod && !e.altKey && !e.shiftKey && key === "d" && selected) {
        e.preventDefault();
        approveRef.current?.("deny");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list, selIndex, selected]);

  const oldest = pending.reduce((o, a) => (!o || Date.parse(a.createdAt || 0) < Date.parse(o.createdAt || 0) ? a : o), null);
  const waitingLine = pending.length === 0
    ? "Aquí llega lo que necesita tu decisión: preguntas, envíos y permisos."
    : `${pending.length === 1 ? "1 cosa espera tu decisión" : `${pending.length} cosas esperan tu decisión`}${oldest?.createdAt ? ` · ${pending.length === 1 ? "desde" : "la más antigua,"} ${ago(oldest.createdAt)}` : ""}.`;
  const empty = pending.length === 0;

  return (
    <>
      <style>{css}</style>
      <div style={{ minHeight: "100vh", display: "flex", flexWrap: "wrap", background: "#EEF0F4" }}>
        <Sidebar variant="compact" active="bandeja" />
        <main style={{ flex: "999 1 560px", minWidth: "0", display: "flex", flexWrap: "wrap", alignItems: "stretch" }}>
          <section aria-labelledby="bandeja-t" style={{ flex: "999 1 520px", minWidth: "0", padding: "28px clamp(16px, 3vw, 36px) 48px", display: "flex", flexDirection: "column", gap: "22px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "14px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <h1 id="bandeja-t" style={{ margin: "0", font: "800 36px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>Bandeja</h1>
                <p style={{ margin: "0", fontSize: "15px", color: "#4A4F5C" }}>{waitingLine}</p>
              </div>
              {empty ? null : <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#4A4F5C" }}>
                <Kbd>Ctrl+Intro</Kbd>permitir
                <Kbd>Ctrl+Mayús+Intro</Kbd>siempre
                <Kbd>Ctrl+D</Kbd>denegar
                <Kbd>J K</Kbd>moverse
              </span>}
            </div>
            {showFilters ? <div role="group" aria-label="Filtrar" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {filters.map((f) => {
                const on = f.id === filter;
                const style = on
                  ? { height: "40px", padding: "0 14px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "20px", cursor: "pointer", fontWeight: "600", fontSize: "14px" }
                  : { height: "40px", padding: "0 14px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "20px", cursor: "pointer", fontSize: "14px" };
                return (
                  <button key={f.id} type="button" aria-pressed={on ? "true" : "false"} onClick={() => { setFilter(f.id); setSelectedId(null); }} style={style}>
                    {`${f.label} · ${counts[f.id]}`}
                  </button>
                );
              })}
            </div> : null}

            {empty ? <AllClear /> : <BatchBar items={list.filter(batchable)} />}
            {!empty ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {list.map((a) => (
                  <ApprovalCard
                    key={a.id}
                    a={a}
                    on={a.id === selected?.id}
                    bot={botById(bots, a.botId)}
                    room={roomOf(a, missions)}
                    cardRef={(el) => { cards.current[a.id] = el; }}
                    onSelect={() => setSelectedId(a.id)}
                    approveRef={a.id === selected?.id ? approveRef : null}
                  />
                ))}
              </div>
            ) : null}

            <Unsent missions={missions} bots={bots} />
            <DoneToday resolved={resolved} bots={bots} missions={missions} />
          </section>

          {empty ? null : <aside aria-label={selected?.kind === "send" || !selected ? "Vista previa del envío" : "Vista previa"} style={{ flex: "1 1 420px", minWidth: "0", background: "#FFFFFF", borderLeft: "1px solid #DCE0E8", padding: "24px", display: "flex", flexDirection: "column", gap: "18px", position: "sticky", top: 0, alignSelf: "flex-start", height: "calc(100vh - var(--chrome, 0px))", overflowY: "auto", overscrollBehavior: "contain" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
              <span style={{ font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}>
                {!selected || selected.kind === "send" ? "Vista previa · lo que se enviará" : selected.kind === "question" ? "Vista previa · lo que pregunta" : "Vista previa · lo que se pide"}
              </span>
              {selected ? <span style={{ fontSize: "13px", color: "#4A4F5C" }}>{`${selIndex + 1} de ${list.length}`}</span> : null}
            </div>
            <Preview a={selected} bot={botById(bots, selected?.botId)} />
            {always ? <AlwaysSuggestion s={always} /> : null}
          </aside>}
        </main>
      </div>
    </>
  );
}

/** Empty Bandeja: one calm state instead of «Nada te espera» three times. */
function AllClear() {
  return (
    <section aria-label="Todo al día" style={{ display: "flex", alignItems: "center", gap: "18px", padding: "26px 24px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "18px" }}>
      <span aria-hidden="true" style={{ width: "52px", height: "52px", flex: "none", display: "grid", placeItems: "center", borderRadius: "16px", background: "#E1F4EC", color: "#0B6B4A" }}><CheckCheck size={26} strokeWidth={2.2} className="c-draw" /></span>
      <span style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <strong style={{ font: "700 22px/1.15 'Bricolage Grotesque', sans-serif" }}>Todo al día</strong>
        <span style={{ fontSize: "15px", lineHeight: "1.5", color: "#4A4F5C" }}>{"Cuando un bot te pregunte algo o necesite tu OK para enviar, pagar o publicar, aparecerá aquí y te avisaremos."}</span>
      </span>
    </section>
  );
}

const OUTCOME = {
  ok: { Icon: Check, style: { background: "#E1F4EC", color: "#0B5A3E" } },
  no: { Icon: Ban, style: { background: "#FDE8E8", color: "#8A1C1C" } },
  rule: { Icon: Zap, style: { background: "#EEF0F4", color: "#4A4F5C" } },
  review: { Icon: ShieldCheck, style: { background: "#EEF0F4", color: "#4A4F5C" } },
  late: { Icon: Clock3, style: { background: "#EEF0F4", color: "#4A4F5C" } },
};
function outcomeOf(a) {
  if (a.decidedBy === "regla") return { tone: "rule", label: "Regla" };
  if (a.decidedBy === "revisor") return { tone: "review", label: "Revisor" };
  if (a.status === "denied") return { tone: "no", label: a.kind === "send" ? "No se envió" : "Denegado" };
  if (a.status === "expired") return { tone: "late", label: "Caducó" };
  if (a.status === "answered") return { tone: "ok", label: "Respondido" };
  if (a.kind === "plan") return { tone: "ok", label: "Plan aprobado" };
  if (a.kind === "send") return { tone: "ok", label: "Enviado" };
  return { tone: "ok", label: "Aprobado" };
}

/**
 * «No se enviaron»: your messages that did not reach their room (lost connection, Colmena
 * closed…). Reintentar sends them again as they were; Abrir takes you there; × forgets them.
 */
function Unsent({ missions, bots }) {
  const list = useUnsent();
  const [sending, setSending] = useState(null);
  if (!list.length) return null;
  const retry = async (u) => {
    setSending(u.id);
    const path = "/missions/" + u.missionId;
    try {
      await post(path + "/messages", { text: u.text });
      unshowSent(path, u.id);
    } catch (error) {
      addUnsent({ ...u, error: error.message, at: new Date().toISOString() });
    } finally {
      setSending(null);
    }
  };
  return (
    <section aria-labelledby="no-enviados" style={{ display: "flex", flexDirection: "column", gap: "8px", paddingTop: "4px" }}>
      <h2 id="no-enviados" style={{ margin: "0", display: "flex", alignItems: "baseline", gap: "10px", font: "700 18px/1.1 'Bricolage Grotesque', sans-serif" }}>
        {"No se enviaron"}<span style={{ font: "600 13px/1 'Geist Mono', monospace", color: "#555A68" }}>{list.length}</span>
      </h2>
      <div style={{ background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "16px", overflow: "hidden" }}>
        {list.map((u, i) => {
          const m = missions.find((x) => x.id === u.missionId);
          const where = !m ? "Conversación borrada" : m.conversation ? "Chat con " + (botById(bots, m.botIds?.[0])?.name || "un bot") : "#" + (m.room || m.title);
          return (
            <div key={u.id} style={{ display: "grid", gridTemplateColumns: "28px 1fr auto", alignItems: "center", gap: "12px", padding: "10px 12px 10px 16px", borderTop: i ? "1px solid #E6E8EE" : "0" }}>
              <span aria-hidden="true" style={{ width: "28px", height: "28px", display: "grid", placeItems: "center", borderRadius: "8px", background: "#FDE8E8", color: "#B4372A" }}><CircleAlert size={15} strokeWidth={2.4} /></span>
              <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                <span style={{ fontSize: "14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.text.replace(/\s+/g, " ")}</span>
                <span style={{ fontSize: "12px", color: "#555A68", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{`${where} · ${ago(u.at)} · ${u.error}`}</span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                {m ? (
                  <>
                    <button type="button" className="rm-focus" disabled={sending === u.id} onClick={() => retry(u)} style={{ display: "inline-flex", alignItems: "center", gap: "5px", height: "32px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", border: 0, borderRadius: "9px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
                      <RotateCcw size={13} strokeWidth={2.4} aria-hidden="true" />{sending === u.id ? "Enviando…" : "Reintentar"}
                    </button>
                    <button type="button" className="rm-focus" onClick={() => navigate(roomUrl(m))} style={{ height: "32px", padding: "0 12px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "9px", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#12131A" }}>Abrir</button>
                  </>
                ) : null}
                <button type="button" className="rm-focus" aria-label="Descartar este mensaje" title="Descartar" onClick={() => unshowSent("/missions/" + u.missionId, u.id)} style={{ width: "32px", height: "32px", display: "grid", placeItems: "center", background: "transparent", border: 0, borderRadius: "9px", cursor: "pointer", color: "#555A68" }}>
                  <X size={15} strokeWidth={2.4} aria-hidden="true" />
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** «Hecho hoy»: one line per decision; the room opens on click; more than 5 fold. */
function DoneToday({ resolved, bots, missions }) {
  const [all, setAll] = useState(false);
  const isNew = freshness("hecho-hoy", resolved.map((a) => a.id));
  if (!resolved.length) return null;
  const shown = all ? resolved : resolved.slice(0, 5);
  return (
    <section aria-labelledby="hecho-hoy" style={{ display: "flex", flexDirection: "column", gap: "8px", paddingTop: "4px" }}>
      <h2 id="hecho-hoy" style={{ margin: "0", display: "flex", alignItems: "baseline", gap: "10px", font: "700 18px/1.1 'Bricolage Grotesque', sans-serif" }}>
        {"Hecho hoy"}<span style={{ font: "600 13px/1 'Geist Mono', monospace", color: "#555A68" }}>{resolved.length}</span>
      </h2>
      <div style={{ background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "16px", overflow: "hidden" }}>
        {shown.map((a, i) => {
          const bot = botById(bots, a.botId);
          const m = missions.find((x) => x.id === a.missionId);
          const out = outcomeOf(a);
          const { Icon, style } = OUTCOME[out.tone];
          const text = a.title || a.summary || "";
          const href = m ? roomUrl(m) : null;
          return (
            <button key={a.id} type="button" disabled={!href} onClick={() => href && navigate(href)} className={"rm-focus" + (isNew(a.id) ? " c-enter" : "")} title={(a.summary || text) + (a.resolution && ["rule", "review"].includes(out.tone) ? " · " + a.resolution : "") + (a.denyReason ? " · Motivo: " + a.denyReason : "")}
              style={{ width: "100%", display: "grid", gridTemplateColumns: "48px 24px 1fr auto", alignItems: "center", gap: "12px", minHeight: "52px", padding: "8px 16px", background: "transparent", border: "0", borderTop: i ? "1px solid #E6E8EE" : "0", cursor: href ? "pointer" : "default", textAlign: "left", color: "#12131A", fontSize: "14px" }}>
              <span style={{ font: "500 13px/1 'Geist Mono', monospace", color: "#555A68" }}>{time(a.decidedAt)}</span>
              <Avatar bot={bot} size={24} />
              <span style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: "8px" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
                {m ? <span style={{ flex: "none", color: "#555A68" }}>{"#" + (m.room || m.title)}</span> : null}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", height: "26px", padding: "0 9px", borderRadius: "13px", fontSize: "12px", fontWeight: "600", whiteSpace: "nowrap", ...style }}>
                <Icon size={13} strokeWidth={2.6} aria-hidden="true" />{out.label}
              </span>
            </button>
          );
        })}
      </div>
      {resolved.length > 5 ? <button type="button" onClick={() => setAll(!all)} style={{ alignSelf: "flex-start", padding: "4px 0", background: "transparent", border: "0", cursor: "pointer", fontSize: "14px", fontWeight: "600", color: "#1F4FD1" }}>{all ? "Ver menos" : "Ver las " + resolved.length}</button> : null}
    </section>
  );
}

/** The automatic reviewer's word on a card: looking at it, or why it left it for you. */
function ReviewerLine({ a }) {
  if (a.status !== "pending" || (!a.reviewing && !a.reviewNote)) return null;
  return (
    <p style={{ margin: "0", display: "flex", alignItems: "flex-start", gap: "6px", fontSize: "13px", lineHeight: "1.45", color: "#4A4F5C" }}>
      <ShieldCheck size={14} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", marginTop: "2px" }} />
      <span>{a.reviewing ? "El revisor de Colmena lo está mirando: si es rutina, lo aprobará por ti." : "El revisor lo deja para ti: " + a.reviewNote}</span>
    </p>
  );
}

const Kbd = ({ children }) => <span style={{ font: "500 12px/1 'Geist Mono', monospace", padding: "5px 7px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "6px" }}>{children}</span>;
/** A key from a text field (or anything editable) never decides an approval. */
export const fromTextEntry = (e) => (e.composedPath?.() || [e.target]).some((t) => t instanceof Element && t.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));

/** Why you say no (optional); Enter denies, Escape goes back. */
function DenyForm({ name, busy, label, onDeny, onCancel }) {
  const [reason, setReason] = useState("");
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);
  return (
    <form className="c-enter" onSubmit={(e) => { e.preventDefault(); onDeny(reason.trim()); }} style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "8px" }}>
      <label style={{ flex: "1 1 280px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", color: "#4A4F5C" }}>
        {`¿Por qué? Se lo diremos a ${name} para que lo corrija (opcional)`}
        <input ref={input} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }}
          placeholder="Por ejemplo: usa la plantilla de la empresa" style={{ height: "42px", padding: "0 12px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "10px", fontSize: "14px", color: "#12131A" }} />
      </label>
      <button type="submit" disabled={busy} style={BTN_DARK}>{label}</button>
      <button type="button" onClick={onCancel} style={BTN_GHOST}>Cancelar</button>
    </form>
  );
}

function ApprovalCard({ a, on, bot, room, cardRef, onSelect, approveRef }) {
  const { act, busy, error, conflict } = useAction();
  // Decisions carry the revision of what you are looking at; if it changed you get a 409.
  // A decided card folds away while the decision is saved (comes back if it fails).
  const self = useRef(null);
  const decide = (decision, always, reason = "") => act(() => leave(self.current, () => post(`/approvals/${a.id}`, { decision, revision: a.revision, ...(always ? { always: true } : {}), ...(reason ? { reason } : {}) })));
  const answer = (optionId) => act(() => leave(self.current, () => post(`/approvals/${a.id}/answer`, { optionId, revision: a.revision })));
  // «Denegar» first asks why (optional): the bot reads the reason on its next turn.
  const [denying, setDenying] = useState(false);
  const kind = KIND_LABEL[a.kind] ? a.kind : "permission";
  const badge = BADGE[kind] || BADGE.other;
  const name = bot?.name || "El bot";
  const context = a.context || [name, a.blocks ? `bloquea ${plural(a.blocks, "paso", "pasos")}` : null, ago(a.createdAt)].filter(Boolean).join(" · ");
  const dim = busy ? { opacity: "0.6" } : {};

  if (approveRef) {
    approveRef.current = (how = "once") => {
      if (busy || a.status === "expired") return;
      const decidable = kind === "send" || ["permission", "write", "memory", "soul"].includes(kind);
      if (how === "deny") { if (decidable) setDenying(true); return; }
      if (decidable) decide("approved", how === "always" && a.canAlways && kind !== "send");
      else if (kind === "question" && how === "once") {
        const primary = (a.options || []).find((o) => o.primary);
        if (primary) answer(primary.id);
      }
    };
  }

  const isExpired = a.status === "expired";
  let actions;
  if (isExpired) {
    actions = null;
  } else if (kind === "send") {
    actions = (
      <>
        <button type="button" disabled={busy} onClick={() => decide("approved")} style={{ height: "42px", padding: "0 16px", background: "#FFC93C", border: "2px solid #12131A", borderRadius: "10px", cursor: "pointer", fontWeight: "700", fontSize: "14px", ...dim }}>Aprobar y enviar</button>
        <a href={`/bandeja/${a.id}/editar`} style={{ display: "flex", alignItems: "center", height: "42px", padding: "0 14px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "10px", fontSize: "14px" }}>Editar</a>
        <button type="button" disabled={busy} onClick={() => setDenying(true)} style={BTN_GHOST}>Rechazar</button>
      </>
    );
  } else if (kind === "question") {
    const opts = a.options || [];
    const firstDark = Math.max(0, opts.findIndex((o) => o.primary));
    let outlined = false;
    actions = (
      <>
        {opts.map((o, i) => {
          let style;
          if (i === firstDark) style = { height: "42px", padding: "0 14px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "10px", cursor: "pointer", fontWeight: "600", fontSize: "14px" };
          else if (!outlined) { outlined = true; style = { height: "42px", padding: "0 14px", background: "#FFFFFF", border: "1px solid #12131A", borderRadius: "10px", cursor: "pointer", fontSize: "14px" }; }
          else style = BTN_LIGHT;
          return <button key={o.id} type="button" disabled={busy} onClick={() => answer(o.id)} style={{ ...style, ...dim }}>{o.label}</button>;
        })}
        {room ? <a href={room} style={LINK_ROOM}>Abrir en la sala</a> : null}
      </>
    );
  } else if (kind === "skill") {
    actions = (
      <>
        <a href={`/equipo/${a.botId}?skill=${encodeURIComponent(a.skillId || a.targetId || a.id)}`} style={{ ...BTN_DARK, display: "flex", alignItems: "center" }}>Revisar</a>
        <button type="button" disabled={busy} onClick={() => decide("denied")} style={BTN_GHOST}>Denegar</button>
      </>
    );
  } else if (kind === "secret") {
    // A key is typed in its own masked box, never with A/Ctrl+Intro.
    actions = <div style={{ flex: "1 1 100%" }}><SecretPrompt approval={a} bots={bots} compact /></div>;
  } else if (kind === "plan") {
    actions = (
      <>
        <a href={room || "/misiones"} style={{ ...BTN_DARK, display: "flex", alignItems: "center" }}>Ver el plan</a>
      </>
    );
  } else {
    actions = (
      <>
        <button type="button" disabled={busy} onClick={() => decide("approved")} style={{ ...BTN_DARK, ...dim }}>Permitir esta vez</button>
        {a.canAlways ? <button type="button" disabled={busy} onClick={() => decide("approved", true)} style={{ ...BTN_LIGHT, ...dim }}>{`Permitir siempre a ${name}`}</button> : null}
        <button type="button" disabled={busy} onClick={() => setDenying(true)} style={BTN_GHOST}>Denegar</button>
      </>
    );
  }

  return (
    <article ref={(el) => { self.current = el; cardRef?.(el); }} aria-current={on ? "true" : undefined} onClick={onSelect} style={on ? CARD_ON : CARD}>
      <Avatar bot={bot} size={40} />
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: "0" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
          <span style={{ font: "600 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", padding: "4px 7px", ...badge, borderRadius: "5px" }}>{KIND_LABEL[kind]}</span>
          {isExpired ? <span style={{ font: "600 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", padding: "4px 7px", ...BADGE.expired, borderRadius: "5px" }}>Caducado</span> : null}
          <span style={{ fontSize: "13px", color: "#555A68" }}>{context}</span>
          {isExpired ? null : <ExpiryChip expiresAt={a.expiresAt} style={{ marginLeft: "auto" }} />}
        </div>
        <p style={{ margin: "0", fontSize: "16px", lineHeight: "1.45", ...(isExpired ? { color: "#4A4F5C" } : {}) }}>
          <Emph text={a.summary} strong={a.title} />
        </p>
        <ImpactLine impact={a.impact} />
        <ReviewerLine a={a} />
        {a.computer ? <ApprovalShot approvalId={a.id} /> : null}
        {isExpired ? (
          <>
            <p style={{ margin: "0", fontSize: "14px", lineHeight: "1.45", color: "#4A4F5C" }}>{`Pasaron más de 30 minutos sin decidirlo, así que no se hará. Pide a ${name} que lo vuelva a preparar con los datos de ahora.`}</p>
            <ExpiredActions a={a} name={name} dark={BTN_DARK} light={BTN_LIGHT} ghost={BTN_GHOST} />
          </>
        ) : (
          denying ? <DenyForm name={name} busy={busy} label={kind === "send" ? "Rechazar" : "Denegar"} onDeny={(reason) => decide("denied", false, reason)} onCancel={() => setDenying(false)} />
            : <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>{actions}</div>
        )}
        <ApprovalConflict error={error} conflict={conflict} />
      </div>
    </article>
  );
}

/** Email body as in the mockup: blank lines split paragraphs, «– » / «- » / «• » lines become a list. */
function EmailBody({ text }) {
  const blocks = String(text || "").replace(/\r/g, "").split(/\n\s*\n/).filter((b) => b.trim());
  return blocks.map((block, i) => {
    const lines = block.split("\n");
    const bullet = /^\s*[–\-•*]\s+/;
    const items = lines.filter((l) => bullet.test(l));
    if (items.length && items.length === lines.filter((l) => l.trim()).length) {
      return (
        <ul key={i} style={{ margin: "0", paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>
          {items.map((l, j) => <li key={j}>{l.replace(bullet, "")}</li>)}
        </ul>
      );
    }
    // Paragraph followed by bullets (e.g. «Lo más importante:\n– …»).
    const firstBullet = lines.findIndex((l) => bullet.test(l));
    if (firstBullet > 0 && lines.slice(firstBullet).every((l) => bullet.test(l) || !l.trim())) {
      return (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <p style={{ margin: "0", whiteSpace: "pre-line" }}>{lines.slice(0, firstBullet).join("\n")}</p>
          <ul style={{ margin: "0", paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>
            {lines.slice(firstBullet).filter((l) => l.trim()).map((l, j) => <li key={j}>{l.replace(bullet, "")}</li>)}
          </ul>
        </div>
      );
    }
    return <p key={i} style={{ margin: "0", whiteSpace: "pre-line" }}>{block}</p>;
  });
}

const fileName = (f) => (typeof f === "string" ? f : f?.name || "");

function Preview({ a, bot }) {
  const frame = { border: "1px solid #DCE0E8", borderRadius: "14px", overflow: "hidden" };
  const head = { padding: "14px 16px", background: "#F7F8FA", borderBottom: "1px solid #E6E8EE", display: "flex", flexDirection: "column", gap: "8px", fontSize: "14px" };
  const row = { display: "grid", gridTemplateColumns: "64px 1fr", gap: "8px" };
  const body = { padding: "18px 16px", fontSize: "15px", lineHeight: "1.6", display: "flex", flexDirection: "column", gap: "12px" };
  const foot = { padding: "10px 16px", borderTop: "1px solid #E6E8EE", fontSize: "12px", color: "#555A68" };
  const name = bot?.name || "El bot";

  if (!a) {
    return (
      <div style={frame}>
        <div style={body}><p style={{ margin: "0" }}>Nada te espera. Cuando un bot necesite tu OK, aquí verás exactamente lo que quiere hacer.</p></div>
      </div>
    );
  }

  if (a.kind === "send" && a.email) {
    const e = a.email;
    const files = (e.attachments || []).map(fileName).filter(Boolean);
    return (
      <div style={frame}>
        <ImpactLine impact={a.impact} full />
        <div style={head}>
          <div style={row}><span style={{ color: "#555A68" }}>Para</span><span>{(e.to || []).join(", ") || "—"}</span></div>
          {e.cc?.length ? <div style={row}><span style={{ color: "#555A68" }}>CC</span><span>{e.cc.join(", ")}</span></div> : null}
          {e.cco?.length ? <div style={row}><span style={{ color: "#555A68" }}>CCO</span><span>{e.cco.join(", ")}</span></div> : null}
          <div style={row}><span style={{ color: "#555A68" }}>Asunto</span><strong>{e.subject}</strong></div>
        </div>
        <div style={body}><EmailBody text={e.body} /></div>
        <div style={foot}>
          {`Redactado por ${name}. Se enviará con tu nombre.`}
          {files.length ? ` Adjuntos: ${files.join(", ")}.` : ""}
        </div>
      </div>
    );
  }

  return (
    <div style={frame}>
      <ImpactLine impact={a.impact} full />
      <div style={head}>
        <div style={row}><span style={{ color: "#555A68" }}>Quién</span><span>{name}{bot?.role ? ` · ${bot.role}` : ""}</span></div>
        <div style={row}><span style={{ color: "#555A68" }}>Qué</span><strong>{a.title || KIND_LABEL[a.kind]}</strong></div>
        {a.context ? <div style={row}><span style={{ color: "#555A68" }}>Dónde</span><span>{a.context}</span></div> : null}
      </div>
      <div style={body}>
        {a.summary ? <Markdown text={a.summary} size={15} /> : null}
        {a.kind === "question" && a.options?.length ? (
          <ul style={{ margin: "0", paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>
            {a.options.map((o) => <li key={o.id}>{o.label}</li>)}
          </ul>
        ) : null}
        {a.blocks ? <p style={{ margin: "0", color: "#4A4F5C" }}>{`Mientras no respondas, ${plural(a.blocks, "paso queda", "pasos quedan")} en espera.`}</p> : null}
      </div>
      <div style={foot}>{a.kind === "question" ? `Lo pregunta ${name}. Tu respuesta llega a la sala.` : `Lo pide ${name}. No se hace nada sin tu OK.`}</div>
    </div>
  );
}

function AlwaysSuggestion({ s }) {
  const { act, busy, error } = useAction();
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "14px 16px", background: "#F7F8FA", borderRadius: "12px" }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", marginTop: "1px" }}><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4v4.5h4.5" /></svg>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "14px", lineHeight: "1.45" }}>
        <span>{s.text}</span>
        <button type="button" disabled={busy} onClick={() => act(() => post(`/suggestions/${s.id}`, { decision: "accept" }))} style={{ alignSelf: "flex-start", height: "38px", padding: "0 12px", background: "#FFFFFF", border: "1px solid #12131A", borderRadius: "9px", cursor: "pointer", fontSize: "13px", fontWeight: "600", opacity: busy ? "0.6" : "1" }}>
          {s.cta || "Aprobarlo siempre a partir de ahora"}
        </button>
        {error ? <p role="alert" style={ERROR}>{error}</p> : null}
      </div>
    </div>
  );
}

