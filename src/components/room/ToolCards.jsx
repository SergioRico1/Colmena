import { Brain, CircleHelp, Compass, FileText, Folder, FolderCode, Globe, Image as ImageIcon, MessagesSquare, Monitor, Plug, RotateCw, Save, Search, SquareTerminal, Wrench } from "lucide-react";
import { plural } from "../../lib/format.js";
import WorkingDots from "./Dots.jsx";
import { BotAvatar, findBot } from "./common.jsx";

// One card per tool call (pattern of OpenMuse useRenderTool / browser-tool-card, MIT:
// licenses/OpenMuse.txt), drawn with the language of design/Chat.dc.html: the numbered list
// that opens from the «Leyó 2 documentos · 40 s» pill. Data: steps[].tools from
// GET /api/missions/:id ({ id, name, status, error, card }).

const APP_NAMES = { gmail: "Gmail", googledrive: "Google Drive", googlecalendar: "Google Calendar", googlesheets: "Hojas de Google", googledocs: "Documentos de Google", outlook: "Outlook", slack: "Slack", notion: "Notion", hubspot: "HubSpot", microsoft: "Microsoft", onedrive: "OneDrive", dropbox: "Dropbox", trello: "Trello", github: "GitHub", holded: "Holded", whatsapp: "WhatsApp", telegram: "Telegram" };
const appName = (app) => APP_NAMES[String(app || "").toLowerCase()] || app;
const MUTED = { fontSize: "13px", lineHeight: "1.45", color: "#555A68" };
const MONO = { font: "500 12px/1.5 'Geist Mono', monospace" };
const LINK = { alignSelf: "flex-start", fontSize: "13px", fontWeight: "600", color: "#1F4FD1" };

/** Consecutive reads of the same file become one card («las 14 páginas»). */
export function groupTools(tools = []) {
  const out = [];
  for (const t of tools) {
    const prev = out[out.length - 1];
    if (t.card?.type === "file" && prev?.card?.type === "file" && prev.card.name === t.card.name && t.status === "done" && prev.status === "done") {
      const pages = new Set([...(prev.card.read || [prev.card.page].filter(Boolean)), t.card.page].filter(Boolean));
      // PDF reads keep the real page range they covered (from the first to the last read).
      const pdf = prev.card.pdf && t.card.pdf
        ? { ...t.card.pdf, from: Math.min(prev.card.pdf.from, t.card.pdf.from), to: Math.max(prev.card.pdf.to, t.card.pdf.to), scanned: [...new Set([...(prev.card.pdf.scanned || []), ...(t.card.pdf.scanned || [])])] }
        : t.card.pdf || prev.card.pdf;
      out[out.length - 1] = { ...prev, card: { ...prev.card, read: [...pages], pages: t.card.pages ?? prev.card.pages, ...(pdf ? { pdf } : {}) } };
    } else out.push(t.card?.type === "file" ? { ...t, card: { ...t.card, read: [t.card.page].filter(Boolean) } } : t);
  }
  return out;
}

// A semantic icon per kind of step; hovering shows the exact tool (OpenClaw).
export const ICONS = { web: Globe, websearch: Search, file: FileText, folder: Folder, search: Search, deliverable: Save, bot: MessagesSquare, question: CircleHelp, app: Plug, browser: Compass, command: SquareTerminal, memory: Brain, image: ImageIcon, pdf_fields: FileText, fill_pdf: FileText, retry: RotateCw, desktop: Monitor, project: FolderCode };
const DESKTOP = { windows: ["Mirando las ventanas", "Miró las ventanas abiertas"], open: ["Abriendo ", "Abrió "], look: ["Mirando ", "Miró "], do: ["Usando ", "Usó "] };
const DO_VERB = { click: "hizo clic", double_click: "hizo doble clic", right_click: "abrió el menú", type: "escribió", key: "pulsó una tecla", hotkey: "usó un atajo", set_value: "rellenó un campo", scroll: "se desplazó" };

