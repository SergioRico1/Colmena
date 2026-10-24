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
export default function TaskPeople({ taskId }) {
  const { peers } = useStore();
  const { view, share } = useTaskPeople(taskId);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
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
  const people = view.people || [];
  const looking = (view.viewers || []).filter((v) => !v.me);
  const toggle = async (id) => {
    setError(null);
    const next = people.some((p) => p.id === id) ? people.filter((p) => p.id !== id).map((p) => p.id) : [...people.map((p) => p.id), id];
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
        <div role="dialog" aria-label="Compartir la tarea" style={{ position: "absolute", top: "48px", right: 0, zIndex: 40, width: "min(360px, 86vw)", padding: "18px", borderRadius: "24px", background: "rgba(255,255,255,.97)", WebkitBackdropFilter: "blur(24px)", backdropFilter: "blur(24px)", boxShadow: "0 30px 60px -20px rgba(18,19,26,.35)", display: "flex", flexDirection: "column", gap: "12px", animation: "rise .22s ease-out" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <strong style={{ font: "600 18px/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.01em" }}>{"Compartir la tarea"}</strong>
            <span style={{ fontSize: "13px", lineHeight: 1.5, color: "#5C606C" }}>{"Verán en qué está, el plan de Bruno y la PR, y podrán aprobar el plan o pedir cambios. Nunca tu código, tus archivos ni lo que hablas con Bruno. Todo se hace en este ordenador."}</span>
          </span>
          <div role="group" aria-label="Personas" style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {contacts.length ? contacts.map((c) => {
              const on = people.some((p) => p.id === c.id);
              return (
                <button key={c.id} type="button" role="checkbox" aria-checked={on ? "true" : "false"} onClick={() => toggle(c.id)} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "48px", padding: "0 10px", border: 0, borderRadius: "14px", background: on ? "rgba(31,79,209,.07)" : "transparent", cursor: "pointer", textAlign: "left" }}>
                  <PeerAvatar person={c} size={30} dot ring="#FFFFFF" />
                  <span style={{ flex: 1, fontSize: "15px", fontWeight: 500 }}>{c.name}</span>
                  <span aria-hidden="true" style={{ width: "22px", height: "22px", display: "grid", placeItems: "center", borderRadius: "50%", background: on ? "#1F4FD1" : "transparent", boxShadow: on ? "none" : "inset 0 0 0 1.5px #C9CBD1", color: "#FFFFFF" }}>{on ? <Check size={13} strokeWidth={3} /> : null}</span>
                </button>
              );
            }) : <span style={{ fontSize: "14px", color: "#5C606C" }}>{"Aún no hablas con nadie. Invita a alguien en Chats › Nueva."}</span>}
          </div>
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
