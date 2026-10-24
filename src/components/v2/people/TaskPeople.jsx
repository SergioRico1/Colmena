import { useEffect, useRef, useState } from "react";
import { Check, UserPlus } from "lucide-react";
import { PeerAvatar } from "./PeerAvatar.jsx";
import { useStore } from "../../../lib/store.jsx";
import { post } from "../../../lib/api.js";
import { useTaskPeople } from "../../../lib/codeshare.js";
import { names } from "./PeopleMessage.jsx";

// «Compartir» in a Código task (design/V2Codigo.dc.html, paso compartir): the people who see
// it from their Colmena, who is looking now, and the sheet to choose them. They see what it
// is doing, Bruno's plan and the PR; never your code, your files or your chat with Bruno.
const ASKS = [["pregunta", "Pregúntame"], ["siempre", "Siempre"], ["nunca", "Nunca"]];

export default function TaskPeople({ taskId, project = null }) {
  const { peers } = useStore();
  const { view, share, invite, askReview } = useTaskPeople(taskId);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const [handing, setHanding] = useState(null); // {person, busy, done}
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (!peers?.me || !view) return null;
  const contacts = (peers.contacts || []).filter((c) => c.status === "active");
  const members = view.project?.people || [];
  // Everyone who sees it: this task's people and the project's.
  const own = view.people || [];
  const people = [...own, ...members.filter((m) => !own.some((p) => p.id === m.id))];
  const setMembers = async (next) => { setError(null); try { await invite(project.id, next); } catch (e) { setError(e.message); } };
  const toggleMember = (id) => setMembers(members.some((m) => m.id === id) ? members.filter((m) => m.id !== id).map((m) => ({ id: m.id, comments: m.comments })) : [...members.map((m) => ({ id: m.id, comments: m.comments })), { id, comments: "pregunta" }]);
  const setAsk = (id, comments) => setMembers(members.map((m) => ({ id: m.id, comments: m.id === id ? comments : m.comments })));
  const looking = (view.viewers || []).filter((v) => !v.me);
  const toggle = async (id) => {
    setError(null);
    const next = own.some((p) => p.id === id) ? own.filter((p) => p.id !== id).map((p) => p.id) : [...own.map((p) => p.id), id];
    try { await share(next); } catch (e) { setError(e.message); }
  };
  if (!contacts.length && !people.length) return null;
  return (
    <div ref={box} style={{ position: "relative", flex: "none", display: "flex", alignItems: "center", gap: "8px" }}>
      {looking.length ? (
        <span title={names(looking.map((v) => v.name)) + (looking.length > 1 ? " lo están mirando" : " lo está mirando")} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600, color: "#0B6B4A", animation: "fade .3s ease-out" }}>
          <span style={{ display: "flex" }}>{looking.slice(0, 3).map((v, i) => <span key={v.id} style={{ marginLeft: i ? "-6px" : 0, borderRadius: "50%", boxShadow: "0 0 0 2px #1E9E6A" }}><PeerAvatar person={v} size={24} /></span>)}</span>
          <span className="sr-only" style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{names(looking.map((v) => v.name)) + " lo está mirando"}</span>
        </span>
      ) : null}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open ? "true" : "false"} aria-label={people.length ? "Compartida con " + names(people.map((p) => p.name)) : "Compartir con una persona"} title="Compartir con personas"
        style={{ display: "flex", alignItems: "center", gap: "8px", height: "40px", minWidth: "40px", padding: people.length ? "0 6px" : 0, justifyContent: "center", border: 0, borderRadius: "999px", background: open ? "#12131A" : "rgba(18,19,26,.06)", color: open ? "#FFFFFF" : "#12131A", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
        {people.length ? <span style={{ display: "flex" }}>{people.slice(0, 3).map((p, i) => <span key={p.id} style={{ marginLeft: i ? "-8px" : 0, borderRadius: "50%", boxShadow: `0 0 0 2px ${open ? "#12131A" : "#F5F5F2"}` }}><PeerAvatar person={p} size={28} /></span>)}</span> : <UserPlus size={15} strokeWidth={2.2} aria-hidden="true" />}
        {people.length > 3 ? <span style={{ paddingRight: "6px" }}>{"+" + (people.length - 3)}</span> : null}
      </button>
      {open ? (
        <div role="dialog" aria-label="Compartir la tarea" style={{ position: "absolute", top: "48px", right: 0, zIndex: 40, width: "min(380px, 86vw)", maxHeight: "70vh", overflowY: "auto", padding: "18px", borderRadius: "24px", background: "rgba(255,255,255,.97)", WebkitBackdropFilter: "blur(24px)", backdropFilter: "blur(24px)", boxShadow: "0 30px 60px -20px rgba(18,19,26,.35)", display: "flex", flexDirection: "column", gap: "12px", animation: "rise .22s ease-out" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <strong style={{ font: "600 18px/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.01em" }}>{"Compartir la tarea"}</strong>
            <span style={{ fontSize: "13px", lineHeight: 1.5, color: "#5C606C" }}>{"Verán en qué está, el plan de Bruno y la PR, y podrán aprobar el plan o pedir cambios. Nunca tu código, tus archivos ni lo que hablas con Bruno. Todo se hace en este ordenador."}</span>
          </span>
          <div role="group" aria-label="Personas" style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {contacts.length ? contacts.map((c) => {
              const on = own.some((p) => p.id === c.id);
              return (
                <button key={c.id} type="button" role="checkbox" aria-checked={on ? "true" : "false"} onClick={() => toggle(c.id)} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "48px", padding: "0 10px", border: 0, borderRadius: "14px", background: on ? "rgba(31,79,209,.07)" : "transparent", cursor: "pointer", textAlign: "left" }}>
                  <PeerAvatar person={c} size={30} dot ring="#FFFFFF" />
                  <span style={{ flex: 1, fontSize: "15px", fontWeight: 500 }}>{c.name}</span>
                  <span aria-hidden="true" style={{ width: "22px", height: "22px", display: "grid", placeItems: "center", borderRadius: "50%", background: on ? "#1F4FD1" : "transparent", boxShadow: on ? "none" : "inset 0 0 0 1.5px #C9CBD1", color: "#FFFFFF" }}>{on ? <Check size={13} strokeWidth={3} /> : null}</span>
                </button>
              );
            }) : <span style={{ fontSize: "14px", color: "#5C606C" }}>{"Aún no hablas con nadie. Invita a alguien en Chats › Nueva."}</span>}
          </div>
          {contacts.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingTop: "12px", borderTop: "1px solid rgba(18,19,26,.07)" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                <strong style={{ fontSize: "14px", fontWeight: 600 }}>{"Pedir revisión a…"}</strong>
                <span style={{ fontSize: "12px", lineHeight: 1.5, color: "#5C606C" }}>{"Le llegan el resumen y los cambios; comenta líneas y su bot puede revisarlo con su cuenta. Su revisión vuelve aquí y Bruno se pone con ella."}</span>
              </span>
              <span style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {contacts.map((c) => {
                  const pending = (view.reviews || []).find((r) => r.person.id === c.id && r.state === "asked");
                  return <button key={c.id} type="button" disabled={!!pending} onClick={async () => { setError(null); try { await askReview(c.id); } catch (e) { setError(e.message); } }} style={{ display: "flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 12px 0 4px", border: 0, borderRadius: "999px", background: pending ? "#FFF6DE" : "rgba(18,19,26,.06)", cursor: pending ? "default" : "pointer", fontSize: "12px", fontWeight: 600, color: "#12131A" }}><PeerAvatar person={c} size={24} />{pending ? c.name.split(" ")[0] + " lo está revisando" : c.name.split(" ")[0]}</button>;
                })}
              </span>
            </div>
          ) : null}
          {contacts.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingTop: "12px", borderTop: "1px solid rgba(18,19,26,.07)" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                <strong style={{ fontSize: "14px", fontWeight: 600 }}>{"Pasar la tarea a…"}</strong>
                <span style={{ fontSize: "12px", lineHeight: 1.5, color: "#5C606C" }}>{"Se sube su rama a GitHub, Bruno escribe qué está hecho y qué falta, y su Colmena sigue desde ahí."}</span>
              </span>
              {handing?.done ? <span role="status" style={{ fontSize: "13px", color: "#0B6B4A" }}>{"Pasada a " + handing.name + ". Te avisamos cuando la coja."}</span> : handing ? (
                <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
                  <button type="button" disabled={handing.busy} onClick={async () => { setError(null); setHanding({ ...handing, busy: true }); try { await post("/peers/code/tasks/" + encodeURIComponent(taskId) + "/handoff", { person: handing.person }); setHanding({ ...handing, busy: false, done: true }); } catch (e) { setError(e.message); setHanding(null); } }} style={{ height: "32px", padding: "0 14px", border: 0, borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}>{handing.busy ? "Subiendo y escribiendo el traspaso…" : "Pasársela a " + handing.name}</button>
                  {handing.busy ? null : <button type="button" onClick={() => setHanding(null)} style={{ height: "32px", padding: "0 12px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}>{"Cancelar"}</button>}
                </span>
              ) : (
                <span style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {contacts.map((c) => <button key={c.id} type="button" onClick={() => setHanding({ person: c.id, name: c.name.split(" ")[0] })} style={{ display: "flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 12px 0 4px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "12px", fontWeight: 600, color: "#12131A" }}><PeerAvatar person={c} size={24} />{c.name.split(" ")[0]}</button>)}
                </span>
              )}
            </div>
          ) : null}
          {project && contacts.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingTop: "12px", borderTop: "1px solid rgba(18,19,26,.07)" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                <strong style={{ fontSize: "14px", fontWeight: 600 }}>{"Todo el proyecto «" + project.name + "»"}</strong>
                <span style={{ fontSize: "12px", lineHeight: 1.5, color: "#5C606C" }}>{"Verán todas sus tareas, lo que hace Bruno en directo y los cambios, y podrán comentar líneas. El código lo cogen de vuestro repositorio, no de aquí."}</span>
              </span>
              {contacts.map((c) => {
                const m = members.find((x) => x.id === c.id);
                return (
                  <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "6px 4px" }}>
                    <button type="button" role="checkbox" aria-checked={m ? "true" : "false"} onClick={() => toggleMember(c.id)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: 0, border: 0, background: "transparent", cursor: "pointer", textAlign: "left" }}>
                      <span aria-hidden="true" style={{ width: "20px", height: "20px", display: "grid", placeItems: "center", borderRadius: "6px", background: m ? "#1F4FD1" : "transparent", boxShadow: m ? "none" : "inset 0 0 0 1.5px #C9CBD1", color: "#FFFFFF" }}>{m ? <Check size={12} strokeWidth={3} /> : null}</span>
                      <span style={{ flex: 1, fontSize: "14px", fontWeight: 500 }}>{c.name}</span>
                    </button>
                    {m ? (
                      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", marginLeft: "30px", fontSize: "12px", color: "#6B6F7A" }}>
                        {"Sus comentarios a Bruno:"}
                        <span role="radiogroup" aria-label={"Comentarios de " + c.name} style={{ display: "flex", gap: "2px", padding: "2px", borderRadius: "999px", background: "rgba(18,19,26,.05)" }}>
                          {ASKS.map(([v, label]) => <button key={v} type="button" role="radio" aria-checked={m.comments === v ? "true" : "false"} onClick={() => setAsk(c.id, v)} style={{ height: "26px", padding: "0 10px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "12px", fontWeight: 600, background: m.comments === v ? "#FFFFFF" : "transparent", boxShadow: m.comments === v ? "0 1px 2px rgba(18,19,26,.12)" : "none", color: "#12131A" }}>{label}</button>)}
                        </span>
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          {error ? <span role="alert" style={{ fontSize: "13px", color: "#B4231A" }}>{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** On your plan: what the people it is shared with said («Marta lo aprueba», «Luis pide…»). */
export function PlanVotes({ taskId, item }) {
  const { view } = useTaskPeople(taskId, { looking: false });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const votes = view?.votes?.[item.id] || [];
  if (!votes.length) return null;
  const nameOf = (id) => view.people.find((p) => p.id === id) || { id, name: "Alguien", initials: "?" };
  const refine = async (from) => {
    setBusy(from); setError(null);
    try { await post("/peers/code/tasks/" + encodeURIComponent(taskId) + "/refine", { item: item.id, from }); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "12px 14px", borderRadius: "18px", background: "#F4F4F0" }}>
      {votes.map((v) => {
        const p = nameOf(v.from);
        const first = p.name.split(" ")[0];
        return (
          <div key={v.from} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 10px", fontSize: "14px" }}>
            <PeerAvatar person={p} size={24} />
            {v.action === "approve"
              ? <span style={{ flex: 1, minWidth: "180px" }}><strong style={{ fontWeight: 600 }}>{first}</strong>{" lo aprueba. Tú decides cuándo implementarlo."}</span>
              : <span style={{ flex: 1, minWidth: "180px", display: "flex", flexDirection: "column", gap: "2px" }}><span><strong style={{ fontWeight: 600 }}>{first}</strong>{" pide cambios:"}</span><span style={{ color: "#3D404A", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{"«" + v.text + "»"}</span></span>}
            {v.action === "changes" && item.status === "open" ? (
              <button type="button" disabled={!!busy} onClick={() => refine(v.from)} title={"Bruno rehace el plan con lo que pide " + first + " (como sugerencia de otra persona, no como orden)"} style={{ height: "34px", padding: "0 14px", border: 0, borderRadius: "999px", background: "#FFFFFF", cursor: busy ? "default" : "pointer", fontSize: "13px", fontWeight: 600, boxShadow: "0 1px 2px rgba(18,19,26,.08)" }}>{busy === v.from ? "Refinando…" : "Refinar con esto"}</button>
            ) : null}
          </div>
        );
      })}
      {error ? <span role="alert" style={{ fontSize: "13px", color: "#B4231A" }}>{error}</span> : null}
    </div>
  );
}

/** Comments of the people invited to the project, for you: pass one to Bruno or let it be. */
export function PeerComments({ taskId }) {
  const { view } = useTaskPeople(taskId, { looking: false });
  const [busy, setBusy] = useState(null);
  const [showKept, setShowKept] = useState(false);
  const list = (view?.comments || []).filter((c) => c.state === "asked" || c.state === "kept");
  if (!list.length) return null;
  const act = async (c, what) => { setBusy(c.id); try { await post("/peers/code/comments/" + encodeURIComponent(c.id) + "/" + what); } catch {} finally { setBusy(null); } };
  const asked = list.filter((c) => c.state === "asked");
  const kept = list.filter((c) => c.state === "kept");
  const row = (c) => (
    <div key={c.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px", padding: "10px 12px", borderRadius: "16px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.05)" }}>
      <PeerAvatar person={c.person} size={26} />
      <span style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px", fontSize: "14px" }}>
        <span style={{ fontSize: "12px", color: "#6B6F7A" }}><strong style={{ fontWeight: 600, color: "#12131A" }}>{c.person.name.split(" ")[0]}</strong>{c.file ? " · " : ""}{c.file ? <code style={{ fontFamily: "'Geist Mono', monospace", fontSize: "12px" }}>{c.file + (c.line ? ":" + c.line : "")}</code> : null}</span>
        <span style={{ color: "#2B2E36", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{"«" + c.text + "»"}</span>
      </span>
      <span style={{ display: "flex", gap: "6px" }}>
        <button type="button" disabled={busy === c.id} onClick={() => act(c, "forward")} title="Bruno lo recibe como la opinión de otra persona, no como una orden" style={{ height: "32px", padding: "0 12px", border: 0, borderRadius: "999px", background: "#12131A", color: "#FFFFFF", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}>{"Pasárselo a Bruno"}</button>
        <button type="button" disabled={busy === c.id} onClick={() => act(c, "drop")} style={{ height: "32px", padding: "0 10px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}>{"Descartar"}</button>
      </span>
    </div>
  );
  return (
    <div role="region" aria-label="Comentarios de otras personas" style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "10px clamp(18px, 3vw, 32px) 12px", background: "#F4F4F0", borderBottom: "1px solid rgba(18,19,26,.06)", animation: "fade .3s ease-out" }}>
      {asked.map(row)}
      {kept.length ? <button type="button" onClick={() => setShowKept((o) => !o)} style={{ alignSelf: "flex-start", padding: 0, border: 0, background: "transparent", cursor: "pointer", fontSize: "12px", fontWeight: 600, color: "#5C606C" }}>{(showKept ? "Ocultar" : "Ver") + " comentarios que solo ves tú (" + kept.length + ")"}</button> : null}
      {showKept ? kept.map(row) : null}
    </div>
  );
}
