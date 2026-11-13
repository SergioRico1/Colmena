import { fitInitials, stepOf } from "../../../lib/type.js";
import { Clock3, Moon } from "../../Icon.js";
import { C } from "../../../lib/theme.js";
import { personTint } from "../../../lib/palette4.js";

// People of «Personas» (design/V2Personas.dc.html, v4): round avatars tinted with the person's
// colour (lib/palette4.js personTint: their colour mixed into the surface and into the ink, in
// both themes; bots are shapes, people never are), a green dot while connected, a dashed ring
// while invited, a moon for «No molestar» and a clock for «Fuera».
export function PeerAvatar({ person, size = 38, ring = "var(--c-page)", dashed = false, dot = false }) {
  const me = !!person?.me;
  const badge = Math.max(9, Math.round(size / 3.4));
  const away = dot ? person?.away?.mode : null;
  const Icon = away === "dnd" ? Moon : away === "away" ? Clock3 : null;
  return (
    <span aria-hidden="true" style={{ position: "relative", width: size + "px", height: size + "px", flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", boxSizing: "border-box", ...(me && !person?.color ? { background: "var(--c-btn)", color: "var(--c-btn-text)" } : person?.color ? personTint(person.color) : { background: C.chip, color: C.text2 }), font: `600 ${stepOf(Math.round(size / 2.9))}px/1 'Geist', sans-serif`, letterSpacing: "0.02em", border: dashed ? "1.5px dashed var(--c-text-4)" : 0 }}>
      {fitInitials(me ? "TÚ" : person?.initials || "?", size)}
      {Icon ? (
        <span style={{ position: "absolute", right: "-2px", bottom: "-2px", width: badge + 4 + "px", height: badge + 4 + "px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: "var(--c-card)", color: "var(--c-text-3)", boxShadow: `0 0 0 2px ${ring}` }}><Icon size={badge} strokeWidth={2.4} /></span>
      ) : dot ? <span style={{ position: "absolute", right: 0, bottom: 0, width: badge + "px", height: badge + "px", borderRadius: "var(--r-circle)", background: person?.online ? C.ok : C.lineStrong, boxShadow: `0 0 0 2px ${ring}` }} /> : null}
    </span>
  );
}

/**
 * The face of a conversation's row: a direct one is the person; a group is «#» with the
 * avatar of the last one who wrote and «+N» for the rest.
 */
export function ShareFace({ share, ring = "var(--c-page)" }) {
  if (share.kind === "dm") {
    const other = share.members.find((m) => !m.me) || null;
    return <PeerAvatar person={other} size={38} ring={ring} dot={other?.status === "active"} dashed={other?.status === "pending"} />;
  }
  return (
    <span aria-hidden="true" style={{ position: "relative", width: "38px", height: "38px", flex: "none", display: "grid", placeItems: "center" }}>
      <span style={{ width: "38px", height: "38px", display: "grid", placeItems: "center", borderRadius: "var(--r-md)", background: "var(--c-chip)", font: "600 var(--t-read)/1 'Geist', sans-serif", color: "var(--c-text-2)" }}>{"#"}</span>
      {share.face ? (
        <span style={{ position: "absolute", right: "-9px", bottom: "-6px", display: "flex" }}>
          <span style={{ position: "relative", zIndex: 1, width: "20px", height: "20px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", ...(share.face.color ? personTint(share.face.color) : { background: C.chip, color: C.text2 }), font: "600 var(--t-micro)/1 'Geist', sans-serif", letterSpacing: "0.02em", boxShadow: `0 0 0 2px ${ring}` }}>{share.face.initials}</span>
          {share.more > 0 ? <span style={{ marginLeft: "-4px", minWidth: "20px", height: "20px", padding: "0 4px 0 6px", display: "grid", placeItems: "center", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", font: "600 var(--t-micro)/1 'Geist', sans-serif", boxShadow: `0 0 0 2px ${ring}`, boxSizing: "border-box" }}>{"+" + share.more}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

/** Up to four people overlapped (a header). */
export function PeoplePile({ people, size = 30, max = 4 }) {
  const shown = people.slice(0, max);
  return (
    <span style={{ display: "flex" }}>
      {shown.map((p, i) => <span key={p.id} style={{ marginRight: i < shown.length - 1 ? "-8px" : 0, borderRadius: "var(--r-circle)", boxShadow: "0 0 0 2px var(--c-cut)" }}><PeerAvatar person={p} size={size} /></span>)}
      {people.length > max ? <span style={{ marginLeft: "4px", alignSelf: "center", fontSize: "var(--t-caption)", fontWeight: 600, color: "var(--c-text-3)" }}>{"+" + (people.length - max)}</span> : null}
    </span>
  );
}
