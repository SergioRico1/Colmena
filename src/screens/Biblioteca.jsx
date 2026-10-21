import { useSlidingPill } from "../lib/useSlidingPill.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import Sidebar from "../components/Sidebar.jsx";
import { css } from "../design/css/Biblioteca.js";
import { useAction, useResource, useStore } from "../lib/store.jsx";
import { api, del, download, get, patch, pickTextFiles, post } from "../lib/api.js";
import { avatarStyle, initial } from "../lib/bots.js";
import { ago, dateTime, roomUrl, shortDate } from "../lib/format.js";
import { navigate } from "../lib/router.jsx";
import { ListenButton } from "../components/interaction/Voice.jsx";
import MemoryImport from "../components/library/MemoryImport.jsx";
import { SlideViewer, isDeck } from "../components/v2/SlideDeck.jsx";
import { DocViewer, SheetViewer, isWordDoc, isWorkbook } from "../components/v2/OfficeFiles.jsx";

const EXTRA_CSS = "\nbutton:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #2F6BFF;outline-offset:2px}\n.colmena-md{font-size:15px;line-height:1.6;color:#2B2D36}.colmena-md h1,.colmena-md h2,.colmena-md h3{font-family:'Bricolage Grotesque',sans-serif;line-height:1.15;color:#12131A}.colmena-md table{border-collapse:collapse}.colmena-md td,.colmena-md th{border:1px solid #DCE0E8;padding:6px 8px}.colmena-md pre{background:#12131A;color:#E6E8EE;padding:12px;border-radius:10px;overflow:auto}.colmena-md code{font-family:'Geist Mono',monospace;font-size:13px}";

const TABS = ["archivos", "memoria", "habilidades", "plantillas"];
const KINDS = [
  { key: "todo", label: "Todo", kinds: null },
  { key: "document", label: "Documentos", kinds: ["document"] },
  { key: "table", label: "Hojas", kinds: ["table", "sheet"] },
  { key: "slides", label: "Presentaciones", kinds: ["slides"] },
  { key: "design", label: "Diseños", kinds: ["design"] },
  { key: "code", label: "Código", kinds: ["code"] },
];
const KIND_LABEL = { document: "Documento", table: "Hoja", sheet: "Hoja", slides: "Presentación", design: "Diseño", code: "Código" };
const SOURCE = { importado: "Importado de ChatGPT", dijiste: "Lo dijiste tú", dedujo: "Lo dedujo un bot", acuerdo: "Acuerdo entre bots", documento: "Sacado de un documento" };
// Mission templates from the approved mockups (Misiones «Empezar desde una plantilla» + Inicio «Prueba con»).
const TEMPLATES = [
  { title: "Informe para dirección", desc: "Datos, comparativa, diapositivas y resumen. 4 bots.", text: "Prepara un informe para dirección: datos del periodo, comparativa, diapositivas y un resumen de una página.", mode: "equipo" },
  { title: "Revisar un contrato", desc: "Cláusulas a vigilar y fechas clave. 1 bot.", text: "Revisa este contrato y dime las cláusulas a vigilar y las fechas clave.", mode: "solo" },
  { title: "Tres ideas de diseño", desc: "En modo debate: proponen, se critican y eliges.", text: "Proponed tres ideas de diseño para ", mode: "debate" },
  { title: "Automatizar una tarea repetida", desc: "Un bot de código la convierte en script y la prueba.", text: "Convierte en un script, y pruébalo, esta tarea que repito a menudo: ", mode: "solo" },
];
const TRY = [
  "Resume los correos de ayer y dime cuáles piden respuesta",
  "Compara tres programas de contabilidad para nosotros",
  "Convierte este Excel en 5 diapositivas",
];
const QUESTION = /^(¿|qu[eé]|c[oó]mo|cu[aá]l(es)?|cu[aá]ndo|d[oó]nde|qui[eé]n(es)?|por ?qu[eé]|cu[aá]nt[oa]s?|hay|tenemos|dijimos|sabemos|tengo|hicimos|resume|res[uú]meme|explica|expl[ií]came|dime|busca|encuentra)\b/i;
const looksLikeQuestion = (t) => /\?\s*$/.test(t) || QUESTION.test(t.trim());

