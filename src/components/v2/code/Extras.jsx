import { useEffect, useRef, useState } from "react";
import { FileCode2, Sparkles, SquareSlash, Paperclip, X, ImageIcon, SquareTerminal, MessageSquareText, Globe } from "lucide-react";
import { get, post } from "../../../lib/api.js";
import { C, MONO, SHEET } from "./parts.jsx";
import { triggerAt } from "./model.js";

// The composer's extras (T3 Code): «/» commands, «$» skills, «@» files of the task,
// attachments (the paperclip, pasting an image or dropping files on the box) and context chips
// (a terminal excerpt, a comment on diff lines, a preview note) sent with «colmena:code-context».

/** Sends a context chip to the open task's composer (Terminal.jsx, Changes.jsx, Preview.jsx). */
export function addContext(taskId, context) {
  window.dispatchEvent(new CustomEvent("colmena:code-context", { detail: { taskId, context } }));
}
const CONTEXT_ICON = { terminal: SquareTerminal, diff: MessageSquareText, preview: Globe };

/** Colmena's own commands, then the engine's (Claude Code reports its slash commands). */
export const BUILT_IN = [
  { name: "goal", text: "Objetivo: Bruno sigue solo hasta cumplirlo (/goal pasan los tests)", arg: true },
  { name: "btw", text: "Pregunta al margen: Bruno contesta sin dejar lo que hace (/btw ¿qué te falta?)", arg: true },
  { name: "plan", text: "Pasar a modo Plan: primero un plan, sin tocar nada" },
  { name: "construir", text: "Volver a modo Construir" },
  { name: "compactar", text: "Resumir la conversación para liberar contexto" },
  { name: "parar", text: "Parar a Bruno" },
  { name: "nueva", text: "Nueva tarea" },
  { name: "atajos", text: "Ver y cambiar los atajos de teclado" },
];

const readFile64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] || "");
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

