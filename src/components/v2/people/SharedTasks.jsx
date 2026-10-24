import { useState } from "react";
import { ChevronRight, Copy, ExternalLink, Eye, FileDiff, GitBranch, GitPullRequest, Lock, MessageSquare, UsersRound } from "lucide-react";
import { PeerAvatar } from "./PeerAvatar.jsx";
import { names } from "./PeopleMessage.jsx";
import { navigate } from "../../../lib/router.jsx";
import { useSharedTask, useSharedTasks } from "../../../lib/codeshare.js";

// Código tasks other people share with you (design/V2Codigo.dc.html, paso compartida): what
// the task is doing on its owner's computer, Bruno's plan (approve it or ask for changes) and
// the PR. You never see their code; nothing runs on yours.
const MONO = "'Geist Mono', ui-monospace, monospace";
export const sharedStatus = (s, owner = "") => ({
  working: { text: "Bruno trabaja en ella", dot: "#1E9E6A" },
  waiting: { text: "Bruno espera a " + (owner.split(" ")[0] || "su dueño"), dot: "#FFC93C" },
  planned: { text: "Plan para revisar", dot: "#FFC93C" },
  error: { text: "Atascada", dot: "#D9483B" },
}[s.running ? "working" : s.status] || { text: "En pausa", dot: "#C9CBD1" });
const CHECKS = { passing: ["Pasa el CI", "#0B6B4A", "#E8F5EE"], failing: ["Falla el CI", "#B4231A", "#FCEBEA"], pending: ["CI en marcha", "#6B4E00", "#FFF6DE"], none: ["Sin CI", "#5C606C", "rgba(18,19,26,.05)"] };

/** «Compartidas contigo» at the end of the list of projects. */
export function SharedShelf({ current = null }) {
  const items = useSharedTasks();
  const [open, setOpen] = useState(true);
  if (!items?.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px 4px", border: 0, background: "transparent", cursor: "pointer", font: `500 11px/1.3 ${MONO}`, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8C8F99", textAlign: "left" }}>
        <ChevronRight size={11} strokeWidth={2.6} aria-hidden="true" style={{ transition: "transform .2s ease", transform: open ? "rotate(90deg)" : "none" }} />
        <UsersRound size={11} strokeWidth={2.4} aria-hidden="true" />{"Compartidas contigo"}<span style={{ color: "#A3A6AE" }}>{items.length}</span>
      </button>
      {open ? items.map((m) => {
        const st = sharedStatus(m.snapshot, m.ownerPerson.name);
        const here = current === m.id;
        return (
          <a key={m.id} href={"/codigo/compartida/" + m.id} onClick={(e) => { e.preventDefault(); navigate("/codigo/compartida/" + m.id); }}
            style={{ display: "flex", alignItems: "center", gap: "11px", marginLeft: "14px", padding: "9px 10px", borderRadius: "14px", background: here ? "#FFFFFF" : "transparent", boxShadow: here ? "0 1px 2px rgba(18,19,26,.05), 0 8px 20px -10px rgba(18,19,26,.18)" : "none", color: "#12131A", textDecoration: "none" }}>
            <PeerAvatar person={m.ownerPerson} size={22} />
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontSize: "14px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.snapshot.title}</span>
              <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#6B6F7A" }}><span aria-hidden="true" style={{ width: "6px", height: "6px", borderRadius: "50%", background: st.dot }} />{st.text}</span>
            </span>
          </a>
        );
      }) : null}
    </div>
  );
}

