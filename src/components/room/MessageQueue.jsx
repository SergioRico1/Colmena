import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CornerDownRight, GripVertical, ListOrdered, Pencil, X } from "lucide-react";
import { del, patch, post } from "../../lib/api.js";
import { useStore } from "../../lib/store.jsx";
import { later, useHidden } from "../../lib/undoToast.js";

// Visible queue of a conversation (T3 Code queued runs; first version after OpenMuse
// apps/mobile/src/conversation-queue.ts, MIT: licenses/OpenMuse.txt). While the bot answers
// you can keep writing: messages wait here, editable, reorderable and removable. The queue
// lives in the conversation's record (server/queue.mjs), so it survives a restart, and the
// server sends the next one when the bot finishes. If a send fails the queue pauses and
// never resends on its own. «Pasárselo ya» (OpenClaw steer) gives one message to the bot at
// its next step instead of waiting for the turn to end.

const ICON_BTN = { width: "32px", height: "32px", flex: "none", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "8px", cursor: "pointer", color: "#4A4F5C" };
const EMPTY = [];

/**
 * The queue of the conversation `key` (a mission id), from the server. Changes show at once
 * and are confirmed by the next state the server sends.
 */
export function useConversationQueue({ key }) {
  const { missions, run } = useStore();
  const mission = key ? missions.find((m) => m.id === key) : null;
  const server = mission?.queue || EMPTY;
  // What you just changed, until the server's next state says the same (or something newer).
  const [local, setLocal] = useState(null);
  const serverKey = JSON.stringify(server);
  const seen = useRef(serverKey);
  useEffect(() => {
    if (seen.current !== serverKey) { seen.current = serverKey; setLocal(null); }
  }, [serverKey]);
  useEffect(() => setLocal(null), [key]);
  const hiddenQueued = useHidden("queued");
  const pending = (local || server).filter((m) => !hiddenQueued(m.id));
  const [error, setError] = useState(null);
  const act = useCallback(async (optimistic, fn) => {
    if (optimistic) setLocal(optimistic);
    setError(null);
    try {
      const result = await run(fn);
      if (result?.queue) setLocal(result.queue);
      return result;
    } catch (e) {
      setLocal(null);
      setError(e?.message || "No se pudo cambiar la cola.");
      throw e;
    }
  }, [run]);
  const base = key ? `/missions/${encodeURIComponent(key)}/queue` : null;
  const enqueue = useCallback((text) => {
    const body = String(text || "").trim();
    if (!body || !base) return Promise.resolve();
    return act([...pending, { id: "nuevo-" + Date.now(), text: body, at: new Date().toISOString(), sending: true }], () => post(base, { text: body })).catch(() => {});
  }, [act, base, pending]);
  // Taking a message out of the queue waits five seconds («Deshacer» puts it back).
  const remove = useCallback((id) => { later({ id: "queued:" + id, keys: ["queued:" + id], text: "Mensaje quitado de la cola", error: "No se pudo quitar de la cola", run: () => act(null, () => del(`${base}/${encodeURIComponent(id)}`)) }); }, [act, base]);
  const edit = useCallback((id, text) => act(pending.map((m) => (m.id === id ? { ...m, text } : m)), () => patch(`${base}/${encodeURIComponent(id)}`, { text })).catch(() => {}), [act, base, pending]);
  // Drag a waiting message (or Alt + ↑/↓) to change the order they go out in.
  const move = useCallback((id, target, after = false) => {
    const from = pending.findIndex((m) => m.id === id);
    if (from < 0 || id === target) return Promise.resolve();
    const rest = pending.filter((m) => m.id !== id);
    let to = rest.findIndex((m) => m.id === target);
    if (to < 0) return Promise.resolve();
    if (after) to += 1;
    const next = [...rest.slice(0, to), pending[from], ...rest.slice(to)];
    return act(next, () => patch(`${base}/${encodeURIComponent(id)}`, { before: next[to + 1]?.id ?? null })).catch(() => {});
  }, [act, base, pending]);
  const sayNow = useCallback((id) => act(pending.filter((m) => m.id !== id), () => post(`${base}/${encodeURIComponent(id)}/now`)), [act, base, pending]);
  const resume = useCallback(() => act(null, () => post(`${base}/resume`)).catch(() => {}), [act, base]);
  // Stopping the bot keeps the queue as it is: it goes when the bot finishes after you resume it.
  const pause = useCallback(() => {}, []);
  const failed = mission?.queuePaused || null;
  return { pending, paused: !!failed, error: error || failed, running: false, enqueue, remove, edit, move, sayNow, pause, resume };
}

