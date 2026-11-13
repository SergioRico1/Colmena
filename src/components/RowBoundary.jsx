import { CircleAlert } from "./Icon.js";
import { Boundary } from "../lib/boundary.js";

// One message or card that fails to draw must not take the conversation with it: the row
// becomes a single muted pill and the rest of the list keeps working. The error goes to the
// console once (lib/boundary.js). `resetKey` (the row's id and revision…) lets the row try
// again when what it shows changes — a message that failed halfway comes back with its next
// text.

export const ROW_FAILED = "No se ha podido mostrar este mensaje";

/** The muted pill: what could not be shown and, when there is one, a way on. */
export function FailedPill({ label = ROW_FAILED, action = null }) {
  return (
    <span role="note" data-row-failed="" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "6px", maxWidth: "100%", minHeight: "30px", padding: "4px 12px 4px 10px", borderRadius: "var(--r-lg)", background: "rgb(var(--c-ink-rgb) / .06)", fontSize: "var(--t-meta)", lineHeight: "1.4", color: "var(--c-text-3)" }}>
      <CircleAlert size={14} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none" }} />
      <span>{label}</span>
      {action?.href ? <a href={action.href} style={{ fontWeight: "600", color: "var(--c-accent-ink)" }}>{action.text}</a> : null}
    </span>
  );
}

/**
 * @param {object} p
 * @param {string} [p.label] what the pill says
 * @param {{href: string, text: string}|null} [p.action] a way on (a request is still decided in Revisar)
 * @param {*} [p.resetKey] when it changes, the row is tried again
 */
export default function RowBoundary({ label = ROW_FAILED, action = null, resetKey, children }) {
  return <Boundary label={label} resetKey={resetKey} fallback={() => <FailedPill label={label} action={action} />}>{children}</Boundary>;
}

/**
 * The same component inside its own boundary. `action(props)` may give `{href, text}`;
 * `resetKey(props)` says what makes it try again.
 */
export function withRowBoundary(Inner, { label = ROW_FAILED, action = null, resetKey = null } = {}) {
  function Guarded(props) {
    return (
      <RowBoundary label={label} action={action ? action(props) : null} resetKey={resetKey ? resetKey(props) : undefined}>
        <Inner {...props} />
      </RowBoundary>
    );
  }
  Guarded.displayName = `Guarded(${Inner.displayName || Inner.name || "Row"})`;
  return Guarded;
}