/** Consecutive identical steps (three looks at the same window) become one row «×3». */
export function collapseRepeats(tools = []) {
  const out = [];
  for (const t of tools) {
    const prev = out[out.length - 1];
    const same = prev && prev.status === t.status && t.status !== "running" && prev.name === t.name && JSON.stringify(prev.card || {}) === JSON.stringify(t.card || {}) && !["web", "file", "deliverable", "bot", "question", "image"].includes(t.card?.type);
    if (same) out[out.length - 1] = { ...prev, times: (prev.times || 1) + 1 };
    else out.push(t);
  }
  return out;
}

/** «Leyó 2 documentos», «3 pasos». */
export function toolsLabel(tools = []) {
  const grouped = groupTools(tools);
  const reads = grouped.filter((t) => ["web", "file", "pdf_fields"].includes(t.card?.type) && t.status !== "error").length;
  if (reads && reads === grouped.length) return `Leyó ${plural(reads, "documento", "documentos")}`;
  if (reads) return `Leyó ${plural(reads, "documento", "documentos")} · ${plural(grouped.length, "paso", "pasos")}`;
  return grouped.length ? plural(grouped.length, "paso", "pasos") : null;
}

const FORMAT_NAME = { pdf: "PDF", docx: "Word", xlsx: "Excel", pptx: "PowerPoint", csv: "CSV", tsv: "tabla" };
const fileUrl = (id) => `/api/artifacts/${encodeURIComponent(id)}/file`;
const domainOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

function pagesText(card) {
  if (card.pdf?.total) {
    const { from, to, total } = card.pdf;
    if (from === 1 && to >= total) return total === 1 ? "la única página" : `las ${total} páginas`;
    return from === to ? `página ${from} de ${total}` : `páginas ${from}–${to} de ${total}`;
  }
  const read = card.read || [];
  if (card.pages && read.length >= card.pages) return card.pages === 1 ? "la única página" : `las ${card.pages} páginas`;
  if (card.pages && read.length) {
    const sorted = [...read].sort((a, b) => a - b);
    const range = sorted.length > 1 && sorted[sorted.length - 1] - sorted[0] === sorted.length - 1 ? `páginas ${sorted[0]}–${sorted[sorted.length - 1]}` : sorted.length > 1 ? `${sorted.length} páginas` : `página ${sorted[0]}`;
    return `${range} de ${card.pages}`;
  }
  return null;
}

export function Status({ tool }) {
  if (tool.status === "running") {
    return (
      <span role="status" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: "600", color: "#2B2D36" }}>
        <WorkingDots />
        {"En curso"}
      </span>
    );
  }
  if (tool.status === "waiting") {
    return <span style={{ height: "22px", padding: "0 8px", display: "flex", alignItems: "center", background: "#FFF4D1", border: "1px solid #F2D27A", borderRadius: "11px", fontSize: "12px", fontWeight: "600" }}>{"Te espera"}</span>;
  }
  if (tool.status === "error") return <span style={{ fontSize: "12px", fontWeight: "700", color: "#B4372A" }}>{"No salió"}</span>;
  if (tool.status === "uncertain") return <span title="Puede que se hiciera o no: compruébalo antes de repetirlo" style={{ height: "22px", padding: "0 8px", display: "flex", alignItems: "center", background: "#FFF4D1", border: "1px solid #F2D27A", borderRadius: "11px", fontSize: "12px", fontWeight: "600" }}>{"Resultado incierto"}</span>;
  return null;
}

