import { createContext, useContext } from "react";
import { dragOutProps, workFileUrl } from "../../../lib/dragOut.js";
import { withFileLinks } from "../../../lib/turnFiles.js";

// The files a turn changed, for the Markdown of that turn's answer (ChangedFiles.jsx
// TurnFileLinks provides it): their names become links that open them.

export const FileLinksContext = createContext(null);
/** {missionId, files, find(text), open(file)} or null outside a turn with changed files. */
export const useFileLinks = () => useContext(FileLinksContext);

/** The answer's Markdown with the turn's file names as «#file:» links. */
export const linkFiles = (md, ctx) => (ctx?.files?.length ? withFileLinks(md, ctx.files) : md);

/** A file name in the answer, as a link (it opens the file, or its before/after if it is gone). */
export function FileLink({ file, children }) {
  const ctx = useFileLinks();
  return (
    <button type="button" className="rm-focus" onClick={() => ctx?.open(file)} title={file.openable ? `Abrir ${file.path}` : `Ver qué cambió en ${file.path}`}
      {...(file.openable && ctx?.missionId ? dragOutProps(workFileUrl(ctx.missionId, file.path)) : {})}
      style={{ display: "inline", padding: 0, border: 0, background: "transparent", cursor: "pointer", font: "inherit", color: "#1F4FD1", textDecoration: "underline", textDecorationColor: "rgba(31,79,209,.35)", textUnderlineOffset: "3px" }}>
      {children}
    </button>
  );
}

/** A «#file:» link of the answer. */
export function FileHref({ href, children }) {
  const ctx = useFileLinks();
  const file = ctx?.find(href);
  return file ? <FileLink file={file}>{children}</FileLink> : <span>{children}</span>;
}

/** Inline code that is exactly one of the turn's files: a link with the code look. */
export function useCodeFile(text) {
  const ctx = useFileLinks();
  return ctx ? ctx.find(String(text || "")) : null;
}
