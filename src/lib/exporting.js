// Text out of Colmena: what is pasted into another app, exported or copied for a spreadsheet.

/**
 * Markdown → clean text for pasting into Word, Outlook or a form: no **, `, # or link
 * syntax; paragraphs and line breaks stay; bullets become «• »; tables become tab-separated
 * rows (they land as cells in Excel and as aligned text elsewhere).
 */
export function toPlainText(md) {
  const lines = String(md || "").replace(/\r/g, "").split("\n");
  const out = [];
  let fence = false;
  for (const raw of lines) {
    if (/^\s{0,3}(```|~~~)/.test(raw)) { fence = !fence; continue; }
    if (fence) { out.push(raw); continue; }
    let line = raw;
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)) continue; // table rule
    if (/^\s*\|.*\|\s*$/.test(line)) line = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).join("\t");
    line = line
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s{0,3}>\s?/, "")
      .replace(/^(\s*)[-*+]\s+\[( |x|X)\]\s+/, (_, s, x) => s + (x.trim() ? "☑ " : "☐ "))
      .replace(/^(\s*)[-*+]\s+/, "$1• ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, t, u) => (t === u ? u : `${t} (${u})`))
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, "$1$2")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/`([^`]*)`/g, "$1");
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** A Markdown table (or an HTML <table>) → TSV, ready to paste as cells in Excel/Sheets. */
export function tableToTSV(table) {
  if (typeof table === "string") {
    return table.split("\n").filter((l) => /^\s*\|.*\|\s*$/.test(l) && !/^\s*\|?\s*:?-{3,}/.test(l))
      .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => cell(c.trim())).join("\t")).join("\n");
  }
  return [...table.rows].map((row) => [...row.cells].map((c) => cell(c.innerText.trim())).join("\t")).join("\n");
}
// Spreadsheets split cells on tabs and rows on newlines: keep both out of a cell.
const cell = (v) => String(v).replace(/[\t\r\n]+/g, " ").replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]*)`/g, "$1");

// ------------------------------------------------------------ conversation export
// A room or chat as a document (OpenClaw /export): a title, then each message under «## Who
// (date)». Deliverables, questions and answers are named; work notes are left out.
const when = (at) => (at ? new Date(at).toLocaleString("es-ES", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export function conversationTitle(mission, bots = []) {
  if (mission?.conversation) return "Conversación con " + (bots.find((b) => b.id === mission.botIds?.[0])?.name || "tu bot") + (mission.title ? " — " + mission.title : "");
  return "#" + (mission?.room || "sala") + (mission?.title ? " — " + mission.title : "");
}

export function conversationMarkdown(mission, messages = [], bots = [], artifacts = []) {
  const name = (m) => (m.role === "user" ? "Tú" : bots.find((b) => b.id === (m.botId || "atlas"))?.name || "Colmena");
  const lines = ["# " + conversationTitle(mission, bots), "", `Exportado de Colmena el ${when(new Date().toISOString())}.`, ""];
  for (const m of messages) {
    if (m.optimistic || m.failed || m.role === "system" || ["activity", "guard", "fork", "learned", "progress"].includes(m.kind)) continue;
    let body = String(m.text || "").trim();
    if (m.kind === "deliverable") body = "📎 Entregable: " + (artifacts.find((a) => a.id === m.artifactId)?.title || body || "documento");
    else if (m.kind === "question") body = "❓ " + body;
    else if (m.kind === "secret") body = "🔑 " + body;
    if (m.attachments?.length) body += (body ? "\n\n" : "") + m.attachments.map((f) => "📎 " + f.name).join("\n");
    if (!body) continue;
    lines.push(`## ${name(m)}${m.at ? ` (${when(m.at)})` : ""}`, "", body, "");
  }
  return lines.join("\n").trim() + "\n";
}

/** Markdown → a Word document (HTML Word opens as .doc), Colmena's type and spacing. */
export function wordDocument(title, html) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title.replace(/</g, "&lt;")}</title>
<style>body{font-family:Calibri,'Segoe UI',sans-serif;font-size:11pt;line-height:1.5;color:#12131A;max-width:720px}
h1{font-size:20pt;margin:0 0 6pt}h2{font-size:12pt;margin:16pt 0 4pt;color:#4A4F5C;border-bottom:1px solid #DCE0E8;padding-bottom:2pt}
table{border-collapse:collapse;margin:6pt 0}th,td{border:1px solid #DCE0E8;padding:4pt 6pt;text-align:left;vertical-align:top}th{background:#F7F8FA}
code,pre{font-family:Consolas,monospace;font-size:9.5pt}pre{background:#F7F8FA;padding:8pt;border-radius:6pt;white-space:pre-wrap}
blockquote{margin:4pt 0;padding-left:8pt;border-left:3px solid #FFC93C;color:#4A4F5C}</style></head><body>${html}</body></html>`;
}