function tint(hex, amount) {
  const n = parseInt(String(hex || "#C9CCD6").replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}
const dayLabel = (v) => {
  const d = shortDate(v);
  return d === "Hoy" || d === "Ayer" ? d.toLowerCase() : d;
};

function Avatar({ bot, size, font }) {
  return <span aria-hidden="true" style={{ width: size + "px", height: size + "px", flex: "none", display: "grid", placeItems: "center", ...avatarStyle(bot, size), font: `800 ${bot?.shape === "diamond" ? font - 1 : font}px/1 'Bricolage Grotesque', sans-serif` }}>{initial(bot)}</span>;
}

// SVG previews are fetched once per artifact (GET /api/artifacts/:id) and rendered as <img>, never inline.
const svgCache = new Map();
function useSvg(id, enabled) {
  const [src, setSrc] = useState(() => svgCache.get(id) || null);
  useEffect(() => {
    if (!enabled || svgCache.has(id)) return;
    let alive = true;
    get(`/artifacts/${encodeURIComponent(id)}`)
      .then((a) => {
        if (!a?.content || !/<svg[\s>]/i.test(a.content)) return;
        const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(a.content)}`;
        svgCache.set(id, url);
        if (alive) setSrc(url);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, enabled]);
  return src;
}

/** Miniature by artifact kind, reproducing the mockup thumbnails. */
function Thumb({ a, bot }) {
  const color = bot?.color || "#2F6BFF";
  const isSvg = a.kind === "design" && a.format === "svg";
  const svg = useSvg(a.id, isSvg);
  if (a.kind === "table" || a.kind === "sheet") {
    return (
      <span aria-hidden="true" style={{ aspectRatio: "4 / 3", background: "#E1F4EC", display: "grid", placeItems: "center" }}>
        <span style={{ width: "70%", height: "62%", background: "#FFFFFF", borderRadius: "4px", backgroundImage: "linear-gradient(#9ED4BC 1px, transparent 1px), linear-gradient(90deg, #9ED4BC 1px, transparent 1px)", backgroundSize: "100% 20%, 25% 100%" }} />
      </span>
    );
  }
  if (a.kind === "slides") {
    return (
      <span aria-hidden="true" style={{ aspectRatio: "4 / 3", background: tint(color, 0.86), display: "grid", placeItems: "center" }}>
        <span style={{ width: "72%", aspectRatio: "16 / 9", background: "#FFFFFF", borderRadius: "4px", padding: "10px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <span style={{ height: "7px", width: "50%", background: "#12131A", borderRadius: "3px" }} />
          <span style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "50%" }}>
            <span style={{ flex: "1", height: "40%", background: color }} />
            <span style={{ flex: "1", height: "75%", background: color }} />
            <span style={{ flex: "1", height: "55%", background: color }} />
          </span>
        </span>
      </span>
    );
  }
  if (a.kind === "design") {
    if (svg) {
      return (
        <span aria-hidden="true" style={{ aspectRatio: "4 / 3", background: "#F7F8FA", display: "grid", placeItems: "center", overflow: "hidden" }}>
          <img src={svg} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
        </span>
      );
    }
    const words = (a.title || "").split(/\s+/).filter(Boolean).slice(0, 2);
    return (
      <span aria-hidden="true" style={{ aspectRatio: "4 / 3", background: tint(color, 0.82), position: "relative", overflow: "hidden", display: "block" }}>
        <span style={{ position: "absolute", right: "-14px", top: "-14px", width: "90px", height: "90px", borderRadius: "50%", background: color }} />
        <span style={{ position: "absolute", left: "14px", bottom: "14px", font: "800 18px/1 'Bricolage Grotesque', sans-serif", color: "#12131A" }}>
          {words.map((w, i) => <span key={i}>{w.replace(/[.,;:]$/, "")}.{i < words.length - 1 ? <br /> : null}</span>)}
        </span>
      </span>
    );
  }
  if (a.kind === "code") {
    return (
      <span aria-hidden="true" style={{ aspectRatio: "4 / 3", background: "#12131A", padding: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
        <span style={{ height: "5px", width: "40%", background: color, borderRadius: "2px" }} />
        <span style={{ height: "5px", width: "70%", background: "#4A4F5C", borderRadius: "2px", marginLeft: "12px" }} />
        <span style={{ height: "5px", width: "55%", background: "#4A4F5C", borderRadius: "2px", marginLeft: "12px" }} />
        <span style={{ height: "5px", width: "30%", background: "#3DDC97", borderRadius: "2px", marginLeft: "24px" }} />
        <span style={{ height: "5px", width: "60%", background: "#4A4F5C", borderRadius: "2px", marginLeft: "12px" }} />
      </span>
    );
  }
  return (
    <span aria-hidden="true" style={{ aspectRatio: "4 / 3", background: tint(color, 0.88), display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ width: "52%", height: "76%", background: "#FFFFFF", borderRadius: "4px", padding: "10px", display: "flex", flexDirection: "column", gap: "6px" }}>
        <span style={{ height: "6px", width: "70%", background: color, borderRadius: "3px" }} />
        <span style={{ height: "4px", background: tint(color, 0.74), borderRadius: "2px" }} />
        <span style={{ height: "4px", background: tint(color, 0.74), borderRadius: "2px" }} />
        <span style={{ height: "4px", width: "80%", background: tint(color, 0.74), borderRadius: "2px" }} />
      </span>
    </span>
  );
}

function artifactPlace(a, mission) {
  if (mission?.conversation) return "chat privado";
  const room = a.room || mission?.room;
  return room ? `# ${room}` : null;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const sep = (text.split("\n")[0].match(/;/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
  for (let i = 0; i < text.length && rows.length < 300; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

const MIME = { md: "text/markdown", csv: "text/csv", svg: "image/svg+xml", html: "text/html", py: "text/x-python", json: "application/json" };
const fileName = (a) => `${(a.title || "entregable").replace(/[\\/:*?"<>|]+/g, "-").trim()}.${a.format || "txt"}`;

/** The content of a deliverable: image, table, page, markdown or code. */
export function ArtifactContent({ a, loading = false, error = null }) {
  const content = a?.content ?? "";
  if (loading && !a) return <p style={{ margin: 0, color: "#4A4F5C" }}>Abriendo…</p>;
  if (error) return <p role="alert" style={{ margin: 0, padding: "10px 12px", background: "#FDECEC", border: "1px solid #F1B5B7", borderRadius: "10px", fontSize: "14px", color: "#8F1D22" }}>{`No se pudo abrir: ${error}`}</p>;
  if (!content) return <p style={{ margin: 0, color: "#4A4F5C" }}>{a?.status === "en curso" ? "Todavía se está haciendo. Aparecerá aquí en cuanto el bot lo termine." : "Este entregable está vacío."}</p>;
  if (isDeck(a)) return <SlideViewer artifact={a} />;
  if (isWordDoc(a)) return <DocViewer artifact={a} />;
  if (isWorkbook(a)) return <SheetViewer artifact={a} />;
  if (a.format === "svg") return <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`} alt={a.title} style={{ maxWidth: "100%", display: "block", margin: "0 auto", background: "#FFFFFF", border: "1px solid #E6E8EE", borderRadius: "12px" }} />;
  if (a.format === "csv") {
    const rows = parseCsv(content);
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "13px", minWidth: "100%" }}>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => i === 0
                ? <th key={j} scope="col" style={{ padding: "8px", borderBottom: "2px solid #12131A", textAlign: "left", fontWeight: "600", whiteSpace: "nowrap" }}>{c}</th>
                : <td key={j} style={{ padding: "8px", borderBottom: "1px solid #E6E8EE", fontFamily: /^-?[\d.,%€$ ]+$/.test(c) ? "'Geist Mono', monospace" : "inherit" }}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (a.format === "html") return <iframe title={a.title} sandbox="" srcDoc={content} style={{ width: "100%", height: "70vh", border: "1px solid #E6E8EE", borderRadius: "12px", background: "#FFFFFF" }} />;
  if (a.format === "md" || a.format === "txt" || a.kind === "document" || a.kind === "slides") return <div className="colmena-md"><ReactMarkdown>{content}</ReactMarkdown></div>;
  return <pre style={{ margin: 0, padding: "16px", background: "#12131A", color: "#E6E8EE", borderRadius: "12px", overflow: "auto", font: "400 13px/1.6 'Geist Mono', monospace" }}>{content}</pre>;
}

/** Side panel with the artifact content (GET /api/artifacts/:id) and download. */
function ArtifactPanel({ id, onClose }) {
  const { bots, missions } = useStore();
  const { data, error, loading } = useResource(`/artifacts/${encodeURIComponent(id)}`);
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const key = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  const a = data;
  const bot = a ? bots.find((b) => b.id === a.botId) : null;
  const mission = a ? missions.find((m) => m.id === a.missionId) : null;
  const content = a?.content ?? "";


  return (
    <div style={{ position: "fixed", inset: "0", zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
      <div aria-hidden="true" onClick={onClose} style={{ position: "absolute", inset: "0", background: "rgba(18,19,26,.38)" }} />
      <section role="dialog" aria-modal="true" aria-labelledby="entregable-t" style={{ position: "relative", width: "min(680px, 100%)", height: "100%", background: "#FFFFFF", borderLeft: "2px solid #12131A", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 22px 16px", borderBottom: "1px solid #E6E8EE", display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
            <span style={{ font: "500 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#4A4F5C" }}>
              {a ? [KIND_LABEL[a.kind] || "Archivo", a.format, a.version ? `v${a.version}` : null].filter(Boolean).join(" · ") : "Entregable"}
            </span>
            <button ref={closeRef} type="button" aria-label="Cerrar" onClick={onClose} style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "10px", cursor: "pointer" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <h2 id="entregable-t" style={{ margin: 0, font: "700 24px/1.15 'Bricolage Grotesque', sans-serif", fontFamily: a?.kind === "code" ? "'Geist Mono', monospace" : undefined, letterSpacing: "-0.01em" }}>
            {a?.title || "…"}
            {a?.status && a.status !== "final" ? <span style={{ fontWeight: "500", fontSize: "16px", color: a.status === "borrador" ? "#8A6400" : "#4A4F5C" }}>{` · ${a.status}`}</span> : null}
          </h2>
          {a ? (
            <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#4A4F5C" }}>
              {bot ? <Avatar bot={bot} size={20} font={10} /> : null}
              {[bot?.name, artifactPlace(a, mission), dateTime(a.createdAt)].filter(Boolean).join(" · ")}
            </span>
          ) : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", paddingTop: "4px" }}>
            {a?.content ? (
              <button type="button" onClick={() => download(fileName(a), a.content, `${MIME[a.format] || "text/plain"};charset=utf-8`)} style={{ display: "flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 14px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "600" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
                Descargar
              </button>
            ) : (
              <a href={`/api/artifacts/${encodeURIComponent(id)}/download`} download style={{ display: "flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 14px", background: "#12131A", color: "#FFFFFF", borderRadius: "10px", fontSize: "14px", fontWeight: "600" }}>Descargar</a>
            )}
            {mission ? <a href={roomUrl(mission)} style={{ display: "flex", alignItems: "center", height: "40px", padding: "0 14px", background: "#FFFFFF", border: "1px solid #12131A", borderRadius: "10px", fontSize: "14px", fontWeight: "600" }}>{mission.conversation ? "Abrir el chat" : "Abrir en la sala"}</a> : null}
            {a?.content && (a.format === "md" || a.format === "txt" || a.kind === "document") ? <ListenButton text={a.content} bot={bot} style={{ height: "40px", padding: "0 14px", borderRadius: "10px", fontSize: "14px" }} /> : null}
          </div>
        </div>
        <div style={{ flex: "1", overflow: "auto", padding: "22px" }}><ArtifactContent a={a} loading={loading} error={error} /></div>
      </section>
    </div>
  );
}

/** «Perfil de la persona» (USER.md): short profile condensed from memories; the person can edit it. */
function ProfileCard() {
  const { data: profile, setData } = useResource("/user-profile");
  const { act, busy, error, setError } = useAction();
  const [draft, setDraft] = useState(null);
  const save = async () => {
    const result = await act(() => api("/user-profile", "PUT", { content: draft }));
    if (result) {
      setData(result);
      setDraft(null);
    }
  };
  const condense = async () => {
    const result = await act(() => post("/user-profile/condense"));
    if (result?.profile) setData(result.profile);
  };
  const active = (profile?.directives || []).filter((d) => d.status === "active");
  const old = (profile?.directives || []).filter((d) => d.status !== "active");
  const percent = profile ? Math.min(100, Math.round((profile.chars / profile.limit) * 100)) : 0;
  return (
    <section aria-labelledby="perfil-t" style={{ background: "#FFFFFF", border: "2px solid #12131A", borderRadius: "16px", padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
          <h3 id="perfil-t" style={{ margin: 0, font: "700 17px/1.2 'Bricolage Grotesque', sans-serif" }} title="Se guarda como USER.md">Lo que saben de ti</h3>
          <span style={{ fontSize: "13px", color: "#4A4F5C" }}>Lo que todos los bots saben de ti, resumido a partir de tus recuerdos. Tus cambios mandan.</span>
        </div>
        {draft === null ? (
          <div style={{ display: "flex", gap: "6px" }}>
            <button type="button" disabled={busy} onClick={condense} title="Resume ahora los recuerdos nuevos sobre ti" style={{ height: "36px", padding: "0 12px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "9px", cursor: busy ? "wait" : "pointer", fontSize: "13px" }}>{busy ? "Resumiendo…" : "Actualizar"}</button>
            <button type="button" disabled={!profile} onClick={() => { setDraft(profile?.content || ""); setError(null); }} style={{ height: "36px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "9px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>Editar</button>
          </div>
        ) : null}
      </div>
      {profile ? (
        <span style={{ display: "flex", alignItems: "center", gap: "10px", font: "500 12px/1.4 'Geist Mono', monospace", color: "#4A4F5C" }}>
          <span role="meter" aria-label="Tamaño del perfil" aria-valuemin={0} aria-valuemax={profile.limit} aria-valuenow={profile.chars} style={{ flex: "1", maxWidth: "200px", height: "6px", background: "#E6E8EE", borderRadius: "3px", overflow: "hidden" }}><span style={{ display: "block", width: percent + "%", height: "100%", background: percent >= 90 ? "#E5484D" : "#0B8A5F" }} /></span>
          {`${percent} % — ${profile.chars}/${profile.limit}`}{profile.updatedAt ? ` · ${ago(profile.updatedAt)}` : ""}
        </span>
      ) : null}
      {error ? <p role="alert" style={{ margin: 0, padding: "10px 12px", background: "#FDECEC", border: "1px solid #F1B5B7", borderRadius: "10px", fontSize: "13px", color: "#8F1D22" }}>{error}</p> : null}
      {draft !== null ? (
        <>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={10} maxLength={2800} aria-label="Editar lo que los bots saben de ti" autoFocus style={{ padding: "12px", border: "1px solid #12131A", borderRadius: "10px", font: "400 13px/1.6 'Geist Mono', monospace", resize: "vertical" }} />
          <span style={{ fontSize: "12px", color: "#4A4F5C" }}>Una línea por directiva: «- [AAAA-MM-DD · activa] Prefiere…». Marca como «sustituida» lo que ya no vale.</span>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
            <button type="button" onClick={() => setDraft(null)} style={{ height: "36px", padding: "0 12px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "9px", cursor: "pointer", fontSize: "13px" }}>Cancelar</button>
            <button type="button" disabled={busy} onClick={save} style={{ height: "36px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "9px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>Guardar perfil</button>
          </div>
        </>
      ) : active.length || old.length ? (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }}>
          {[...active, ...old].map((d, i) => (
            <li key={i} style={{ display: "flex", alignItems: "baseline", gap: "10px", padding: "8px 0", borderTop: "1px solid #E6E8EE", fontSize: "14px", lineHeight: "1.45", color: d.status === "active" ? "#12131A" : "#8C91A0", textDecoration: d.status === "active" ? "none" : "line-through" }}>
              <span style={{ flex: "1" }}>{d.text}</span>
              <span style={{ font: "400 12px/1.4 'Geist Mono', monospace", color: "#4A4F5C", textDecoration: "none", whiteSpace: "nowrap" }}>{d.status === "active" ? "activa" : "sustituida"}{d.date ? ` · ${d.date}` : ""}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ margin: 0, fontSize: "14px", color: "#4A4F5C" }}>{profile ? "Aún está vacío. Se irá llenando con lo que cuentes a los bots, o escríbelo tú con Editar." : "Cargando…"}</p>
      )}
    </section>
  );
}

/** «Memoria compartida» tab: full editable list (POST/PATCH/DELETE /api/memories). */
function MemoryTab({ q }) {
  const { memories, bots, missions } = useStore();
  const { act, busy, error, setError } = useAction();
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("todo");
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [importing, setImporting] = useState(false);
  const needle = q.trim().toLowerCase();
  const review = memories.filter((m) => m.review).length;
  const list = memories
    .filter((m) => (filter === "equipo" ? m.scope === "equipo" : filter === "bots" ? m.scope !== "equipo" : filter === "revisar" ? m.review : true))
    .filter((m) => !needle || (m.text || "").toLowerCase().includes(needle))
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  const chip = (key, label) => (
    <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} style={filter === key
      ? { height: "36px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "18px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }
      : { height: "36px", padding: "0 12px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "18px", cursor: "pointer", fontSize: "13px" }}>{label}</button>
  );
  const add = async (e) => {
    e.preventDefault();
    if (!text.trim()) return setError("Escribe lo que el equipo debe recordar.");
    const ok = await act(() => post("/memories", { text: text.trim(), scope: "equipo" }));
    if (ok !== undefined) setText("");
  };
  const save = async (m) => {
    if (!draft.trim()) return setError("El recuerdo no puede quedar vacío.");
    const ok = await act(() => patch(`/memories/${encodeURIComponent(m.id)}`, { text: draft.trim() }));
    if (ok !== undefined) setEditing(null);
  };
  const meta = (m) => {
    const owner = m.scope === "equipo" ? "Equipo" : bots.find((b) => b.id === m.botId)?.name || "Un bot";
    const mission = missions.find((x) => x.id === m.missionId);
    return [m.sourceLabel || SOURCE[m.source] || null, mission && !m.sourceLabel ? `# ${mission.room}` : null, owner, ago(m.createdAt)].filter(Boolean).join(" · ");
  };

  return (
    <section aria-label="Memoria compartida" style={{ background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "16px", padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <form onSubmit={add} style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <label style={{ flex: "1 1 280px", display: "flex", alignItems: "center", height: "46px", padding: "0 14px", background: "#F7F8FA", border: "1px solid #DCE0E8", borderRadius: "12px" }}>
          <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden" }}>Nuevo recuerdo para el equipo</span>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Algo que todo el equipo debe saber: «Los informes van siempre en euros»" style={{ flex: "1", minWidth: "0", border: "0", outline: "none", background: "transparent", fontSize: "14px" }} />
        </label>
        <button type="submit" disabled={busy} style={{ height: "46px", padding: "0 16px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "12px", cursor: "pointer", fontSize: "14px", fontWeight: "600" }}>Añadir</button>
        <button type="button" onClick={() => setImporting(true)} title="Trae lo que ChatGPT ya sabe de ti" style={{ height: "46px", padding: "0 16px", background: "#FFFFFF", color: "#12131A", border: "1px solid #DCE0E8", borderRadius: "12px", cursor: "pointer", fontSize: "14px", fontWeight: "600" }}>Traer de ChatGPT</button>
      </form>
      {importing ? <MemoryImport onClose={() => setImporting(false)} /> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {chip("todo", "Todo")}
        {chip("equipo", "Del equipo")}
        {chip("bots", "De cada bot")}
        {review ? chip("revisar", `Por revisar · ${review}`) : null}
      </div>
      {error ? <p role="alert" style={{ margin: 0, padding: "10px 12px", background: "#FDECEC", border: "1px solid #F1B5B7", borderRadius: "10px", fontSize: "13px", color: "#8F1D22" }}>{error}</p> : null}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {list.length === 0 ? <p style={{ margin: 0, padding: "14px 0", borderTop: "1px solid #E6E8EE", fontSize: "14px", color: "#4A4F5C" }}>{needle ? `Nada en la memoria coincide con «${q.trim()}».` : "La memoria está vacía. Lo que digas o acuerden los bots se guardará aquí."}</p> : null}
        {list.map((m) => (
          <div key={m.id} style={{ padding: "12px 0", borderTop: "1px solid #E6E8EE", display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "10px" }}>
            <div style={{ flex: "1 1 320px", minWidth: "0", display: "flex", flexDirection: "column", gap: "4px" }}>
              {editing === m.id ? (
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} aria-label="Editar recuerdo" autoFocus style={{ padding: "10px 12px", border: "1px solid #12131A", borderRadius: "10px", fontSize: "14px", lineHeight: "1.45", resize: "vertical" }} />
              ) : (
                <span style={{ fontSize: "14px", lineHeight: "1.45" }}>
                  {m.review ? <span style={{ marginRight: "6px", padding: "2px 7px", background: "#FFF4D1", borderRadius: "5px", fontSize: "12px", fontWeight: "600" }}>por revisar</span> : null}
                  {m.text}
                </span>
              )}
              <span style={{ fontSize: "12px", color: "#4A4F5C" }}>{meta(m)}</span>
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              {editing === m.id ? (
                <>
                  <button type="button" disabled={busy} onClick={() => save(m)} style={{ height: "34px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "9px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>Guardar</button>
                  <button type="button" onClick={() => setEditing(null)} style={{ height: "34px", padding: "0 12px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "9px", cursor: "pointer", fontSize: "13px" }}>Cancelar</button>
                </>
              ) : confirm === m.id ? (
                <>
                  <button type="button" disabled={busy} onClick={() => act(() => del(`/memories/${encodeURIComponent(m.id)}`)).then(() => setConfirm(null))} style={{ height: "34px", padding: "0 12px", background: "#E5484D", color: "#FFFFFF", border: "0", borderRadius: "9px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>Borrar</button>
                  <button type="button" onClick={() => setConfirm(null)} style={{ height: "34px", padding: "0 12px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "9px", cursor: "pointer", fontSize: "13px" }}>Cancelar</button>
                </>
              ) : (
                <>
                  {m.review ? <button type="button" disabled={busy} onClick={() => act(() => patch(`/memories/${encodeURIComponent(m.id)}`, { review: false }))} style={{ height: "34px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "9px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>Confirmar</button> : null}
                  <button type="button" onClick={() => { setEditing(m.id); setDraft(m.text || ""); setError(null); }} aria-label={`Editar: ${m.text}`} style={{ height: "34px", padding: "0 12px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "9px", cursor: "pointer", fontSize: "13px" }}>Editar</button>
                  <button type="button" onClick={() => setConfirm(m.id)} aria-label={`Borrar: ${m.text}`} style={{ height: "34px", padding: "0 12px", background: "transparent", border: "0", borderRadius: "9px", cursor: "pointer", fontSize: "13px", color: "#4A4F5C" }}>Borrar</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const SKILL_STATE = {
  pending: { label: "Por revisar", style: { background: "#FFF4D1", color: "#12131A" } },
  active: { label: "Activa", style: { background: "#E1F4EC", color: "#0B5A3E" } },
  disabled: { label: "Desactivada", style: { background: "#EEF0F4", color: "#4A4F5C" } },
  stale: { label: "Sin usar", style: { background: "#FFF4D1", color: "#5C4300" } },
  archived: { label: "Archivada", style: { background: "#EEF0F4", color: "#4A4F5C" } },
};
const ORIGIN = { learned: "aprendida", imported: "importada", shared: "compartida" };

/** «Habilidades» tab: every skill with status/version; import SKILL.md (POST /api/skills). */
function SkillsTab({ q }) {
  const { skills: summaries, bots } = useStore();
  const { act, busy, error, setError } = useAction();
  const [note, setNote] = useState(null);
  const { data: curated } = useResource("/learning/skills");
  const extra = new Map((curated || []).map((s) => [s.id, s]));
  const skills = summaries.map((s) => ({ ...s, ...(extra.get(s.id) || {}) }));
  const needle = q.trim().toLowerCase();
  const order = { pending: 0, active: 1, stale: 2, disabled: 3, archived: 4 };
  const reactivate = async (s) => {
    const ok = await act(() => patch(`/skills/${encodeURIComponent(s.id)}/curation`, { status: "active" }));
    if (ok !== undefined) setNote(`«${s.name}» vuelve a estar activa.`);
  };
  const list = skills
    .filter((s) => !needle || `${s.name} ${s.description}`.toLowerCase().includes(needle))
    .sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || (a.name || "").localeCompare(b.name || "", "es"));
  const importSkill = async () => {
    setNote(null);
    let files;
    try {
      files = await pickTextFiles({ multiple: false, accept: ".md,.markdown,.txt" });
    } catch (e) {
      return setError(e.message);
    }
    if (!files?.length) return;
    const ok = await act(() => post("/skills", { content: files[0].content, source: files[0].name }));
    if (ok !== undefined) setNote(`«${files[0].name}» importada. Revísala antes de activarla.`);
  };
  return (
    <section aria-label="Habilidades" style={{ background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "16px", padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        <span style={{ fontSize: "13px", color: "#4A4F5C" }}>Los pasos que los bots saben seguir. Importar una habilidad (archivo SKILL.md) solo añade texto: no instala ni ejecuta nada.</span>
        <button type="button" onClick={importSkill} disabled={busy} style={{ display: "flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 14px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "600" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20V9M7 14l5-5 5 5M5 4h14" /></svg>
          Importar una habilidad
        </button>
      </div>
      {error ? <p role="alert" style={{ margin: 0, padding: "10px 12px", background: "#FDECEC", border: "1px solid #F1B5B7", borderRadius: "10px", fontSize: "13px", color: "#8F1D22" }}>{error}</p> : null}
      {note && !error ? <p role="status" style={{ margin: 0, padding: "10px 12px", background: "#E1F4EC", border: "1px solid #9ED4BC", borderRadius: "10px", fontSize: "13px", color: "#0B5A3E" }}>{note}</p> : null}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {list.length === 0 ? <p style={{ margin: 0, padding: "14px 0", borderTop: "1px solid #E6E8EE", fontSize: "14px", color: "#4A4F5C" }}>{needle ? `Ninguna habilidad coincide con «${q.trim()}».` : "Aún no hay habilidades. Los bots las proponen al repetir tareas, o puedes importar un SKILL.md."}</p> : null}
        {list.map((s) => {
          const bot = bots.find((b) => b.id === s.botId);
          const st = SKILL_STATE[s.status] || SKILL_STATE.disabled;
          return (
            <div key={s.id} style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: "10px", padding: "12px 0", borderTop: "1px solid #E6E8EE" }}>
              {bot ? <Avatar bot={bot} size={28} font={12} /> : <span aria-hidden="true" style={{ width: "28px", height: "28px", display: "grid", placeItems: "center", background: "#EEF0F4", borderRadius: "6px", font: "800 12px/1 'Bricolage Grotesque', sans-serif" }}>✦</span>}
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "10px" }}>
                <div style={{ flex: "1 1 300px", minWidth: "0", display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                    <strong style={{ fontSize: "14px" }}>{s.name}</strong>
                    <span style={{ padding: "2px 7px", borderRadius: "5px", fontSize: "12px", fontWeight: "600", ...st.style }}>{st.label}</span>
                    {s.pinned ? <span style={{ padding: "2px 7px", borderRadius: "5px", fontSize: "12px", fontWeight: "600", background: "#12131A", color: "#FFFFFF" }}>Fijada</span> : null}
                    {s.automation ? <span style={{ padding: "2px 7px", borderRadius: "5px", fontSize: "12px", background: "#EEF0F4", color: "#4A4F5C" }}>La usa una automatización</span> : null}
                  </span>
                  {s.status === "stale" || s.status === "archived" ? <span style={{ fontSize: "13px", color: "#4A4F5C" }}>{s.status === "stale" ? "Lleva un mes sin usarse: ya no se ofrece a los bots." : "Archivada tras tres meses sin uso. No se ha borrado nada."}</span> : null}
                  {s.description ? <span style={{ fontSize: "13px", lineHeight: "1.45", color: "#2B2D36" }}>{s.description}</span> : null}
                  <span style={{ font: "400 12px/1.4 'Geist Mono', monospace", color: "#4A4F5C" }}>
                    {[`v${s.version || 1}`, s.steps ? `${s.steps} pasos` : null, `${s.uses || 0} usos`, bot ? bot.name : "todo el equipo", ORIGIN[s.origin], s.learnedFrom].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  {s.status === "pending" && bot ? <a href={`/equipo/${encodeURIComponent(bot.id)}?skill=${encodeURIComponent(s.id)}`} style={{ display: "flex", alignItems: "center", height: "36px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", borderRadius: "9px", fontSize: "13px", fontWeight: "600" }}>Revisar</a> : null}
                  {s.status === "pending" && !bot ? <button type="button" disabled={busy} onClick={() => act(() => patch(`/skills/${encodeURIComponent(s.id)}`, { status: "active" }))} style={{ height: "36px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "9px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>Activar</button> : null}
                  {s.status === "active" ? <button type="button" disabled={busy} onClick={() => act(() => patch(`/skills/${encodeURIComponent(s.id)}`, { status: "disabled" }))} style={{ height: "36px", padding: "0 12px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "9px", cursor: "pointer", fontSize: "13px" }}>Desactivar</button> : null}
                  {s.status === "disabled" ? <button type="button" disabled={busy} onClick={() => act(() => patch(`/skills/${encodeURIComponent(s.id)}`, { status: "active" }))} style={{ height: "36px", padding: "0 12px", background: "transparent", border: "1px solid #12131A", borderRadius: "9px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>Activar</button> : null}
                  {s.status === "stale" || s.status === "archived" ? <button type="button" disabled={busy} onClick={() => reactivate(s)} style={{ height: "36px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "9px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>Reactivar</button> : null}
                  {s.status !== "pending" && curated ? <button type="button" disabled={busy} aria-pressed={s.pinned ? "true" : "false"} onClick={() => act(() => patch(`/skills/${encodeURIComponent(s.id)}/curation`, { pinned: !s.pinned }))} style={{ height: "36px", padding: "0 12px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "9px", cursor: "pointer", fontSize: "13px" }} title={s.pinned ? "Volver a dejar que el bot la mejore sola" : "Fijar esta versión: el bot no la cambiará por su cuenta"}>{s.pinned ? "Dejar de fijar" : "Fijar"}</button> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** «Plantillas» tab: mission templates that prefill the Inicio composer. */
function TemplatesTab() {
  const use = (text, mode) => {
    sessionStorage.setItem("colmena:draft", JSON.stringify({ text, mode }));
    navigate("/");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <section aria-labelledby="plantillas" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 id="plantillas" style={{ margin: "0", font: "700 20px/1.1 'Bricolage Grotesque', sans-serif" }}>Empezar desde una plantilla</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: "12px" }}>
          {TEMPLATES.map((t) => (
            <button key={t.title} type="button" onClick={() => use(t.text, t.mode)} style={{ padding: "16px", textAlign: "left", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "14px", cursor: "pointer", display: "flex", flexDirection: "column", gap: "6px" }}>
              <strong style={{ fontSize: "15px" }}>{t.title}</strong>
              <span style={{ fontSize: "13px", lineHeight: "1.4", color: "#4A4F5C" }}>{t.desc}</span>
            </button>
          ))}
        </div>
      </section>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "14px", color: "#555A68", marginRight: "4px" }}>Prueba con</span>
        {TRY.map((t) => (
          <button key={t} type="button" onClick={() => use(t, "solo")} style={{ minHeight: "40px", padding: "8px 14px", background: "transparent", border: "1px dashed #A9AEBB", borderRadius: "20px", cursor: "pointer", fontSize: "14px", textAlign: "left" }}>{t}</button>
        ))}
      </div>
    </div>
  );
}

export default function Biblioteca({ query = {} }) {
  const { artifacts, bots, missions, skills, memories, ready } = useStore();
  const [tab, setTab] = useState(TABS.includes(query.tab) ? query.tab : "archivos");
  const [kind, setKind] = useState("todo");
  const [by, setBy] = useState(null);
  const [menu, setMenu] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(query.artefacto || query.archivo || null);
  const { act, busy, error } = useAction();
  const menuRef = useRef(null);
  const closePanel = useCallback(() => {
    setOpen(null);
    // Drop ?artefacto=<id> so going back/reloading does not reopen it.
    if (/[?&](artefacto|archivo)=/.test(location.search)) {
      const params = new URLSearchParams(location.search);
      params.delete("artefacto");
      params.delete("archivo");
      navigate(`/biblioteca${params.toString() ? `?${params}` : ""}`, { replace: true });
    }
  }, []);
  useEffect(() => {
    const id = query.artefacto || query.archivo;
    if (id) {
      setTab("archivos");
      setOpen(id);
    }
  }, [query.artefacto, query.archivo]);

  useEffect(() => {
    if (TABS.includes(query.tab)) setTab(query.tab);
  }, [query.tab]);
  useEffect(() => {
    if (!menu) return;
    const close = (e) => {
      if (e.type === "keydown" ? e.key === "Escape" : !menuRef.current?.contains(e.target)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  const botOf = (id) => bots.find((b) => b.id === id) || null;
  const missionOf = (id) => missions.find((m) => m.id === id) || null;
  const pendingSkills = skills.filter((s) => s.status === "pending");
  const week = Date.now() - 7 * 864e5;
  const teamMemories = memories.filter((m) => m.scope === "equipo");
  const recentMemories = teamMemories.filter((m) => Date.parse(m.createdAt || 0) >= week).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 3);
  const makers = useMemo(() => bots.filter((b) => artifacts.some((a) => a.botId === b.id)), [bots, artifacts]);
  const needle = q.trim().toLowerCase();
  const kinds = KINDS.find((k) => k.key === kind)?.kinds;
  const files = artifacts
    .filter((a) => !kinds || kinds.includes(a.kind))
    .filter((a) => !by || a.botId === by)
    .filter((a) => !needle || [a.title, a.room, missionOf(a.missionId)?.room, botOf(a.botId)?.name, a.format, KIND_LABEL[a.kind]].filter(Boolean).join(" ").toLowerCase().includes(needle))
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));

  const ask = async (event) => {
    if (event.key !== "Enter") return;
    const text = q.trim();
    if (!text || !looksLikeQuestion(text)) return;
    event.preventDefault();
    const nora = bots.find((b) => b.id === "nora") || bots.find((b) => /^nora$/i.test(b.name)) || bots.find((b) => b.enabled !== false);
    if (!nora) return;
    const mission = await act(() => post("/missions", { prompt: `Responde usando la Biblioteca: ${text}`, mode: "solo", botIds: [nora.id], conversation: true, safety: "preguntar" }));
    const id = mission?.id || mission?.mission?.id;
    if (id) navigate(`/chat/${encodeURIComponent(nora.id)}?c=${encodeURIComponent(id)}`);
  };

  const [tabsRef, tabPill] = useSlidingPill(tab);
  const tabStyle = (key, withBadge) => (tab === key
    ? { ...(withBadge ? { display: "flex", alignItems: "center", gap: "8px" } : {}), height: "46px", padding: "0 14px", background: "transparent", border: "0", borderBottom: "3px solid " + (tabPill ? "transparent" : "#12131A"), cursor: "pointer", fontWeight: "600", fontSize: "15px" }
    : { ...(withBadge ? { display: "flex", alignItems: "center", gap: "8px" } : {}), height: "46px", padding: "0 14px", background: "transparent", border: "0", borderBottom: "3px solid transparent", cursor: "pointer", fontSize: "15px", color: "#4A4F5C" });
  const chipStyle = (on) => (on
    ? { height: "36px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "18px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }
    : { height: "36px", padding: "0 12px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "18px", cursor: "pointer", fontSize: "13px" });

  const reviewPanel = (
    <section aria-labelledby="revisar" style={{ background: "#FFFFFF", border: pendingSkills.length ? "2px solid #12131A" : "1px solid #DCE0E8", borderRadius: "16px", padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <h2 id="revisar" style={{ margin: "0", font: "700 18px/1.1 'Bricolage Grotesque', sans-serif" }}>Habilidades por revisar</h2>
        <span style={{ fontSize: "13px", color: "#4A4F5C" }}>Los bots las aprendieron solos. No las usan hasta que las apruebes.</span>
      </div>
      {pendingSkills.length === 0 ? <span style={{ paddingTop: "12px", borderTop: "1px solid #E6E8EE", fontSize: "14px", color: "#4A4F5C" }}>Nada que revisar por ahora.</span> : null}
      {pendingSkills.slice(0, 4).map((s) => {
        const bot = botOf(s.botId);
        return (
          <div key={s.id} style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: "10px", paddingTop: "12px", borderTop: "1px solid #E6E8EE" }}>
            {bot ? <Avatar bot={bot} size={28} font={12} /> : <span aria-hidden="true" style={{ width: "28px", height: "28px", display: "grid", placeItems: "center", background: "#EEF0F4", borderRadius: "6px", font: "800 12px/1 'Bricolage Grotesque', sans-serif" }}>✦</span>}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <strong style={{ fontSize: "14px" }}>{s.name}</strong>
              <span style={{ fontSize: "13px", color: "#4A4F5C" }}>{[s.steps ? `${s.steps} pasos` : null, s.learnedFrom].filter(Boolean).join(" · ") || `Versión ${s.version || 1}`}</span>
              <div style={{ display: "flex", gap: "6px" }}>
                {bot
                  ? <a href={`/equipo/${encodeURIComponent(bot.id)}?skill=${encodeURIComponent(s.id)}`} style={{ display: "flex", alignItems: "center", height: "36px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", borderRadius: "9px", fontSize: "13px", fontWeight: "600" }}>Revisar</a>
                  : <button type="button" onClick={() => setTab("habilidades")} style={{ height: "36px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "9px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>Revisar</button>}
              </div>
            </div>
          </div>
        );
      })}
      {pendingSkills.length > 4 ? <button type="button" onClick={() => setTab("habilidades")} style={{ marginTop: "6px", alignSelf: "flex-start", height: "36px", padding: "0 12px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "9px", cursor: "pointer", fontSize: "13px" }}>{`Ver las ${pendingSkills.length}`}</button> : null}
    </section>
  );
  const memoryPanel = (
    <section aria-labelledby="memoria" style={{ background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "16px", padding: "18px", display: "flex", flexDirection: "column", gap: "4px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px", paddingBottom: "8px" }}>
        <h2 id="memoria" style={{ margin: "0", font: "700 18px/1.1 'Bricolage Grotesque', sans-serif" }}>Memoria compartida</h2>
        <span style={{ fontSize: "12px", color: "#4A4F5C" }}>Nuevo esta semana</span>
      </div>
      {recentMemories.length === 0 ? <div style={{ padding: "10px 0", borderTop: "1px solid #E6E8EE", fontSize: "14px", color: "#4A4F5C" }}>Nada nuevo esta semana.</div> : null}
      {recentMemories.map((m) => {
        const mission = missionOf(m.missionId);
        return (
          <div key={m.id} style={{ padding: "10px 0", borderTop: "1px solid #E6E8EE", display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "14px", lineHeight: "1.45" }}>{m.text}</span>
            <span style={{ fontSize: "12px", color: "#4A4F5C" }}>{m.sourceLabel || [SOURCE[m.source], mission ? `en # ${mission.room}` : null].filter(Boolean).join(" ") || ago(m.createdAt)}</span>
          </div>
        );
      })}
      <button type="button" onClick={() => setTab("memoria")} style={{ marginTop: "6px", alignSelf: "flex-start", height: "36px", padding: "0 12px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "9px", cursor: "pointer", fontSize: "13px" }}>Ver toda la memoria</button>
    </section>
  );

  return (
    <>
      <style>{css + EXTRA_CSS}</style>
      <div style={{ minHeight: "100vh", display: "flex", flexWrap: "wrap", background: "#EEF0F4" }}>
        <Sidebar variant="compact" active="biblioteca" />
        <main style={{ flex: "999 1 560px", minWidth: "0", padding: "28px clamp(16px, 3vw, 36px) 48px", display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "14px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <h1 style={{ margin: "0", font: "800 36px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>Biblioteca</h1>
              <p style={{ margin: "0", fontSize: "15px", color: "#4A4F5C" }}>Todo lo que el equipo ha hecho y sabe. Los entregables se guardan aquí solos.</p>
            </div>
            <label style={{ flex: "0 1 360px", display: "flex", alignItems: "center", gap: "8px", height: "46px", padding: "0 14px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "12px" }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></svg>
              <input type="search" aria-label="Buscar en la Biblioteca" aria-describedby="buscar-ayuda" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={ask} disabled={busy} placeholder="Busca o pregunta: «¿qué dijimos de la limpieza?»" style={{ flex: "1", minWidth: "0", border: "0", outline: "none", background: "transparent", fontSize: "14px" }} />
            </label>
          </div>
          <span id="buscar-ayuda" style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden" }}>Escribe para filtrar. Si escribes una pregunta y pulsas Intro, Nora la responde usando la Biblioteca.</span>
          {error ? <p role="alert" style={{ margin: 0, padding: "10px 12px", background: "#FDECEC", border: "1px solid #F1B5B7", borderRadius: "10px", fontSize: "13px", color: "#8F1D22" }}>{`No se pudo preguntar a Nora: ${error}`}</p> : null}
          {busy ? <p role="status" style={{ margin: 0, fontSize: "13px", color: "#4A4F5C" }}>Preguntando a Nora…</p> : null}

          <div ref={tabsRef} role="tablist" aria-label="Secciones de la Biblioteca" className="c-seg" style={{ display: "flex", flexWrap: "wrap", gap: "4px", borderBottom: "1px solid #DCE0E8" }}>
            {tabPill ? <span aria-hidden="true" className="c-seg-pill" style={{ left: tabPill.left, width: tabPill.width, top: tabPill.top + tabPill.height - 3, height: 3, background: "#12131A", borderRadius: "2px", zIndex: 1 }} /> : null}
            <button type="button" role="tab" aria-selected={tab === "archivos"} data-seg-active={tab === "archivos" ? "true" : undefined} onClick={() => setTab("archivos")} style={tabStyle("archivos")}>Archivos</button>
            <button type="button" role="tab" aria-selected={tab === "memoria"} data-seg-active={tab === "memoria" ? "true" : undefined} onClick={() => setTab("memoria")} style={tabStyle("memoria")}>Memoria compartida</button>
            <button type="button" role="tab" aria-selected={tab === "habilidades"} data-seg-active={tab === "habilidades" ? "true" : undefined} onClick={() => setTab("habilidades")} style={tabStyle("habilidades", true)}>
              Habilidades
              {pendingSkills.length ? <span style={{ minWidth: "20px", height: "20px", padding: "0 5px", borderRadius: "10px", background: "#FFC93C", color: "#12131A", font: "600 11px/20px 'Geist Mono', monospace" }} aria-label={`${pendingSkills.length} por revisar`}>{pendingSkills.length}</span> : null}
            </button>
            <button type="button" role="tab" aria-selected={tab === "plantillas"} data-seg-active={tab === "plantillas" ? "true" : undefined} onClick={() => setTab("plantillas")} style={tabStyle("plantillas")}>Plantillas</button>
          </div>

          {tab === "archivos" ? (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
              {KINDS.map((k) => <button key={k.key} type="button" aria-pressed={kind === k.key} onClick={() => setKind(k.key)} style={chipStyle(kind === k.key)}>{k.label}</button>)}
              <span style={{ flex: "1" }} />
              <div ref={menuRef} style={{ position: "relative" }}>
                <button type="button" aria-haspopup="listbox" aria-expanded={menu} onClick={() => setMenu(!menu)} style={{ display: "flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 12px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "18px", cursor: "pointer", fontSize: "13px" }}>
                  {`Hecho por: ${by ? botOf(by)?.name || "—" : "todos"}`}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {menu ? (
                  <div role="listbox" aria-label="Hecho por" style={{ position: "absolute", right: "0", top: "42px", zIndex: 20, minWidth: "200px", padding: "6px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "12px", boxShadow: "0 12px 32px rgba(18,19,26,.14)", display: "flex", flexDirection: "column", gap: "2px" }}>
                    {[null, ...makers.map((b) => b.id)].map((id) => {
                      const b = id ? botOf(id) : null;
                      return (
                        <button key={id || "todos"} type="button" role="option" aria-selected={by === id} onClick={() => { setBy(id); setMenu(false); }} style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "38px", padding: "0 10px", background: by === id ? "#EEF0F4" : "transparent", border: "0", borderRadius: "8px", cursor: "pointer", fontSize: "14px", fontWeight: by === id ? "600" : "400", textAlign: "left" }}>
                          {b ? <Avatar bot={b} size={18} font={9} /> : <span aria-hidden="true" style={{ width: "18px" }} />}
                          {b ? b.name : "Todos"}
                        </button>
                      );
                    })}
                    {makers.length === 0 ? <span style={{ padding: "8px 10px", fontSize: "13px", color: "#4A4F5C" }}>Aún nadie ha hecho entregables.</span> : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "flex-start" }}>
            <div style={{ flex: "3 1 520px", minWidth: "0" }}>
              {tab === "archivos" ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(210px, 100%), 1fr))", gap: "14px" }}>
                  {files.length === 0 ? (
                    <div style={{ gridColumn: "1 / -1", padding: "22px", background: "#FFFFFF", border: "1px dashed #A9AEBB", borderRadius: "14px", display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-start" }}>
                      <strong style={{ fontSize: "15px" }}>{!ready ? "Cargando la Biblioteca…" : artifacts.length === 0 ? "Aún no hay entregables." : needle ? `Nada coincide con «${q.trim()}».` : "Nada con estos filtros."}</strong>
                      <span style={{ fontSize: "13px", color: "#4A4F5C" }}>{artifacts.length === 0 ? "Lo que terminen los bots se guardará aquí solo." : needle ? "Si es una pregunta, pulsa Intro y Nora la responde con lo que hay en la Biblioteca." : "Prueba con otro tipo o con «Hecho por: todos»."}</span>
                      {ready && artifacts.length === 0 ? <a href="/" style={{ display: "flex", alignItems: "center", height: "36px", padding: "0 12px", background: "#12131A", color: "#FFFFFF", borderRadius: "9px", fontSize: "13px", fontWeight: "600" }}>Pedir algo al equipo</a> : null}
                    </div>
                  ) : null}
                  {files.map((a) => {
                    const bot = botOf(a.botId);
                    const mission = missionOf(a.missionId);
                    const tail = a.kind === "code" && a.version ? `v${a.version}` : dayLabel(a.createdAt);
                    return (
                      <button key={a.id} type="button" onClick={() => setOpen(a.id)} aria-label={`Abrir ${a.title}`} style={{ padding: "0", textAlign: "left", color: "inherit", cursor: "pointer", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "14px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                        <Thumb a={a} bot={bot} />
                        <span style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                          <strong style={a.kind === "code" ? { fontFamily: "'Geist Mono', monospace", fontSize: "13px", lineHeight: "1.3" } : { fontSize: "14px", lineHeight: "1.3" }}>
                            {a.title}
                            {a.status === "borrador" ? <>{" "}<span style={{ fontWeight: "500", color: "#8A6400" }}>· borrador</span></> : null}
                            {a.status === "en curso" ? <>{" "}<span style={{ fontWeight: "500", color: "#4A4F5C" }}>· en curso</span></> : null}
                          </strong>
                          <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#4A4F5C" }}>
                            {bot ? <Avatar bot={bot} size={18} font={9} /> : null}
                            {[bot?.name, artifactPlace(a, mission), tail].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {tab === "memoria" ? <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}><ProfileCard /><MemoryTab q={q} /></div> : null}
              {tab === "habilidades" ? <SkillsTab q={q} /> : null}
              {tab === "plantillas" ? <TemplatesTab /> : null}
            </div>
            <aside style={{ flex: "1 1 320px", minWidth: "0", display: "flex", flexDirection: "column", gap: "20px" }}>
              {tab !== "habilidades" ? reviewPanel : null}
              {tab !== "memoria" ? memoryPanel : null}
            </aside>
          </div>
        </main>
      </div>
      {open ? <ArtifactPanel id={open} onClose={closePanel} /> : null}
    </>
  );
}
