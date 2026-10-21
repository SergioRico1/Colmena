import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { renderToStaticMarkup } from "react-dom/server";
import { api, download } from "./api.js";
import { conversationMarkdown, conversationTitle, wordDocument } from "./exporting.js";

// «Exportar» of a room or chat: the whole conversation (all its messages, not only the ones
// on screen) as Markdown, as a Word document, or copied as Markdown.
const fileName = (title, ext) => (title.replace(/[\/:*?"<>|#]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "conversacion") + "." + ext;

export async function exportConversation(missionId, format, { bots = [] } = {}) {
  const data = await api(`/missions/${encodeURIComponent(missionId)}?mensajes=todos`);
  const md = conversationMarkdown(data, data.messages || [], bots, data.artifacts || []);
  const title = conversationTitle(data, bots);
  if (format === "copy") {
    await navigator.clipboard.writeText(md);
    return "copied";
  }
  if (format === "word") {
    const html = renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{md}</ReactMarkdown>);
    download(fileName(title, "doc"), wordDocument(title, html), "application/msword");
    return "word";
  }
  download(fileName(title, "md"), md, "text/markdown;charset=utf-8");
  return "markdown";
}
