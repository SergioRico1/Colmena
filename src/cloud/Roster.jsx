// The roster: the team in a row of comb cells. Bots are pixel characters (BotFace), people are
// circles with their initials. A cell can be empty (waiting to be filled), asleep (no AI yet),
// awake, or off (a bot you put aside). Cells that arrive play a short «hatch» once.
import BotFace from "../components/BotFace.jsx";
import { hexPath } from "../lib/hive.js";
import { initialsOf } from "../lib/identity.js";

const CELL = hexPath(32, 36, 33);

/** One cell of the comb with something in it. */
export function Cell({ state = "awake", lit = false, children, size = "md" }) {
  return (
    <span className={"cl-cell " + size} data-state={state} data-lit={lit ? "" : undefined}>
      <svg className="cl-cell-hex" viewBox="0 0 64 72" aria-hidden="true" focusable="false"><path d={CELL} /></svg>
      <span className="cl-cell-in">{children}</span>
    </span>
  );
}

/** A bot in its cell; `asleep` closes its eyes. */
export function BotCell({ bot, asleep = false, off = false, lit = false, size = "md" }) {
  const px = size === "lg" ? 48 : size === "sm" ? 24 : 32;
  return (
    <Cell state={off ? "off" : asleep ? "asleep" : "awake"} lit={lit} size={size}>
      <BotFace bot={{ ...bot, builtin: true }} size={px} state={asleep || off ? "pause" : "rest"} decorative />
    </Cell>
  );
}

/** A person in their cell: a circle with initials (circles are people). */
export function PersonCell({ name, size = "md" }) {
  return (
    <Cell state="awake" size={size}>
      <span className="cl-person" aria-hidden="true">{initialsOf(name)}</span>
    </Cell>
  );
}

/**
 * The team as a list: [{kind:"bot"|"person"|"empty", key, name, line, bot, asleep, off}].
 * `label` names the list for screen readers.
 */
export function Roster({ items, label, compact = false }) {
  return (
    <ul className={"cl-roster" + (compact ? " compact" : "")} aria-label={label}>
      {items.map((it) => (
        <li key={it.key} className="cl-roster-item" data-kind={it.kind} data-in={it.fresh ? "" : undefined}>
          {it.kind === "bot" ? <BotCell bot={it.bot} asleep={it.asleep} off={it.off} lit={it.lit} size={compact ? "sm" : "md"} />
            : it.kind === "person" ? <PersonCell name={it.name} size={compact ? "sm" : "md"} />
            : <Cell state="empty" size={compact ? "sm" : "md"} />}
          {compact ? <span className="cl-sr">{it.name ? `${it.name}${it.line ? ", " + it.line : ""}` : "Hueco libre"}</span> : (
            <span className="cl-roster-text">
              <span className="cl-roster-name">{it.name || " "}</span>
              {it.line ? <span className="cl-roster-line">{it.line}</span> : null}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
