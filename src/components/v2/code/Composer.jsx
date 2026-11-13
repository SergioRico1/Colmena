import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Ellipsis, X } from "../../Icon.js";
import { C, Seg, MenuChip, MenuItem, MODEL_LABEL, EFFORT_LABEL, ACCESS_INFO, SR } from "./parts.jsx";
import { useComposerExtras } from "./Extras.jsx";
import EngineModelMenu, { ENGINE_NAME, EngineMark, modelNote } from "./EngineModels.jsx";
import { useExpert } from "../../../lib/expert.js";

export { ENGINE_NAME, modelNote };
import { useHidden } from "../../../lib/undoToast.js";
import { MicButton, appendDictation } from "../../interaction/Voice.jsx";

// The «Código» composer (T3 Code): Enter sends, Shift+Enter breaks the line; «Construir» or
// «Plan» (a plan first, nothing changes until «Implementar»); engine · model, effort and Bruno's
// access; while Bruno works a message waits for the end of the turn («Cuando acabe») or reaches
// him now («Pasárselo ya»). Queued messages show above. «/» commands, «$» skills, «@» files and
// attachments come from Extras.jsx; the microphone dictates.
// Two looks (design/V3Codigo.dc.html, V3CodigoTarea.dc.html): `variant="home"`, the big box with
// «Empezar» at the top of Código; and the task's, one line to write to Bruno with the rest in «…».

const WHEN_KEY = "colmena:code-while-working";
const readWhen = () => { try { return localStorage.getItem(WHEN_KEY) === "steer" ? "steer" : "queue"; } catch { return "queue"; } };

