import { useEffect, useState } from "react";
import { approvalCard } from "../lib/approvalCard.js";

// The pieces every approval card shares (lib/approvalCard.js): who a send goes to and its
// subject, with what the card leaves out said in words, and the two lines under the buttons:
// the undo window and what happens if nobody decides in time. Each surface passes its own
// sizes; the words are the same everywhere.

/** The card model of `a`, kept current while a deadline runs (every second in its last hour). */
export function useApprovalCard(a, botName, options = {}) {
  const [now, setNow] = useState(() => Date.now());
  const deadline = [a?.autoSendAt, a?.expiresAt, a?.waitUntil].map((t) => Date.parse(t || "")).filter((t) => !Number.isNaN(t)).sort((x, y) => x - y)[0] ?? null;
  useEffect(() => {
    if (deadline == null) return undefined;
    const every = deadline - Date.now() < 90 * 60e3 ? 1000 : 30000;
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [deadline]);
  return approvalCard(a, { botName, now, ...options });
}

const strong = { fontWeight: "600", color: "#12131A" };

/**
 * «Para ana@…, luis@… y 2 más», the subject and the start of the text. `subject`: false where
 * the surface's title already says it (then it is not repeated here).
 */
export function SendWhat({ send, subject = true, size = "var(--t-body)", style = null }) {
  if (!send) return null;
  const to = send.to.length ? send.to.join(", ") + (send.moreTo ? ` y ${send.moreTo} más` : "") : "nadie todavía";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: size, lineHeight: "1.5", color: "#4A4D57", minWidth: 0, overflowWrap: "anywhere", ...style }}>
      <span>
        {"Para "}<strong style={strong}>{to}</strong>
        {send.copies ? (send.copies === 1 ? " y 1 en copia" : ` y ${send.copies} en copia`) : null}
        {send.attachments.length ? <>{" · con "}<strong style={strong}>{send.attachments.join(", ")}</strong></> : null}
      </span>
      {subject ? <span>{"Asunto: "}<strong style={strong}>{send.subject || "sin asunto"}</strong></span> : null}
      {send.excerpt ? <span>{`«${send.excerpt}»`}</span> : null}
    </div>
  );
}

/** The quiet lines of a card: what the card cut, the undo window, what happens at the deadline. */
export function ApprovalNotes({ model, size = "var(--t-meta)", style = null }) {
  if (!model) return null;
  const lines = [model.truncatedLine, model.undoLine].filter(Boolean);
  const expiry = model.expiryLine;
  if (!lines.length && !expiry) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: size, lineHeight: "1.45", color: "#5C606C", ...style }}>
      {lines.length ? <span>{lines.join(" ")}</span> : null}
      {expiry ? <span role="timer" aria-live="off" style={{ color: expiry.urgent ? "#B4232A" : "#5C606C" }}>{expiry.text}</span> : null}
    </div>
  );
}
