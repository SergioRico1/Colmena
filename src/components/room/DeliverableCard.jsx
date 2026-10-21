import { KIND_LABEL, findBot } from "./common.jsx";
import { useStore } from "../../lib/store.jsx";
import { ListenArtifactButton } from "../interaction/Voice.jsx";

const SPOKEN = new Set(["md", "txt", "markdown", "html", "doc", "docx"]);

const TABLE_ICON = (size) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#1F4FD1" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 10h18M9 10v9" />
  </svg>
);
const DOC_ICON = (size) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#1F4FD1" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M9 12h6M9 16h6" />
  </svg>
);
const CODE_ICON = (size) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#1F4FD1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />
  </svg>
);
const IMAGE_ICON = (size) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#1F4FD1" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="2" />
    <path d="m4 19 6-6 4 4 3-3 4 4" />
  </svg>
);

export function artifactIcon(artifact, size) {
  const kind = artifact?.kind;
  if (kind === "table" || kind === "sheet" || artifact?.format === "csv") return TABLE_ICON(size);
  if (kind === "code") return CODE_ICON(size);
  if (kind === "design" || artifact?.format === "svg") return IMAGE_ICON(size);
  return DOC_ICON(size);
}

export function artifactMeta(artifact) {
  const parts = [KIND_LABEL[artifact?.kind] || "Documento"];
  if (artifact?.status && artifact.status !== "final") parts.push(artifact.status);
  if (artifact?.version) parts.push(`versión ${artifact.version}`);
  return parts.join(" · ");
}

/** Deliverable card. variant "chat" = Chat mockup (44 px icon + «Abrir»), "room" = Sala mockup. */
export default function DeliverableCard({ artifact, variant = "room", onOpen, pressed }) {
  const { bots } = useStore();
  if (!artifact) return null;
  const chat = variant === "chat";
  // Text deliverables can be read aloud («Escuchar»), next to the card.
  const spoken = (artifact.kind || "document") === "document" && SPOKEN.has(String(artifact.format || "md").toLowerCase());
  const card = (
    <button
      type="button"
      className="rm-focus"
      onClick={onOpen}
      aria-pressed={pressed === undefined ? undefined : pressed ? "true" : "false"}
      aria-label={`Abrir ${artifact.title}`}
      style={chat
        ? { alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "14px", width: "min(100%, 440px)", padding: "14px 16px", background: "#FFFFFF", border: "0", borderRadius: "20px", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 12px 30px -18px rgba(18,19,26,.28)", cursor: "pointer", textAlign: "left" }
        : { alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "12px", width: "min(100%, 440px)", padding: "12px 14px", background: "#FFFFFF", border: "0", borderRadius: "18px", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 12px 30px -18px rgba(18,19,26,.28)", cursor: "pointer", textAlign: "left" }}
    >
      <span aria-hidden="true" style={chat
        ? { width: "44px", height: "44px", flex: "none", borderRadius: "10px", background: "#E7EEFF", display: "grid", placeItems: "center" }
        : { width: "40px", height: "40px", flex: "none", borderRadius: "9px", background: "#E7EEFF", display: "grid", placeItems: "center" }}>
        {artifactIcon(artifact, chat ? 22 : 20)}
      </span>
      <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "3px" }}>
        <strong style={{ fontSize: chat ? "15px" : "14px", overflowWrap: "anywhere" }}>{artifact.title}</strong>
        <span style={{ fontSize: "13px", color: "#555A68" }}>{artifactMeta(artifact)}</span>
      </span>
      {chat ? <span style={{ fontSize: "13px", fontWeight: "600" }}>{"Abrir"}</span> : null}
    </button>
  );
  if (!spoken) return card;
  return (
    <span style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "6px", width: "min(100%, 470px)" }}>
      {card}
      <ListenArtifactButton artifactId={artifact.id} title={artifact.title} bot={findBot(bots || [], artifact.botId)} />
    </span>
  );
}
