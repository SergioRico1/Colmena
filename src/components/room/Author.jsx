import { fitInitials } from "../../lib/type.js";
import { avatarColors } from "../../lib/personColor.js";
import { srOnly } from "../../lib/alt.js";
import { ArrowLeftRight } from "../Icon.js";
import BotFace from "../BotFace.jsx";
import { createContext, useContext } from "react";
import { initialsOf, personTint } from "../../lib/identity.js";
import { authorView, durationText, handoffLine, statusLine } from "../../lib/roomView.js";
import { time } from "../../lib/format.js";
import "../../styles/conversation.css";

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

/** The initials a person's circle shows: theirs; yours when your name is known, else «TÚ». */
function personInitials(person) {
  const you = !!(person?.you || person?.me);
  const named = person?.initials && person.initials !== "TÚ" && !you ? person.initials : null;
  if (named) return named;
  const name = String(person?.name || "").trim();
  if (you && (!name || /^(t[úu]|tu cuenta|sin nombre)$/i.test(name))) return "TÚ";
  return initialsOf(name);
}

/**
 * A person's round avatar (design/v4 › .av): a soft tint of their family colour with the initials
 * in its deep shade, following the theme (lib/personColor.js). `presence`: "online" | "offline"
 * draws the dot (filled green: here; a ring: not), cut out of `ring` (the surface behind).
 */
export function PersonAvatar({ person, size = 40, ring = "var(--c-app)", presence = null, label = null }) {
  const dot = size >= 28 ? 11 : 9;
  const font = size >= 40 ? "var(--t-ui)" : size >= 28 ? "var(--t-caption)" : "var(--t-micro)";
  const initials = personInitials(person);
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" };
  return (
    <span {...a11y} style={{ position: "relative", flex: "none", width: size + "px", height: size + "px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", ...avatarColors(person?.color || tintOf(person?.name)), font: `600 ${font}/1 'Geist', sans-serif`, letterSpacing: "0.01em" }}>
      {size < 22 ? initials.slice(0, 1) : fitInitials(initials, size)}
      {presence ? <span style={{ position: "absolute", right: "-2px", bottom: "-2px", width: dot + "px", height: dot + "px", boxSizing: "border-box", borderRadius: "var(--r-circle)", background: presence === "online" ? "var(--c-ok)" : ring, border: `2px solid ${ring}`, boxShadow: presence === "online" ? "none" : "inset 0 0 0 2px var(--c-text-3)" }} /> : null}
    </span>
  );
}

/**
 * Who to show when a bot's face or name is clicked anywhere in a conversation: the room (or the
 * chat) provides `(author) => void`, which opens the bot's profile in the right panel.
 */
export const OpenBot = createContext(null);
export const useOpenBot = () => useContext(OpenBot);

/**
 * The avatar of a row's author (design/v4 › .msg): round for a person, the bot's pixel face for a
 * bot (someone else's carries its owner's initials in a round chip in the corner). A bot's face
 * opens its profile where the conversation offers one.
 */
export function AuthorAvatar({ author, size = 32, state = "rest" }) {
  const open = useOpenBot();
  if (author?.kind === "bot") {
    const face = <BotFace bot={author} size={size} state={state} owner={author.owner?.you ? null : author.owner} decorative />;
    if (open) return <button type="button" className="v4-face-btn" onClick={() => open(author)} aria-label={`Ver el perfil de ${author.name || "este bot"}`} title={`Ver el perfil de ${author.name || "este bot"}`} style={{ width: size + "px", height: size + "px" }}>{face}</button>;
    return <span aria-hidden="true" style={{ width: size + "px", height: size + "px", flex: "none", display: "block" }}>{face}</span>;
  }
  return <PersonAvatar person={author} size={size} />;
}

/** «Vera [Redacción] bot de Lucía · para Marta 10:12» (design/v4 › .mh). */
export function AuthorHead({ author, at = null, to = null, note = null, children = null }) {
  const names = useBotNames();
  const open = useOpenBot();
  const v = authorView(author, names);
  const bot = v.kind === "bot";
  const tail = [to ? "para " + to : null, note].filter(Boolean);
  return (
    <span className="v4-head">
      {bot && open ? <button type="button" className="n" onClick={() => open(author)} title={`Ver el perfil de ${v.name}`}>{v.name}</button> : <span className="n">{v.name}</span>}
      {/* A bot of yours shows its role only: «bot» is said to a screen reader (someone else's says «bot de …»). */}
      {bot && v.mine ? <span style={srOnly}>{", bot"}</span> : null}
      {bot && v.role ? <span className="v4-tag">{v.role}</span> : null}
      {bot && !v.mine && v.whose && v.name === (author?.name || v.name) ? <span className="of">{v.whose}</span> : null}
      {tail.length ? <span className="of">{tail.join(" · ")}</span> : null}
      {at ? <time dateTime={at}>{time(at)}</time> : null}
      {children}
    </span>
  );
}

/** «Iris (de Lucía) está trabajando · prepara 3 imágenes»: the bot's name in bold, the rest quiet. */
function boldName(text, name) {
  if (!name || !text.startsWith(name)) return text;
  return <><b>{name}</b>{text.slice(name.length)}</>;
}

/** One quiet line about another owner's bot («Vera espera el OK de Sergio»). Never honey. */
export function StatusLine({ item }) {
  const text = statusLine(item);
  if (!text) return null;
  const moving = item.state === "working" || item.state === "thinking";
  const owner = item.owner && !item.owner.you ? item.owner : null;
  return (
    <p data-message-id={item.id || undefined} className="v4-line">
      {item.bot ? <BotFace bot={item.bot} size={24} state={moving ? "work" : item.state === "waiting" ? "wait" : "rest"} owner={owner} decorative /> : null}
      <span>{boldName(text, item.bot?.name)}{item.at ? <span>{" · " + time(item.at)}</span> : null}</span>
    </p>
  );
}

/** A handoff between two bots: «Vera ⇄ Atlas · 3 min», with the sentence for a screen reader. */
export function HandoffLine({ item }) {
  const line = handoffLine(item);
  if (!line) return null;
  const took = Number(item.ms) > 0 ? durationText(item.ms) : null;
  return (
    <p data-message-id={item.id || undefined} role="img" aria-label={line.label} className="v4-line">
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
        <BotFace bot={line.fromBot} size={20} decorative /><b>{line.from}</b>
        <ArrowLeftRight size={15} style={{ color: "var(--c-text-3)" }} />
        <BotFace bot={line.toBot} size={20} decorative /><b>{line.to}</b>
      </span>
      {took || item.at ? <span aria-hidden="true">{"· " + (took || time(item.at))}</span> : null}
    </p>
  );
}
