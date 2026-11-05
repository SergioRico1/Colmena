import { useState } from "react";
import { useExpert } from "../../../lib/expert.js";
import { Pencil, History, ListChecks, Undo2, Check, Target, ShieldCheck, GitPullRequest } from "lucide-react";
import Markdown from "../../room/Markdown.jsx";
import { C, MONO, HEAD, CARD, Stat, BTN } from "./parts.jsx";
import { EngineMark } from "./EngineModels.jsx";
import { PlanVotes } from "../people/TaskPeople.jsx";
import { turnStatsLine } from "./model.js";
export { buildRows } from "./model.js";

/** How long a turn took and what it changed, in the quiet code font (tokens in expert mode). */
function TurnStats({ stats, files = true, style = null }) {
  const [expert] = useExpert();
  const line = turnStatsLine(stats, { files, expert });
  if (!line) return null;
  return <span title="Lo que llevó este turno" style={{ font: `400 11.5px/1.4 ${MONO}`, color: C.quiet, ...style }}>{line}</span>;
}

// The timeline of a «Código» task: your messages, Bruno's answers, a grouped work log with
// each command's output on unfold (T3 Code), a card per turn that changed files («Ver
// cambios», «Volver aquí»), Bruno's questions and red lines.

/** Bruno's «[objetivo: …]» line is for Colmena (server/code/service.mjs GOAL_MARK), not for you. */
export const withoutGoalMark = (text) => String(text || "").replace(/\n*\[\s*objetivo\s*:\s*(cumplido|sigue|bloqueado)[^\]]*\]\s*$/i, "");

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
  const meta = running ? "en marcha" : denied ? "no permitido" : failed ? "falló" : "";
  const details = items.map((i) => i.detail).filter(Boolean);
  const output = items.length === 1 ? items[0].output : "";
  const canOpen = details.length || output;
  return (
    <>
      <button type="button" onClick={() => canOpen && setOpen(!open)} aria-expanded={canOpen ? open : undefined} title={details[0] || undefined}
        style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", minHeight: "20px", padding: 0, border: 0, background: "transparent", cursor: canOpen ? "pointer" : "default", textAlign: "left", font: `400 12px/1.5 ${MONO}`, color: denied ? C.faint : failed ? C.red : running ? C.ink : C.muted }}>
        {running ? <span aria-hidden="true" style={{ flex: "none", width: "9px", height: "9px", borderRadius: "50%", border: "1.5px solid rgba(255,122,26,.25)", borderTopColor: C.bruno, animation: "spin .8s linear infinite" }} /> : null}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: denied ? "line-through" : "none" }}>{entryLine(entry)}</span>
        {meta ? <span style={{ flex: "none", color: running ? C.bruno : failed ? C.red : C.quiet }}>{meta}</span> : null}
      </button>
      {open ? (
        <div style={{ margin: "4px 0 6px", padding: "12px 14px", borderRadius: "12px", background: C.ink, display: "flex", flexDirection: "column", gap: "3px", font: `400 12px/1.6 ${MONO}`, color: "#C9CBD1", animation: "rise .25s ease-out", maxHeight: "300px", overflow: "auto" }}>
          {details.map((d, k) => <span key={k} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: items[0].verb === "run" ? "#8A8D96" : "#C9CBD1" }}>{items[0].verb === "run" ? "> " + d : d}</span>)}
          {output ? <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: items[0].status === "error" ? "#FF8A80" : "#E6E7EC" }}>{output}</span> : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * Bruno's steps under what he says (design/V3Sistema.dc.html «El mismo paso, dos niveles»): in
 * expert mode each one in the code font; in simple mode folded behind «Ver los N pasos».
 */
