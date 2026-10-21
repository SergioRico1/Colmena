import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, ClipboardCopy, Copy } from "lucide-react";
import { tableToTSV } from "../../lib/exporting.js";
import { AnswerLayout, splitInteractive } from "./Interactive.jsx";
import Diagram from "./Diagram.jsx";
import { MentionLink } from "../v2/MentionPill.jsx";
import { useStore } from "../../lib/store.jsx";

/** Text of a hast node (the code inside a fenced block). */
const textOf = (n) => (n?.type === "text" ? n.value : (n?.children || []).map(textOf).join(""));

// Markdown with the typography of the Chat / Sala mockups (16 px / 1.6 body,
// 22 px list indent, Geist Mono chips for inline code). No raw HTML.
const make = (size) => ({
  p: ({ node, ...props }) => <p style={{ margin: "0" }} {...props} />,
  ul: ({ node, ...props }) => <ul style={{ margin: "0", paddingLeft: "22px", display: "flex", flexDirection: "column", gap: "8px" }} {...props} />,
  ol: ({ node, ...props }) => <ol style={{ margin: "0", paddingLeft: "22px", display: "flex", flexDirection: "column", gap: "8px" }} {...props} />,
  h1: ({ node, ...props }) => <h3 style={{ margin: "4px 0 0", font: `700 ${size + 6}px/1.2 'Bricolage Grotesque', sans-serif` }} {...props} />,
  h2: ({ node, ...props }) => <h3 style={{ margin: "4px 0 0", font: `700 ${size + 4}px/1.2 'Bricolage Grotesque', sans-serif` }} {...props} />,
  h3: ({ node, ...props }) => <h4 style={{ margin: "4px 0 0", font: `700 ${size + 2}px/1.25 'Bricolage Grotesque', sans-serif` }} {...props} />,
  h4: ({ node, ...props }) => <h4 style={{ margin: "4px 0 0", fontSize: size + "px", fontWeight: "700" }} {...props} />,
  blockquote: ({ node, ...props }) => <blockquote style={{ margin: "0", padding: "2px 0 2px 14px", borderLeft: "3px solid #DCE0E8", color: "#2B2D36" }} {...props} />,
  hr: () => <hr style={{ width: "100%", border: "0", borderTop: "1px solid #E6E8EE", margin: "4px 0" }} />,
  a: ({ node, href, ...props }) =>
    String(href || "").startsWith("#@")
      ? <MentionLink href={href}>{props.children}</MentionLink>
      : <a href={href} target="_blank" rel="noreferrer noopener" data-preview="" {...props} />,
  pre: ({ node, ...props }) => {
    // ```mermaid blocks are drawn as diagrams.
    const code = node?.children?.find((c) => c.tagName === "code");
    const cls = code?.properties?.className;
    if (Array.isArray(cls) && cls.includes("language-mermaid")) return <Diagram source={textOf(code).trim()} />;
    return <CodeBlock text={textOf(code || node)} {...props} />;
  },
  code: ({ node, className, children, ...props }) => {
    const block = /language-/.test(className || "") || String(children).includes("\n");
    if (block) return <code className={className} {...props}>{children}</code>;
    return <code style={{ font: "500 12px/1 'Geist Mono', monospace", padding: "3px 6px", background: "#E7EEFF", color: "#1F4FD1", borderRadius: "5px" }} {...props}>{children}</code>;
  },
  // GFM tables (bots write them for schedules, comparisons…): the same look as the
  // interactive table, scrolling sideways inside the message when they are wide.
  table: ({ node, ...props }) => <Table size={size} {...props} />,
  th: ({ node, style, ...props }) => <th style={{ textAlign: style?.textAlign || "left", padding: "8px 10px", borderBottom: "1.5px solid #12131A", verticalAlign: "bottom", fontWeight: "700" }} {...props} />,
  td: ({ node, style, ...props }) => <td style={{ textAlign: style?.textAlign || "left", padding: "8px 10px", borderBottom: "1px solid #E6E8EE", verticalAlign: "top" }} {...props} />,
  del: ({ node, ...props }) => <del style={{ color: "#555A68" }} {...props} />,
  input: ({ node, ...props }) => <input {...props} disabled style={{ margin: "0 6px 0 0", verticalAlign: "-1px" }} />,
  img: ({ node, alt }) => <span style={{ color: "#555A68" }}>{alt ? `[${alt}]` : ""}</span>,
});

/** «Copiado» for a moment after a copy (OpenClaw: 1.5 s, 2 s when it failed). */
function useCopied() {
  const [state, setState] = useState(null);
  const run = async (text) => {
    try { await navigator.clipboard.writeText(text); setState("ok"); } catch { setState("fail"); }
    setTimeout(() => setState(null), 1500);
  };
  return [state, run];
}

