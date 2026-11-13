import { shapeOf } from "../v2/Presence.jsx";
import { useStore } from "../../lib/store.jsx";
import { useExpert } from "../../lib/expert.js";
import { navigate } from "../../lib/router.jsx";
import { aiConnected } from "../../lib/aiAccount.js";

// Colmena 3 app states (design/V3Estados.dc.html) that live inside a screen:
//  - NoAccountNotice: the bots cannot think (no AI account, or its sign-in failed). A system
//    notice, in neutral: honey is kept for what is on the list of what waits for you
//    (server/waiting.mjs), and this is not on it. One way out, to Ajustes › Cuentas de IA.
//  - StuckBotCard: a bot that got stuck — red ring around its shape, the reason in words, the
//    technical detail only in expert mode, «Reintentar» and «Hablar con …».
// For loading see v2/Skeleton.jsx; for plan limits,
// v2/LimitNotice.jsx (PlanLimitNotice).

const INK = "#12131A";
const HEX = "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)";
const pill = { height: "40px", padding: "0 16px", display: "inline-flex", alignItems: "center", border: "0", borderRadius: "999px", background: INK, color: "#FFFFFF", fontSize: "14px", fontWeight: "600", cursor: "pointer", textDecoration: "none" };

export { aiConnected };

/**
 * «Tus bots no pueden pensar ahora». Renders nothing while an account is connected and works.
 * `style` merges into the card.
 */
export function NoAccountNotice({ style = null }) {
  const state = useStore();
  const { ready, authError } = state;
  if (!ready) return null;
  const connected = aiConnected(state);
  if (connected && !authError) return null;
  const text = authError
    ? `No se pudo entrar en tu cuenta de IA (${String(authError.message || authError).replace(/\.$/, "")}). Vuelve a entrar y siguen donde lo dejaron.`
    : "Aún no has conectado tu cuenta de IA. Conéctala una vez y se ponen a trabajar.";
  return (
    <div role="status" style={{ display: "flex", gap: "14px", padding: "18px", borderRadius: "18px", background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(18,19,26,.1)", ...style }}>
      <span aria-hidden="true" style={{ flex: "none", width: "26px", height: "26px", background: INK, clipPath: HEX }} />
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <span style={{ fontSize: "15.5px", fontWeight: "600" }}>{"Tus bots no pueden pensar ahora"}</span>
        <span style={{ fontSize: "14px", lineHeight: "1.5", color: "#4A4D57" }}>{text}</span>
        <a href="/ajustes/ia" onClick={(e) => { e.preventDefault(); navigate("/ajustes/ia"); }} style={{ ...pill, alignSelf: "flex-start" }}>{authError || connected ? "Volver a entrar" : "Conectar mi cuenta"}</a>
      </div>
    </div>
  );
}

/**
 * A stuck bot. `bot` ({id, name, color, shape}); `reason` in plain words («La web del INE no
 * responde desde hace 10 min. Ha guardado lo que llevaba.»); `detail` the technical line, shown
 * only in expert mode; `onRetry` and `chatHref` (defaults to the bot's chat) are the ways out.
 */
export function StuckBotCard({ bot, reason, detail = null, onRetry = null, retrying = false, chatHref = null, style = null }) {
  const [expert] = useExpert();
  const s = shapeOf(bot);
  const name = bot?.name || "El bot";
  const chat = chatHref || (bot?.id ? `/chat/${bot.id}` : null);
  return (
    <div role="status" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "12px", padding: "28px", borderRadius: "24px", background: "#FFFFFF", ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <span aria-hidden="true" style={{ flex: "none", width: "36px", height: "36px", display: "grid", placeItems: "center", borderRadius: "50%", boxShadow: "inset 0 0 0 2.5px #B4232A" }}>
          <span style={{ width: "20px", height: "20px", background: bot?.color || "#C9CBD1", clipPath: s.clip, borderRadius: s.radius }} />
        </span>
        <span style={{ fontSize: "15.5px", fontWeight: "600" }}>{`${name} se ha atascado`}</span>
      </div>
      {reason ? <span style={{ fontSize: "14px", lineHeight: "1.5", color: "#4A4D57" }}>{reason}</span> : null}
      {expert && detail ? <span style={{ padding: "10px 12px", borderRadius: "12px", background: "#F6F6F3", font: "400 12px/1.5 'Geist Mono', monospace", color: "#3D404A", overflowWrap: "anywhere" }}>{detail}</span> : null}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        {onRetry ? <button type="button" disabled={retrying} onClick={onRetry} style={{ ...pill, height: "42px", padding: "0 18px", cursor: retrying ? "wait" : "pointer" }}>{retrying ? "Reintentando…" : "Reintentar"}</button> : null}
        {chat ? <a href={chat} onClick={(e) => { e.preventDefault(); navigate(chat); }} style={{ height: "42px", padding: "0 16px", display: "inline-flex", alignItems: "center", border: "1px solid rgba(18,19,26,.16)", borderRadius: "999px", color: INK, fontSize: "14px", fontWeight: "500", textDecoration: "none" }}>{`Hablar con ${name}`}</a> : null}
      </div>
    </div>
  );
}