function WorkLog({ row }) {
  const [expert] = useExpert();
  const [open, setOpen] = useState(false);
  const n = row.entries.reduce((k, e) => k + e.items.length, 0);
  const running = row.entries.some((e) => e.items.some((i) => i.status === "running"));
  if (!expert && !open) {
    const now = running ? entryLine(row.entries.at(-1)) : null;
    return (
      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
        <button type="button" onClick={() => setOpen(true)} style={{ height: "32px", padding: "0 12px", border: "1px solid rgba(18,19,26,.12)", borderRadius: "999px", background: "transparent", fontSize: "13px", color: C.text2, cursor: "pointer" }}>{n === 1 ? "Ver el paso" : "Ver los " + n + " pasos"}</button>
        {now ? <span style={{ minWidth: 0, fontSize: "13px", color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{now}…</span> : null}
      </span>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
      {row.entries.map((e) => <LogEntry key={e.id} entry={e} />)}
      {!expert ? <button type="button" onClick={() => setOpen(false)} style={{ alignSelf: "flex-start", marginTop: "4px", padding: 0, border: 0, background: "transparent", fontSize: "12.5px", color: C.muted, cursor: "pointer" }}>Ocultar los pasos</button> : null}
    </div>
  );
}

function TurnCard({ item, total, busy, onDiff, onRestore }) {
  const files = item.files || [];
  return (
    <div data-message-id={item.id} className="code-turn" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px", padding: "10px 10px 10px 14px", borderRadius: "14px", background: C.white, boxShadow: CARD }}>
      <span style={{ flex: "1 1 150px", minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
        <strong style={{ fontSize: "13.5px", fontWeight: 600 }}>{files.length === 1 ? "1 archivo cambiado" : files.length + " archivos cambiados"}</strong>
        <span style={{ display: "flex", gap: "6px", alignItems: "center", font: `500 12px/1 ${MONO}` }}><Stat add={item.add} del={item.del} /><span style={{ color: C.quiet }}>· punto {item.n} de {total}</span></span>
        <TurnStats stats={item.stats} files={false} />
      </span>
      <button type="button" onClick={() => onDiff(item.n)} style={{ ...BTN.outline, height: "32px", padding: "0 12px", fontSize: "13px" }}>Ver cambios</button>
      <button type="button" disabled={busy} onClick={() => onRestore(item.n)} title="Deja el proyecto como estaba justo después de este turno"
        style={{ ...BTN.quiet, height: "32px", padding: "0 8px", gap: "6px", fontSize: "13px", cursor: busy ? "default" : "pointer", color: busy ? C.quiet : C.text2 }}>
        <History size={13} strokeWidth={2.2} aria-hidden="true" />Volver aquí
      </button>
    </div>
  );
}

// Cards that need you wear the honey ring (design/V3CodigoTarea.dc.html); the answered ones are plain.
const RING = "0 0 0 2px #FFC93C";
const PENDING_DOT = <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: C.honey, animation: "halo 1.8s ease-out infinite" }} />;

function AskCard({ item, onAnswer }) {
  const [picked, setPicked] = useState({});
  const pending = item.status === "pending";
  const red = item.ask === "redline";
  const box = { display: "flex", flexDirection: "column", gap: "12px", padding: pending ? "16px" : "12px 16px", borderRadius: "16px", background: C.white, boxShadow: pending ? RING : CARD, animation: pending ? "sheet .45s cubic-bezier(.2,.8,.2,1)" : "none" };
  const choice = (on) => ({ minHeight: "36px", padding: "7px 14px", border: on ? "1px solid " + C.ink : "1px solid rgba(18,19,26,.16)", borderRadius: "999px", fontSize: "13.5px", fontWeight: 500, textAlign: "left", background: on ? C.ink : C.white, color: on ? C.white : C.ink });
  if (item.ask === "question") {
    const qs = item.questions || [];
    const ready = qs.every((q) => picked[q.question]);
    return (
      <div style={box}>
        <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 600, color: pending ? C.honeyText : C.faint }}>
          {pending ? PENDING_DOT : null}{pending ? "Bruno te pregunta" : item.status === "answered" ? "Respondiste" : "Pregunta sin responder"}
        </span>
        {qs.map((q) => (
          <div key={q.question} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <h2 style={{ margin: 0, font: `600 17px/1.25 ${HEAD}`, letterSpacing: "-0.015em" }}>{q.question}</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {q.options.map((o) => {
                const chosen = (pending ? picked[q.question] : item.answers?.[q.question]) === o.label;
                return <button key={o.label} type="button" disabled={!pending} title={o.description} onClick={() => setPicked({ ...picked, [q.question]: o.label })} style={{ ...choice(chosen), cursor: pending ? "pointer" : "default" }}>{o.label}</button>;
              })}
            </div>
          </div>
        ))}
        {pending ? <button type="button" disabled={!ready} onClick={() => onAnswer(item, { answers: picked })} style={{ ...BTN.primary, alignSelf: "flex-start", opacity: ready ? 1 : 0.45, cursor: ready ? "pointer" : "default" }}>Responder</button> : null}
      </div>
    );
  }
  const status = { allowed: item.always ? "Permitido siempre en este proyecto" : item.scope === "task" ? "Permitido en esta tarea" : item.scope === "here" ? "Permitida siempre esta orden aquí" : "Lo permitiste", denied: "Dijiste que no", expired: "Ya no hacía falta" }[item.status];
  const small = { ...BTN.outline, height: "36px", padding: "0 12px", fontSize: "13px" };
  return (
    <div role={pending ? "dialog" : undefined} style={box}>
      <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 600, color: pending ? C.honeyText : C.faint }}>
        {pending ? PENDING_DOT : null}{pending ? (red ? "Línea roja · necesita tu OK" : "Necesita tu OK") : status}
      </span>
      <h2 style={{ margin: 0, font: `600 ${pending ? 17 : 15}px/1.25 ${HEAD}`, letterSpacing: "-0.015em" }}>{item.title}</h2>
      {item.command ? <code style={{ padding: "8px 12px", borderRadius: "10px", background: C.card, font: `400 12.5px/1.45 ${MONO}`, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "160px", overflow: "auto" }}>{item.command}</code> : null}
      {pending && item.reason ? <p style={{ margin: 0, fontSize: "13.5px", lineHeight: 1.5, color: C.text2 }}>{item.reason}{red ? " Lo demás (editar, probar, instalar dentro del proyecto) lo hace sin preguntarte." : ""}</p> : null}
      {pending ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          <button type="button" onClick={() => onAnswer(item, { decision: "allow" })} style={{ ...BTN.primary, height: "36px", padding: "0 16px", fontSize: "13px" }}>Permitir</button>
          {item.taskScope ? <button type="button" onClick={() => onAnswer(item, { decision: "task" })} title={red ? "No vuelve a preguntar esto mientras dure esta tarea" : "No vuelve a preguntar por este tipo de paso en esta tarea"} style={small}>En esta tarea</button> : null}
          {item.exact ? <button type="button" onClick={() => onAnswer(item, { decision: "here" })} title={"Esta orden exacta no vuelve a preguntar en este proyecto: " + item.exact} style={small}>Siempre aquí</button> : null}
          {item.durable ? <button type="button" onClick={() => onAnswer(item, { decision: "always" })} style={small}>Siempre en este proyecto</button> : null}
          <button type="button" onClick={() => onAnswer(item, { decision: "deny" })} style={{ ...BTN.quiet, height: "36px", fontSize: "13px" }}>Ahora no</button>
        </div>
      ) : null}
    </div>
  );
}