/** One task shared with you. */
export function SharedTask({ id }) {
  const { item, error, vote, askDiff, comment, review } = useSharedTask(id);
  const [asked, setAsked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  if (error === "missing") return <Empty text="Esta tarea ya no se comparte contigo." />;
  if (!item) return <Empty text={error || "Cargando…"} />;
  const s = item.snapshot;
  const owner = item.ownerPerson;
  const first = owner.name.split(" ")[0];
  const st = sharedStatus(s, owner.name);
  const plan = s.plan;
  const mine = item.myVote && plan && item.myVote.item === plan.id ? item.myVote : null;
  const looking = (item.viewers || []).filter((v) => !v.me);
  const send = async (action) => {
    setBusy(true); setProblem(null);
    try { await vote(action, action === "changes" ? text : ""); setAsking(false); setText(""); } catch (e) { setProblem(e.message); } finally { setBusy(false); }
  };
  const gone = !!item.removedAt;
  return (
    <section aria-label={"Tarea compartida: " + s.title} style={{ flex: 1, minWidth: 0, height: "100%", overflowY: "auto", overscrollBehavior: "contain" }}>
      <div style={{ width: "100%", maxWidth: "820px", margin: "0 auto", padding: "34px clamp(20px, 4vw, 44px) 60px", display: "flex", flexDirection: "column", gap: "22px", boxSizing: "border-box" }}>
        <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px 18px" }}>
          <PeerAvatar person={owner} size={46} dot />
          <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={{ font: `500 12px/1 ${MONO}`, letterSpacing: "0.06em", textTransform: "uppercase", color: "#6B6F7A" }}>{"Compartida por " + owner.name + (s.project ? " · " + s.project : "")}</span>
            <h1 style={{ margin: 0, font: "600 28px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{s.title}</h1>
            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px", fontSize: "14px", color: "#5C606C" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 600, color: "#12131A" }}><span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: st.dot, animation: s.running ? "breathe 1.4s ease-in-out infinite" : "none" }} />{st.text}</span>
              {s.branch ? <span title={s.branch} style={{ display: "flex", alignItems: "center", gap: "5px", fontFamily: MONO, fontSize: "12px", maxWidth: "280px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><GitBranch size={13} strokeWidth={2} aria-hidden="true" />{s.branch}</span> : null}
              {s.add || s.del ? <span style={{ fontFamily: MONO, fontSize: "12px" }}><span style={{ color: "#0B8A5F" }}>{"+" + s.add}</span>{" "}<span style={{ color: "#B4231A" }}>{"−" + s.del}</span></span> : null}
            </span>
          </div>
          {looking.length ? (
            <span title={names(looking.map((v) => v.name)) + " lo está mirando"} style={{ display: "flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 14px 0 8px", borderRadius: "999px", background: "#E8F5EE", fontSize: "13px", fontWeight: 600, color: "#0B6B4A" }}>
              <span style={{ display: "flex" }}>{looking.slice(0, 3).map((v, i) => <span key={v.id} style={{ marginLeft: i ? "-6px" : 0, borderRadius: "50%", boxShadow: "0 0 0 2px #E8F5EE" }}><PeerAvatar person={v} size={26} /></span>)}</span>
              <Eye size={14} strokeWidth={2.2} aria-hidden="true" />{looking.length === 1 ? "La está mirando" : "La están mirando"}
            </span>
          ) : null}
        </header>
        {gone ? <p role="status" style={{ margin: 0, padding: "12px 16px", borderRadius: "16px", background: "#FFF6DE", color: "#6B4E00", fontSize: "14px" }}>{first + " ha dejado de compartirla. Lo de abajo es como estaba."}</p> : null}

        {item.projectInfo ? (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", padding: "12px 16px", borderRadius: "18px", background: "#F4F4F0", fontSize: "13px", color: "#5C606C" }}>
            <span style={{ flex: "1 1 260px" }}>{"Del proyecto «" + item.projectInfo.name + "», al que " + first + " te ha invitado." + (item.projectInfo.remote ? " Para tener el código, clónalo de vuestro repositorio:" : "")}</span>
            {item.projectInfo.remote ? (
              <button type="button" onClick={() => { navigator.clipboard?.writeText("git clone " + item.projectInfo.remote).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => {}); }} style={{ display: "flex", alignItems: "center", gap: "8px", maxWidth: "100%", height: "34px", padding: "0 12px", border: 0, borderRadius: "10px", background: "#FFFFFF", cursor: "pointer", font: "400 12px/1 'Geist Mono', monospace", color: "#12131A", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                {"git clone " + item.projectInfo.remote}<Copy size={13} strokeWidth={2.2} aria-hidden="true" />{copied ? <span style={{ fontFamily: "inherit", color: "#0B6B4A" }}>{"Copiado"}</span> : null}
              </button>
            ) : null}
          </div>
        ) : null}

        {s.log?.length ? (
          <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "14px 18px", borderRadius: "22px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 10px 26px -16px rgba(18,19,26,.2)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "8px", font: "500 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#6B6F7A" }}>{s.running ? <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#1E9E6A", animation: "breathe 1.4s ease-in-out infinite" }} /> : null}{s.running ? "Ahora" : "Lo último que hizo"}</span>
            {s.log.map((l, i) => <span key={i} style={{ fontSize: "14px", lineHeight: 1.45, color: l.kind === "assistant" ? "#12131A" : "#3D404A", opacity: i === s.log.length - 1 ? 1 : 0.72 }}>{(l.kind === "assistant" ? "Bruno: " : "") + l.text}</span>)}
          </div>
        ) : null}

        {s.pr ? (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", padding: "16px 18px", borderRadius: "22px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 10px 26px -16px rgba(18,19,26,.2)" }}>
            <span aria-hidden="true" style={{ width: "38px", height: "38px", display: "grid", placeItems: "center", borderRadius: "12px", background: "#F2F2EE" }}><GitPullRequest size={18} strokeWidth={2} /></span>
            <span style={{ flex: 1, minWidth: "180px", display: "flex", flexDirection: "column", gap: "3px" }}>
              <strong style={{ fontSize: "15px", fontWeight: 600 }}>{"PR #" + s.pr.number + (s.pr.state === "MERGED" ? " · fusionada" : s.pr.state === "CLOSED" ? " · cerrada" : "")}</strong>
              <span style={{ fontSize: "13px", color: "#6B6F7A" }}>{s.pr.mergeable === "CONFLICTING" ? "Tiene conflictos con " + (s.base || "main") : "Rama " + (s.branch || "") + " → " + (s.base || "main")}</span>
            </span>
            {s.pr.state === "OPEN" ? <span style={{ padding: "5px 12px", borderRadius: "999px", fontSize: "13px", fontWeight: 600, color: CHECKS[s.pr.checks][1], background: CHECKS[s.pr.checks][2] }}>{CHECKS[s.pr.checks][0]}</span> : null}
            {s.pr.url ? <a href={s.pr.url} target="_blank" rel="noreferrer noopener" style={{ display: "flex", alignItems: "center", gap: "6px", height: "38px", padding: "0 14px", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "13px", fontWeight: 600, textDecoration: "none" }}>{"Abrir en GitHub"}<ExternalLink size={13} strokeWidth={2.4} aria-hidden="true" /></a> : null}
          </div>
        ) : null}

        {plan ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "22px 22px 18px", borderRadius: "24px", background: "#FFFFFF", boxShadow: plan.status === "open" ? "0 0 0 1.5px #12131A, 6px 6px 0 0 #FFC93C" : "0 1px 2px rgba(18,19,26,.05), 0 10px 26px -16px rgba(18,19,26,.2)" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: plan.status === "open" ? "#8A6400" : "#8C8F99" }}>
              {plan.status === "open" ? "El plan de Bruno · aún no ha tocado nada" : { implemented: first + " lo está implementando", refined: "Bruno lo está rehaciendo", moved: "Se implementa en otra tarea" }[plan.status] || "Plan"}
            </span>
            <div style={{ fontSize: "15px", lineHeight: 1.6, color: "#3D404A", whiteSpace: "pre-wrap", overflowWrap: "anywhere", userSelect: "text" }}>{plan.text}</div>
            {plan.votes?.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "10px 14px", borderRadius: "16px", background: "#F4F4F0", fontSize: "14px" }}>
                {plan.votes.map((v) => <span key={v.name + v.at}><strong style={{ fontWeight: 600 }}>{v.name.split(" ")[0]}</strong>{v.action === "approve" ? " lo aprueba" : " pide: «" + v.text + "»"}</span>)}
              </div>
            ) : null}
            {plan.status === "open" && !gone ? (
              <>
                {mine ? <span role="status" style={{ fontSize: "14px", color: "#0B6B4A", fontWeight: 500 }}>{mine.action === "approve" ? `Lo has aprobado. ${first} decide cuándo implementarlo.` : `Le has pedido cambios. ${first} decide si Bruno lo rehace.`}</span> : null}
                {asking ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", animation: "fade .2s ease-out" }}>
                    <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder={"Qué cambiarías del plan. Le llega a " + first + "; Bruno solo lo usa si " + first + " quiere."} aria-label="Qué cambiarías"
                      style={{ width: "100%", minHeight: "84px", padding: "12px 14px", border: 0, borderRadius: "16px", outline: "none", resize: "vertical", background: "#F7F7F4", font: "inherit", fontSize: "15px", lineHeight: 1.5, boxSizing: "border-box" }} />
                    <span style={{ display: "flex", gap: "8px" }}>
                      <button type="button" disabled={busy || !text.trim()} onClick={() => send("changes")} style={{ height: "42px", padding: "0 18px", border: 0, borderRadius: "999px", background: text.trim() ? "#12131A" : "#C9CBD1", color: "#FFFFFF", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>{"Enviar a " + first}</button>
                      <button type="button" onClick={() => setAsking(false)} style={{ height: "42px", padding: "0 16px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>{"Cancelar"}</button>
                    </span>
                  </div>
                ) : (
                  <span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    <button type="button" disabled={busy} onClick={() => send("approve")} style={{ height: "44px", padding: "0 20px", border: 0, borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>{"Aprobar el plan"}</button>
                    <button type="button" onClick={() => setAsking(true)} style={{ height: "44px", padding: "0 18px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>{"Pedir cambios"}</button>
                  </span>
                )}
                <span style={{ fontSize: "12px", color: "#8C8F99" }}>{"Aprobar no pone a Bruno a trabajar: se lo dice a " + first + ", que decide."}</span>
              </>
            ) : null}
            {problem ? <span role="alert" style={{ fontSize: "13px", color: "#B4231A" }}>{problem}</span> : null}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: "15px", color: "#5C606C" }}>{"Aún no hay plan. Te avisamos cuando Bruno proponga uno, y cuando la PR esté lista o falle el CI."}</p>
        )}

        {item.review ? <ReviewPanel item={item} review={review} first={first} onError={setProblem} /> : null}

        {item.projectInfo || item.review ? (
          <Changes item={item} asked={asked} onAsk={async () => { setAsked(true); try { await askDiff(); } catch (e) { setProblem(e.message); setAsked(false); } }} onComment={item.review?.state === "asked" ? (c) => review.add({ severity: c.severity || "P2", title: c.text, file: c.file, line: c.line, detail: "" }) : comment} reviewing={item.review?.state === "asked"} first={first} />
        ) : null}

        <p style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#6B6F7A" }}><Lock size={13} strokeWidth={2.2} aria-hidden="true" />{item.projectInfo ? "La tarea va en el ordenador de " + first + ". Los cambios te llegan cifrados; el código está en vuestro repositorio." : "La tarea va en el ordenador de " + first + ". Ves lo que hace, nunca su código ni sus archivos."}</p>
      </div>
    </section>
  );
}

function Empty({ text }) {
  return <section style={{ flex: 1, display: "grid", placeItems: "center", padding: "40px", fontSize: "15px", color: "#5C606C" }}>{text}</section>;
}

// ---- the changes of a task of a project you were invited to, with comments on lines ----
const COMMENT_STATE = { sent: "Enviado", asked: "Lo verá y decidirá si se lo pasa a Bruno", kept: "Lo verá", dropped: "Descartado", draft: "En tu revisión (aún sin enviar)" };
/** A file's patch as rows: [{kind, text, line}] (line: the new file's line, for comments). */
function patchRows(patch) {
  const rows = [];
  let n = 0;
  for (const raw of String(patch || "").split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
    if (hunk) { n = Number(hunk[1]); rows.push({ kind: "hunk", text: raw, line: null }); continue; }
    if (raw.startsWith("diff ") || raw.startsWith("index ") || raw.startsWith("--- ") || raw.startsWith("+++ ")) continue;
    if (raw.startsWith("+")) rows.push({ kind: "add", text: raw.slice(1), line: n++ });
    else if (raw.startsWith("-")) rows.push({ kind: "del", text: raw.slice(1), line: null });
    else if (raw.startsWith("\\")) continue;
    else rows.push({ kind: "ctx", text: raw.slice(1), line: n++ });
  }
  return rows;
}
function Changes({ item, asked, onAsk, onComment, first, reviewing = false }) {
  const diff = item.diff;
  const [at, setAt] = useState(null); // {file, line, text}
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  const [severity, setSeverity] = useState("P2");
  const comments = reviewing ? (item.draft || []).filter((x) => x.by === "me").map((x) => ({ id: x.id, file: x.file, line: x.line, text: "[" + x.severity + "] " + x.title, state: "draft" })) : item.comments || [];
  const send = async () => {
    if (!words.trim()) return;
    setBusy(true);
    try { await onComment({ file: at.file, line: at.line, text: words.trim(), excerpt: at.text, severity }); setAt(null); setWords(""); setSeverity("P2"); } finally { setBusy(false); }
  };
  const ROW = { add: ["#E8F5EE", "#0B6B4A", "+"], del: ["#FCEBEA", "#B4231A", "−"], ctx: ["transparent", "#3D404A", " "], hunk: ["#F4F4F0", "#8C8F99", ""] };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
        <strong style={{ flex: 1, font: "600 18px/1.2 'Bricolage Grotesque', sans-serif" }}>{"Cambios"}{diff ? <span style={{ marginLeft: "10px", font: "500 13px/1 'Geist Mono', monospace" }}><span style={{ color: "#0B8A5F" }}>{"+" + diff.add}</span>{" "}<span style={{ color: "#B4231A" }}>{"−" + diff.del}</span></span> : null}</strong>
        <button type="button" onClick={onAsk} disabled={asked && !diff} style={{ display: "flex", alignItems: "center", gap: "6px", height: "38px", padding: "0 16px", border: 0, borderRadius: "999px", background: diff ? "rgba(18,19,26,.06)" : "#12131A", color: diff ? "#12131A" : "#FFFFFF", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}><FileDiff size={14} strokeWidth={2.2} aria-hidden="true" />{asked && !diff ? "Pidiéndoselos a " + first + "…" : diff ? "Actualizar" : "Ver los cambios"}</button>
      </span>
      {diff?.tooBig ? <span style={{ fontSize: "13px", color: "#6B4E00" }}>{"Son demasiados para enviarlos aquí: solo la lista de archivos. Míralos en vuestro repositorio."}</span> : null}
      {diff?.files?.length === 0 ? <span style={{ fontSize: "14px", color: "#5C606C" }}>{"Aún no ha cambiado nada."}</span> : null}
      {(diff?.files || []).map((file) => (
        <div key={file.path} style={{ borderRadius: "16px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 10px 26px -16px rgba(18,19,26,.2)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderBottom: "1px solid rgba(18,19,26,.06)", font: "500 13px/1.3 'Geist Mono', monospace" }}>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.path}</span>
            <span style={{ color: "#0B8A5F" }}>{"+" + file.add}</span><span style={{ color: "#B4231A" }}>{"−" + file.del}</span>
          </div>
          {file.binary ? <p style={{ margin: 0, padding: "10px 14px", fontSize: "13px", color: "#6B6F7A" }}>{"Archivo binario"}</p> : (
            <div style={{ overflowX: "auto", font: "400 12px/1.6 'Geist Mono', monospace" }}>
              {patchRows(file.patch).map((r, i) => {
                const [bg, fg, sign] = ROW[r.kind];
                const here = at && at.file === file.path && at.row === i;
                const said = r.line ? comments.filter((c) => c.file === file.path && c.line === r.line) : [];
                return (
                  <div key={i}>
                    <div className="diff-row" style={{ display: "grid", gridTemplateColumns: "48px 18px 1fr 28px", alignItems: "center", background: bg, color: fg, minWidth: "max-content" }}>
                      <span style={{ padding: "0 8px", textAlign: "right", color: "#A3A6AE", userSelect: "none" }}>{r.line ?? ""}</span>
                      <span style={{ userSelect: "none" }}>{sign}</span>
                      <span style={{ whiteSpace: "pre", paddingRight: "12px" }}>{r.text}</span>
                      {r.line ? <button type="button" aria-label={"Comentar la línea " + r.line + " de " + file.path} onClick={() => { setAt({ file: file.path, line: r.line, text: r.text, row: i }); setWords(""); }} style={{ width: "24px", height: "20px", display: "grid", placeItems: "center", border: 0, borderRadius: "6px", background: "transparent", cursor: "pointer", color: "#1F4FD1" }}><MessageSquare size={12} strokeWidth={2.2} aria-hidden="true" /></button> : <span />}
                    </div>
                    {said.map((c) => <div key={c.id} style={{ margin: "6px 14px 6px 66px", padding: "8px 12px", borderRadius: "12px", background: "#F4F6FD", fontFamily: "'Geist', sans-serif", fontSize: "13px", color: "#2B2E36" }}>{"Tú: " + c.text}<span style={{ display: "block", marginTop: "2px", fontSize: "11px", color: "#6B6F7A" }}>{COMMENT_STATE[c.state] || ""}</span></div>)}
                    {here ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "8px 14px 10px 66px", fontFamily: "'Geist', sans-serif" }}>
                        <textarea autoFocus value={words} onChange={(e) => setWords(e.target.value)} maxLength={2000} placeholder={"Tu comentario sobre la línea " + r.line + ". " + first + " decide si se lo pasa a Bruno."} aria-label="Comentario"
                          onKeyDown={(e) => { if (e.key === "Escape") setAt(null); if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); }}
                          style={{ minHeight: "64px", padding: "10px 12px", border: 0, borderRadius: "12px", outline: "none", resize: "vertical", background: "#F7F7F4", font: "inherit", fontSize: "14px" }} />
                        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
                          {reviewing ? <span role="radiogroup" aria-label="Gravedad" style={{ display: "flex", gap: "2px", padding: "2px", borderRadius: "999px", background: "rgba(18,19,26,.05)" }}>{["P0", "P1", "P2", "P3"].map((v) => <button key={v} type="button" role="radio" aria-checked={severity === v ? "true" : "false"} onClick={() => setSeverity(v)} style={{ height: "28px", padding: "0 10px", border: 0, borderRadius: "999px", cursor: "pointer", font: "600 11px/1 'Geist Mono', monospace", background: severity === v ? "#FFFFFF" : "transparent", boxShadow: severity === v ? "0 1px 2px rgba(18,19,26,.12)" : "none" }}>{v}</button>)}</span> : null}
                          <button type="button" disabled={busy || !words.trim()} onClick={send} style={{ height: "32px", padding: "0 14px", border: 0, borderRadius: "999px", background: words.trim() ? "#12131A" : "#C9CBD1", color: "#FFFFFF", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>{"Comentar"}</button>
                          <button type="button" onClick={() => setAt(null)} style={{ height: "32px", padding: "0 12px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>{"Cancelar"}</button>
                        </span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---- a review someone asked you for: your findings (by hand and from your bot), then send ----
const SEV = { P0: ["#FCEBEA", "#B4231A"], P1: ["#FFF1E0", "#9A4A00"], P2: ["#FFF6DE", "#6B4E00"], P3: ["#F2F2EE", "#5C606C"] };
function ReviewPanel({ item, review, first, onError }) {
  const r = item.review;
  const [busy, setBusy] = useState(null);
  const [summary, setSummary] = useState("");
  const draft = item.draft || [];
  const run = async (what, fn) => { setBusy(what); onError(null); try { await fn(); } catch (e) { onError(e.message); } finally { setBusy(null); } };
  if (r.state === "sent") {
    return <p role="status" style={{ margin: 0, padding: "14px 16px", borderRadius: "18px", background: "#E8F5EE", color: "#0B6B4A", fontSize: "14px" }}>{(r.verdict === "approve" ? "Has aprobado los cambios. " : "Has enviado tu revisión. ") + first + " la tiene en su tarea y Bruno se pone con lo que haga falta."}</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "20px 22px", borderRadius: "24px", background: "#FFFFFF", boxShadow: "0 0 0 1.5px #12131A, 6px 6px 0 0 #FFC93C", animation: "rise .3s ease-out" }}>
      <span style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <strong style={{ font: "600 19px/1.2 'Bricolage Grotesque', sans-serif" }}>{first + " te pide que lo revises"}</strong>
        {r.note ? <span style={{ fontSize: "14px", color: "#3D404A" }}>{"«" + r.note + "»"}</span> : null}
      </span>
      {r.summary ? <p style={{ margin: 0, padding: "12px 14px", borderRadius: "14px", background: "#F4F4F0", fontSize: "14px", lineHeight: 1.55, color: "#2B2E36", whiteSpace: "pre-wrap" }}>{"Bruno dice: " + r.summary}</p> : null}
      <span style={{ fontSize: "13px", color: "#5C606C" }}>{"Pulsa el bocadillo de una línea de los cambios para comentarla, o pide a tu bot que lo revise con tu cuenta."}</span>
      {draft.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {draft.map((x) => (
            <div key={x.id} style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "10px 12px", borderRadius: "14px", background: "#FAFAF8" }}>
              <span style={{ flex: "none", padding: "3px 8px", borderRadius: "999px", background: SEV[x.severity][0], color: SEV[x.severity][1], font: "600 11px/1.3 'Geist Mono', monospace" }}>{x.severity}</span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px", fontSize: "14px" }}>
                <strong style={{ fontWeight: 600 }}>{x.title}</strong>
                <span style={{ font: "400 12px/1.3 'Geist Mono', monospace", color: "#8C8F99" }}>{(x.file || "") + (x.line ? ":" + x.line : "") + (x.by === "bot" ? " · de tu bot" : "")}</span>
                {x.detail ? <span style={{ fontSize: "13px", color: "#3D404A" }}>{x.detail}</span> : null}
              </span>
              <button type="button" aria-label="Quitar" onClick={() => run("rm", () => review.remove(x.id))} style={{ height: "28px", padding: "0 10px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}>{"Quitar"}</button>
            </div>
          ))}
        </div>
      ) : null}
      <textarea value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={1200} placeholder={item.botSummary ? "Resumen (si lo dejas vacío, va el de tu bot: «" + item.botSummary + "»)" : "Resumen para " + first + " (opcional)"} aria-label="Resumen de tu revisión" style={{ minHeight: "60px", padding: "10px 12px", border: 0, borderRadius: "14px", outline: "none", resize: "vertical", background: "#F7F7F4", font: "inherit", fontSize: "14px" }} />
      <span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <button type="button" disabled={!!busy || !item.diff?.files?.length} onClick={() => run("bot", () => review.bot())} style={{ height: "42px", padding: "0 18px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>{busy === "bot" ? "Tu bot está revisando…" : "Revisar con mi bot"}</button>
        <button type="button" disabled={!!busy} onClick={() => run("send", () => review.send(draft.length ? "changes" : "approve", summary))} style={{ height: "42px", padding: "0 18px", border: 0, borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>{draft.length ? "Enviar revisión (" + draft.length + ")" : "Aprobar sin cambios"}</button>
      </span>
      <span style={{ fontSize: "12px", color: "#8C8F99" }}>{"Tu bot revisa con tu cuenta de IA y solo ve los cambios, como contenido de otra persona."}</span>
    </div>
  );
}