/** A table of an answer, with «Copiar para Excel» (tab-separated: it lands as cells). */
function Table({ size, ...props }) {
  const ref = useRef(null);
  const [copied, copy] = useCopied();
  return (
    <div className="c-md-table" style={{ position: "relative", display: "flex", flexDirection: "column", gap: "4px", maxWidth: "100%" }}>
      <div style={{ overflowX: "auto", maxWidth: "100%" }}>
        <table ref={ref} style={{ width: "100%", borderCollapse: "collapse", fontSize: Math.max(13, size - 2) + "px", lineHeight: "1.45" }} {...props} />
      </div>
      <button type="button" className="rm-focus c-md-copy" onClick={() => ref.current && copy(tableToTSV(ref.current))} title="Copia la tabla para pegarla en Excel o Hojas de cálculo"
        style={{ alignSelf: "flex-end", display: "inline-flex", alignItems: "center", gap: "6px", height: "28px", padding: "0 10px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "8px", cursor: "pointer", fontSize: "12px", fontWeight: "600", color: copied === "ok" ? "#0B6B4A" : "#4A4F5C" }}>
        {copied === "ok" ? <Check size={13} strokeWidth={2.4} aria-hidden="true" /> : <ClipboardCopy size={13} strokeWidth={2.2} aria-hidden="true" />}
        {copied === "ok" ? "Copiada" : copied === "fail" ? "No se pudo copiar" : "Copiar para Excel"}
      </button>
    </div>
  );
}

/** A code block with «Copiar». */
function CodeBlock({ text, ...props }) {
  const [copied, copy] = useCopied();
  return (
    <div className="c-md-code" style={{ position: "relative" }}>
      <pre style={{ margin: "0", padding: "14px 16px", background: "#1D1F27", color: "#E6E8EE", borderRadius: "12px", font: "400 13px/1.7 'Geist Mono', monospace", overflowX: "auto", whiteSpace: "pre" }} {...props} />
      <button type="button" className="rm-focus c-md-copy" onClick={() => copy(String(text || "").replace(/\n$/, ""))} aria-label={copied === "ok" ? "Código copiado" : "Copiar el código"}
        style={{ position: "absolute", top: "8px", right: "8px", display: "inline-flex", alignItems: "center", gap: "5px", height: "28px", padding: "0 9px", background: "#2B2D36", color: "#E6E8EE", border: "1px solid #3A3E4B", borderRadius: "7px", cursor: "pointer", fontSize: "12px" }}>
        {copied === "ok" ? <Check size={13} strokeWidth={2.4} aria-hidden="true" /> : <Copy size={13} strokeWidth={2.2} aria-hidden="true" />}{copied === "ok" ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

const GFM = [remarkGfm];
const BODY = make(16);
const SMALL = make(15);
const TINY = make(14);

const escapeRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** «@Nora» → mention chip (blue, as in the mockups) without breaking the Markdown. */
function withMentions(text, names = []) {
  if (!names.length) return text;
  const re = new RegExp("@(" + names.map(escapeRe).join("|") + ")(?![\\p{L}\\d])", "gu");
  return text.replace(re, (_, name) => `[@${name}](#@${encodeURIComponent(name)})`);
}

/** Markdown → plain text, for one-line places (cards, summaries, notices). */
export function plain(md) {
  return String(md || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-*:?\s*$/gm, " ")
    .replace(/\s*\|\s*/g, " · ")
    .replace(/^\s*[-*+]\s+/gm, "· ")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .replace(/(?:\s*·\s*){2,}/g, " · ")
    .replace(/(^|:)\s*·\s*/g, "$1 ")
    .replace(/\s*·\s*$/, "")
    .trim();
}

export default function Markdown({ text, size = 16, style, mentions = [] }) {
  // «@Vera» is a pill wherever a bot of the team is named (not only where a list is passed).
  const { bots = [] } = useStore() || {};
  if (!mentions.length) mentions = bots.map((x) => x.name).filter(Boolean);
  return (
    <div className="rm-md" style={{ display: "flex", flexDirection: "column", gap: size <= 14 ? "8px" : "12px", fontSize: size + "px", lineHeight: size >= 16 ? "1.6" : size <= 14 ? "1.5" : "1.55", overflowWrap: "anywhere", ...style }}>
      {(() => {
        const parts = splitInteractive(String(text || ""));
        const renderText = (md, key) => <ReactMarkdown key={key} remarkPlugins={GFM} components={size >= 16 ? BODY : size <= 14 ? TINY : SMALL} skipHtml>{withMentions(md, mentions)}</ReactMarkdown>;
        return parts.some((p) => p.kind !== "md") ? <AnswerLayout parts={parts} renderText={renderText} /> : renderText(String(text || ""), "all");
      })()}
    </div>
  );
}