const SEVERITY = {
  P0: { bg: "#FBE9EA", fg: "#B4232A", text: "Rompe algo" }, P1: { bg: "#FBE9EA", fg: "#B4232A", text: "Fallo real" },
  P2: { bg: "#FFF1C7", fg: "#8A5A00", text: "Conviene arreglar" }, P3: { bg: "#F1F1EC", fg: "#4A4D57", text: "Detalle" },
};

/** The review before merging (OpenClaw autoreview): findings P0–P3; «Que Bruno lo arregle» is up in the header. */
function ReviewCard({ item, onFinding, current, pr = null, onPublish = null }) {
  const [expert] = useExpert();
  const [publishing, setPublishing] = useState(false);
  const publish = async () => { setPublishing(true); try { await onPublish(item); } finally { setPublishing(false); } };
  const findings = item.findings || [];
  const serious = findings.filter((f) => f.severity === "P0" || f.severity === "P1").length;
  const who = item.by ? String(item.by).split(" ")[0] : "Tu bot";
  const needs = current && findings.length > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px 16px", borderRadius: "16px", background: C.white, boxShadow: needs ? RING : CARD, animation: "rise .3s ease-out" }}>
      <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", fontWeight: 600, color: findings.length ? C.ink : C.greenText }}>
        {findings.length ? null : <ShieldCheck size={15} strokeWidth={2.2} aria-hidden="true" />}
        {who} revisó los cambios{findings.length ? "" : item.verdict === "approve" ? " · lo aprueba" : " · sin problemas"}
      </span>
      {item.summary && expert ? <p style={{ margin: 0, fontSize: "13.5px", lineHeight: 1.5, color: C.text2 }}>{item.summary}</p> : null}
      {findings.map((f, k) => {
        const s = SEVERITY[f.severity] || SEVERITY.P2;
        return (
          <div key={k} className="code-turn" style={{ position: "relative", display: "flex", gap: "10px", fontSize: "13.5px", lineHeight: 1.45 }}>
            <span title={s.text} style={{ flex: "none", height: "20px", padding: "0 7px", display: "inline-flex", alignItems: "center", borderRadius: "6px", background: s.bg, color: s.fg, font: `600 11px/1 ${MONO}` }}>{f.severity}</span>
            <span style={{ flex: 1, minWidth: 0 }} title={f.detail || undefined}>
              {f.title}{f.file ? <> <span style={{ font: `400 12px/1 ${MONO}`, color: C.muted }}>{f.file.split("/").pop()}{f.line ? ":" + f.line : ""}</span></> : null}
              {f.detail && expert ? <span style={{ display: "block", marginTop: "2px", fontSize: "12.5px", color: C.muted }}>{f.detail}</span> : null}
            </span>
            <button type="button" className="code-tools" onClick={() => onFinding(f)} title="Añádelo a tu próximo mensaje" style={{ position: "absolute", right: 0, top: "-2px", height: "24px", padding: "0 9px", border: "1px solid rgba(18,19,26,.12)", borderRadius: "999px", background: C.white, boxShadow: "0 4px 12px -4px rgba(18,19,26,.25)", cursor: "pointer", fontSize: "11.5px", whiteSpace: "nowrap" }}>Pasar a Bruno</button>
          </div>
        );
      })}
      {needs ? (
        <span style={{ fontSize: "12.5px", lineHeight: 1.45, color: C.muted }}>
          Antes de fusionar: {serious ? (serious === 1 ? "1 problema importante" : serious + " problemas importantes") + (findings.length > serious ? " y " + (findings.length - serious === 1 ? "1 aviso" : findings.length - serious + " avisos") : "") : findings.length === 1 ? "1 aviso" : findings.length + " avisos"}. «Que Bruno lo arregle» le pasa {findings.length === 1 ? "el aviso" : findings.length === 2 ? "los dos" : findings.length === 3 ? "los tres" : "todos"}.
        </span>
      ) : null}
      {/* Outward-facing: it goes to GitHub only on your click, and only once. */}
      {item.published ? (
        <a href={item.published.url} target="_blank" rel="noreferrer" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12.5px", color: C.muted }}>
          <Check size={12} strokeWidth={2.6} aria-hidden="true" />Publicada en la PR #{item.published.number}
        </a>
      ) : pr && onPublish ? (
        <button type="button" disabled={publishing} onClick={publish} title="La deja en GitHub como una revisión: cada aviso en su línea cuando se puede, el resto en el comentario" style={{ ...BTN.outline, alignSelf: "flex-start", height: "30px", padding: "0 12px", fontSize: "12.5px", opacity: publishing ? 0.55 : 1, cursor: publishing ? "default" : "pointer" }}>
          <GitPullRequest size={13} strokeWidth={2.2} aria-hidden="true" />{publishing ? "Publicando…" : "Publicar en la PR #" + pr.number}
        </button>
      ) : null}
    </div>
  );
}

