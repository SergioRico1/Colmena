// The message box of team messaging: Enter sends, Mayús+Enter is a new line; «@» names someone
// (or @canal / @aquí), files go up as you add them (button, paste or drop) and travel with the
// message; the draft is kept per channel; while you type the channel's people see «escribiendo».
// Also the box for editing a message in place (`editing`).
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Paperclip, X } from "../components/Icon.js";
import { chat, uploadFile } from "./api.js";
import { decodeForEdit, encode } from "./format.jsx";
import { chatState, typing, useChat, upsertChannel } from "./store.js";
import { Avatar, sizeOf } from "./ui.jsx";

const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The «@…» being typed right before the caret, or null. */
function mentionQuery(text, caret) {
  const m = /(^|\s)@([\p{L}\p{N}._-]{0,30})$/u.exec(text.slice(0, caret));
  return m ? { query: m[2], start: caret - m[2].length - 1 } : null;
}

export function Composer({ channel, thread = null, editing = null, placeholder = "Escribe un mensaje", alsoChannel = null, initialDraft = "", disabled = false, onSent = null, onDone = null, onPending = null, autoFocus = false }) {
  const s = useChat();
  const initial = useMemo(() => (editing ? decodeForEdit(editing.text) : { text: initialDraft || "", mentions: [] }), [editing, initialDraft]);
  const [text, setText] = useState(initial.text);
  const [mentions, setMentions] = useState(initial.mentions);
  const [files, setFiles] = useState([]); // {key, name, size, progress, id?, error?}
  const [also, setAlso] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(null); // {query, start, index}
  const box = useRef(null);
  const draftTimer = useRef(null);

  useEffect(() => { setText(initial.text); setMentions(initial.mentions); }, [initial]);
  useEffect(() => { if (autoFocus || editing) box.current?.focus(); }, [autoFocus, editing]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(240, el.scrollHeight) + "px";
  }, [text]);
  // Drafts of the channel's box (not of threads or edits) are kept on the server.
  useEffect(() => () => clearTimeout(draftTimer.current), []);
  const saveDraft = (value) => {
    if (editing || thread) return;
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      chat.put(`/channels/${channel}/draft`, { text: value }).catch(() => {});
      upsertChannel({ id: channel, draft: value });
    }, 700);
  };

  const ch = s.channels.get(channel);
  const candidates = useMemo(() => {
    if (!pick) return [];
    const q = fold(pick.query);
    const members = new Set(ch?.people || []);
    const people = [...s.people.values()].filter((p) => !p.deactivated && p.id !== s.me?.id && (!q || fold(p.name).split(/\s+/).some((w) => w.startsWith(q)) || fold(p.email).startsWith(q)))
      .sort((a, b) => (members.has(b.id) ? 1 : 0) - (members.has(a.id) ? 1 : 0) || a.name.localeCompare(b.name, "es")).slice(0, 7)
      .map((p) => ({ id: p.id, label: "@" + p.name, name: p.name, sub: p.title || p.email }));
    // The company's bots (Phase 3): «@Nora» is stored as <@bot:nora>, like a person.
    const bots = [...(s.bots?.values() || [])].filter((b) => !q || fold(b.name).split(/\s+/).some((w) => w.startsWith(q)))
      .sort((a, b) => a.name.localeCompare(b.name, "es")).slice(0, 5)
      .map((b) => ({ id: b.id, label: "@" + b.name, name: b.name, sub: "Bot" + (b.title ? " · " + b.title : "") }));
    const special = ch && ch.kind !== "dm" ? [{ id: "channel", label: "@canal", name: "canal", sub: "Avisa a todo el canal" }, { id: "here", label: "@aquí", name: "aquí", sub: "Avisa a quien esté conectado" }].filter((x) => !q || x.name.startsWith(q)) : [];
    return [...people, ...bots, ...special];
  }, [pick, s.people, s.bots, s.me, ch]);

  const onChange = (e) => {
    const value = e.target.value;
    setText(value);
    saveDraft(value);
    if (!editing && value.trim()) typing(channel, thread);
    const q = mentionQuery(value, e.target.selectionStart);
    setPick(q ? { ...q, index: 0 } : null);
  };
  const choose = (c) => {
    const before = text.slice(0, pick.start), after = text.slice(box.current.selectionStart);
    const next = before + c.label + " " + after;
    setText(next);
    if (c.id !== "channel" && c.id !== "here") setMentions((m) => [...m.filter((x) => x.label !== c.label), { label: c.label, id: c.id }]);
    setPick(null);
    requestAnimationFrame(() => { const at = (before + c.label + " ").length; box.current?.setSelectionRange(at, at); box.current?.focus(); });
  };

  const addFiles = async (list) => {
    for (const file of [...list].slice(0, 10)) {
      const key = Math.random().toString(36).slice(2);
      setFiles((f) => [...f, { key, name: file.name, size: file.size, progress: 0 }]);
      try {
        const done = await uploadFile(channel, file, { onProgress: (p) => setFiles((f) => f.map((x) => (x.key === key ? { ...x, progress: p } : x))) });
        setFiles((f) => f.map((x) => (x.key === key ? { ...x, id: done.id, progress: 1 } : x)));
      } catch (err) {
        setFiles((f) => f.map((x) => (x.key === key ? { ...x, error: err.message } : x)));
      }
    }
  };

  const send = async () => {
    if (busy || disabled) return;
    const ready = files.filter((f) => f.id);
    if (files.some((f) => !f.id && !f.error)) { setError("Espera a que terminen de subir los archivos."); return; }
    const body = encode(text.trim(), mentions);
    if (!body && !ready.length) return;
    setError(null);
    if (editing) {
      setBusy(true);
      try { await chat.patch(`/messages/${editing.id}`, { text: body }); onDone?.(); }
      catch (e) { setError(e.message); }
      finally { setBusy(false); }
      return;
    }
    const clientId = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const me = chatState().me;
    onPending?.({ id: clientId, clientId, pending: true, seq: Number.MAX_SAFE_INTEGER, channel, author: me.id, at: Date.now(), text: body, files: [], reactions: [], replies: 0, threadId: thread });
    setText(""); setMentions([]); setFiles([]); setPick(null);
    if (!thread) { clearTimeout(draftTimer.current); upsertChannel({ id: channel, draft: "" }); }
    try {
      const out = await chat.post(`/channels/${channel}/messages`, { text: body, thread, alsoChannel: !!(thread && also), files: ready.map((f) => f.id), clientId });
      onSent?.(out.message, clientId, out.notInChannel || []);
      setAlso(false);
    } catch (e) {
      setError(e.message);
      setText(text); setMentions(mentions); setFiles(files);
      onSent?.(null, clientId, []);
    }
  };

  const onKeyDown = (e) => {
    if (pick && candidates.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setPick({ ...pick, index: (pick.index + 1) % candidates.length }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setPick({ ...pick, index: (pick.index - 1 + candidates.length) % candidates.length }); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(candidates[pick.index]); return; }
      if (e.key === "Escape") { e.preventDefault(); setPick(null); return; }
    }
    if (e.key === "Escape" && editing) { e.preventDefault(); onDone?.(); return; }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  };

  const listId = "mention-list-" + channel + (thread || "") + (editing?.id || "");
  return (
    <div className={"cp" + (editing ? " is-editing" : "")} onDragOver={(e) => { if (!editing && [...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault(); }} onDrop={(e) => { if (editing || !e.dataTransfer?.files?.length) return; e.preventDefault(); addFiles(e.dataTransfer.files); }}>
      {pick && candidates.length ? (
        <ul id={listId} role="listbox" className="cp-mentions" aria-label="Mencionar a">
          {candidates.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === pick.index} className="cp-mention" onMouseDown={(e) => { e.preventDefault(); choose(c); }}>
              {c.id === "channel" || c.id === "here" ? <span className="cp-at" aria-hidden="true">@</span> : <Avatar id={c.id} size={22} />}
              <span className="cp-mention-name">{c.name}</span><span className="cp-mention-sub">{c.sub}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {files.length ? (
        <ul className="cp-files" aria-label="Archivos para enviar">
          {files.map((f) => (
            <li key={f.key} className={"cp-file" + (f.error ? " is-error" : "")}>
              <span className="cp-file-name">{f.name}</span>
              <span className="cp-file-meta">{f.error ? f.error : f.id ? sizeOf(f.size) : Math.round(f.progress * 100) + " %"}</span>
              {!f.id && !f.error ? <span className="cp-file-bar" style={{ transform: `scaleX(${f.progress})` }} aria-hidden="true" /> : null}
              <button type="button" className="ch-iconbtn" aria-label={"Quitar " + f.name} onClick={() => setFiles((all) => all.filter((x) => x.key !== f.key))}><X size={14} /></button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="cp-box">
        {editing ? null : (
          <label className="cp-attach ch-iconbtn" title="Adjuntar archivos">
            <input type="file" multiple className="cp-file-input" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} disabled={disabled} />
            <Paperclip size={18} aria-hidden="true" /><span className="cp-sr">Adjuntar archivos</span>
          </label>
        )}
        <textarea ref={box} rows={1} className="cp-text" value={text} onChange={onChange} onKeyDown={onKeyDown} disabled={disabled}
          onPaste={(e) => { if (!editing && e.clipboardData?.files?.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
          placeholder={placeholder} aria-label={placeholder} role="combobox" aria-expanded={!!(pick && candidates.length)} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={undefined} />
        {editing ? (
          <span className="cp-edit-actions">
            <button type="button" className="ch-btn" onClick={() => onDone?.()}>Cancelar</button>
            <button type="button" className="ch-btn is-primary" onClick={send} disabled={busy}>Guardar</button>
          </span>
        ) : (
          <button type="button" className="cp-send" onClick={send} disabled={disabled || (!text.trim() && !files.some((f) => f.id))} aria-label="Enviar"><ArrowUp size={18} weight="bold" /></button>
        )}
      </div>
      {alsoChannel && thread && !editing ? (
        <label className="cp-also"><input type="checkbox" checked={also} onChange={(e) => setAlso(e.target.checked)} /> {"También enviar a " + alsoChannel}</label>
      ) : null}
      {error ? <p className="ch-error cp-error" role="alert">{error}</p> : null}
    </div>
  );
}
