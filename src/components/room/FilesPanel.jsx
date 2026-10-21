import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Download, File, FileImage, FileSpreadsheet, FileText, Pencil, RotateCcw, Save, Search, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { ago } from "../../lib/format.js";
import { copyText, ErrorLine } from "./common.jsx";
import Markdown from "./Markdown.jsx";
import { CsvTable } from "./ArtifactPanel.jsx";
import PagePreview from "./PagePreview.jsx";

// «Archivos» of a room or chat (OpenClaw chat-files-panel + chat-sidebar-file-view): the
// working folder with what the bots changed or read and what you attached; each file opens
// in its own tab with a preview, download and conflict-safe editing (Ctrl+S; if it changed
// meanwhile: «Recargar» or «Sobrescribir»). Unsaved edits survive switching tabs and rooms.
const I = { size: 15, strokeWidth: 2.2, "aria-hidden": "true" };
const FILTERS = [
  { id: "all", label: (n) => `Todos · ${n}` },
  { id: "changed", label: (n) => `${n} ${n === 1 ? "cambiado" : "cambiados"}` },
  { id: "read", label: (n) => `${n} ${n === 1 ? "leído" : "leídos"}` },
  { id: "attachment", label: (n) => `${n} ${n === 1 ? "tuyo" : "tuyos"}` },
];
const GROUPS = [
  { kind: "changed", title: "Cambiados por el equipo", open: true },
  { kind: "attachment", title: "Los que adjuntaste", open: true },
  { kind: "read", title: "Leídos", open: false },
  { kind: "other", title: "Otros archivos", open: false },
];
const size = (n) => (n == null ? "" : n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1).replace(".", ",") + " MB");
export const fileIcon = (type) => (type === "image" ? <FileImage {...I} /> : type === "csv" ? <FileSpreadsheet {...I} /> : ["text", "markdown", "document", "pdf"].includes(type) ? <FileText {...I} /> : <File {...I} />);
const rawUrl = (missionId, path, download = false) => `/api/missions/${encodeURIComponent(missionId)}/workfiles/raw?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;

// Unsaved edits, per room and path (OpenClaw keeps them in memory per tab, plus a reload guard).
const drafts = new Map();
const draftKey = (missionId, path) => missionId + "\u0000" + path;
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => { if (drafts.size) { e.preventDefault(); e.returnValue = ""; } });
}

/** The list of files of the conversation. `onOpen(file)` opens its tab. */
export default function FilesPanel({ missionId, onOpen, version = 0 }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(() => Object.fromEntries(GROUPS.map((g) => [g.kind, g.open])));
  const load = useCallback(() => {
    api(`/missions/${encodeURIComponent(missionId)}/workfiles`).then((d) => { setData(d); setError(null); }, (e) => setError(e.message));
  }, [missionId]);
  useEffect(() => { load(); }, [load, version]);
  const files = data?.files || [];
  const counts = useMemo(() => ({ all: files.length, changed: files.filter((f) => f.kind === "changed").length, read: files.filter((f) => f.kind === "read").length, attachment: files.filter((f) => f.kind === "attachment").length }), [files]);
  // A chip with nothing in it goes away; if it was the chosen one, back to «Todos».
  const shownFilter = filter !== "all" && !counts[filter] ? "all" : filter;
  const needle = q.trim().toLowerCase();
  const visible = files.filter((f) => (shownFilter === "all" || f.kind === shownFilter) && (!needle || f.path.toLowerCase().includes(needle)));
  const forced = !!needle || shownFilter !== "all";

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ position: "sticky", top: 0, zIndex: 1, background: "#F7F8FA", padding: "12px 14px 10px", display: "flex", flexDirection: "column", gap: "10px", borderBottom: "1px solid #E6E8EE" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "8px", height: "38px", padding: "0 10px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "10px" }}>
          <Search {...I} style={{ color: "#555A68", flex: "none" }} />
          <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>Buscar archivos</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en los archivos de la sala" style={{ flex: "1", minWidth: 0, border: "0", outline: "none", background: "transparent", fontSize: "14px" }} />
          {q ? <button type="button" className="rm-focus" onClick={() => setQ("")} aria-label="Borrar búsqueda" style={{ width: "24px", height: "24px", display: "grid", placeItems: "center", background: "transparent", border: "0", cursor: "pointer" }}><X {...I} size={13} /></button> : null}
        </label>
        {files.length ? (
          <div role="group" aria-label="Filtrar archivos" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {FILTERS.filter((f) => f.id === "all" || counts[f.id]).map((f) => {
              const on = shownFilter === f.id;
              return <button key={f.id} type="button" className="rm-focus" aria-pressed={on ? "true" : "false"} onClick={() => setFilter(f.id)}
                style={{ height: "28px", padding: "0 10px", borderRadius: "14px", cursor: "pointer", fontSize: "12px", fontWeight: on ? "700" : "500", background: on ? "#12131A" : "#FFFFFF", color: on ? "#FFFFFF" : "#2B2D36", border: on ? "1px solid #12131A" : "1px solid #DCE0E8" }}>{f.label(counts[f.id])}</button>;
            })}
          </div>
        ) : null}
      </div>
      <div style={{ padding: "8px 8px 16px", display: "flex", flexDirection: "column", gap: "2px" }}>
        {error ? <ErrorLine style={{ padding: "8px" }}>{`No pude ver los archivos: ${error}`}</ErrorLine> : null}
        {!data && !error ? <p role="status" style={{ margin: "8px", fontSize: "14px", color: "#555A68" }}>Cargando archivos…</p> : null}
        {data && !files.length ? (
          <div style={{ margin: "12px 8px", padding: "16px", background: "#FFFFFF", border: "1px dashed #A9AEBB", borderRadius: "12px", fontSize: "14px", lineHeight: "1.5", color: "#4A4F5C" }}>
            <strong style={{ display: "block", color: "#12131A", marginBottom: "4px" }}>Aún no hay archivos</strong>
            Aquí aparecerán los que adjuntes y los que preparen los bots en esta conversación.
          </div>
        ) : null}
        {data && files.length && !visible.length ? <p style={{ margin: "8px", fontSize: "14px", color: "#555A68" }}>Ningún archivo coincide.</p> : null}
        {GROUPS.map((g, _i, all) => {
          const list = visible.filter((f) => f.kind === g.kind);
          if (!list.length) return null;
          // A single group is always open: folding the only list would hide everything.
          const only = all.filter((x) => visible.some((f) => f.kind === x.kind)).length === 1;
          const isOpen = forced || only || open[g.kind];
          return (
            <section key={g.kind} aria-label={g.title} style={{ display: "flex", flexDirection: "column" }}>
              <button type="button" className="rm-focus" aria-expanded={isOpen ? "true" : "false"} disabled={forced || only} onClick={() => setOpen((o) => ({ ...o, [g.kind]: !o[g.kind] }))}
                style={{ display: "flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 8px", background: "transparent", border: "0", cursor: forced || only ? "default" : "pointer", font: "500 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}>
                {isOpen ? <ChevronDown {...I} size={13} /> : <ChevronRight {...I} size={13} />}{`${g.title} · ${list.length}`}
              </button>
              {isOpen ? list.map((f) => <FileRow key={f.path} file={f} missionId={missionId} onOpen={() => onOpen(f)} />) : null}
            </section>
          );
        })}
        {data?.truncated ? <p style={{ margin: "8px", fontSize: "12px", color: "#555A68" }}>Se muestran los primeros 500 archivos.</p> : null}
      </div>
    </div>
  );
}

function FileRow({ file, missionId, onOpen }) {
  const [copied, setCopied] = useState(false);
  const when = ago(file.modifiedAt);
  const line = [file.kind === "changed" && file.by ? `cambiado por ${file.by}` : file.kind === "read" && file.by ? `leído por ${file.by}` : file.kind === "attachment" ? "lo adjuntaste" : null, when, size(file.size)].filter(Boolean).join(" · ");
  return (
    <div className="msg-row" style={{ display: "flex", alignItems: "center", gap: "4px", margin: 0, padding: "0 4px 0 0" }}>
      <button type="button" className="rm-focus" onClick={onOpen} title={file.path} style={{ flex: "1", minWidth: 0, display: "flex", alignItems: "center", gap: "10px", minHeight: "48px", padding: "6px 8px", background: "transparent", border: "0", borderRadius: "10px", cursor: "pointer", textAlign: "left" }}>
        <span style={{ width: "28px", height: "28px", flex: "none", display: "grid", placeItems: "center", background: "#FFFFFF", border: "1px solid #E6E8EE", borderRadius: "8px", color: "#4A4F5C" }}>{fileIcon(file.type)}</span>
        <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
          <span style={{ fontSize: "14px", fontWeight: "600", color: "#12131A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {file.name}{file.dir ? <span style={{ fontWeight: "400", color: "#555A68" }}>{" · " + file.dir}</span> : null}
          </span>
          <span style={{ fontSize: "12px", color: "#555A68", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line}</span>
        </span>
      </button>
      <span className="msg-actions" style={{ position: "static", opacity: undefined, display: "flex" }}>
        <a href={rawUrl(missionId, file.path, true)} download className="rm-focus" aria-label={"Descargar " + file.name} title="Descargar" style={{ width: "30px", height: "30px", display: "grid", placeItems: "center", borderRadius: "8px", color: "#4A4F5C" }}><Download {...I} size={14} /></a>
        <button type="button" className="rm-focus" aria-label={"Copiar la ruta de " + file.name} title={copied ? "Copiada" : "Copiar la ruta"} onClick={async () => { await copyText(file.path); setCopied(true); setTimeout(() => setCopied(false), 1400); }}
          style={{ width: "30px", height: "30px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "8px", cursor: "pointer", color: copied ? "#0B6B4A" : "#4A4F5C" }}>{copied ? <Check {...I} size={14} /> : <Copy {...I} size={14} />}</button>
      </span>
    </div>
  );
}

/** One file in its own tab: preview, download and (text) conflict-safe editing. */
export function FileView({ missionId, path, onDirty, version = 0 }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const key = draftKey(missionId, path);
  const [editing, setEditing] = useState(() => drafts.has(key));
  const [text, setText] = useState(() => drafts.get(key)?.text ?? "");
  const [notice, setNotice] = useState(null); // {kind:'conflict'|'error'|'saved', text}
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState("preview"); // markdown / csv: preview | source
  const area = useRef(null);
  const gutter = useRef(null);
  const url = `/missions/${encodeURIComponent(missionId)}/workfiles/file?path=${encodeURIComponent(path)}`;
  const load = useCallback(() => api(url).then((f) => { setFile(f); setError(null); return f; }, (e) => { setError(e.message); return null; }), [url]);
  // Redrawn when the bots change the mission's files (a page Bruno edits shows its new version).
  useEffect(() => { if (!editing) load(); }, [load, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const draft = drafts.get(key);
  const expectedHash = draft?.hash || file?.hash;
  const original = file?.text ?? "";
  const dirty = editing && text !== (draft ? draft.base : original);
  useEffect(() => { onDirty?.(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  // Keep the edit (with the hash it started from) while you look elsewhere.
  useEffect(() => {
    if (editing && file?.editable) drafts.set(key, { text, hash: expectedHash, base: draft?.base ?? original });
  }, [editing, text]); // eslint-disable-line react-hooks/exhaustive-deps
  const startEdit = () => { setText(original); setEditing(true); setNotice(null); };
  // The editor takes the keyboard as soon as it appears.
  useEffect(() => { if (editing) area.current?.focus({ preventScroll: true }); }, [editing]);
  const discard = () => { drafts.delete(key); setEditing(false); setNotice(null); setText(""); };
  const toDisk = (t) => (file?.lineEnding === "crlf" ? t.replace(/\r?\n/g, "\r\n") : t);
  const save = async (content = text, hash = expectedHash) => {
    if (saving) return;
    setSaving(true);
    setNotice(null);
    try {
      await api(url.replace(/\?path=.*/, ""), "PUT", { path, content: toDisk(content), expectedHash: hash });
      drafts.delete(key);
      setEditing(false);
      await load();
      setNotice({ kind: "saved", text: "Guardado." });
      setTimeout(() => setNotice((n) => (n?.kind === "saved" ? null : n)), 2200);
    } catch (e) {
      if (e.status === 409) setNotice({ kind: "conflict", text: "El archivo ha cambiado desde que lo abriste (quizá lo tocó un bot)." });
      else setNotice({ kind: "error", text: e.message });
    } finally {
      setSaving(false);
    }
  };
  // «Sobrescribir»: what you had when you clicked, saved over the latest version.
  const overwrite = async () => {
    const mine = text;
    const latest = await load();
    if (latest?.hash) await save(mine, latest.hash);
  };
  const reload = async () => {
    drafts.delete(key);
    const latest = await load();
    setText(latest?.text ?? "");
    setNotice(null);
    if (!latest?.editable) setEditing(false);
  };
  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (dirty) save(); }
    if (e.key === "Escape" && !dirty) { e.preventDefault(); discard(); }
  };
  const lines = (editing ? text : original).split("\n").length;
  const btn = { display: "inline-flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 10px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "8px", cursor: "pointer", fontSize: "13px", color: "#12131A", textDecoration: "none" };
  const type = file?.type;
  const page = /[.]html?$/i.test(path);
  const canToggle = !editing && (type === "markdown" || type === "csv" || page);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", padding: "10px 14px", background: "#F7F8FA", borderBottom: "1px solid #E6E8EE" }}>
        <span style={{ flex: "1 1 160px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
          <strong style={{ fontSize: "14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={path}>{path.split("/").pop()}</strong>
          <span style={{ fontSize: "12px", color: "#555A68" }}>{[path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null, size(file?.size), file?.modifiedAt ? "modificado " + ago(file.modifiedAt) : null].filter(Boolean).join(" · ")}</span>
        </span>
        {canToggle ? (
          <span role="group" aria-label="Cómo verlo" style={{ display: "inline-flex", padding: "2px", background: "#EEF0F4", borderRadius: "9px" }}>
            {(page ? [["preview", "Vista previa"], ["source", "Código"]] : [["preview", "Vista"], ["source", "Texto"]]).map(([id, label]) => (
              <button key={id} type="button" className="rm-focus" aria-pressed={view === id ? "true" : "false"} onClick={() => setView(id)} style={{ height: "28px", padding: "0 10px", border: "0", borderRadius: "7px", cursor: "pointer", fontSize: "12px", fontWeight: view === id ? "700" : "500", background: view === id ? "#FFFFFF" : "transparent" }}>{label}</button>
            ))}
          </span>
        ) : null}
        {editing ? (
          <>
            <button type="button" className="rm-focus" onClick={() => save()} disabled={!dirty || saving} title="Guardar (Ctrl+S)" style={{ ...btn, background: "#FFC93C", border: "1.5px solid #12131A", fontWeight: "700", opacity: !dirty || saving ? 0.55 : 1 }}><Save {...I} size={14} />{saving ? "Guardando…" : "Guardar"}</button>
            <button type="button" className="rm-focus" onClick={discard} style={btn}>{dirty ? "Descartar" : "Cerrar edición"}</button>
          </>
        ) : file?.editable ? (
          <button type="button" className="rm-focus" onClick={startEdit} style={btn}><Pencil {...I} size={14} />Editar</button>
        ) : null}
        <a href={rawUrl(missionId, path, true)} download className="rm-focus" aria-label="Descargar" title="Descargar" style={{ ...btn, width: "32px", padding: 0, justifyContent: "center" }}><Download {...I} size={14} /></a>
      </div>
      {notice ? (
        <div role={notice.kind === "saved" ? "status" : "alert"} className="c-band" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", margin: "10px 14px 0", padding: "10px 12px", borderRadius: "10px", fontSize: "13px", background: notice.kind === "saved" ? "#E1F4EC" : notice.kind === "conflict" ? "#FFF4D1" : "#FBE7DF", border: "1px solid " + (notice.kind === "saved" ? "#9ED4BC" : notice.kind === "conflict" ? "#F2D27A" : "#B4372A") }}>
          <span style={{ flex: "1 1 200px" }}>{notice.text}</span>
          {notice.kind === "conflict" ? (
            <>
              <button type="button" className="rm-focus" onClick={reload} style={btn}><RotateCcw {...I} size={13} />Recargar</button>
              <button type="button" className="rm-focus" onClick={overwrite} style={{ ...btn, background: "#12131A", color: "#FFFFFF", border: "0" }}>Sobrescribir con lo mío</button>
            </>
          ) : null}
        </div>
      ) : null}
      <div style={{ flex: "1", padding: "14px", display: "flex", flexDirection: "column", gap: "12px", minHeight: 0 }}>
        {error ? <ErrorLine>{error}</ErrorLine> : null}
        {!file && !error ? <p role="status" style={{ margin: 0, fontSize: "14px", color: "#555A68" }}>Abriendo…</p> : null}
        {file?.reason ? <p style={{ margin: 0, fontSize: "14px", color: "#4A4F5C" }}>{file.reason}</p> : null}
        {file && editing ? (
          <div style={{ flex: "1", display: "flex", minHeight: "320px", background: "#FFFFFF", border: "1.5px solid #12131A", borderRadius: "12px", overflow: "hidden" }}>
            <div ref={gutter} aria-hidden="true" style={{ flex: "none", padding: "12px 8px 12px 10px", background: "#F7F8FA", borderRight: "1px solid #E6E8EE", font: "400 13px/1.6 'Geist Mono', monospace", color: "#8C91A0", textAlign: "right", overflow: "hidden", userSelect: "none", whiteSpace: "pre" }}>
              {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
            </div>
            <textarea ref={area} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} spellCheck={false} aria-label={"Editar " + path}
              onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }}
              style={{ flex: "1", minWidth: 0, padding: "12px", border: "0", outline: "none", resize: "none", font: "400 13px/1.6 'Geist Mono', monospace", color: "#12131A", whiteSpace: "pre", overflow: "auto" }} />
          </div>
        ) : file ? (
          type === "image" ? <img data-lightbox="" data-name={path.split("/").pop()} src={rawUrl(missionId, path)} alt={path} style={{ cursor: "zoom-in", maxWidth: "100%", height: "auto", alignSelf: "flex-start", borderRadius: "10px", border: "1px solid #E6E8EE", background: "#FFFFFF" }} />
            : file.preview != null ? (
              <>
                <p style={{ margin: 0, fontSize: "12px", color: "#555A68" }}>{`Vista de texto${file.pages ? ` · página 1 de ${file.pages}` : ""}. Descárgalo para verlo con su formato.`}</p>
                <pre style={{ margin: 0, padding: "14px", background: "#FFFFFF", border: "1px solid #E6E8EE", borderRadius: "12px", font: "400 13px/1.6 'Geist', sans-serif", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{file.preview}</pre>
              </>
            )
              : file.text != null ? (
                page && view === "preview" ? <PagePreview html={file.text} title={path} />
                  : type === "markdown" && view === "preview" ? <div style={{ padding: "4px 2px" }}><Markdown text={file.text} size={15} /></div>
                  : type === "csv" && view === "preview" ? <div style={{ overflowX: "auto" }}><CsvTable text={file.text} /></div>
                    : <pre style={{ margin: 0, padding: "12px 14px", background: "#FFFFFF", border: "1px solid #E6E8EE", borderRadius: "12px", font: "400 13px/1.6 'Geist Mono', monospace", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{file.text}</pre>
              ) : !file.reason ? <p style={{ margin: 0, fontSize: "14px", color: "#4A4F5C" }}>No se puede ver aquí. Descárgalo para abrirlo.</p> : null
        ) : null}
      </div>
    </div>
  );
}
