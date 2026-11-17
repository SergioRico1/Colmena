// /despues: what you kept for later on this computer (server/room-plus.mjs) — the messages you
// saved and what is planned (scheduled messages, reminders, bots' follow-ups). Reached from a room's
// «⋯», the notices that say where it went, and Ctrl+K.
import Shell from "../components/v2/Shell.jsx";
import { navigate } from "../lib/router.jsx";
import { PlannedList, SavedList } from "../components/room/RoomPlus.jsx";

export default function Despues({ query = {} }) {
  const tab = query.ver === "programados" ? "programados" : "guardados";
  const tabBtn = (id, label) => (
    <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => navigate("/despues" + (id === "programados" ? "?ver=programados" : ""), { replace: true })}
      style={{ height: "34px", padding: "0 14px", border: 0, borderRadius: "var(--r-pill)", background: tab === id ? "var(--c-card)" : "transparent", boxShadow: tab === id ? "var(--c-shadow-lift)" : "none", fontSize: "var(--t-ui)", fontWeight: tab === id ? 600 : 500, color: "var(--c-text)", cursor: "pointer" }}>{label}</button>
  );
  return (
    <Shell active="chats">
      <main aria-label="Para después" style={{ width: "100%", maxWidth: "760px", margin: "0 auto", padding: "28px 24px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "18px" }}>
        <h1 style={{ margin: 0, font: "600 var(--t-heading)/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Para después"}</h1>
        <div role="tablist" aria-label="Para después" style={{ display: "flex", gap: "4px", padding: "4px", alignSelf: "flex-start", borderRadius: "var(--r-pill)", background: "var(--c-sunken)" }}>
          {tabBtn("guardados", "Guardados")}{tabBtn("programados", "Programados")}
        </div>
        {tab === "programados" ? <PlannedList /> : <SavedList />}
      </main>
    </Shell>
  );
}