function QueueItem({ index, message, onRemove, onEdit, onSayNow, sayBusy, botName, drag }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(message.text);
  useEffect(() => setValue(message.text), [message.text]);
  const save = () => {
    const body = value.trim();
    if (body) onEdit(body);
    else onRemove();
    setEditing(false);
  };
  return (
    <li {...(editing ? {} : drag.props)} className="rm-focus" style={{ display: "flex", alignItems: editing ? "stretch" : "center", gap: "10px", minHeight: "48px", padding: "6px 6px 6px 10px", background: "#FFFFFF", borderRadius: "18px", boxShadow: "0 0 0 1px rgba(18,19,26,.06)", opacity: message.sending ? 0.6 : 1, transition: "opacity .2s ease, box-shadow .15s ease", animation: "rise .25s ease-out", ...drag.style }}>
      {editing ? null : <GripVertical size={15} strokeWidth={2} aria-hidden="true" style={{ flex: "none", color: "#A3A6AE", cursor: drag.props.draggable ? "grab" : "default" }} />}
      <span aria-hidden="true" style={{ width: "22px", height: "22px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: "rgba(18,19,26,.06)", font: "600 11px/1 'Geist Mono', monospace", color: "#5C606C", alignSelf: editing ? "flex-start" : "center", marginTop: editing ? "9px" : 0 }}>{index + 1}</span>
      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); save(); }} style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "8px", padding: "2px 0" }}>
          <label style={{ display: "flex" }}>
            <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{`Editar el mensaje ${index + 1} de la cola`}</span>
            <textarea autoFocus rows="2" value={value} onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); } if (e.key === "Escape") { e.stopPropagation(); setValue(message.text); setEditing(false); } }}
              style={{ flex: "1", resize: "none", border: 0, outline: "none", borderRadius: "12px", padding: "10px 12px", background: "#F5F5F2", fontSize: "15px", lineHeight: "1.45", fontFamily: "inherit", fieldSizing: "content", maxHeight: "160px" }} />
          </label>
          <span style={{ display: "flex", gap: "6px" }}>
            <button type="submit" style={{ height: "34px", padding: "0 16px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>{"Guardar"}</button>
            <button type="button" onClick={() => { setValue(message.text); setEditing(false); }} style={{ height: "34px", padding: "0 14px", background: "transparent", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: 500, color: "#3D404A" }}>{"Cancelar"}</button>
          </span>
        </form>
      ) : (
        <>
          <span onDoubleClick={() => setEditing(true)} style={{ flex: "1", minWidth: "0", fontSize: "15px", lineHeight: "1.45", color: "#12131A", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: "2", WebkitBoxOrient: "vertical", overflowWrap: "anywhere" }}>{message.text}</span>
          {onSayNow ? (
            <button type="button" className="rm-focus" disabled={sayBusy} onClick={onSayNow} title={`Se lo pasas a ${botName} ya: lo lee en su siguiente paso, sin esperar a que acabe`} aria-label={`Pasarle ya a ${botName} el mensaje ${index + 1}`}
              style={{ display: "flex", alignItems: "center", gap: "6px", height: "34px", flex: "none", padding: "0 14px 0 12px", background: "rgba(18,19,26,.06)", border: "0", borderRadius: "999px", cursor: sayBusy ? "progress" : "pointer", fontSize: "13px", fontWeight: "600", color: "#12131A", whiteSpace: "nowrap" }}>
              <CornerDownRight size={14} strokeWidth={2.4} aria-hidden="true" />{"Pasárselo ya"}
            </button>
          ) : null}
          <button type="button" className="rm-focus" aria-label={`Editar el mensaje ${index + 1}`} title="Editar" onClick={() => setEditing(true)} style={ICON_BTN}><Pencil size={15} strokeWidth={2.2} aria-hidden="true" /></button>
          <button type="button" className="rm-focus" aria-label={`Quitar el mensaje ${index + 1} de la cola`} title="Quitar de la cola" onClick={onRemove} style={ICON_BTN}><X size={16} strokeWidth={2.4} aria-hidden="true" /></button>
        </>
      )}
    </li>
  );
}