export function useComposerExtras({ text, setText, area, taskId = null, projectId = null, commands = [], onCommand }) {
  const [caret, setCaret] = useState(0);
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(0);
  const [closedAt, setClosedAt] = useState(null);
  const [files, setFiles] = useState([]);
  const [contexts, setContexts] = useState([]);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState(null);
  const skills = useRef(null);
  const trig = triggerAt(text, caret);
  const open = !!trig && closedAt !== trig.start + ":" + trig.kind;
  const key = trig ? trig.kind + trig.query : "";

  useEffect(() => {
    if (!open) { setItems([]); return undefined; }
    let alive = true;
    const q = trig.query.toLowerCase();
    (async () => {
      let list = [];
      if (trig.kind === "/") {
        list = [...BUILT_IN.map((c) => ({ ...c, built: true })), ...commands.filter((c) => !BUILT_IN.some((b) => b.name === c.name)).map((c) => ({ name: c.name, text: c.description || "Comando de Claude Code" }))]
          .filter((c) => c.name.toLowerCase().includes(q)).slice(0, 12);
      } else if (trig.kind === "$") {
        if (!skills.current) {
          const where = taskId ? "task=" + taskId : projectId ? "project=" + projectId : "";
          skills.current = where ? (await get("/code/skills?" + where).catch(() => ({ skills: [] }))).skills : [];
        }
        list = skills.current.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)).slice(0, 12).map((s) => ({ name: s.name, text: s.description, note: s.source }));
      } else if (taskId || projectId) {
        const url = taskId ? "/code/tasks/" + taskId + "/files?q=" : "/code/projects/" + projectId + "/files?q=";
        const r = await get(url + encodeURIComponent(trig.query)).catch(() => ({ files: [] }));
        list = r.files.slice(0, 12).map((f) => ({ name: f }));
      }
      if (alive) { setItems(list); setActive(0); }
    })();
    return () => { alive = false; };
  }, [key, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (item) => {
    if (!trig) return;
    if (trig.kind === "/" && item.arg) { // «/goal …» takes words after it
      const word = "/" + item.name + " ";
      setText(word + text.slice(trig.end).replace(/^\s+/, ""));
      requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(word.length, word.length); setCaret(word.length); });
      return;
    }
    if (trig.kind === "/" && item.built) {
      setText(text.slice(0, trig.start) + text.slice(trig.end).replace(/^\s+/, ""));
      onCommand?.(item.name);
      return;
    }
    const word = trig.kind + item.name + " ";
    const next = text.slice(0, trig.start) + word + text.slice(trig.end).replace(/^\s+/, "");
    const pos = trig.start + word.length;
    setText(next);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(pos, pos); setCaret(pos); });
  };

  /** True when the key was the menu's. */
  const onKeyDown = (e) => {
    if (!open || !items.length) return false;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((active + 1) % items.length); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((active - 1 + items.length) % items.length); return true; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(items[Math.min(active, items.length - 1)]); return true; }
    if (e.key === "Escape") { e.preventDefault(); setClosedAt(trig.start + ":" + trig.kind); return true; }
    return false;
  };
  const track = () => setCaret(area.current?.selectionStart ?? 0);

  const attach = async (list) => {
    const chosen = [...(list || [])].slice(0, 10);
    if (!chosen.length) return;
    setError(null);
    setUploading((n) => n + chosen.length);
    for (const file of chosen) {
      try {
        if (file.size > 20 * 1024 * 1024) throw Error("«" + file.name + "» pasa de 20 MB.");
        const { attachment } = await post("/code/attachments", { name: file.name || "imagen.png", data: await readFile64(file) });
        setFiles((f) => [...f, attachment]);
      } catch (err) {
        setError(err.message);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  const pickFiles = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = () => attach(input.files);
    input.click();
  };
  const onPaste = (e) => {
    const pasted = [...(e.clipboardData?.files || [])];
    if (pasted.length) { e.preventDefault(); attach(pasted); }
  };
  const onDrop = (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    attach(e.dataTransfer.files);
  };

  const menu = open && items.length ? (
    <div role="listbox" aria-label={trig.kind === "/" ? "Comandos" : trig.kind === "$" ? "Habilidades" : "Archivos"}
      style={{ position: "absolute", left: "12px", right: "12px", bottom: "calc(100% + 8px)", zIndex: 40, maxHeight: "320px", overflowY: "auto", padding: "8px", borderRadius: "20px", background: C.white, boxShadow: SHEET, animation: "rise .18s ease-out" }}>
      <span style={{ display: "block", padding: "4px 10px 8px", fontSize: "12px", fontWeight: 600, color: C.faint }}>{trig.kind === "/" ? "Comandos" : trig.kind === "$" ? "Habilidades · se añaden a tu mensaje" : "Archivos de la tarea"}</span>
      {items.map((it, i) => {
        const Icon = trig.kind === "/" ? SquareSlash : trig.kind === "$" ? Sparkles : FileCode2;
        const on = i === active;
        return (
          <div key={it.name} role="option" aria-selected={on} onMouseDown={(e) => { e.preventDefault(); pick(it); }} onMouseMove={() => setActive(i)}
            style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "38px", padding: "6px 10px", borderRadius: "12px", background: on ? C.soft : "transparent", cursor: "pointer" }}>
            <Icon size={14} strokeWidth={2} color={C.muted} aria-hidden="true" style={{ flex: "none" }} />
            <span style={{ font: trig.kind === "@" ? `400 13px/1.3 ${MONO}` : "600 13px/1.3 'Geist', sans-serif", color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: trig.kind === "@" ? "100%" : "40%" }}>{trig.kind === "@" ? it.name : trig.kind + it.name}</span>
            {it.text ? <span style={{ flex: 1, minWidth: 0, fontSize: "12px", color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.text}</span> : null}
            {it.note ? <span style={{ fontSize: "11px", color: C.quiet, whiteSpace: "nowrap" }}>{it.note}</span> : null}
          </div>
        );
      })}
    </div>
  ) : null;

  useEffect(() => {
    const on = (e) => {
      if (!e.detail?.context || (e.detail.taskId && e.detail.taskId !== taskId)) return;
      setContexts((all) => [...all, { ...e.detail.context, key: Date.now() + Math.random() }].slice(-20));
      requestAnimationFrame(() => area.current?.focus());
    };
    window.addEventListener("colmena:code-context", on);
    return () => window.removeEventListener("colmena:code-context", on);
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  const chips = files.length || uploading || error || contexts.length ? (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {contexts.map((c) => {
        const Icon = CONTEXT_ICON[c.kind] || FileCode2;
        return (
          <span key={c.key} title={[c.note, c.text].filter(Boolean).join("\n\n").slice(0, 1200)} style={{ display: "flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 6px 0 10px", borderRadius: "999px", background: "#FFF4D1", boxShadow: "inset 0 0 0 1px rgba(255,201,60,.55)", fontSize: "12px", color: "#5C4300", maxWidth: "280px", animation: "rise .2s ease-out" }}>
            <Icon size={13} strokeWidth={2} aria-hidden="true" />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
            <button type="button" onClick={() => setContexts((all) => all.filter((x) => x.key !== c.key))} aria-label={"Quitar " + c.label} style={{ width: "20px", height: "20px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "transparent", cursor: "pointer", color: "#8A5A00" }}><X size={11} strokeWidth={2.4} aria-hidden="true" /></button>
          </span>
        );
      })}
      {files.map((f) => (
        <span key={f.path} title={f.path} style={{ display: "flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 6px 0 10px", borderRadius: "999px", background: C.soft, fontSize: "12px", color: C.text, maxWidth: "240px" }}>
          {f.image ? <ImageIcon size={13} strokeWidth={2} aria-hidden="true" /> : <Paperclip size={13} strokeWidth={2} aria-hidden="true" />}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
          <button type="button" onClick={() => setFiles((all) => all.filter((x) => x.path !== f.path))} aria-label={"Quitar " + f.name} style={{ width: "20px", height: "20px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "transparent", cursor: "pointer", color: C.muted }}><X size={11} strokeWidth={2.4} aria-hidden="true" /></button>
        </span>
      ))}
      {uploading ? <span style={{ height: "30px", display: "flex", alignItems: "center", fontSize: "12px", color: C.faint }}>Subiendo…</span> : null}
      {error ? <span role="alert" style={{ height: "30px", display: "flex", alignItems: "center", fontSize: "12px", color: C.red }}>{error}</span> : null}
    </div>
  ) : null;

  const clip = (
    <button type="button" onClick={pickFiles} aria-label="Adjuntar archivos" title="Adjuntar archivos o imágenes (también puedes pegarlas o soltarlas aquí)" style={{ width: "36px", height: "36px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "transparent", cursor: "pointer", color: C.muted }}>
      <Paperclip size={16} strokeWidth={2} aria-hidden="true" />
    </button>
  );
  return { menu, chips, clip, onKeyDown, track, onPaste, onDrop, files, contexts: contexts.map(({ key, ...c }) => c), clear: () => { setFiles([]); setContexts([]); }, uploading: uploading > 0 };
}
