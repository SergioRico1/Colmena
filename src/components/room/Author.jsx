import { fitInitials, stepOf } from "../../lib/type.js";
import { srOnly } from "../../lib/alt.js";
import { ArrowLeftRight } from "lucide-react";
import { BotPresence } from "../v2/Presence.jsx";
import { createContext, useContext } from "react";
import { BotMark, OwnerBadge, badgeSize } from "../v2/chat/Mark.jsx";
import { initialsOf, personTint } from "../../lib/identity.js";
import { authorView, handoffLine, statusLine } from "../../lib/roomView.js";
import { time } from "../../lib/format.js";

// Who wrote a row, the same in every conversation (docs/PLAN-equipo-y-salas.md, scope 4):
// a PERSON is a circle with initials («TÚ» in ink for you) and a name; a BOT is its shape, its
// name, its role in small text and «bot de Lucía» when it is not yours. Circles are people only.
const tintOf = personTint;

/**
 * The names bots go by in this place (identity.js › botNameLabels): a room provides it so that a
 * name two visible bots share reads «Vera · de Lucía» in every author line.
 */
export const BotNames = createContext(null);
export const useBotNames = () => useContext(BotNames);

/** A person's round avatar. `presence`: "online" | "offline" draws the dot (filled: here; ring: not). */
export function PersonAvatar({ person, size = 40, ring = "#F5F5F2", presence = null }) {
  const you = !!(person?.you || person?.me);
  const dot = Math.max(8, Math.round(size / 3.6));
  return (
    <span aria-hidden="true" style={{ position: "relative", flex: "none", width: size + "px", height: size + "px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: you ? "#12131A" : person?.color || tintOf(person?.name), color: you ? "#FFFFFF" : "#12131A", font: `600 ${stepOf(Math.round(size / 3))}px/1 'Geist', sans-serif`, letterSpacing: "0.02em" }}>
      {fitInitials(you ? "TÚ" : person?.initials || initialsOf(person?.name), size)}
      {presence ? <span style={{ position: "absolute", right: "-1px", bottom: "-1px", width: dot + "px", height: dot + "px", boxSizing: "border-box", borderRadius: "var(--r-circle)", background: presence === "online" ? "#1E9E6A" : ring, border: presence === "online" ? "0" : "2px solid #8A8D96", boxShadow: `0 0 0 2px ${ring}` }} /> : null}
    </span>
  );
}

/** The avatar of a row's author: round for a person, the bot's shape for a bot. */
export function AuthorAvatar({ author, size = 40, state = "rest" }) {
  // Someone else's bot carries its owner's initials in a round chip in the corner.
  if (author?.kind === "bot") return <span aria-hidden="true" style={{ position: badgeSize(author.owner, size) ? "relative" : undefined, width: size + "px", height: size + "px", flex: "none", display: "grid", placeItems: "center" }}><BotPresence bot={author} size={size} state={state} /><OwnerBadge owner={author.owner} size={size} ring="#F5F5F2" /></span>;
  return <PersonAvatar person={author} size={size} />;
}

/** «Vera · Investigación · bot de Lucía · para Marta · 09:06». */
export function AuthorHead({ author, at = null, to = null, note = null, children = null }) {
  const names = useBotNames();
  const v = authorView(author, names);
  const tail = [to ? "para " + to : null, note, at ? time(at) : null].filter(Boolean);
  return (
    <span style={{ fontSize: "var(--t-ui)", lineHeight: "1.3", marginBottom: "-2px" }}>
      <strong style={{ fontWeight: "600" }}>{v.name}</strong>
      {/* A bot of yours shows its role only: «bot» is said to a screen reader (someone else's says «bot de …»). */}
      {v.kind === "bot" && v.mine ? <span style={srOnly}>{", bot"}</span> : null}
      {v.kind === "bot" && v.sub ? <span style={{ fontSize: "var(--t-meta)", color: "#5C606C" }}>{" · " + v.sub}</span> : null}
      {tail.length ? <span style={{ color: "#5C606C" }}>{" " + tail.map((x) => "· " + x).join(" ")}</span> : null}
      {children}
    </span>
  );
}

const quiet = { margin: 0, padding: "5px 0 5px 52px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "var(--t-meta)", lineHeight: "1.45", color: "#5C606C" };

/** One quiet line about another owner's bot («Vera espera el OK de Sergio»). Never honey. */
export function StatusLine({ item }) {
  const text = statusLine(item);
  if (!text) return null;
  const moving = item.state === "working" || item.state === "thinking";
  return (
    <p data-message-id={item.id || undefined} style={quiet}>
      {item.bot ? <BotMark bot={item.bot} size={12} state={moving ? "work" : "rest"} /> : null}
      <span>{text}{item.at ? <span>{" · " + time(item.at)}</span> : null}</span>
    </p>
  );
}

/** A handoff between two bots: «Vera ⇄ Atlas», with the sentence for a screen reader. */
export function HandoffLine({ item }) {
  const line = handoffLine(item);
  if (!line) return null;
  return (
    <p data-message-id={item.id || undefined} role="img" aria-label={line.label} style={quiet}>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", gap: "8px", color: "#3D404A", fontWeight: 500 }}>
        <BotMark bot={line.fromBot} size={12} />{line.from}
        <ArrowLeftRight size={14} strokeWidth={2.2} color="#5C606C" />
        <BotMark bot={line.toBot} size={12} />{line.to}
      </span>
      {item.at ? <span aria-hidden="true">{"· " + time(item.at)}</span> : null}
    </p>
  );
}