/** First line of each card, in the mockup's voice («Leyó oferta.pdf, las 14 páginas»). */
export function headline(tool, bots) {
  const c = tool.card || {};
  const running = tool.status === "running";
  switch (c.type) {
    case "web":
      return <>{running ? "Leyendo " : "Leyó "}{c.title ? <strong>{`«${c.title}»`}</strong> : "una página"}{c.domain ? ` · ${c.domain}` : ""}</>;
    case "file": {
      const pages = pagesText(c);
      const kind = FORMAT_NAME[c.format] ? ` (${FORMAT_NAME[c.format]})` : "";
      return <>{running ? "Leyendo " : "Leyó "}<strong>{c.name || "un archivo"}</strong>{kind}{pages ? `, ${pages}` : ""}</>;
    }
    case "folder":
      return <>{"Miró la carpeta"}{c.path ? <> <strong>{c.path}</strong></> : null}{c.count != null ? ` · ${plural(c.count, "elemento", "elementos")}` : ""}</>;
    case "search":
      return <>{tool.name === "recall" ? "Buscó en la memoria" : "Buscó en el historial"}{c.query ? <> <strong>{`«${c.query}»`}</strong></> : null}{c.count != null ? ` · ${plural(c.count, "resultado", "resultados")}` : ""}</>;
    case "deliverable":
      return <>{running ? "Guardando " : "Guardó "}<strong>{`«${c.title || "Entregable"}»`}</strong>{c.version > 1 ? ` (versión ${c.version})` : ""}</>;
    case "bot": {
      const name = findBot(bots, c.botId)?.name || c.botName || "otro bot";
      return <>{running ? "Consultando a " : "Consultó a "}<strong>{name}</strong></>;
    }
    case "question":
      return <>{"Te preguntó"}</>;
    case "app":
      return <>{running ? "Usando " : "Usó "}<strong>{appName(c.app) || "una app conectada"}</strong>{c.action ? `: ${c.action}` : ""}</>;
    case "browser":
      return <>{running ? "Navegando a " : "Navegó a "}<strong>{c.domain || "una página"}</strong>{c.action && !/^(navigate|open|goto)$/i.test(c.action) ? ` · ${c.action}` : ""}</>;
    case "command":
      return <>{running ? "Ejecutando " : "Ejecutó "}<strong>{c.program || "un programa"}</strong></>;
    case "memory":
      return <>{"Guardó un recuerdo"}</>;
    case "websearch":
      if (c.action === "open_page" || c.action === "find" || c.action === "find_in_page")
        return <>{running ? "Abriendo " : "Abrió "}<strong>{domainOf(c.url) || "una página"}</strong>{" desde la búsqueda"}</>;
      return <>{running ? "Buscando en la web " : "Buscó en la web "}{c.query ? <strong>{`«${c.query}»`}</strong> : null}{c.count != null && !running ? ` · ${plural(c.count, "resultado", "resultados")}` : ""}</>;
    case "image":
      return <>{running ? "Creando la imagen " : tool.status === "waiting" ? "Quiere crear la imagen " : "Creó la imagen "}<strong>{`«${c.title || "Imagen"}»`}</strong>{c.size ? ` · ${c.size.replace("x", "×")}` : ""}</>;
    case "pdf_fields":
      return <>{running ? "Leyendo los campos de " : "Miró los campos de "}<strong>{c.name || "un PDF"}</strong>{c.count != null ? ` · ${plural(c.count, "campo", "campos")}` : ""}</>;
    case "fill_pdf":
      return <>{running ? "Rellenando " : tool.status === "waiting" ? "Quiere rellenar " : "Rellenó una copia de "}<strong>{c.source || "un PDF"}</strong>{c.count ? ` · ${plural(c.count, "campo", "campos")}` : ""}</>;
    case "retry":
      if (tool.status === "running") return <>{`Reintentando (${c.attempt || 1}/${c.max || 3})…`}{c.reason ? ` · ${c.reason}` : ""}</>;
      if (c.fallback) return <>{"OpenAI no respondía: siguió con el "}<strong>{"modelo local"}</strong></>;
      if (tool.status === "error") return <>{"OpenAI no respondió tras "}{plural(c.max || 3, "reintento", "reintentos")}</>;
      return <>{"OpenAI tardó en responder: "}{c.retries === 1 ? "lo reintentó una vez" : `lo reintentó ${c.retries || 1} veces`}</>;
    case "project": {
      const name = c.path ? c.path.split("/").pop() : c.project || "el proyecto";
      const waiting = tool.status === "waiting";
      if (c.step === "create") return <>{running ? "Creando el proyecto " : waiting ? "Quiere crear el proyecto " : "Creó el proyecto "}<strong>{c.project || "nuevo"}</strong>{c.template ? ` · ${c.template}` : ""}</>;
      if (c.step === "files") return <>{"Miró los archivos de "}<strong>{c.project || "el proyecto"}</strong>{c.count != null ? ` · ${plural(c.count, "archivo", "archivos")}` : ""}</>;
      if (c.step === "write") return <>{running ? "Escribiendo " : "Escribió "}<strong>{name}</strong></>;
      if (c.step === "edit") return <>{running ? "Cambiando " : "Cambió "}<strong>{name}</strong>{c.edits > 1 ? ` · ${plural(c.edits, "cambio", "cambios")}` : ""}</>;
      if (c.step === "delete") return <>{"Movió a la papelera "}<strong>{name}</strong></>;
      if (c.step === "preview") return <>{running ? "Probando " : waiting ? "Quiere arrancar " : "Probó "}<strong>{c.project || "el proyecto"}</strong>{c.errors ? ` · ${plural(c.errors, "error", "errores")}` : c.ok ? " · sin errores" : ""}</>;
      if (c.step === "start") return <>{running ? "Arrancando " : waiting ? "Quiere arrancar " : "Arrancó "}<strong>{c.project || "el servidor"}</strong>{c.port ? ` · 127.0.0.1:${c.port}` : ""}</>;
      if (c.step === "stop") return <>{"Paró el servidor de "}<strong>{c.project || "el proyecto"}</strong></>;
      return <>{"Miró el servidor de "}<strong>{c.project || "el proyecto"}</strong></>;
    }
    case "desktop": {
      const [now, past] = DESKTOP[c.step] || DESKTOP.do;
      const where = c.title || c.app || "una ventana";
      if (c.step === "windows") return <>{running ? now : past}</>;
      if (c.step === "do" && !running) return <>{"En "}<strong>{where}</strong>{", " + (DO_VERB[c.action] || "actuó")}{c.typed ? <> {"«"}{c.typed}{"»"}</> : null}</>;
      return <>{running ? now : past}<strong>{where}</strong></>;
    }
    default:
      return <>{tool.name || "Paso"}</>;
  }
}

