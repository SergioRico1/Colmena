import { Sparkles } from "lucide-react";

// What you might say next, under the latest answer (after assistant-ui follow-up-suggestions):
// two or three short pills that rise in one after the other; one puts its words in the box.
export default function FollowUps({ list = [], onPick }) {
  if (list.length < 2) return null;
  return (
    <div role="group" aria-label="Para seguir" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", marginTop: "-8px" }}>
      <Sparkles size={14} strokeWidth={2.2} aria-hidden="true" style={{ color: "#8A8D96" }} />
      {list.map((t, i) => (
        <button key={t} type="button" className="rm-focus" onClick={() => onPick(t)} title={i === 0 ? "Tab en el cuadro vacío para usarla" : undefined}
          style={{ height: "36px", padding: "0 16px", border: 0, borderRadius: "999px", background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(18,19,26,.08)", cursor: "pointer", fontSize: "14px", color: "#12131A", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", animation: "rise .35s ease-out both", animationDelay: i * 70 + "ms" }}>
          {t}
        </button>
      ))}
    </div>
  );
}
