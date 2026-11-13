import { KIND_LABEL, findBot } from "./common.jsx";
import { CodeXml, Download, Eye, FileDoc, Image, Table } from "../Icon.js";
import { useStore } from "../../lib/store.jsx";
import { ListenArtifactButton } from "../interaction/Voice.jsx";
import { artifactFileUrl } from "./ArtifactPanel.jsx";
import "../../styles/conversation.css";

const SPOKEN = new Set(["md", "txt", "markdown", "html", "doc", "docx"]);
const tint = { color: "var(--c-accent-ink)" };

export function artifactIcon(artifact, size) {
  const kind = artifact?.kind;
  if (kind === "table" || kind === "sheet" || artifact?.format === "csv") return <Table size={size} style={tint} />;
  if (kind === "code") return <CodeXml size={size} style={tint} />;
  if (kind === "design" || artifact?.format === "svg") return <Image size={size} style={tint} />;
  return <FileDoc size={size} style={tint} />;
}

export function artifactMeta(artifact) {
  const parts = [KIND_LABEL[artifact?.kind] || "Documento"];
  if (artifact?.status && artifact.status !== "final") parts.push(artifact.status);
  if (artifact?.version) parts.push(`versión ${artifact.version}`);
  return parts.join(" · ");
}

/**
 * A deliverable in the conversation (Colmena 4: design/v4 › .file): its tile, its name and what
 * it is, and «Ver» (beside the conversation) · «Guardar» (a copy on your computer); a text one
 * can also be read aloud. `variant` is kept for callers ("chat" | "room"); both look alike.
 */
export default function DeliverableCard({ artifact, onOpen, pressed }) {
  const { bots } = useStore();
  if (!artifact) return null;
  // Text deliverables can be read aloud («Escuchar»), among its actions.
  const spoken = (artifact.kind || "document") === "document" && SPOKEN.has(String(artifact.format || "md").toLowerCase());
  return (
    <div style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "12px", width: "min(100%, 540px)", padding: "10px 10px 10px 12px", border: "1px solid var(--c-line)", borderRadius: "var(--r-md)", background: "var(--c-raised)", boxSizing: "border-box" }}>
      <span aria-hidden="true" style={{ width: "40px", height: "40px", flex: "none", borderRadius: "var(--r-md)", background: "var(--c-accent-soft)", display: "grid", placeItems: "center" }}>{artifactIcon(artifact, 22)}</span>
      <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "2px" }}>
        <strong style={{ fontSize: "var(--t-ui)", fontWeight: 600, color: "var(--c-text)", overflowWrap: "anywhere" }}>{artifact.title}</strong>
        <span style={{ fontSize: "var(--t-caption)", color: "var(--c-text-3)" }}>{artifactMeta(artifact)}</span>
      </span>
      <span style={{ flex: "none", display: "flex", alignItems: "center", gap: "6px" }}>
        {spoken ? <ListenArtifactButton artifactId={artifact.id} title={artifact.title} bot={findBot(bots || [], artifact.botId)} /> : null}
        <button type="button" className="v4-btn" onClick={onOpen} aria-pressed={pressed === undefined ? undefined : pressed ? "true" : "false"} aria-label={`Ver ${artifact.title}`}><Eye size={15} />{"Ver"}</button>
        <a className="v4-btn" href={artifactFileUrl(artifact.id, true)} download aria-label={`Guardar ${artifact.title}`}><Download size={15} />{"Guardar"}</a>
      </span>
    </div>
  );
}