/** A proposed plan (T3 Code): Implementar · En una tarea nueva · Refinar. Once decided, a line. */
function PlanCard({ item, busy, onPlan, onShowPlan }) {
  const open = item.status === "open";
  const done = { implemented: "aprobado", moved: "en otra tarea", refined: "refinado" }[item.status] || "";
  if (!open) {
    return (
      <span data-message-id={item.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: C.muted }}>
        <ListChecks size={14} strokeWidth={2.2} aria-hidden="true" />Plan de Bruno{done ? " · " + done : ""}
        {onShowPlan ? <button type="button" onClick={onShowPlan} style={{ padding: 0, border: 0, background: "transparent", cursor: "pointer", fontSize: "13px", fontWeight: 500, color: C.blue }}>Ver el plan</button> : null}
      </span>
    );
  }
  return (
    <div data-message-id={item.id} style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px", borderRadius: "16px", background: C.white, boxShadow: RING, animation: "sheet .45s cubic-bezier(.2,.8,.2,1)" }}>
      <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 600, color: C.honeyText }}>{PENDING_DOT}Plan · aún no ha tocado nada</span>
      <div style={{ color: C.body }}><Markdown text={item.text} size={14} /></div>
      {item.taskId ? <PlanVotes taskId={item.taskId} item={item} /> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        <button type="button" disabled={busy} onClick={() => onPlan(item, "implement")} style={{ ...BTN.primary, height: "38px", cursor: busy ? "default" : "pointer" }}>Implementar</button>
        <button type="button" disabled={busy} onClick={() => onPlan(item, "new")} title="Una tarea nueva, con su propia copia, empieza por este plan" style={{ ...BTN.outline, height: "38px", fontSize: "13.5px", cursor: busy ? "default" : "pointer" }}>En una tarea nueva</button>
        <button type="button" onClick={() => onPlan(item, "refine")} title="Escribe abajo qué cambiarías: Bruno rehace el plan" style={{ ...BTN.quiet, height: "38px", fontSize: "13.5px" }}>Refinar</button>
      </div>
    </div>
  );
}

