import { useState } from "react";
import { ChevronRight, ExternalLink, Eye, GitBranch, GitPullRequest, Lock, UsersRound } from "lucide-react";
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
  const { item, error, vote } = useSharedTask(id);
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

        <p style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#6B6F7A" }}><Lock size={13} strokeWidth={2.2} aria-hidden="true" />{"La tarea va en el ordenador de " + first + ". Ves lo que hace, nunca su código ni sus archivos."}</p>
      </div>
    </section>
  );
}

function Empty({ text }) {
  return <section style={{ flex: 1, display: "grid", placeItems: "center", padding: "40px", fontSize: "15px", color: "#5C606C" }}>{text}</section>;
}
