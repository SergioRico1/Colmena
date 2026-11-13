import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Folder, FolderCheck, Hash, MessagesSquare } from "lucide-react";
import { api } from "../../lib/api.js";
import { createComposition } from "../../lib/composition.js";
import { chatsFrom, mentionItems, MENTION_LIMITS, refBody } from "../../lib/mentionMenu.js";
import { useStore } from "../../lib/store.jsx";
import { BotMark } from "../v2/chat/Mark.jsx";
import { PersonAvatar } from "./Author.jsx";
import { mentionGroups } from "../../lib/roomView.js";
import { firstName } from "../../lib/identity.js";

// The tints of the attachment tiles (v2/chat/Parts.jsx, which shows these chips: kept here so
// neither imports the other).
const TINT = { pdf: ["#FBE9EA", "#B4232A"], xlsx: ["#E3F4EC", "#0B6B4A"], xls: ["#E3F4EC", "#0B6B4A"], csv: ["#E3F4EC", "#0B6B4A"], docx: ["#E3EBFF", "#1F4FD1"], doc: ["#E3EBFF", "#1F4FD1"], md: ["#E3EBFF", "#1F4FD1"], txt: ["#E3EBFF", "#1F4FD1"], pptx: ["#FFE9DC", "#C2410C"] };
const extOf = (name) => (String(name || "").split(".").pop() || "").toLowerCase();
const extTint = (ext) => TINT[ext] || ["#F1F1EC", "#4A4D57"];