/** Rows Bruno writes or does (they hang under his shape and name). */
export const BOT_ROWS = new Set(["text", "log", "turn"]);

export function TimelineRow({ row, ctx }) {
  const { item } = row;
  if (row.kind === "log") return <WorkLog row={row} />;
  if (row.kind === "user") {
    const canEdit = !ctx.busy && !item.steer && ctx.editable.has(item.id);
    return (
      <div className="code-turn" style={{ alignSelf: "flex-end", maxWidth: "92%", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
        <div data-message-id={item.id} style={{ padding: "10px 14px", background: "#E8E8E2", borderRadius: "18px 18px 6px 18px", fontSize: "14.5px", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {item.steer ? <span style={{ display: "block", fontSize: "12px", color: C.faint, marginBottom: "4px" }}>Se lo pasaste mientras trabajaba</span> : null}{item.text}
          {item.contexts?.length ? (
            <span style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: item.text ? "8px" : 0 }}>
              {item.contexts.map((c, k) => <span key={k} title={[c.note, c.text].filter(Boolean).join("\n\n").slice(0, 1200)} style={{ padding: "3px 9px", borderRadius: "999px", background: "#FFF1C7", fontSize: "12px", color: "#5C4300" }}>{c.label}</span>)}
            </span>
          ) : null}
          {item.attachments?.length ? (
            <span style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: item.text ? "8px" : 0 }}>
              {item.attachments.map((a) => <span key={a.path} title={a.path} style={{ padding: "3px 9px", borderRadius: "999px", background: "rgba(255,255,255,.7)", fontSize: "12px", color: C.text }}>{a.image ? "Imagen · " : ""}{a.name}</span>)}
            </span>
          ) : null}
        </div>
        {canEdit ? (
          <span className="code-tools" style={{ display: "flex", gap: "4px" }}>
            <button type="button" onClick={() => ctx.onEditFrom(item)} title="Vuelve los archivos a antes de este mensaje y te deja reescribirlo" style={{ display: "flex", alignItems: "center", gap: "6px", height: "26px", padding: "0 10px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.05)", cursor: "pointer", fontSize: "12px", fontWeight: 500 }}>
              <Pencil size={12} strokeWidth={2.2} aria-hidden="true" />Editar desde aquí
            </button>
          </span>
        ) : null}
      </div>
    );
  }
  if (row.kind === "text") {
    return (
      <>
        <div data-message-id={item.id} style={{ color: C.body }}><Markdown text={withoutGoalMark(item.text)} size={14.5} /></div>
        {item.stats ? <TurnStats stats={item.stats} style={{ marginTop: "-4px" }} /> : null}
      </>
    );
  }
  if (row.kind === "turn") return <TurnCard item={item} total={ctx.turns} busy={ctx.busy} onDiff={ctx.onDiff} onRestore={ctx.onRestore} />;
  if (row.kind === "ask") return <AskCard item={item} onAnswer={ctx.onAnswer} />;
  if (row.kind === "plan") return <PlanCard item={item} busy={ctx.busy} onPlan={ctx.onPlan} onShowPlan={ctx.onShowPlan} />;
  if (row.kind === "review") return <ReviewCard item={item} onFinding={ctx.onFinding} current={ctx.review === item.id} pr={ctx.pr} onPublish={ctx.onPublish} />;
  if (row.kind === "notice") {
    const tone = item.tone === "done" ? { bg: "#E3F4EC", fg: "#0B6B4A" } : item.tone === "warn" ? { bg: "#FFF1C7", fg: "#5C4300" } : null;
    return (
      <span data-message-id={item.id} title={item.detail || undefined} style={{ alignSelf: "center", display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: "6px 8px", padding: tone ? "6px 12px" : 0, borderRadius: "999px", background: tone ? tone.bg : "transparent", fontSize: "12.5px", lineHeight: 1.4, color: tone ? tone.fg : C.faint, textAlign: "center" }}>
        {item.tone === "done" ? <Check size={13} strokeWidth={2.6} aria-hidden="true" /> : item.engineSwitch ? <EngineMark engine={item.engineSwitch.to} size={12} /> : item.goal ? <Target size={13} strokeWidth={2.2} color={C.bruno} aria-hidden="true" /> : item.setup ? <span aria-hidden="true" style={{ width: "10px", height: "10px", borderRadius: "50%", border: "2px solid rgba(255,122,26,.25)", borderTopColor: C.bruno, animation: "spin .8s linear infinite" }} /> : null}{item.text}
        {item.url ? <a href={item.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: C.blue, whiteSpace: "nowrap" }}>Abrir en GitHub</a> : null}
        {item.overlap ? <a href={"/codigo/" + item.overlap} style={{ fontWeight: 600, color: C.blue, whiteSpace: "nowrap" }}>Ver la otra tarea</a> : null}
        {item.undo && ctx.lastNotice === item.id && !ctx.busy ? (
          <button type="button" onClick={() => ctx.onUndoRestore(item)} style={{ display: "flex", alignItems: "center", gap: "5px", height: "26px", padding: "0 10px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "12px", fontWeight: 600, color: C.ink }}>
            <Undo2 size={12} strokeWidth={2.4} aria-hidden="true" />Deshacer
          </button>
        ) : null}
      </span>
    );
  }
  if (row.kind === "error") return <p data-message-id={item.id} role="alert" style={{ margin: 0, padding: "10px 14px", borderRadius: "14px", background: "#FBE9EA", color: "#B4232A", fontSize: "13.5px", lineHeight: 1.5 }}>{item.text}</p>;
  return null;
}
