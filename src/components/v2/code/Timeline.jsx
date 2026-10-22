import { useState } from "react";
import { Search, Pencil, SquareTerminal, Globe, FilePen, FileDiff, History, ChevronRight, Bot, Sparkles, ListChecks, Wrench, Undo2, Check, Target } from "lucide-react";
import Markdown from "../../room/Markdown.jsx";
import { C, MONO, HEAD, CARD, Stat } from "./parts.jsx";
export { buildRows } from "./model.js";

// The timeline of a «Código» task: your messages, Bruno's answers, a grouped work log with
// each command's output on unfold (T3 Code), a card per turn that changed files («Ver
// cambios», «Volver aquí»), Bruno's questions and red lines.

/** Bruno's «[objetivo: …]» line is for Colmena (server/code/service.mjs GOAL_MARK), not for you. */
export const withoutGoalMark = (text) => String(text || "").replace(/\n*\[\s*objetivo\s*:\s*(cumplido|sigue|bloqueado)[^\]]*\]\s*$/i, "");

const VERB_ICON = { read: Search, search: Search, write: FilePen, edit: Pencil, run: SquareTerminal, web: Globe, agent: Bot, skill: Sparkles, plan: ListChecks, tool: Wrench };

function entryLine(entry) {
  const [first] = entry.items;
  const n = entry.items.length;
  if (entry.group === "read" && n > 1) return "Leyó " + n + " archivos";
  if (entry.group === "search" && n > 1) return "Hizo " + n + " búsquedas";
  return first.text;
}

function LogEntry({ entry }) {
  const [open, setOpen] = useState(false);
  const items = entry.items;
  const running = items.some((i) => i.status === "running");
  const failed = items.some((i) => i.status === "error");
  const denied = items.some((i) => i.status === "denied");
  const Icon = VERB_ICON[items[0].verb] || Wrench;
  const meta = running ? "en marcha" : denied ? "no permitido" : failed ? "falló" : items[0].steps ? items[0].steps + " pasos" : "";
  const details = items.map((i) => i.detail).filter(Boolean);
  const output = items.length === 1 ? items[0].output : "";
  const canOpen = details.length || output;
  return (
    <>
      <button type="button" onClick={() => canOpen && setOpen(!open)} aria-expanded={canOpen ? open : undefined} className="code-hover"
        style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "42px", padding: "0 12px", border: 0, borderRadius: "14px", background: "transparent", cursor: canOpen ? "pointer" : "default", textAlign: "left", width: "100%" }}>
        <span aria-hidden="true" style={{ width: "26px", height: "26px", flex: "none", display: "grid", placeItems: "center", borderRadius: "8px", background: C.soft, color: C.text }}>
          {running ? <span style={{ width: "12px", height: "12px", borderRadius: "50%", border: "2px solid rgba(255,122,26,.25)", borderTopColor: C.bruno, animation: "spin .8s linear infinite" }} /> : <Icon size={14} strokeWidth={2} />}
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: "14px", color: denied ? C.faint : C.ink, textDecoration: denied ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entryLine(entry)}</span>
        {meta ? <span style={{ font: `400 12px/1 ${MONO}`, color: running ? C.bruno : failed ? C.red : C.quiet, whiteSpace: "nowrap" }}>{meta}</span> : null}
        {canOpen ? <ChevronRight size={14} strokeWidth={2.2} color={C.quiet} aria-hidden="true" style={{ transition: "transform .2s ease", transform: open ? "rotate(90deg)" : "none" }} /> : null}
      </button>
      {open ? (
        <div style={{ margin: "2px 8px 8px 50px", padding: "14px 16px", borderRadius: "14px", background: C.ink, display: "flex", flexDirection: "column", gap: "3px", font: `400 12.5px/1.6 ${MONO}`, color: "#C9CBD1", animation: "rise .25s ease-out", maxHeight: "340px", overflow: "auto" }}>
          {details.map((d, k) => <span key={k} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: items[0].verb === "run" ? "#8A8D96" : "#C9CBD1" }}>{items[0].verb === "run" ? "> " + d : d}</span>)}
          {output ? <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: items[0].status === "error" ? "#FF8A80" : "#E6E7EC" }}>{output}</span> : null}
        </div>
      ) : null}
    </>
  );
}