export function Detail({ tool, bots, onOpenArtifact, liveOutput = null }) {
  const c = tool.card || {};
  const parts = [];
  if (c.type === "web") {
    if (c.excerpt) parts.push(<p key="e" style={{ ...MUTED, margin: "0", display: "-webkit-box", WebkitLineClamp: "2", WebkitBoxOrient: "vertical", overflow: "hidden" }}>{c.excerpt}</p>);
    if (c.url) parts.push(<a key="l" href={c.url} target="_blank" rel="noreferrer noopener" style={LINK}>{"Abrir la página"}</a>);
  }
  if (c.type === "deliverable" && c.artifactId && onOpenArtifact) {
    parts.push(<button key="o" type="button" className="rm-focus" onClick={() => onOpenArtifact(c.artifactId)} style={{ ...LINK, padding: "0", background: "transparent", border: "0", cursor: "pointer" }}>{"Abrir"}</button>);
  }
  if (c.type === "bot") {
    const bot = findBot(bots, c.botId);
    if (c.question) parts.push(<p key="q" style={{ ...MUTED, margin: "0" }}>{`«${c.question}»`}</p>);
    if (c.answer) {
      parts.push(
        <div key="a" style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: "8px", padding: "8px 10px", background: "#F7F8FA", borderRadius: "10px" }}>
          <BotAvatar bot={bot} size={22} />
          <span style={{ fontSize: "13px", lineHeight: "1.45", color: "#2B2D36", overflowWrap: "anywhere" }}>{c.answer}</span>
        </div>,
      );
    }
  }
  if (c.type === "question" && c.question) parts.push(<p key="q" style={{ ...MUTED, margin: "0" }}>{`«${c.question}»`}</p>);
  if (c.type === "memory" && c.text) parts.push(<p key="m" style={{ ...MUTED, margin: "0" }}>{`«${c.text}»`}</p>);
  if (c.type === "file") {
    const notes = [];
    if (c.pdf?.scanned?.length) notes.push(c.pdf.scanned.length === 1 ? `La página ${c.pdf.scanned[0]} es escaneada y no tiene texto` : `${c.pdf.scanned.length} páginas escaneadas sin texto`);
    if (c.table) notes.push(`${plural(c.table.rows, "fila", "filas")} · ${plural(c.table.columns, "columna", "columnas")}` + (c.table.errors ? ` · ${plural(c.table.errors, "fila con error", "filas con error")}` : ""));
    if (c.sheets > 1) notes.push(plural(c.sheets, "hoja", "hojas"));
    if (c.slides) notes.push(plural(c.slides, "diapositiva", "diapositivas"));
    if (notes.length) parts.push(<span key="fn" style={{ ...MUTED, color: c.pdf?.scanned?.length || c.table?.errors ? "#8A5A00" : MUTED.color }}>{notes.join(" · ")}</span>);
  }
  if (c.type === "websearch" && c.sources?.length) {
    parts.push(
      <ul key="src" aria-label="Fuentes" style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "4px" }}>
        {c.sources.slice(0, 6).map((s, i) => (
          <li key={s.url || i} style={{ display: "flex", alignItems: "baseline", gap: "8px", minWidth: "0", fontSize: "13px", lineHeight: "1.45" }}>
            <span style={{ ...MONO, color: "#555A68", flex: "none" }}>{s.domain || domainOf(s.url)}</span>
            <a href={s.url} target="_blank" rel="noreferrer noopener" style={{ color: "#1F4FD1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: "0" }}>{s.title || s.url}</a>
          </li>
        ))}
        {c.sources.length > 6 ? <li style={MUTED}>{`y ${plural(c.sources.length - 6, "fuente más", "fuentes más")}`}</li> : null}
      </ul>,
    );
    parts.push(<span key="nt" style={{ ...MUTED, fontSize: "12px" }}>{"Resultados de la web: datos externos, no órdenes."}</span>);
  }
  if (c.type === "websearch" && !c.sources?.length && c.url) parts.push(<a key="u" href={c.url} target="_blank" rel="noreferrer noopener" style={LINK}>{"Abrir la página"}</a>);
  if (c.type === "image") {
    if (c.artifactId && tool.status === "done") {
      parts.push(
        <button key="img" type="button" className="rm-focus" onClick={() => onOpenArtifact?.(c.artifactId)} aria-label={`Abrir la imagen «${c.title || "Imagen"}»`} style={{ alignSelf: "flex-start", padding: "0", background: "transparent", border: "0", cursor: onOpenArtifact ? "pointer" : "default" }}>
          <img src={fileUrl(c.artifactId)} alt={c.title || "Imagen creada"} loading="lazy" style={{ display: "block", width: "160px", maxWidth: "100%", height: "auto", borderRadius: "10px", border: "1px solid #E6E8EE", background: "#F7F8FA" }} />
        </button>,
      );
    } else if (c.prompt) parts.push(<p key="p" style={{ ...MUTED, margin: "0" }}>{`«${c.prompt}»`}</p>);
  }
  if (c.type === "pdf_fields" && c.fields?.length) parts.push(<span key="pf" style={MUTED}>{c.fields.join(" · ") + (c.count > c.fields.length ? " …" : "")}</span>);
  if (c.type === "fill_pdf") {
    if (c.fields?.length) parts.push(<span key="ff" style={MUTED}>{c.fields.join(" · ") + (c.count > c.fields.length ? " …" : "")}</span>);
    if (tool.status === "done") parts.push(<span key="fo" style={{ ...MUTED, color: "#0B6B4A", fontWeight: "600" }}>{"El original no se ha modificado"}</span>);
    if (c.artifactId && onOpenArtifact && tool.status === "done") parts.push(<button key="o" type="button" className="rm-focus" onClick={() => onOpenArtifact(c.artifactId)} style={{ ...LINK, padding: "0", background: "transparent", border: "0", cursor: "pointer" }}>{"Revisar la copia"}</button>);
  }
  if (c.type === "retry" && tool.status === "running" && c.waitSeconds) parts.push(<span key="rw" style={MUTED}>{`Espera ${c.waitSeconds} s y vuelve a intentarlo; lo hecho se conserva.`}</span>);
  if (c.type === "app" && (c.account || c.query)) parts.push(<span key="a" style={MUTED}>{[c.query ? `«${c.query}»` : null, c.account ? `Cuenta ${c.account}` : null].filter(Boolean).join(" · ")}</span>);
  if (c.type === "browser" && c.title) parts.push(<span key="t" style={MUTED}>{c.title}</span>);
  if (c.type === "browser") parts.push(<div key="shot" data-browser-call={tool.id} />);
  if (c.type === "project" && c.path && !["preview", "start", "stop", "status", "logs"].includes(c.step)) parts.push(<span key="pp" style={{ ...MONO, color: "#555A68", overflowWrap: "anywhere" }}>{c.path}</span>);
  if (c.type === "project" && c.step === "preview" && c.round) parts.push(<span key="pr" style={{ ...MUTED, color: "#8A5A00" }}>{`Ronda ${c.round}`}</span>);
  if (c.type === "command") {
    if (c.command) parts.push(<code key="c" style={{ ...MONO, alignSelf: "flex-start", maxWidth: "100%", padding: "3px 6px", background: "#EEF0F4", borderRadius: "5px", overflowWrap: "anywhere" }}>{c.command}</code>);
    if (tool.status === "done") parts.push(<span key="r" style={{ ...MUTED, color: c.exitCode && c.exitCode !== 0 ? "#B4372A" : "#0B6B4A", fontWeight: "600" }}>{c.exitCode != null && c.exitCode !== 0 ? `Terminó con el código ${c.exitCode}` : "Terminó bien"}</span>);
    // While it runs, its output arrives live, only for the row you unfolded (WorkLog.jsx).
    if (liveOutput) parts.push(<span key="lo" style={{ display: "contents" }}>{liveOutput}</span>);
    else if (c.output) parts.push(<pre key="o" style={{ ...MONO, margin: "0", padding: "8px 10px", background: "#F7F8FA", borderRadius: "8px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "#2B2D36" }}>{c.output}</pre>);
  }
  if (tool.status === "error" && tool.error) parts.push(<span key="err" role="note" style={{ fontSize: "13px", lineHeight: "1.45", color: "#B4372A", fontWeight: "600" }}>{tool.error}</span>);
  return parts;
}

/** The expanded list of the activity pill: one numbered card per tool call. */
export default function ToolCards({ tools = [], bots = [], onOpenArtifact }) {
  const grouped = collapseRepeats(groupTools(tools));
  return (
    <ol style={{ margin: "0", padding: "12px 16px", listStyle: "none", display: "flex", flexDirection: "column", gap: "12px", background: "#FFFFFF", border: "1px solid #E6E8EE", borderRadius: "12px", fontSize: "14px", color: "#2B2D36" }}>
      {grouped.map((t, i) => (
        <li key={t.id || i} data-tool={t.name} data-status={t.status} style={{ display: "flex", gap: "10px" }}>
          {(() => { const Icon = ICONS[t.card?.type] || Wrench; return <span title={t.name} aria-hidden="true" style={{ width: "20px", height: "20px", flex: "none", display: "grid", placeItems: "center", color: t.status === "error" ? "#B4372A" : "#555A68" }}><Icon size={15} strokeWidth={2} /></span>; })()}
          <div style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "4px 10px" }}>
              <span style={{ lineHeight: "20px", overflowWrap: "anywhere" }}>{headline(t, bots)}{t.times > 1 ? <span style={{ marginLeft: "6px", font: "600 12px/1 'Geist Mono', monospace", color: "#555A68" }}>{"×" + t.times}</span> : null}</span>
              <Status tool={t} />
            </div>
            <Detail tool={t} bots={bots} onOpenArtifact={onOpenArtifact} />
          </div>
        </li>
      ))}
    </ol>
  );
}
