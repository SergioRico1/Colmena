// The message box of team messaging: Enter sends, Mayús+Enter is a new line; «@» names someone
// (or @canal / @aquí), files go up as you add them (button, paste or drop) and travel with the
// message; the draft is kept per channel; while you type the channel's people see «escribiendo».
// Also the box for editing a message in place (`editing`).
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ChevronDown, Paperclip, Smiley, X } from "../components/Icon.js";
import { MenuButton } from "../components/Menu.js";
import { PollDialog, TaskDialog, WhenDialog, commandMatches, runCommand } from "./Plus.jsx";
import EmojiPicker from "./emoji/EmojiPicker.jsx";
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
  const [info, setInfo] = useState(null); // what a command or a scheduled send did
  const [dialog, setDialog] = useState(null); // {kind: "task"|"poll"|"when", ...}
  const [cmdIndex, setCmdIndex] = useState(0);
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

  // «/enc…» at the start of an empty box: the commands that match.
  const commands = editing ? null : commandMatches(text);
  const pickCommand = (c) => { const next = "/" + c.name + " "; setText(next); setCmdIndex(0); requestAnimationFrame(() => { box.current?.focus(); box.current?.setSelectionRange(next.length, next.length); }); };
  const onChange = (e) => {
    const value = e.target.value;
    setText(value);
    setCmdIndex(0);
    if (info) setInfo(null);
    saveDraft(value);
    if (!editing && value.trim()) typing(channel, thread);
    const q = mentionQuery(value, e.target.selectionStart);
    setPick(q ? { ...q, index: 0 } : null);
  };
  // The emoji panel writes where the cursor was (or in place of the selection).
  const [emojiAt, setEmojiAt] = useState(null); // the button it opens from
  const caret = useRef([0, 0]);
  const openEmoji = (button) => {
    caret.current = [box.current?.selectionStart ?? text.length, box.current?.selectionEnd ?? text.length];
    setEmojiAt(emojiAt ? null : button);
  };
  const insertEmoji = (emoji) => {
    const [a, b] = caret.current;
    const next = text.slice(0, a) + emoji + text.slice(b);
    setText(next);
    saveDraft(next);
    setEmojiAt(null);
    const at = a + emoji.length;
    caret.current = [at, at];
    requestAnimationFrame(() => { box.current?.focus(); box.current?.setSelectionRange(at, at); });
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
    // «/encargo», «/recordar», «/encuesta», «/resumen» (Plus.jsx): never sent as text.
    if (!editing && /^\/[a-zñ]+(\s|$)/i.test(text.trim())) {
      setBusy(true);
      try {
        const out = await runCommand(text, body, { channel, thread });
        if (out.dialog) setDialog(out.dialog);
        else { clearBox(); setInfo(out.notice || null); }
      } catch (e) { setError(e.message); }
      finally { setBusy(false); }
      return;
    }
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

  const clearBox = () => {
    setText(""); setMentions([]);
    if (thread || editing) return;
    clearTimeout(draftTimer.current);
    chat.put(`/channels/${channel}/draft`, { text: "" }).catch(() => {});
    upsertChannel({ id: channel, draft: "" });
  };
  // «Programar envío»: the text goes to the server and is sent as you at that time (chat-plus.mjs).
  const later = async (when) => {
    const body = encode(text.trim(), mentions);
    if (!body) return;
    if (files.length) { setError("Los archivos no se pueden programar: envíalos ahora o quítalos."); return; }
    setBusy(true); setError(null);
    try {
      const r = await chat.post("/scheduled", { channel, text: body, thread, alsoChannel: !!(thread && also), ...(typeof when === "number" ? { at: when } : { when }) });
      clearBox(); setDialog(null);
      setInfo("Se enviará " + r.label + ". Lo tienes en Canales › Programados.");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const laterItems = () => [{ group: "Programar el envío", items: [
    { label: "En 1 hora", onSelect: () => later("en 1 hora") },
    { label: "Mañana", hint: "09:00", onSelect: () => later("mañana a las 9") },
    { label: "El lunes", hint: "09:00", onSelect: () => later("el lunes a las 9") },
    { label: "Elegir fecha y hora…", onSelect: () => setDialog({ kind: "when" }) },
  ] }];
  const onKeyDown = (e) => {
    if (commands?.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setCmdIndex((cmdIndex + 1) % commands.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setCmdIndex((cmdIndex - 1 + commands.length) % commands.length); return; }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); pickCommand(commands[cmdIndex] || commands[0]); return; }
    }
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
      {commands?.length ? (
        <ul role="listbox" className="cp-mentions" aria-label="Comandos">
          {commands.map((c, i) => (
            <li key={c.name} role="option" aria-selected={i === cmdIndex} className="cp-mention" onMouseDown={(e) => { e.preventDefault(); pickCommand(c); }}>
              <span className="cp-cmd-name">{"/" + c.name}</span>{c.hint ? <span className="cp-cmd-hint">{c.hint}</span> : null}<span className="cp-mention-sub">{c.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
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
        <button type="button" className="cp-emoji ch-iconbtn" title="Emoji" aria-label="Añadir un emoji" aria-expanded={!!emojiAt} disabled={disabled} onClick={(e) => openEmoji(e.currentTarget)}><Smiley size={18} aria-hidden="true" /></button>
        {emojiAt ? <EmojiPicker anchor={emojiAt} title="Añadir un emoji" onPick={insertEmoji} onClose={() => setEmojiAt(null)} /> : null}
        {editing ? (
          <span className="cp-edit-actions">
            <button type="button" className="ch-btn" onClick={() => onDone?.()}>Cancelar</button>
            <button type="button" className="ch-btn is-primary" onClick={send} disabled={busy}>Guardar</button>
          </span>
        ) : (
          <span className="cp-sendgroup">
            <button type="button" className="cp-send" onClick={send} disabled={disabled || busy || (!text.trim() && !files.some((f) => f.id))} aria-label="Enviar"><ArrowUp size={18} weight="bold" /></button>
            <MenuButton label="Programar el envío" menuLabel="Programar el envío" items={laterItems} placement="top-end" className="cp-later" disabled={disabled || busy || !text.trim() || text.trim().startsWith("/")}><ChevronDown size={14} /></MenuButton>
          </span>
        )}
      </div>
      {alsoChannel && thread && !editing ? (
        <label className="cp-also"><input type="checkbox" checked={also} onChange={(e) => setAlso(e.target.checked)} /> {"También enviar a " + alsoChannel}</label>
      ) : null}
      {error ? <p className="ch-error cp-error" role="alert">{error}</p> : null}
      {info ? <p className="cp-info" role="status">{info}</p> : null}
      {dialog?.kind === "task" ? <TaskDialog channel={channel} thread={thread} title={dialog.title || ""} assignee={dialog.assignee || null} onClose={() => setDialog(null)} onDone={(t) => { clearBox(); setInfo(t); }} /> : null}
      {dialog?.kind === "poll" ? <PollDialog channel={channel} thread={thread} question={dialog.question || ""} options={dialog.options || []} onClose={() => { setDialog(null); clearBox(); }} /> : null}
      {dialog?.kind === "when" ? <WhenDialog onPick={(at) => later(at)} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