function WorkLog({ row }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", padding: "6px", borderRadius: "20px", background: C.white, boxShadow: CARD }}>
      {row.entries.map((e) => <LogEntry key={e.id} entry={e} />)}
    </div>
  );
}

function TurnCard({ item, total, busy, onDiff, onRestore }) {
  const files = item.files || [];
  return (
    <div className="code-turn" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", padding: "14px 16px 14px 18px", borderRadius: "20px", background: C.white, boxShadow: CARD }}>
      <span aria-hidden="true" style={{ width: "30px", height: "30px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: C.soft, color: C.ink }}><FileDiff size={15} strokeWidth={2} /></span>
      <span style={{ flex: "1 1 180px", minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
        <strong style={{ fontSize: "14px", fontWeight: 600 }}>{files.length === 1 ? "1 archivo cambiado" : files.length + " archivos cambiados"}</strong>
        <span style={{ display: "flex", gap: "6px", alignItems: "center", font: `500 12px/1 ${MONO}` }}><Stat add={item.add} del={item.del} /><span style={{ color: C.quiet }}>· punto {item.n} de {total}</span></span>
      </span>
      <button type="button" onClick={() => onDiff(item.n)} style={{ height: "34px", padding: "0 14px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>Ver cambios</button>
      <button type="button" disabled={busy} onClick={() => onRestore(item.n)} title="Deja el proyecto como estaba justo después de este turno"
        style={{ display: "flex", alignItems: "center", gap: "6px", height: "34px", padding: "0 12px", border: 0, borderRadius: "999px", background: "transparent", cursor: busy ? "default" : "pointer", fontSize: "13px", fontWeight: 500, color: busy ? C.quiet : C.text }}>
        <History size={13} strokeWidth={2.2} aria-hidden="true" />Volver aquí
      </button>
    </div>
  );
}

function AskCard({ item, onAnswer }) {
  const [picked, setPicked] = useState({});
  const pending = item.status === "pending";
  const red = item.ask === "redline";
  if (item.ask === "question") {
    const qs = item.questions || [];
    const ready = qs.every((q) => picked[q.question]);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "22px 22px 18px", borderRadius: "24px", background: C.white, boxShadow: pending ? `0 0 0 1.5px ${C.ink}, 6px 6px 0 0 ${C.honey}` : CARD, animation: pending ? "sheet .45s cubic-bezier(.2,.8,.2,1)" : "none" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 600, color: pending ? C.honeyText : C.faint }}>
          {pending ? <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: C.honey, animation: "halo 1.8s ease-out infinite" }} /> : null}
          {pending ? "Bruno te pregunta" : item.status === "answered" ? "Respondiste" : "Pregunta sin responder"}
        </span>
        {qs.map((q) => (
          <div key={q.question} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <h2 style={{ margin: 0, font: `600 19px/1.25 ${HEAD}`, letterSpacing: "-0.02em" }}>{q.question}</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {q.options.map((o) => {
                const chosen = (pending ? picked[q.question] : item.answers?.[q.question]) === o.label;
                return (
                  <button key={o.label} type="button" disabled={!pending} title={o.description} onClick={() => setPicked({ ...picked, [q.question]: o.label })}
                    style={{ minHeight: "40px", padding: "8px 16px", border: 0, borderRadius: "999px", cursor: pending ? "pointer" : "default", fontSize: "14px", fontWeight: 600, textAlign: "left", background: chosen ? C.ink : "rgba(18,19,26,.06)", color: chosen ? C.white : C.ink }}>
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {pending ? <button type="button" disabled={!ready} onClick={() => onAnswer(item, { answers: picked })} style={{ alignSelf: "flex-start", height: "44px", padding: "0 20px", border: 0, borderRadius: "999px", background: ready ? C.ink : "rgba(18,19,26,.12)", color: C.white, cursor: ready ? "pointer" : "default", fontSize: "14px", fontWeight: 600 }}>Responder</button> : null}
      </div>
    );
  }
  const status = { allowed: item.always ? "Permitido siempre en este proyecto" : "Lo permitiste", denied: "Dijiste que no", expired: "Ya no hacía falta" }[item.status];
  return (
    <div role={pending ? "dialog" : undefined} style={{ display: "flex", flexDirection: "column", gap: "12px", padding: pending ? "22px" : "14px 18px", borderRadius: "24px", background: C.white, boxShadow: pending ? `0 0 0 1px rgba(255,201,60,.6), 0 0 0 7px rgba(255,201,60,.16), 0 30px 60px -28px rgba(18,19,26,.4)` : CARD, animation: pending ? "sheet .45s cubic-bezier(.2,.8,.2,1)" : "none" }}>
      <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 600, color: pending ? C.honeyText : C.faint }}>
        {pending ? <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: C.honey, animation: "halo 1.8s ease-out infinite" }} /> : null}
        {pending ? (red ? "Línea roja · necesita tu OK" : "Necesita tu OK") : status}
      </span>
      <h2 style={{ margin: 0, font: `600 ${pending ? 21 : 16}px/1.2 ${HEAD}`, letterSpacing: "-0.02em" }}>{item.title}</h2>
      {item.command ? <code style={{ padding: "10px 14px", borderRadius: "12px", background: C.soft, font: `400 13px/1.45 ${MONO}`, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "160px", overflow: "auto" }}>{item.command}</code> : null}
      {pending && item.reason ? <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: C.text }}>{item.reason}{red ? " Lo demás (editar, probar, instalar dentro del proyecto) lo hace sin preguntarte." : ""}</p> : null}
      {pending ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          <button type="button" onClick={() => onAnswer(item, { decision: "allow" })} style={{ height: "46px", padding: "0 18px", border: 0, borderRadius: "999px", background: red ? C.honey : C.ink, color: red ? C.ink : C.white, cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>Permitir</button>
          {item.durable ? <button type="button" onClick={() => onAnswer(item, { decision: "always" })} style={{ height: "46px", padding: "0 16px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>Siempre en este proyecto</button> : null}
          <button type="button" onClick={() => onAnswer(item, { decision: "deny" })} style={{ height: "46px", padding: "0 16px", border: 0, borderRadius: "999px", background: "transparent", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>Ahora no</button>
        </div>
      ) : null}
    </div>
  );
}

/** A proposed plan (T3 Code): Implementar · En una tarea nueva · Refinar. */
function PlanCard({ item, busy, onPlan }) {
  const open = item.status === "open";
  const done = { implemented: "Lo estás implementando", moved: "Se implementa en otra tarea", refined: "Lo refinaste" }[item.status];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "22px 22px 18px", borderRadius: "24px", background: C.white, boxShadow: open ? `0 0 0 1.5px ${C.ink}, 6px 6px 0 0 ${C.honey}` : CARD, animation: open ? "sheet .45s cubic-bezier(.2,.8,.2,1)" : "none" }}>
      <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 600, color: open ? C.honeyText : C.faint }}>
        {open ? <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: C.honey, animation: "halo 1.8s ease-out infinite" }} /> : <ListChecks size={14} strokeWidth={2.2} aria-hidden="true" />}
        {open ? "Plan · aún no ha tocado nada" : "Plan · " + (done || "")}
      </span>
      <div style={{ color: C.body }}><Markdown text={item.text} size={15} /></div>
      {open ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", paddingTop: "4px" }}>
          <button type="button" disabled={busy} onClick={() => onPlan(item, "implement")} style={{ height: "44px", padding: "0 18px", border: 0, borderRadius: "999px", background: C.ink, color: C.white, cursor: busy ? "default" : "pointer", fontSize: "14px", fontWeight: 600 }}>Implementar</button>
          <button type="button" disabled={busy} onClick={() => onPlan(item, "new")} title="Una tarea nueva, con su propia copia, empieza por este plan" style={{ height: "44px", padding: "0 16px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: busy ? "default" : "pointer", fontSize: "14px", fontWeight: 600 }}>En una tarea nueva</button>
          <button type="button" onClick={() => onPlan(item, "refine")} title="Escribe abajo qué cambiarías: Bruno rehace el plan" style={{ height: "44px", padding: "0 16px", border: 0, borderRadius: "999px", background: "transparent", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>Refinar</button>
        </div>
      ) : null}
    </div>
  );
}

export function TimelineRow({ row, ctx }) {
  const { item } = row;
  if (row.kind === "log") return <WorkLog row={row} />;
  if (row.kind === "user") {
    const canEdit = !ctx.busy && !item.steer && ctx.editable.has(item.id);
    return (
      <div className="code-turn" style={{ alignSelf: "flex-end", maxWidth: "86%", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
        <div style={{ padding: "14px 18px", background: "#E8E8E2", borderRadius: "22px 22px 8px 22px", fontSize: "15px", lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {item.steer ? <span style={{ display: "block", fontSize: "12px", color: C.faint, marginBottom: "4px" }}>Se lo pasaste mientras trabajaba</span> : null}{item.text}
          {item.contexts?.length ? (
            <span style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: item.text ? "10px" : 0 }}>
              {item.contexts.map((c, k) => <span key={k} title={[c.note, c.text].filter(Boolean).join("\n\n").slice(0, 1200)} style={{ padding: "4px 10px", borderRadius: "999px", background: "#FFF4D1", fontSize: "12px", color: "#5C4300" }}>{c.label}</span>)}
            </span>
          ) : null}
          {item.attachments?.length ? (
            <span style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: item.text ? "10px" : 0 }}>
              {item.attachments.map((a) => <span key={a.path} title={a.path} style={{ padding: "4px 10px", borderRadius: "999px", background: "rgba(255,255,255,.7)", fontSize: "12px", color: C.text }}>{a.image ? "Imagen · " : ""}{a.name}</span>)}
            </span>
          ) : null}
        </div>
        {canEdit ? (
          <span className="code-tools" style={{ display: "flex", gap: "4px" }}>
            <button type="button" onClick={() => ctx.onEditFrom(item)} title="Vuelve los archivos a antes de este mensaje y te deja reescribirlo" style={{ display: "flex", alignItems: "center", gap: "6px", height: "28px", padding: "0 10px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.05)", cursor: "pointer", fontSize: "12px", fontWeight: 500 }}>
              <Pencil size={12} strokeWidth={2.2} aria-hidden="true" />Editar desde aquí
            </button>
          </span>
        ) : null}
      </div>
    );
  }
  if (row.kind === "text") return <div style={{ color: C.body }}><Markdown text={withoutGoalMark(item.text)} size={16} /></div>;
  if (row.kind === "turn") return <TurnCard item={item} total={ctx.turns} busy={ctx.busy} onDiff={ctx.onDiff} onRestore={ctx.onRestore} />;
  if (row.kind === "ask") return <AskCard item={item} onAnswer={ctx.onAnswer} />;
  if (row.kind === "plan") return <PlanCard item={item} busy={ctx.busy} onPlan={ctx.onPlan} />;
  if (row.kind === "notice") {
    const tone = item.tone === "done" ? { bg: C.greenSoft, fg: "#0B5A3E" } : item.tone === "warn" ? { bg: "#FFF4D1", fg: "#5C4300" } : null;
    return (
      <span style={{ alignSelf: "center", display: "flex", alignItems: "center", gap: "8px", padding: tone ? "8px 14px" : 0, borderRadius: "999px", background: tone ? tone.bg : "transparent", fontSize: "13px", lineHeight: 1.4, color: tone ? tone.fg : C.faint, textAlign: "center" }}>
        {item.tone === "done" ? <Check size={14} strokeWidth={2.6} aria-hidden="true" /> : item.goal ? <Target size={13} strokeWidth={2.2} color={C.bruno} aria-hidden="true" /> : item.setup ? <span aria-hidden="true" style={{ width: "10px", height: "10px", borderRadius: "50%", border: "2px solid rgba(255,122,26,.25)", borderTopColor: C.bruno, animation: "spin .8s linear infinite" }} /> : null}{item.text}
        {item.url ? <a href={item.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: C.blue, whiteSpace: "nowrap" }}>Abrir en GitHub</a> : null}
        {item.undo && ctx.lastNotice === item.id && !ctx.busy ? (
          <button type="button" onClick={() => ctx.onUndoRestore(item)} style={{ display: "flex", alignItems: "center", gap: "5px", height: "26px", padding: "0 10px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "12px", fontWeight: 600, color: C.ink }}>
            <Undo2 size={12} strokeWidth={2.4} aria-hidden="true" />Deshacer
          </button>
        ) : null}
      </span>
    );
  }
  if (row.kind === "error") return <p role="alert" style={{ margin: 0, padding: "12px 16px", borderRadius: "16px", background: "#FCEEEB", color: "#7A2A1F", fontSize: "14px", lineHeight: 1.5 }}>{item.text}</p>;
  return null;
}