const TRIGGER = /(^|\s)@([\p{L}\d_.-]*)$/u;
const I = { size: 13, strokeWidth: 2.2, "aria-hidden": "true" };
// design/V3Chat.dc.html «Mencionar»: a white card over the box, rows of 42 px with a small
// glyph, the name and what it is on the right.
const MENU = { position: "absolute", zIndex: 30, left: "0", bottom: "calc(100% + 8px)", width: "320px", maxWidth: "calc(100vw - 32px)", maxHeight: "360px", overflowY: "auto", display: "flex", flexDirection: "column", padding: "6px", borderRadius: "16px", background: "#FFFFFF", boxShadow: "0 2px 4px rgba(18,19,26,.06), 0 24px 48px -16px rgba(18,19,26,.35)", animation: "c-pop-in 120ms cubic-bezier(.2,.8,.2,1) both" };
const ROW = { minHeight: "42px", display: "flex", alignItems: "center", gap: "12px", padding: "0 10px", border: 0, borderRadius: "10px", background: "transparent", textAlign: "left", cursor: "pointer", width: "100%", flex: "none", color: "#12131A" };
const HEAD = { flex: "none", display: "block", padding: "8px 10px 4px", fontSize: "var(--t-caption)", fontWeight: 600, color: "#5C606C", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const tile = (bg, fg = "#3D404A") => ({ width: "18px", height: "18px", flex: "none", display: "grid", placeItems: "center", borderRadius: "4px", background: bg, color: fg, fontSize: "var(--t-micro)", fontWeight: 700 });

function FileGlyph({ name }) {
  const ext = extOf(name);
  const [bg, fg] = extTint(ext);
  return <span aria-hidden="true" style={tile(bg, fg)}>{ext.slice(0, 1).toUpperCase()}</span>;
}

/** The glyph of a pick, in the menu and on its chip. */
export function RefGlyph({ kind, name, room = false }) {
  if (kind === "file") return <FileGlyph name={name} />;
  if (kind === "folder") return <span aria-hidden="true" style={tile("#F1F1EC")}><Folder size={11} strokeWidth={2.3} /></span>;
  return <span aria-hidden="true" style={tile("#E3EBFF", "#1F4FD1")}>{room ? <Hash size={11} strokeWidth={2.4} /> : <MessagesSquare size={11} strokeWidth={2.3} />}</span>;
}

/** Under your message: what you pointed at with «@» (files, folders, conversations). */
export function RefChips({ refs = [], align = "flex-end" }) {
  if (!refs?.length) return null;
  return (
    <span style={{ display: "flex", flexWrap: "wrap", justifyContent: align, gap: "6px" }}>
      {refs.map((r, i) => (
        <span key={r.kind + ":" + (r.id || r.path) + ":" + i} title={r.kind === "chat" ? "Conversación que le pasaste como contexto" : r.path}
          style={{ display: "inline-flex", alignItems: "center", gap: "7px", maxWidth: "100%", height: "28px", padding: "0 10px 0 6px", borderRadius: "10px", background: "#FFFFFF", border: "1px solid rgba(18,19,26,.08)", fontSize: "var(--t-meta)" }}>
          <RefGlyph kind={r.kind} name={r.label || r.path} />
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label || r.path}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * @mentions for composers: typing «@» opens a list; ↑/↓ + Enter/Tab choose; Escape closes.
 * With `sources` ({missionId}) the list also has the files and folders of that conversation's
 * working folder (Enter on a folder opens it) and past conversations and rooms: those picks
 * become chips (`chips`, `removeRef`) and go with the message as `refs` (`refsBody()`).
 * Returns props for the textarea/input and the menu element (render it inside a `position: relative` box).
 */
export function useMentions({ value, setValue, bots, inputRef, sources = null, room = null }) {
  const store = useStore();
  const [query, setQuery] = useState(null);
  // While an input method composes («é», kana…) the text is not final: no list opens with it.
  const [ime] = useState(createComposition);
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState("");
  const [files, setFiles] = useState({ missionId: null, list: null });
  const [refs, setRefs] = useState([]);
  // In a room with people (`room`: its view): who you picked with «@», to send with the message.
  const [picks, setPicks] = useState([]);
  const missionId = sources?.missionId || null;
  const withSources = !!sources;
  useEffect(() => { setRefs([]); setDir(""); }, [missionId]);
  // The folder's files load the first time the menu opens; if they cannot, that group is not there.
  useEffect(() => {
    if (query == null || !missionId || files.missionId === missionId) return undefined;
    let alive = true;
    setFiles({ missionId, list: null });
    api(`/missions/${encodeURIComponent(missionId)}/workfiles`)
      .then((d) => { if (alive) setFiles({ missionId, list: Array.isArray(d?.files) ? d.files : [] }); })
      .catch(() => { if (alive) setFiles({ missionId, list: null }); });
    return () => { alive = false; };
  }, [query == null, missionId]); // eslint-disable-line react-hooks/exhaustive-deps
  const chats = useMemo(() => {
    if (!withSources) return null;
    try { return chatsFrom(store?.missions, missionId); } catch { return null; }
  }, [withSources, store?.missions, missionId]);
  const items = useMemo(() => (query == null ? [] : mentionItems({
    query, bots, dir, who: room ? mentionGroups({ view: room, query, limit: query ? 8 : 4 }) : null,
    files: withSources && files.missionId === missionId ? files.list : null,
    chats,
  })), [query, bots, dir, withSources, files, missionId, chats, room]);
  const options = items.filter((x) => x.type !== "head");
  const open = query != null && options.length > 0;
  const current = Math.min(index, Math.max(0, options.length - 1));
  // ↑/↓ keep the chosen row in view (the list scrolls when it is longer than the card).
  useEffect(() => {
    if (open) document.querySelector('#rm-mentions [aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [open, current, dir]);

  const detect = useCallback((text, caret) => {
    const m = TRIGGER.exec(text.slice(0, caret));
    setQuery(m ? m[2] : null);
    if (!m) setDir("");
    setIndex(0);
  }, []);

  const caretAt = () => inputRef.current?.selectionStart ?? value.length;
  const putCaret = (pos) => requestAnimationFrame(() => {
    const el = inputRef.current;
    el?.focus();
    el?.setSelectionRange(pos, pos);
  });
  /** «@que» before the caret becomes `insert`. */
  const replaceTrigger = (insert) => {
    const caret = caretAt();
    const before = value.slice(0, caret).replace(TRIGGER, (all, space) => space + insert);
    setValue(before + value.slice(caret));
    putCaret(before.length);
  };

  const choose = (item) => {
    if (!item) return;
    if (item.type === "bot" || item.type === "peerbot" || item.type === "person") {
      // A first name two people here share is written in full.
      const label = item.type !== "person" ? item.bot.name
        : (room?.people || []).filter((p) => firstName(p.name).toLowerCase() === firstName(item.person.name).toLowerCase()).length > 1 ? item.person.name : firstName(item.person.name);
      replaceTrigger(`@${label} `);
      if (room) {
        const pick = item.type === "person" ? { type: "person", id: item.person.address, label } : { type: item.type, id: item.bot.id, owner: item.owner?.address || null, ownerName: item.owner?.name || null, label };
        setPicks((list) => (list.some((x) => x.type === pick.type && x.id === pick.id && x.owner === pick.owner) ? list : [...list, pick]));
      }
      setQuery(null);
      return;
    }
    // A folder opens; «Atrás» goes up. The list stays open at what you typed so far: «@».
    if (item.type === "folder" || item.type === "up") {
      setDir(item.path);
      replaceTrigger("@");
      setQuery("");
      setIndex(0);
      return;
    }
    const ref = item.type === "chat"
      ? { key: "ref:chat:" + item.chat.id, kind: "chat", id: item.chat.id, label: item.chat.title, room: item.chat.room }
      : { key: "ref:" + (item.type === "here" ? "folder" : "file") + ":" + item.path, kind: item.type === "here" ? "folder" : "file", path: item.path, label: item.name };
    setRefs((list) => (list.some((r) => r.key === ref.key) ? list : [...list, ref].slice(0, MENTION_LIMITS.refs)));
    replaceTrigger("");
    setQuery(null);
    setDir("");
  };

  /** Inserts «@» at the caret and opens the list (the «@» button of the Sala composer). */
  const start = () => {
    const caret = caretAt();
    const pre = value.slice(0, caret);
    const insert = pre && !/\s$/.test(pre) ? " @" : "@";
    setValue(pre + insert + value.slice(caret));
    setQuery("");
    setIndex(0);
    putCaret(pre.length + insert.length);
  };

  const inputProps = {
    value,
    onChange: (e) => {
      setValue(e.target.value);
      if (ime.change(e.nativeEvent)) return;
      detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
    },
    onCompositionStart: () => ime.start(),
    onCompositionEnd: (e) => { ime.end(); detect(e.target.value, e.target.selectionStart ?? e.target.value.length); },
    onClick: (e) => detect(e.target.value, e.target.selectionStart ?? 0),
    onBlur: () => setTimeout(() => { setQuery(null); setDir(""); }, 150),
    "aria-autocomplete": "list",
    "aria-expanded": open ? "true" : "false",
    "aria-controls": open ? "rm-mentions" : undefined,
  };

  /** Call first in onKeyDown; returns true when the key was consumed by the menu. */
  const handleKey = (e) => {
    if (!open || ime.key(e.nativeEvent || e)) return false;
    if (e.key === "ArrowDown") { e.preventDefault(); setIndex((current + 1) % options.length); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); setIndex((current - 1 + options.length) % options.length); return true; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(options[current]); return true; }
    if (e.key === "Backspace" && dir && query === "") { e.preventDefault(); setDir(dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : ""); return true; }
    if (e.key === "Escape") { e.preventDefault(); setQuery(null); setDir(""); return true; }
    return false;
  };

  const row = (item, selected) => {
    if (item.type === "bot" || item.type === "peerbot") return [<BotMark key="g" bot={item.bot} size={18} />, item.bot.name, item.bot.role || "bot"];
    if (item.type === "person") return [<PersonAvatar key="g" person={item.person} size={20} ring="#FFFFFF" />, item.person.name, item.person.presence === "online" ? "en línea" : "persona"];
    if (item.type === "file") return [<RefGlyph key="g" kind="file" name={item.name} />, item.name, "archivo"];
    if (item.type === "folder") return [<RefGlyph key="g" kind="folder" />, item.name, <span key="k" style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}>{"carpeta"}<ChevronRight {...I} style={{ opacity: selected ? 1 : 0.6 }} /></span>];
    if (item.type === "up") return [<span key="g" aria-hidden="true" style={tile("transparent")}><ChevronLeft size={14} strokeWidth={2.3} /></span>, "Atrás", ""];
    if (item.type === "here") return [<span key="g" aria-hidden="true" style={tile("#F1F1EC")}><FolderCheck size={11} strokeWidth={2.3} /></span>, "Toda la carpeta «" + item.name + "»", "carpeta"];
    return [<RefGlyph key="g" kind="chat" room={item.chat.room} />, item.chat.title, item.chat.room ? "sala" : "chat"];
  };

  let n = -1;
  const menu = open ? (
    <div id="rm-mentions" role="listbox" aria-label={withSources || room ? "Mencionar" : "Mencionar a un bot"} style={MENU}>
      {items.map((item) => {
        if (item.type === "head") return <span key={item.key} role="presentation" style={HEAD}>{item.label}</span>;
        n++;
        const selected = n === current;
        const [glyph, label, kind] = row(item, selected);
        return (
          <button key={item.key} type="button" role="option" aria-selected={selected ? "true" : "false"} className="rm-item"
            onMouseDown={(e) => { e.preventDefault(); choose(item); }} style={{ ...ROW, background: selected ? "#F6F6F3" : "transparent" }}>
            {glyph}
            <span style={{ flex: "1", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--t-ui)", fontWeight: 500 }}>{label}</span>
            {kind ? <span style={{ flex: "none", fontSize: "var(--t-meta)", color: "#5C606C" }}>{kind}</span> : null}
          </button>
        );
      })}
    </div>
  ) : null;

  const chips = refs.map((r) => ({ key: r.key, label: r.label, icon: <RefGlyph kind={r.kind} name={r.label} room={r.room} /> }));
  const removeRef = (key) => setRefs((list) => list.filter((r) => r.key !== key));
  return {
    inputProps, handleKey, menu, start, composing: (e) => ime.key(e?.nativeEvent || e),
    picks, clearPicks: () => setPicks([]), restorePicks: setPicks,
    refs, chips, removeRef, isRef: (key) => String(key || "").startsWith("ref:"),
    refsBody: () => (refs.length ? { refs: refBody(refs) } : {}), clearRefs: () => setRefs([]), restoreRefs: setRefs,
  };
}
