import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Ellipsis, Gauge, ShieldCheck, X } from "lucide-react";
import { C, Seg, MenuChip, MenuItem, MODEL_LABEL, EFFORT_LABEL, ACCESS_INFO } from "./parts.jsx";
import { useComposerExtras } from "./Extras.jsx";
import { useHidden } from "../../../lib/undoToast.js";
import { MicButton, appendDictation } from "../../interaction/Voice.jsx";

// The «Código» composer (T3 Code): Enter sends, Shift+Enter breaks the line; «Construir» or
// «Plan» (a plan first, nothing changes until «Implementar»); engine · model, effort and Bruno's
// access as quiet chips; while Bruno works a message waits for the end of the turn («Cuando
// acabe») or reaches him now («Pasárselo ya»). Queued messages show above. «/» commands,
// «$» skills, «@» files and attachments come from Extras.jsx; the microphone dictates.

const WHEN_KEY = "colmena:code-while-working";
const readWhen = () => { try { return localStorage.getItem(WHEN_KEY) === "steer" ? "steer" : "queue"; } catch { return "queue"; } };

export const ENGINE_NAME = { "claude-code": "Claude Code", codex: "Codex", opencode: "OpenCode" };

export default function Composer({ task = null, models = [], busy = false, running = false, onSend, onStop, onChange, onUnqueue, placeholder, draft = null, footer = null, autoFocus = false, mode = "build", onMode = null, projectId = null, commands = [], onCommand = null, status = null, disabled = null }) {
  const [text, setText] = useState("");
  const [when, setWhen] = useState(readWhen);
  const area = useRef(null);
  const extras = useComposerExtras({ text, setText, area, taskId: task?.id || null, projectId, commands, onCommand });
  useEffect(() => { if (draft != null) { setText(draft.text || ""); area.current?.focus(); } }, [draft]);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(260, el.scrollHeight) + "px";
  }, [text]);
  const pickWhen = (v) => { setWhen(v); try { localStorage.setItem(WHEN_KEY, v); } catch {} };
  const submit = async (e) => {
    e?.preventDefault();
    const value = text.trim();
    if ((!value && !extras.files.length && !extras.contexts.length) || busy || extras.uploading) return;
    const ok = await onSend(value, running ? when : "queue", mode, extras.files, extras.contexts);
    if (ok !== false) { setText(""); extras.clear(); }
  };
  const hiddenQueued = useHidden("codequeue");
  const queue = (task?.queue || []).filter((q) => !hiddenQueued(q.id));
  const ready = !!(text.trim() || extras.files.length || extras.contexts.length);
  if (disabled) return <p style={{ flex: "none", width: "100%", maxWidth: "800px", margin: "0 auto", padding: "16px clamp(18px, 3vw, 32px) 24px", fontSize: "14px", color: C.faint, textAlign: "center" }}>{disabled}</p>;
  return (
    <form onSubmit={submit} className="code-composer" style={{ flex: "none", width: "100%", maxWidth: "800px", margin: "0 auto", padding: "4px clamp(18px, 3vw, 32px) 20px" }}>
      {queue.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", margin: "0 8px 8px" }}>
          {queue.map((q) => (
            <div key={q.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 8px 8px 14px", borderRadius: "14px", background: "rgba(18,19,26,.045)", fontSize: "13px", color: C.text }}>
              <span style={{ fontSize: "12px", color: C.faint, whiteSpace: "nowrap" }}>Cuando acabe</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.text}</span>
              <button type="button" onClick={() => onUnqueue(q.id)} aria-label="Quitar de la cola" style={{ width: "26px", height: "26px", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "transparent", cursor: "pointer", color: C.muted }}><X size={13} strokeWidth={2.4} aria-hidden="true" /></button>
            </div>
          ))}
        </div>
      ) : null}
      {running ? (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "0 0 8px 14px", fontSize: "12px", color: C.faint }}>
          <span>Si escribes mientras trabaja:</span>
          <Seg small label="Si escribes mientras trabaja" value={when} onChange={pickWhen} options={[["queue", "Cuando acabe"], ["steer", "Pasárselo ya"]]} />
        </div>
      ) : null}
      {status}
      <div onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); }} onDrop={extras.onDrop}
        style={{ position: "relative", display: "flex", flexDirection: "column", gap: "8px", padding: "14px 12px 10px 18px", borderRadius: "26px", background: C.white, boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 22px 50px -30px rgba(18,19,26,.4)" }}>
        {extras.menu}
        {extras.chips}
        <label style={{ display: "flex" }}>
          <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{placeholder}</span>
          <textarea ref={area} data-code-composer="" rows={2} value={text} autoFocus={autoFocus} onChange={(e) => { setText(e.target.value); extras.track(); }} placeholder={placeholder}
            onSelect={extras.track} onPaste={extras.onPaste}
            onKeyDown={(e) => { if (extras.onKeyDown(e)) return; if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e); }}
            style={{ flex: 1, minWidth: 0, border: 0, outline: "none", resize: "none", background: "transparent", fontSize: "15px", lineHeight: 1.55, maxHeight: "260px" }} />
        </label>
        {/* One row at any width, as in OpenClaw and T3 Code: density follows the box (a wide side
            panel narrows it too). First the chips keep only their icon, then effort and access move
            into «…», then «Construir / Plan» as well; attach, context and send never move. */}
        <div style={{ display: "flex", flexWrap: "nowrap", alignItems: "center", gap: "4px", minWidth: 0 }}>
          <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "center", gap: "4px" }}>
            {onMode ? <span className={task ? "code-inline-mode" : undefined} style={{ flex: "none" }}><Seg label="Modo" value={mode} onChange={onMode} options={[["build", "Construir"], ["plan", "Plan"]]} /></span> : null}
            {task ? (
              <>
                <MenuChip title={(ENGINE_NAME[task.engine] || "Claude Code") + " · " + modelLabel(models, task.model)} label={<span className="code-model-label">{modelLabel(models, task.model)}</span>}>
                  {(close) => models.map((m) => <MenuItem key={m.id} title={(ENGINE_NAME[task.engine] || "Claude Code") + " · " + m.label} text={modelNote(m)} on={task.model === m.id} onClick={() => { onChange({ model: m.id }); close(); }} />)}
                </MenuChip>
                <MenuChip className="code-inline-extra" title="Esfuerzo" icon={<Gauge size={14} strokeWidth={2} aria-hidden="true" />} label={EFFORT_LABEL[task.effort] || task.effort} width={220}>
                  {(close) => <EffortItems task={task} onChange={onChange} close={close} />}
                </MenuChip>
                <MenuChip className="code-inline-extra" title="Qué puede hacer Bruno" icon={<ShieldCheck size={14} strokeWidth={2} aria-hidden="true" />} label={ACCESS_INFO[task.access]?.label || "Su copia"} width={360}>
                  {(close) => <AccessItems task={task} onChange={onChange} close={close} />}
                </MenuChip>
                <MenuChip className="code-more" title="Más opciones" icon={<Ellipsis size={17} strokeWidth={2.2} aria-hidden="true" />} label="" chevron={false} width={340}>
                  {(close) => (
                    <>
                      {onMode ? (
                        <div className="code-more-mode">
                          <MenuHeading>Modo</MenuHeading>
                          <MenuItem title="Construir" text="Bruno hace los cambios." on={mode === "build"} onClick={() => { onMode("build"); close(); }} />
                          <MenuItem title="Plan" text="Primero un plan; nada cambia hasta «Implementar»." on={mode === "plan"} onClick={() => { onMode("plan"); close(); }} />
                        </div>
                      ) : null}
                      <MenuHeading>{"Esfuerzo · " + (EFFORT_LABEL[task.effort] || task.effort)}</MenuHeading>
                      <EffortItems task={task} onChange={onChange} close={close} />
                      <MenuHeading>{"Qué puede hacer Bruno · " + (ACCESS_INFO[task.access]?.label || "Su copia")}</MenuHeading>
                      <AccessItems task={task} onChange={onChange} close={close} />
                    </>
                  )}
                </MenuChip>
              </>
            ) : footer}
          </div>
          <div style={{ flex: "none", display: "flex", alignItems: "center", gap: "4px" }}>
            {extras.clip}
            <MicButton onText={(said) => { appendDictation(setText)(said); extras.track(); }} size={40} style={{ color: C.muted }} />
            {task?.usage?.used ? <ContextRing used={task.usage.used} max={task.usage.window || 200000} disabled={running} onCompact={onCommand ? () => onCommand("compactar") : null} /> : null}
            {running ? (
              <button type="button" onClick={onStop} aria-label="Parar" title="Parar a Bruno" style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "rgba(18,19,26,.08)", cursor: "pointer" }}>
                <span aria-hidden="true" style={{ width: "11px", height: "11px", borderRadius: "3px", background: C.ink }} />
              </button>
            ) : null}
            <button type="submit" aria-label="Enviar" disabled={!ready || busy} style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: ready && !busy ? C.ink : "rgba(18,19,26,.14)", color: C.white, cursor: ready && !busy ? "pointer" : "default", transition: "background .15s ease" }}>
              <ArrowUp size={17} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

