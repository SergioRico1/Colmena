import { KIND_LABEL, findBot } from "./common.jsx";
import { CodeXml, Table, FileText, Image } from "../Icon.js";
import { useStore } from "../../lib/store.jsx";
import { ListenArtifactButton } from "../interaction/Voice.jsx";

const SPOKEN = new Set(["md", "txt", "markdown", "html", "doc", "docx"]);

const TABLE_ICON = (size) => (
  <Table size={size} color="#1F4FD1" />
);
const DOC_ICON = (size) => (
  <FileText size={size} color="#1F4FD1" />
);
const CODE_ICON = (size) => (
  <CodeXml size={size} color="#1F4FD1" />
);
const IMAGE_ICON = (size) => (
  <Image size={size} color="#1F4FD1" />
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
        ? { alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "14px", width: "min(100%, 440px)", padding: "14px 16px", background: "var(--c-card)", border: "0", borderRadius: "var(--r-xl)", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 12px 30px -18px rgba(18,19,26,.28)", cursor: "pointer", textAlign: "left" }
        : { alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "12px", width: "min(100%, 440px)", padding: "12px 14px", background: "var(--c-card)", border: "0", borderRadius: "var(--r-xl)", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 12px 30px -18px rgba(18,19,26,.28)", cursor: "pointer", textAlign: "left" }}
    >
      <span aria-hidden="true" style={chat
        ? { width: "44px", height: "44px", flex: "none", borderRadius: "var(--r-md)", background: "var(--c-accent-soft)", display: "grid", placeItems: "center" }
        : { width: "40px", height: "40px", flex: "none", borderRadius: "var(--r-sm)", background: "var(--c-accent-soft)", display: "grid", placeItems: "center" }}>
        {artifactIcon(artifact, chat ? 22 : 20)}
      </span>
      <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "3px" }}>
        <strong style={{ fontSize: chat ? "var(--t-body)" : "var(--t-ui)", overflowWrap: "anywhere" }}>{artifact.title}</strong>
        <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{artifactMeta(artifact)}</span>
      </span>
      {chat ? <span style={{ fontSize: "var(--t-meta)", fontWeight: "600" }}>{"Abrir"}</span> : null}
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