/** The queue under the writing capsule. Renders nothing when it is empty and nothing failed. */
export default function MessageQueue({ queue, botName = "el bot", missionPaused = false, onResumeMission, resumeBusy, working = false }) {
  const { pending, paused, error } = queue;
  const [told, setTold] = useState([]); // [{id, text}] passed on now, waiting for the bot's next step
  const [sayBusy, setSayBusy] = useState(false);
  const [sayError, setSayError] = useState(null);
  useEffect(() => {
    if (!told.length) return undefined;
    const t = setTimeout(() => setTold((all) => all.slice(1)), 6000);
    return () => clearTimeout(t);
  }, [told]);
  const sayNow = async (m) => {
    if (sayBusy) return;
    setSayBusy(true);
    setSayError(null);
    try {
      await queue.sayNow(m.id);
      setTold((all) => [...all, { id: m.id, text: m.text }]);
    } catch (e) {
      setSayError(e?.message || "No se lo pude pasar ahora.");
    } finally {
      setSayBusy(false);
    }
  };
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null); // { id, after }
  const dragFor = (m, i) => ({
    props: {
      draggable: pending.length > 1,
      tabIndex: 0,
      "aria-label": `Mensaje ${i + 1} de la cola: ${m.text}`,
      "aria-description": pending.length > 1 ? "Arrastra o pulsa Alt + flecha para cambiar el orden" : undefined,
      onDragStart: (e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/x-colmena-queue", m.id); setDragging(m.id); },
      onDragEnd: () => { setDragging(null); setOver(null); },
      onDragOver: (e) => {
        if (!dragging || dragging === m.id) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        const after = e.clientY > r.top + r.height / 2;
        if (over?.id !== m.id || over.after !== after) setOver({ id: m.id, after });
      },
      onDrop: (e) => {
        e.preventDefault();
        if (dragging && over) queue.move(dragging, over.id, over.after);
        setDragging(null);
        setOver(null);
      },
      onKeyDown: (e) => {
        if (!e.altKey || !["ArrowUp", "ArrowDown"].includes(e.key) || e.target !== e.currentTarget) return;
        e.preventDefault();
        const target = pending[i + (e.key === "ArrowUp" ? -1 : 1)];
        if (target) queue.move(m.id, target.id, e.key === "ArrowDown");
      },
    },
    style: {
      ...(dragging === m.id ? { opacity: 0.45 } : {}),
      ...(over?.id === m.id && dragging && dragging !== m.id ? { boxShadow: over.after ? "0 0 0 1px rgba(18,19,26,.06), inset 0 -2px 0 #FFC93C" : "0 0 0 1px rgba(18,19,26,.06), inset 0 2px 0 #FFC93C" } : {}),
    },
  });
  if (!pending.length && !error && !missionPaused && !told.length && !sayError) return null;
  const stopped = paused || missionPaused;
  const count = pending.length === 1 ? "1 mensaje en cola" : `${pending.length} mensajes en cola`;
  const pill = { height: "32px", padding: "0 14px", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: "600" };
  return (
    <section aria-label="Mensajes en cola" style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "12px 0 0", animation: "fade .2s ease-out" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", padding: "0 6px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#5C606C" }}>
          <ListOrdered size={14} strokeWidth={2.2} aria-hidden="true" />
          {!pending.length && told.length && !missionPaused ? `${botName} lo verá en su siguiente paso` : pending.length
            ? stopped ? `${count} · en pausa` : `${count} · ${pending.length === 1 ? "sale" : "salen"} cuando ${botName} acabe`
            : missionPaused ? `Has parado a ${botName}` : "Cola en pausa"}
        </span>
        <span style={{ flex: "1" }} />
        {missionPaused && onResumeMission ? <button type="button" disabled={resumeBusy} onClick={onResumeMission} style={{ ...pill, background: "rgba(18,19,26,.06)", color: "#12131A" }}>{`Reanudar a ${botName}`}</button> : null}
        {paused && pending.length ? <button type="button" onClick={queue.resume} style={{ ...pill, background: "#12131A", color: "#FFFFFF" }}>{"Enviar la cola"}</button> : null}
      </div>
      {error ? (
        <p role="alert" style={{ margin: "0", padding: "10px 14px", background: "#FBE7DF", borderRadius: "16px", fontSize: "13px", lineHeight: "1.45", color: "#5A1E16" }}>
          <strong>{"No se envió: "}</strong>{error}{paused ? " La cola espera; no se reenvía sola." : ""}
        </p>
      ) : null}
      {told.map((t) => (
        <p key={t.id} role="status" style={{ margin: "0", display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", background: "#E1F4EC", borderRadius: "16px", fontSize: "13px", lineHeight: "1.4", color: "#0B5A3E", animation: "rise .25s ease-out" }}>
          <Check size={14} strokeWidth={2.8} aria-hidden="true" style={{ flex: "none" }} />
          <span style={{ minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><strong>{"Se lo has pasado: "}</strong>{t.text}</span>
        </p>
      ))}
      {sayError ? <p role="alert" style={{ margin: "0 6px", fontSize: "13px", color: "#B4372A", fontWeight: "600" }}>{sayError}</p> : null}
      {pending.length ? (
        <ol style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
          {pending.map((m, i) => <QueueItem key={m.id} index={i} message={m} botName={botName} sayBusy={sayBusy} drag={dragFor(m, i)} onSayNow={working && !missionPaused && !m.sending ? () => sayNow(m) : null} onRemove={() => queue.remove(m.id)} onEdit={(text) => queue.edit(m.id, text)} />)}
        </ol>
      ) : null}
    </section>
  );
}
