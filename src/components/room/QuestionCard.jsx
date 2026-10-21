import { post } from "../../lib/api.js";
import { useAction } from "../../lib/store.jsx";
import { time } from "../../lib/format.js";
import { BotAvatar } from "./common.jsx";
import ApprovalConflict from "./ApprovalConflict.jsx";
import Markdown from "./Markdown.jsx";

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Bolds bot names inside a sentence («Las facturas las lleva **Tomás**»). */
function BoldNames({ text, bots }) {
  const names = bots.map((b) => b.name).filter(Boolean);
  if (!names.length) return text;
  const re = new RegExp(`(${names.map(escapeRe).join("|")})`, "g");
  return String(text || "").split(re).map((part, i) => (names.includes(part) ? <strong key={i}>{part}</strong> : part));
}

/**
 * Highlighted question from a bot («Lo que te bloquea, siempre arriba»: black border + honey shadow).
 * variant "chat" (Chat mockup) or "room" (Sala / En directo mockups).
 */
export default function QuestionCard({ approval, text, bots, variant = "room", id }) {
  const { act, busy, error, conflict } = useAction();
  const chat = variant === "chat";
  const question = approval?.summary || approval?.title || text || "";
  const options = approval?.options || [];
  const pending = approval?.status === "pending";
  const primaryIndex = Math.max(0, options.findIndex((o) => o.primary));
  // The answer is bound to the question exactly as shown (revision); a 409 shows the new one.
  const answer = (option) => act(() => post(`/approvals/${approval.id}/answer`, { optionId: option.id, revision: approval.revision }));
  const mentioned = (label) => bots.find((b) => new RegExp(`\\b${escapeRe(b.name)}\\b`, "i").test(label));
  const helper = chat ? options.map((o) => mentioned(o.label)).find(Boolean) : null;
  const chosen = approval && !pending ? options.find((o) => o.id === approval.resolution || o.label === approval.resolution) : null;

  // Colmena 2.0: honey glow while it waits for you; a calm card once answered (no hard shadows).
  const card = { maxWidth: chat ? "none" : "640px", background: "#FFFFFF", borderRadius: "24px", boxShadow: "0 0 0 1px rgba(255,201,60,.6), 0 0 0 7px rgba(255,201,60,.16), 0 30px 60px -30px rgba(201,138,0,.6)", padding: "20px 22px", display: "flex", flexDirection: "column", gap: "14px" };
  const answered = approval && !pending;

  return (
    <div id={id} style={answered ? { ...card, boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 16px 40px -22px rgba(18,19,26,.16)" } : card}>
      {/[*_`#[\n]/.test(question)
        ? <Markdown text={question} size={chat ? 16 : 15} mentions={(bots || []).map((b) => b.name)} />
        : <p style={{ margin: "0", fontSize: chat ? "16px" : "15px", lineHeight: "1.55" }}><BoldNames text={question} bots={bots} /></p>}
      {answered ? (
        <span style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "6px", minHeight: "30px", padding: "4px 10px", background: "#E1F4EC", border: "1px solid #9ED4BC", borderRadius: "15px", fontSize: "13px", fontWeight: "600", color: "#0B5A3E" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
          {approval.decidedBy === "regla" ? "Respondió una regla" : "Respondiste"}
          {chosen ? `: ${chosen.label}` : approval.resolution && typeof approval.resolution === "string" ? `: ${approval.resolution}` : ""}
          {approval.decidedAt ? ` · ${time(approval.decidedAt)}` : ""}
        </span>
      ) : options.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {options.map((o, i) => {
            const primary = i === primaryIndex;
            const helperBot = chat && primary ? mentioned(o.label) : null;
            // Colmena 2.0 pills: the recommended option in ink, the rest on a soft surface.
            const style = primary
              ? { display: "flex", alignItems: "center", gap: "8px", minHeight: "46px", padding: "0 20px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "15px" }
              : { minHeight: "46px", padding: "0 18px", background: "#F6F6F3", color: "#12131A", border: "0", borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "15px" };
            return (
              <button key={o.id || i} type="button" className="rm-focus" disabled={busy || !pending} aria-busy={busy ? "true" : undefined} onClick={() => answer(o)} style={style}>
                {helperBot ? <BotAvatar bot={helperBot} size={20} /> : null}
                {o.label}
              </button>
            );
          })}
        </div>
      ) : (
        <a href={approval ? `/revisar/${encodeURIComponent(approval.id)}` : "/"} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", height: "44px", padding: "0 18px", background: "#12131A", color: "#FFFFFF", borderRadius: "999px", fontWeight: "600", fontSize: "14px" }}>{"Responder"}</a>
      )}
      {chat && helper && !answered ? (
        <p style={{ margin: "0", fontSize: "13px", color: "#555A68" }}>{`${helper.name} contestará aquí mismo. No hace falta crear una sala.`}</p>
      ) : null}
      <ApprovalConflict error={error} conflict={conflict} />
    </div>
  );
}