// The same choices inline and inside «…».
function EffortItems({ task, onChange, close }) {
  return Object.entries(EFFORT_LABEL).map(([id, label]) => <MenuItem key={id} title={label} on={task.effort === id} onClick={() => { onChange({ effort: id }); close(); }} />);
}
function AccessItems({ task, onChange, close }) {
  return (
    <>
      {Object.entries(ACCESS_INFO).map(([id, a]) => <MenuItem key={id} title={a.title} text={a.text} on={task.access === id} onClick={() => { onChange({ access: id }); close(); }} />)}
      <p style={{ margin: "6px 12px 6px", fontSize: "12px", lineHeight: 1.5, color: C.faint }}>Siempre te pregunta antes de publicar, subir a GitHub, borrar fuera del proyecto o instalar programas en Windows.</p>
    </>
  );
}
const MenuHeading = ({ children }) => <span style={{ display: "block", padding: "10px 12px 4px", font: "500 11px/1.3 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint }}>{children}</span>;

export const modelLabel = (models, id) => models.find((m) => m.id === id)?.label || MODEL_LABEL[id] || id;
export function modelNote(m) {
  if (m.id === "claude-opus-5-5") return "El más capaz. Recomendado para programar.";
  if (m.id === "claude-haiku-5-5") return "Rápido y barato, para cambios pequeños.";
  if (m.id === "claude-sonnet-5-5") return "Equilibrado.";
  if (m.go) return "Con tu cuenta de OpenCode Go.";
  if (String(m.id).startsWith("opencode/")) return "Gratis, con los límites de OpenCode.";
  // Codex's own descriptions come in English: Colmena says it in its words.
  const name = String(m.label || m.id).toLowerCase();
  const older = /5\.5|5\.6/.test(name) ? " Generación anterior." : "";
  if (m.isDefault) return "El que recomienda Codex para programar.";
  if (name.includes("astra")) return "El más capaz, para lo más difícil." + older;
  if (name.includes("luna")) return "Rápido y barato, para cambios pequeños." + older;
  if (name.includes("sol") || name.includes("terra")) return "Equilibrado." + older;
  return older.trim();
}

/** How much of the model's context the task uses; a click offers «Compactar» (T3 Code). */
function ContextRing({ used, max = 200000, onCompact = null, disabled = false }) {
  const [open, setOpen] = useState(false);
  const pct = Math.max(0, Math.min(1, used / max));
  const r = 15, len = 2 * Math.PI * r;
  return (
    <span style={{ position: "relative", display: "flex" }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} title={`Contexto usado: ${Math.round(pct * 100)} % (${Math.round(used / 1000)} k de ${Math.round(max / 1000)} k)`}
        style={{ display: "flex", alignItems: "center", gap: "4px", height: "36px", padding: "0 6px", border: 0, borderRadius: "999px", background: open ? C.soft : "transparent", cursor: "pointer", whiteSpace: "nowrap", font: "500 11px/1 'Geist Mono', monospace", color: "#8A8D96" }}>
        <span className="code-ring-text">{Math.round(pct * 100)} %</span>
        <svg width="22" height="22" viewBox="0 0 36 36" aria-hidden="true" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(18,19,26,.08)" strokeWidth="4" />
          <circle cx="18" cy="18" r={r} fill="none" stroke={pct > 0.85 ? C.honey : C.ink} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${len * pct} ${len}`} />
        </svg>
      </button>
      {open ? (
        <div role="dialog" aria-label="Contexto" onMouseLeave={() => setOpen(false)} style={{ position: "absolute", zIndex: 40, right: 0, bottom: "44px", width: "280px", padding: "16px", borderRadius: "20px", background: C.white, boxShadow: "0 0 0 1px rgba(18,19,26,.06), 0 30px 60px -24px rgba(18,19,26,.45)", display: "flex", flexDirection: "column", gap: "10px", animation: "rise .2s ease-out" }}>
          <strong style={{ fontSize: "14px" }}>Contexto usado: {Math.round(pct * 100)} %</strong>
          <span style={{ fontSize: "13px", lineHeight: 1.5, color: C.muted }}>{Math.round(used / 1000)} k de {Math.round(max / 1000)} k. Compactar resume la conversación para que Bruno siga con más espacio; los archivos no cambian.</span>
          {onCompact ? <button type="button" disabled={disabled} onClick={() => { setOpen(false); onCompact(); }} style={{ alignSelf: "flex-start", height: "36px", padding: "0 16px", border: 0, borderRadius: "999px", background: disabled ? "rgba(18,19,26,.12)" : C.ink, color: C.white, cursor: disabled ? "default" : "pointer", fontSize: "13px", fontWeight: 600 }}>Compactar ahora</button> : null}
        </div>
      ) : null}
    </span>
  );
}