export default function Composer({ task = null, models = [], busy = false, running = false, onSend, onStop, onChange, onUnqueue, placeholder, draft = null, footer = null, autoFocus = false, mode = "build", onMode = null, projectId = null, commands = [], onCommand = null, status = null, disabled = null, engines = [], variant = "task", label = "Empezar" }) {
  const home = variant === "home";
  const [expert] = useExpert();
  const [text, setText] = useState("");
  const [when, setWhen] = useState(readWhen);
  const area = useRef(null);
  const extras = useComposerExtras({ text, setText, area, taskId: task?.id || null, projectId, commands, onCommand, below: home });
  useEffect(() => { if (draft != null) { setText(draft.text || ""); area.current?.focus(); } }, [draft]);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(home ? 320 : 220, el.scrollHeight) + "px";
  }, [text, home]);
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
  // Right after switching engine, its models come with the engines list (the task's list follows).
  const shown = task && !models.some((m) => m.id === task.model) ? engines.find((e) => e.id === task.engine)?.models || models : models;
  const ready = !!(text.trim() || extras.files.length || extras.contexts.length);
  if (disabled) return <p style={{ flex: "none", margin: 0, padding: "14px 4px 4px", fontSize: "var(--t-ui)", lineHeight: 1.5, color: C.faint, textAlign: "center" }}>{disabled}</p>;
  const field = (
    <textarea className="c-bare" ref={area} data-code-composer="" rows={home ? 2 : 1} value={text} autoFocus={autoFocus} onChange={(e) => { setText(e.target.value); extras.track(); }} placeholder={placeholder}
      onSelect={extras.track} onPaste={extras.onPaste}
      onKeyDown={(e) => { if (extras.onKeyDown(e)) return; if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e); }}
      style={home
        ? { flex: 1, minWidth: 0, border: 0, resize: "none", background: "transparent", fontSize: "var(--t-title)", lineHeight: 1.45 }
        : { flex: 1, minWidth: 0, minHeight: "40px", padding: "9px 0", border: 0, resize: "none", background: "transparent", fontSize: "var(--t-body)", lineHeight: "22px", maxHeight: "220px" }} />
  );
  const mic = <MicButton onText={(said) => { appendDictation(setText)(said); extras.track(); }} target={area} size={36} style={{ color: C.muted }} />;
  const drop = { onDragOver: (e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); }, onDrop: extras.onDrop };

  if (home) {
    return (
      <form onSubmit={submit} className="code-composer" style={{ width: "100%" }}>
        <section className="c-ring" aria-label="Nueva tarea de código" {...drop} style={{ position: "relative", display: "flex", flexDirection: "column", borderRadius: "var(--r-2xl)", background: C.white, boxShadow: "var(--c-shadow-pop)" }}>
          {extras.menu}
          {extras.chips ? <div style={{ padding: "16px 24px 0" }}>{extras.chips}</div> : null}
          <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", padding: "22px 14px 8px 24px" }}>
            <label style={{ flex: 1, minWidth: 0, display: "flex" }}><span style={SR}>Qué quieres construir</span>{field}</label>
            {extras.clip}
            {mic}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", padding: "10px 14px 14px 20px", borderTop: "1px solid rgb(var(--c-ink-rgb) / .06)" }}>
            {footer}
            <span style={{ flex: 1 }} />
            <button type="submit" disabled={!ready || busy} style={{ height: "36px", padding: "0 14px", display: "inline-flex", alignItems: "center", border: 0, borderRadius: "var(--r-sm)", background: C.ink, color: C.white, fontSize: "var(--t-ui)", fontWeight: 600, cursor: ready && !busy ? "pointer" : "default", opacity: ready && !busy ? 1 : 0.45, transition: "opacity .15s ease" }}>
              {busy ? "Empezando…" : label}
            </button>
          </div>
        </section>
      </form>
    );
  }

  const engineLabel = (ENGINE_NAME[task?.engine] || "Claude Code") + " · " + modelLabel(shown, task?.model);
  return (
    <form onSubmit={submit} className="code-composer" style={{ flex: "none", width: "100%" }}>
      {queue.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "8px" }}>
          {queue.map((q) => (
            <div key={q.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 6px 6px 12px", borderRadius: "var(--r-md)", background: "rgb(var(--c-ink-rgb) / .045)", fontSize: "var(--t-meta)", color: C.text }}>
              <span style={{ fontSize: "var(--t-caption)", color: C.faint, whiteSpace: "nowrap" }}>Cuando acabe</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.text}</span>
              <button type="button" onClick={() => onUnqueue(q.id)} aria-label="Quitar de la cola" style={{ width: "26px", height: "26px", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-circle)", background: "transparent", cursor: "pointer", color: C.muted }}><X size={13} strokeWidth={2.4} aria-hidden="true" /></button>
            </div>
          ))}
        </div>
      ) : null}
      {running ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", margin: "0 0 8px 4px", fontSize: "var(--t-caption)", color: C.faint }}>
          <span>Si escribes mientras trabaja:</span>
          <Seg small label="Si escribes mientras trabaja" value={when} onChange={pickWhen} options={[["queue", "Cuando acabe"], ["steer", "Pasárselo ya"]]} />
        </div>
      ) : null}
      {status}
      {mode === "plan" ? <span style={{ display: "block", margin: "0 0 8px 4px", fontSize: "var(--t-caption)", color: C.muted }}><strong style={{ fontWeight: 600, color: C.ink }}>Modo plan</strong> · Bruno propone antes de tocar nada.</span> : null}
      <div className="c-ring" {...drop} style={{ position: "relative", display: "flex", flexDirection: "column", gap: "6px", padding: "8px 8px 8px 14px", borderRadius: "var(--r-lg)", background: C.white, boxShadow: "var(--c-shadow-pop)" }}>
        {extras.menu}
        {extras.chips}
        <div style={{ display: "flex", alignItems: "flex-end", gap: "4px" }}>
          <label style={{ flex: 1, minWidth: 0, display: "flex" }}><span style={SR}>{placeholder}</span>{field}</label>
          {running ? (
            <button type="button" onClick={onStop} aria-label="Parar" title="Parar a Bruno" style={{ width: "36px", height: "36px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-circle)", background: "rgb(var(--c-ink-rgb) / .08)", cursor: "pointer" }}>
              <span aria-hidden="true" style={{ width: "11px", height: "11px", borderRadius: "var(--r-xs)", background: C.ink }} />
            </button>
          ) : null}
          <button type="submit" aria-label="Enviar" disabled={!ready || busy} style={{ width: "36px", height: "36px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-circle)", background: C.ink, color: C.white, cursor: ready && !busy ? "pointer" : "default", opacity: ready && !busy ? 1 : 0.85, transition: "opacity .15s ease" }}>
            <ArrowUp size={16} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
      </div>
      {/* Beneath the line: attach, dictate and the context used; expert mode adds which engine,
          model, effort and access this task uses (detail beneath, nothing moves). */}
      <div style={{ display: "flex", alignItems: "center", gap: "2px", minHeight: "36px", margin: "4px 0 -8px -2px" }}>
            {/* «Más»: mode, engine · model, effort and access (the board keeps the line to write clean). */}
            <MenuChip title="Más opciones: modo, motor y modelo, esfuerzo, acceso" icon={<Ellipsis size={17} strokeWidth={2.2} aria-hidden="true" />} label="" chevron={false} width={360} align="left" look={{ width: "36px", height: "36px", color: C.muted }}>
              {(close) => (
                <>
                  {onMode ? (
                    <>
                      <MenuHeading>Modo</MenuHeading>
                      <MenuItem title="Construir" text="Bruno hace los cambios." on={mode === "build"} onClick={() => { onMode("build"); close(); }} />
                      <MenuItem title="Plan" text="Primero un plan; nada cambia hasta «Implementar»." on={mode === "plan"} onClick={() => { onMode("plan"); close(); }} />
                    </>
                  ) : null}
                  <MenuHeading>{"Motor y modelo · " + engineLabel}</MenuHeading>
                  {engines.length ? (
                    <EngineModelMenu engines={engines} current={{ engine: task.engine, model: task.model }} close={close}
                      onPick={(engine, model) => onChange(engine === task.engine ? { model } : { engine, model })}
                      switchNote={running ? "Si eliges otro motor, sigue con él al acabar este turno." : "Otro motor sigue en la misma copia, con lo hablado hasta ahora."} />
                  ) : shown.map((m) => <MenuItem key={m.id} title={(ENGINE_NAME[task.engine] || "Claude Code") + " · " + m.label} text={modelNote(m)} on={task.model === m.id} onClick={() => { onChange({ model: m.id }); close(); }} />)}
                  <MenuHeading>{"Esfuerzo · " + (EFFORT_LABEL[task.effort] || task.effort)}</MenuHeading>
                  <EffortItems task={task} onChange={onChange} close={close} />
                  <MenuHeading>{"Qué puede hacer Bruno · " + (ACCESS_INFO[task.access]?.label || "Su copia")}</MenuHeading>
                  <AccessItems task={task} onChange={onChange} close={close} />
                </>
              )}
            </MenuChip>
        <span title={expert && task ? engineLabel + " · esfuerzo " + (EFFORT_LABEL[task.effort] || task.effort || "").toLowerCase() + " · " + (ACCESS_INFO[task.access]?.label || "Su copia").toLowerCase() : undefined}
          style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "6px", font: "400 var(--t-caption)/1.4 'Geist Mono', monospace", color: C.muted, overflow: "hidden", whiteSpace: "nowrap" }}>
          {expert && task ? <><EngineMark engine={task.engine} size={11} /><span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{engineLabel} · {(EFFORT_LABEL[task.effort] || task.effort || "").toLowerCase()} · {(ACCESS_INFO[task.access]?.label || "Su copia").toLowerCase()}</span></> : null}
        </span>
        {task?.usage?.used ? <ContextRing used={task.usage.used} max={task.usage.window || 200000} disabled={running} onCompact={onCommand ? () => onCommand("compactar") : null} /> : null}
        {extras.clip}
        {mic}
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
      <p style={{ margin: "6px 12px 6px", fontSize: "var(--t-caption)", lineHeight: 1.5, color: C.faint }}>Siempre te pregunta antes de publicar, subir a GitHub, borrar fuera del proyecto o instalar programas en Windows.</p>
    </>
  );
}
const MenuHeading = ({ children }) => <span style={{ display: "block", padding: "10px 12px 4px", font: "500 var(--t-micro)/1.3 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint }}>{children}</span>;

export const modelLabel = (models, id) => models.find((m) => m.id === id)?.label || MODEL_LABEL[id] || id;

/** How much of the model's context the task uses; a click offers «Compactar» (T3 Code). */
function ContextRing({ used, max = 200000, onCompact = null, disabled = false }) {
  const [open, setOpen] = useState(false);
  const pct = Math.max(0, Math.min(1, used / max));
  const r = 15, len = 2 * Math.PI * r;
  return (
    <span style={{ position: "relative", display: "flex" }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} title={`Contexto usado: ${Math.round(pct * 100)} % (${Math.round(used / 1000)} k de ${Math.round(max / 1000)} k)`}
        style={{ display: "flex", alignItems: "center", gap: "4px", height: "32px", padding: "0 6px", border: 0, borderRadius: "var(--r-sm)", background: open ? C.soft : "transparent", cursor: "pointer", whiteSpace: "nowrap", font: "500 var(--t-micro)/1 'Geist Mono', monospace", color: C.quiet }}>
        <svg width="20" height="20" viewBox="0 0 36 36" aria-hidden="true" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="18" cy="18" r={r} fill="none" stroke="rgb(var(--c-ink-rgb) / .08)" strokeWidth="4" />
          <circle cx="18" cy="18" r={r} fill="none" stroke={pct > 0.85 ? "var(--c-warn)" : C.ink} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${len * pct} ${len}`} />
        </svg>
      </button>
      {open ? (
        <div role="dialog" aria-label="Contexto" onMouseLeave={() => setOpen(false)} style={{ position: "absolute", zIndex: 40, right: 0, bottom: "44px", width: "280px", padding: "16px", borderRadius: "var(--r-xl)", background: C.white, boxShadow: "0 0 0 1px rgb(var(--c-ink-rgb) / .06), var(--c-shadow-pop)", display: "flex", flexDirection: "column", gap: "10px", animation: "rise .2s ease-out" }}>
          <strong style={{ fontSize: "var(--t-ui)" }}>Contexto usado: {Math.round(pct * 100)} %</strong>
          <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.5, color: C.muted }}>{Math.round(used / 1000)} k de {Math.round(max / 1000)} k. Compactar resume la conversación para que Bruno siga con más espacio; los archivos no cambian.</span>
          {onCompact ? <button type="button" disabled={disabled} onClick={() => { setOpen(false); onCompact(); }} style={{ alignSelf: "flex-start", height: "32px", padding: "0 12px", border: 0, borderRadius: "var(--r-sm)", background: disabled ? "rgb(var(--c-ink-rgb) / .12)" : C.ink, color: C.white, cursor: disabled ? "default" : "pointer", fontSize: "var(--t-meta)", fontWeight: 600 }}>Compactar ahora</button> : null}
        </div>
      ) : null}
    </span>
  );
}
