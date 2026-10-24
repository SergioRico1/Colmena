import { useState } from "react";
import { ArrowUpRight, Check, Wrench } from "lucide-react";
import { BotPresence } from "../Presence.jsx";
import { post } from "../../../lib/api.js";
import { navigate } from "../../../lib/router.jsx";
import { useStore } from "../../../lib/store.jsx";

// An errand for one of your bots (design/V2Personas.dc.html, paso encargo): only you see this
// card. Nothing runs until you approve; then your bot does it in an incognito chat with the
// tools you chose for errands, and its answer goes back to who asked.
const TOOL_WORDS = { web: "la web", carpetas: "tus carpetas", apps: "tus apps conectadas", ordenador: "tu ordenador" };
const pill = { display: "inline-flex", alignItems: "center", gap: "6px", height: "40px", padding: "0 18px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "14px", fontWeight: 600 };
export const toolsText = (tools) => {
  const on = Object.entries(tools || {}).filter(([, v]) => v).map(([k]) => TOOL_WORDS[k]).filter(Boolean);
  return on.length ? on.slice(0, -1).join(", ") + (on.length > 1 ? " y " : "") + on.at(-1) : "ninguna herramienta: solo lo que sabe";
};

export default function ErrandCard({ errand }) {
  const { bots = [] } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState(errand);
  const e = view?.id === errand?.id && view.state !== "asked" ? view : errand;
  if (!e) return null;
  const first = String(e.from || "").split(" ")[0] || "Alguien";
  const bot = bots.find((b) => b.id === e.bot.id) || { id: e.bot.id, name: e.bot.name, color: "#8C8F99", shape: "circle" };
  const act = async (what) => {
    setBusy(true); setError(null);
    try { setView(await post(`/peers/errands/${encodeURIComponent(e.id)}/${what}`)); } catch (x) { setError(x.message); } finally { setBusy(false); }
  };
  const state = {
    asked: null,
    working: `${bot.name} está en ello. Cuando termine, la respuesta le llega a ${first}.`,
    done: `Hecho: ${bot.name} se lo ha enviado a ${first}.`,
    declined: `No lo has aprobado; ${first} lo sabe.`,
    failed: `${bot.name} no pudo hacerlo${e.error ? ": " + e.error : "."}`,
  }[e.state];
  return (
    <div style={{ alignSelf: "flex-start", width: "min(520px, 100%)", display: "flex", flexDirection: "column", gap: "14px", padding: "18px 20px", borderRadius: "24px", background: "#FFFFFF", boxShadow: e.state === "asked" ? "0 0 0 1.5px #12131A, 6px 6px 0 0 #FFC93C" : "0 1px 2px rgba(18,19,26,.05), 0 14px 30px -20px rgba(18,19,26,.3)", animation: "rise .3s ease-out" }}>
      <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <BotPresence bot={bot} size={26} state={e.state === "working" ? "work" : "rest"} />
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
          <strong style={{ font: "600 17px/1.25 'Bricolage Grotesque', sans-serif" }}>{`${first} pide algo a ${bot.name}`}</strong>
          <span style={{ fontSize: "12px", color: "#6B6F7A" }}>{(e.by?.name ? `Lo pide su bot ${e.by.name} · ` : "") + "solo lo ves tú"}</span>
        </span>
      </span>
      <p style={{ margin: 0, padding: "12px 14px", borderRadius: "16px", background: "#F4F4F0", fontSize: "15px", lineHeight: 1.55, color: "#2B2E36", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{"«" + e.text + "»"}</p>
      {e.state === "asked" ? (
        <>
          <span style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "13px", lineHeight: 1.5, color: "#5C606C" }}>
            <Wrench size={14} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", marginTop: "2px" }} />
            <span>{`${bot.name} lo hará en un chat de incógnito (no aprende nada de él) con ${toolsText(e.tools)}. Enviar, comprar, publicar o borrar algo te lo seguirá preguntando.`}</span>
          </span>
          <span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button type="button" disabled={busy} onClick={() => act("approve")} style={{ ...pill, background: "#12131A", color: "#FFFFFF" }}><Check size={15} strokeWidth={2.6} aria-hidden="true" />{"Aprobar"}</button>
            <button type="button" disabled={busy} onClick={() => act("decline")} style={{ ...pill, background: "rgba(18,19,26,.06)", color: "#12131A" }}>{"No, gracias"}</button>
            <button type="button" onClick={() => navigate("/ajustes/contactos#encargos")} style={{ ...pill, padding: "0 6px", background: "transparent", color: "#1F4FD1" }}>{"Cambiar herramientas"}</button>
          </span>
        </>
      ) : (
        <span role="status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px", fontSize: "14px", color: e.state === "failed" ? "#B4231A" : e.state === "done" ? "#0B6B4A" : "#5C606C" }}>
          {state}
          {e.missionId ? <a href={`/chat/${encodeURIComponent(bot.id)}?c=${encodeURIComponent(e.missionId)}`} onClick={(ev) => { ev.preventDefault(); navigate(`/chat/${encodeURIComponent(bot.id)}?c=${encodeURIComponent(e.missionId)}`); }} style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontWeight: 600, color: "#1F4FD1", textDecoration: "none" }}>{"Ver lo que hizo"}<ArrowUpRight size={14} strokeWidth={2.2} aria-hidden="true" /></a> : null}
        </span>
      )}
      {error ? <span role="alert" style={{ fontSize: "13px", color: "#B4231A" }}>{error}</span> : null}
    </div>
  );
}
