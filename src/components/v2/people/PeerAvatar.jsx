import { Clock3, Moon } from "lucide-react";

// People of «Personas» (design/V2Personas.dc.html): neutral circles with initials (bots are
// shapes; people are never shapes), a green dot while connected, a dashed ring while invited,
// a moon for «No molestar» and a clock for «Fuera».
export function PeerAvatar({ person, size = 38, ring = "#F5F5F2", dashed = false, dot = false }) {
  const me = !!person?.me;
  const badge = Math.max(9, Math.round(size / 3.4));
  const away = dot ? person?.away?.mode : null;
  const Icon = away === "dnd" ? Moon : away === "away" ? Clock3 : null;
  return (
    <span aria-hidden="true" style={{ position: "relative", width: size + "px", height: size + "px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", boxSizing: "border-box", background: me ? "#12131A" : person?.color || "#EEEAE3", color: me ? "#FFFFFF" : "#12131A", font: `600 ${Math.max(8, Math.round(size / 2.9))}px/1 'Geist', sans-serif`, letterSpacing: "0.02em", border: dashed ? "1.5px dashed #8C8F99" : 0 }}>
      {me ? "TÚ" : person?.initials || "?"}
      {Icon ? (
        <span style={{ position: "absolute", right: "-2px", bottom: "-2px", width: badge + 4 + "px", height: badge + 4 + "px", display: "grid", placeItems: "center", borderRadius: "50%", background: "#FFFFFF", color: "#5C606C", boxShadow: `0 0 0 2px ${ring}` }}><Icon size={badge} strokeWidth={2.4} /></span>
      ) : dot ? <span style={{ position: "absolute", right: 0, bottom: 0, width: badge + "px", height: badge + "px", borderRadius: "50%", background: person?.online ? "#1E9E6A" : "#C9CBD1", boxShadow: `0 0 0 2px ${ring}` }} /> : null}
    </span>
  );
}

/**
 * The face of a conversation's row: a direct one is the person; a group is «#» with the
 * avatar of the last one who wrote and «+N» for the rest.
 */
export function ShareFace({ share, ring = "#F5F5F2" }) {
  if (share.kind === "dm") {
    const other = share.members.find((m) => !m.me) || null;
    return <PeerAvatar person={other} size={38} ring={ring} dot={other?.status === "active"} dashed={other?.status === "pending"} />;
  }
  return (
    <span aria-hidden="true" style={{ position: "relative", width: "38px", height: "38px", flex: "none", display: "grid", placeItems: "center" }}>
      <span style={{ width: "38px", height: "38px", display: "grid", placeItems: "center", borderRadius: "12px", background: "#E9E9E4", font: "600 16px/1 'Geist', sans-serif", color: "#3D404A" }}>{"#"}</span>
      {share.face ? (
        <span style={{ position: "absolute", right: "-9px", bottom: "-6px", display: "flex" }}>
          <span style={{ position: "relative", zIndex: 1, width: "20px", height: "20px", display: "grid", placeItems: "center", borderRadius: "50%", background: share.face.color, color: "#12131A", font: "600 8px/1 'Geist', sans-serif", letterSpacing: "0.02em", boxShadow: `0 0 0 2px ${ring}` }}>{share.face.initials}</span>
          {share.more > 0 ? <span style={{ marginLeft: "-4px", minWidth: "20px", height: "20px", padding: "0 4px 0 6px", display: "grid", placeItems: "center", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", font: "600 9px/1 'Geist', sans-serif", boxShadow: `0 0 0 2px ${ring}`, boxSizing: "border-box" }}>{"+" + share.more}</span> : null}
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
      {shown.map((p, i) => <span key={p.id} style={{ marginRight: i < shown.length - 1 ? "-8px" : 0, borderRadius: "50%", boxShadow: "0 0 0 2px #FFFFFF" }}><PeerAvatar person={p} size={size} /></span>)}
      {people.length > max ? <span style={{ marginLeft: "4px", alignSelf: "center", fontSize: "12px", fontWeight: 600, color: "#5C606C" }}>{"+" + (people.length - max)}</span> : null}
    </span>
  );
}
