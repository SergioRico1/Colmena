import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlarmClock, Archive, ArchiveRestore, BellRing, ChevronLeft, ChevronRight, ClipboardPaste, Copy, CopyPlus, Eraser, ExternalLink, ListOrdered, MessageCircle, Pause, PencilLine, Play, Scissors, TextSelect, Trash2, UserRound, FileDown } from "lucide-react";
import { ForgetDialog } from "./interaction/Forget.jsx";
import { del, patch, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { exportConversation } from "../lib/exportConversation.jsx";
import { useStore } from "../lib/store.jsx";
import { missionUrl, roomUrl } from "../lib/format.js";

// Colmena's own right-click menu (the desktop window has none of its own). One listener
// for the whole app reads what is under the pointer, so screens keep the exact markup of
// the designs: rooms and chats (/sala/:id, /misiones/:id, /chat/:bot?c=id), bots
// (/chat/:bot, /equipo/:bot), other links, text fields and selected text.
// Look: a Colmena card (white, #DCE0E8, radius 12) with 36px rows; destructive actions in
// the app's error red and always behind a confirmation dialog.

const ACTIVE = ["queued", "running", "planning", "waiting", "awaiting_plan", "awaiting_choice"];
// Lucide icons (the app's icon set), never hand-drawn.
const ICONS = { export: FileDown, snooze: AlarmClock, wake: BellRing, archive: Archive, unarchive: ArchiveRestore, duplicate: CopyPlus, back: ChevronLeft, forget: Eraser, open: ExternalLink, timeline: ListOrdered, pause: Pause, play: Play, rename: PencilLine, trash: Trash2, chat: MessageCircle, profile: UserRound, cut: Scissors, copy: Copy, paste: ClipboardPaste, all: TextSelect };
const Icon = ({ name }) => {
  const C = ICONS[name];
  return C ? <C size={16} strokeWidth={2} aria-hidden="true" style={{ flex: "none" }} /> : null;
};

// -------------------------------------------------------------------- what is under the pointer
function editableOf(el) {
  const field = el.closest?.("input, textarea, [contenteditable=''], [contenteditable='true']");
  if (!field) return null;
  if (field.tagName === "INPUT" && !/^(text|search|email|url|tel|number|password)$/i.test(field.type || "text")) return null;
  return field;
}
const fieldSelection = (f) => (f.isContentEditable ? String(window.getSelection() || "") : (f.value || "").slice(f.selectionStart ?? 0, f.selectionEnd ?? 0));

function editAction(action, field) {
  field?.focus?.();
  if (window.colmenaWindow?.edit) return window.colmenaWindow.edit(action);
  if (action === "paste") {
    navigator.clipboard?.readText?.().then((text) => document.execCommand("insertText", false, text)).catch(() => {});
    return;
  }
  document.execCommand(action === "selectAll" ? "selectAll" : action);
}
const copyText = (text) => {
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => window.colmenaWindow?.edit?.("copy"));
  else window.colmenaWindow?.edit?.("copy");
};

function linkTarget(a) {
  let url;
  try {
    url = new URL(a.getAttribute("href"), location.origin);
  } catch {
    return null;
  }
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return null;
  const room = /^\/(?:sala|misiones)\/([^/]+)/.exec(url.pathname);
  if (room) return { kind: "mission", id: decodeURIComponent(room[1]), href: url.pathname + url.search };
  const chat = /^\/(?:chat|equipo)\/([^/]+)$/.exec(url.pathname);
  if (chat && url.searchParams.get("c")) return { kind: "mission", id: url.searchParams.get("c"), href: url.pathname + url.search };
  if (chat && chat[1] !== "nuevo") return { kind: "bot", id: decodeURIComponent(chat[1]) };
  return { kind: "link", href: url.pathname + url.search };
}

// «Posponer»: the same presets as the server (server/rooms.mjs snoozeUntil), with their time.
function snoozeChoices(from = new Date()) {
  const at = (days, h) => { const d = new Date(from); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d; };
  const afternoon = at(0, 17);
  const monday = at(((8 - from.getDay()) % 7) || 7, 9);
  const hh = (d) => d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  return [
    ...(afternoon > from ? [{ id: "tarde", label: "Hasta esta tarde", hint: hh(afternoon) }] : []),
    { id: "manana", label: "Hasta mañana", hint: hh(at(1, 9)) },
    { id: "lunes", label: "Hasta el lunes", hint: monday.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) },
  ];
}

// -------------------------------------------------------------------- confirmation dialog
function ConfirmDialog({ eyebrow, title, text, action, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const box = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    box.current?.querySelector("button[data-cancel]")?.focus();
    const key = (e) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 2147482000, background: "rgba(18, 19, 26, 0.55)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "96px 16px 16px" }}>
      <div ref={box} role="alertdialog" aria-modal="true" aria-labelledby="confirmar-t" aria-describedby="confirmar-d" style={{ width: "min(460px, 100%)", background: "#FFFFFF", color: "#12131A", border: "2px solid #12131A", borderRadius: "20px", boxShadow: "0 24px 64px -16px rgba(18,19,26,0.45)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 22px 16px", display: "flex", flexDirection: "column", gap: "6px" }}>
          {eyebrow ? <span style={{ font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68", overflowWrap: "anywhere" }}>{eyebrow}</span> : null}
          <h2 id="confirmar-t" style={{ margin: "0", font: "700 22px/1.15 'Bricolage Grotesque', sans-serif" }}>{title}</h2>
          <p id="confirmar-d" style={{ margin: "0", fontSize: "14px", lineHeight: "1.5", color: "#4A4F5C" }}>{text}</p>
          {error ? <p role="alert" style={{ margin: "4px 0 0", fontSize: "13px", color: "#B4372A", fontWeight: "600" }}>{error}</p> : null}
        </div>
        <div style={{ padding: "14px 22px 18px", borderTop: "1px solid #E6E8EE", display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "8px" }}>
          <button type="button" data-cancel="" onClick={onClose} disabled={busy} style={{ height: "44px", padding: "0 14px", background: "transparent", color: "#12131A", border: "1px solid #DCE0E8", borderRadius: "10px", cursor: "pointer", fontSize: "14px" }}>{"Cancelar"}</button>
          <button type="button" onClick={go} disabled={busy} aria-busy={busy ? "true" : undefined} style={{ height: "44px", padding: "0 16px", background: "#B4372A", color: "#FFFFFF", border: "0", borderRadius: "10px", cursor: busy ? "default" : "pointer", fontWeight: "600", fontSize: "14px", opacity: busy ? 0.7 : 1 }}>{busy ? "Borrando…" : action}</button>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- rename dialog
function RenameDialog({ current, onSave, onClose }) {
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    input.current?.select();
    const key = (e) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const preview = value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^#+/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const save = async (e) => {
    e.preventDefault();
    if (!preview || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(preview);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 2147482000, background: "rgba(18, 19, 26, 0.55)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "96px 16px 16px" }}>
      <form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="renombrar-t" style={{ width: "min(440px, 100%)", background: "#FFFFFF", color: "#12131A", border: "2px solid #12131A", borderRadius: "20px", boxShadow: "8px 8px 0 #FFC93C", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 22px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <h2 id="renombrar-t" style={{ margin: "0", font: "700 22px/1.15 'Bricolage Grotesque', sans-serif" }}>Renombrar sala</h2>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", height: "46px", padding: "0 14px", border: "1.5px solid #12131A", borderRadius: "12px", fontSize: "16px" }}>
            <span aria-hidden="true" style={{ color: "#8C91A0", fontWeight: "700" }}>#</span>
            <input ref={input} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Nombre de la sala" maxLength={60} style={{ flex: "1", minWidth: "0", border: "0", outline: "none", fontSize: "16px", background: "transparent" }} />
          </label>
          <span style={{ fontSize: "13px", color: "#4A4F5C" }}>{preview ? `Quedará así: #${preview}` : "Escribe un nombre con letras o números."}</span>
          {error ? <span role="alert" style={{ fontSize: "13px", color: "#B4372A", fontWeight: "600" }}>{error}</span> : null}
        </div>
        <div style={{ padding: "14px 22px 18px", borderTop: "1px solid #E6E8EE", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button type="button" onClick={onClose} disabled={busy} style={{ height: "44px", padding: "0 14px", background: "transparent", border: "1px solid #DCE0E8", borderRadius: "10px", cursor: "pointer", fontSize: "14px" }}>Cancelar</button>
          <button type="submit" disabled={busy || !preview} style={{ height: "44px", padding: "0 16px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "10px", cursor: "pointer", fontWeight: "600", fontSize: "14px", opacity: busy || !preview ? 0.6 : 1 }}>{busy ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </div>
  );
}

// -------------------------------------------------------------------- the menu
function Menu({ menu, onClose, onReplace }) {
  const box = useRef(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y, ready: false });
  const [focus, setFocus] = useState(-1);
  const items = menu.items;
  const actionable = items.map((it, i) => (it.separator || it.disabled ? null : i)).filter((i) => i != null);

  useLayoutEffect(() => {
    const r = box.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(menu.x, innerWidth - r.width - 8));
    const top = menu.y + r.height > innerHeight - 8 ? Math.max(8, menu.y - r.height) : menu.y;
    // Focus stays where it was (a text field keeps its selection); keys are read globally.
    setPos({ left, top, ready: true });
  }, [menu]);

  useEffect(() => {
    const away = (e) => { if (!box.current?.contains(e.target)) onClose(); };
    const key = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const at = actionable.indexOf(focus);
        const next = e.key === "ArrowDown" ? actionable[(at + 1) % actionable.length] : actionable[(at - 1 + actionable.length) % actionable.length];
        setFocus(next ?? -1);
      } else if (e.key === "Enter" && focus >= 0) { e.preventDefault(); pick(items[focus]); }
    };
    const close = () => onClose();
    document.addEventListener("mousedown", away, true);
    document.addEventListener("keydown", key, true);
    addEventListener("blur", close);
    addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", away, true);
      document.removeEventListener("keydown", key, true);
      removeEventListener("blur", close);
      removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  });

  const pick = (it) => {
    if (!it || it.disabled || it.separator) return;
    if (it.items) {
      setFocus(-1);
      onReplace({ label: it.subLabel || it.label, items: [{ label: "Atrás", icon: "back", onSelect: () => onReplace({ label: menu.label, items }), keep: true }, { separator: true }, ...it.items] });
      return;
    }
    if (it.keep) return it.onSelect?.();
    onClose();
    it.onSelect?.();
  };

  return (
    <div ref={box} role="menu" tabIndex={-1} aria-label={menu.label || "Acciones"} onMouseDown={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()}
      style={{ animation: pos.ready ? "c-pop-in 120ms cubic-bezier(.2,.8,.2,1) both" : "none", transformOrigin: "top left", position: "fixed", left: pos.left + "px", top: pos.top + "px", zIndex: 2147483100, minWidth: "220px", maxWidth: "300px", padding: "6px", background: "#FFFFFF", color: "#12131A", border: "1px solid #DCE0E8", borderRadius: "12px", boxShadow: "0 14px 36px -10px rgba(18,19,26,0.32), 0 2px 6px rgba(18,19,26,0.08)", outline: "none", visibility: pos.ready ? "visible" : "hidden", font: "400 14px/1.2 'Geist', sans-serif", userSelect: "none" }}>
      {menu.label ? <div style={{ padding: "6px 10px 8px", font: "500 11px/1.2 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{menu.label}</div> : null}
      {items.map((it, i) => it.separator
        ? <div key={i} role="separator" style={{ height: "1px", margin: "5px 6px", background: "#E6E8EE" }} />
        : (
          <button key={i} type="button" role="menuitem" disabled={it.disabled} onMouseEnter={() => setFocus(i)} onMouseLeave={() => setFocus(-1)} onClick={() => pick(it)}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", minHeight: "36px", padding: "0 10px", border: "0", borderRadius: "8px", textAlign: "left", font: "inherit", cursor: it.disabled ? "default" : "pointer",
              background: focus === i ? (it.danger ? "#FBEAE7" : "#EEF0F4") : "transparent",
              color: it.disabled ? "#9DA2B0" : it.danger ? "#B4372A" : "#12131A", fontWeight: it.danger ? "600" : "400" }}>
            <span style={{ display: "grid", placeItems: "center", color: it.disabled ? "#9DA2B0" : it.danger ? "#B4372A" : "#4A4F5C" }}>{it.icon ? <Icon name={it.icon} /> : <span style={{ width: "16px" }} />}</span>
            <span style={{ flex: "1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.label}</span>
            {it.hint ? <span style={{ font: "500 11px/1 'Geist Mono', monospace", color: "#9DA2B0" }}>{it.hint}</span> : null}
            {it.items ? <ChevronRight size={14} strokeWidth={2} aria-hidden="true" style={{ flex: "none", color: "#9DA2B0" }} /> : null}
          </button>
        ))}
    </div>
  );
}

// -------------------------------------------------------------------- provider
export default function ContextMenuLayer() {
  const store = useStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const [menu, setMenu] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [rename, setRename] = useState(null);
  const [forget, setForget] = useState(null);
  const close = useCallback(() => setMenu(null), []);

  const missionItems = useCallback((target) => {
    const { missions, bots, run } = storeRef.current;
    const m = missions.find((x) => x.id === target.id);
    if (!m) return null;
    const isChat = !!m.conversation;
    const name = isChat ? (m.title || "Conversación") : "#" + (m.room || m.title || "sala");
    const bot = isChat ? bots.find((b) => b.id === m.botIds?.[0]) : null;
    const items = [{ label: isChat ? "Abrir conversación" : "Abrir sala", icon: "open", onSelect: () => navigate(roomUrl(m)) }];
    if (!isChat) items.push({ label: "Línea de tiempo", icon: "timeline", onSelect: () => navigate(missionUrl(m)) });
    if (!isChat) items.push({ label: "Renombrar…", icon: "rename", onSelect: () => setRename({ current: m.room || "", onSave: (room) => run(() => patch(`/missions/${encodeURIComponent(m.id)}`, { room })) }) });
    if (ACTIVE.includes(m.status)) items.push({ label: "Pausar", icon: "pause", onSelect: () => run(() => post(`/missions/${encodeURIComponent(m.id)}/control`, { action: "pause" })).catch(() => {}) });
    else if (m.status === "paused") items.push({ label: "Reanudar", icon: "play", onSelect: () => run(() => post(`/missions/${encodeURIComponent(m.id)}/control`, { action: "resume" })).catch(() => {}) });
    // Tidy the sidebar: snooze until later, archive when done, or copy it to try another way.
    const room = (body) => run(() => patch(`/missions/${encodeURIComponent(m.id)}`, body)).catch(() => {});
    const snoozed = m.snoozedUntil && Date.parse(m.snoozedUntil) > Date.now();
    if (snoozed) items.push({ label: "Mostrar ahora", icon: "wake", hint: new Date(m.snoozedUntil).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }), onSelect: () => room({ snoozedUntil: null }) });
    else if (!m.archived) items.push({ label: "Posponer", icon: "snooze", subLabel: "Posponer " + name, items: snoozeChoices().map((c) => ({ label: c.label, hint: c.hint, icon: "snooze", onSelect: () => room({ snooze: c.id }) })) });
    if (m.archived) items.push({ label: "Desarchivar", icon: "unarchive", onSelect: () => room({ archived: false }) });
    else if (!["queued", "running", "planning"].includes(m.status)) items.push({ label: "Archivar", icon: "archive", onSelect: () => room({ archived: true }) });
    if (m.mode !== "debate") items.push({ label: isChat ? "Duplicar conversación" : "Duplicar sala", icon: "duplicate", onSelect: () => run(() => post(`/missions/${encodeURIComponent(m.id)}/fork`, {})).then((copy) => copy && navigate(roomUrl(copy))).catch(() => {}) });
    // The whole conversation as a document (OpenClaw /export).
    items.push({ label: "Exportar", icon: "export", subLabel: "Exportar " + name, items: [
      { label: "Documento de Word", hint: ".doc", icon: "export", onSelect: () => exportConversation(m.id, "word", { bots }).catch(() => {}) },
      { label: "Markdown", hint: ".md", icon: "export", onSelect: () => exportConversation(m.id, "markdown", { bots }).catch(() => {}) },
      { label: "Copiar como Markdown", icon: "copy", onSelect: () => exportConversation(m.id, "copy", { bots }).catch(() => {}) },
    ] });
    // What the bots learned here (memories, skills) can be seen and forgotten.
    if (!["queued", "running", "planning"].includes(m.status)) items.push({ label: "Olvidar lo aprendido aquí…", icon: "forget", onSelect: () => setForget({ missionId: m.id, title: m.title || name }) });
    items.push({ separator: true });
    const working = ACTIVE.includes(m.status) && m.status !== "awaiting_choice";
    items.push({
      label: isChat ? "Borrar conversación…" : "Borrar sala…", icon: "trash", danger: true,
      onSelect: () => setConfirm({
        eyebrow: name,
        title: isChat ? "¿Borrar esta conversación?" : "¿Borrar esta sala?",
        text: (working ? "El equipo está trabajando aquí: se detendrá. " : "")
          + (isChat ? `Se borran los mensajes con ${bot?.name || "el bot"}. ` : "Se borran la conversación, el plan y los pasos. ")
          + "Los entregables se quedan en la Biblioteca. No se puede deshacer.",
        action: isChat ? "Borrar conversación" : "Borrar sala",
        onConfirm: async () => {
          await run(() => del(`/missions/${encodeURIComponent(m.id)}`));
          if (location.pathname.includes(m.id) || new URLSearchParams(location.search).get("c") === m.id)
            navigate(isChat ? `/chat/${m.botIds?.[0] || ""}` : "/", { replace: true });
        },
      }),
    });
    return { label: name, items };
  }, []);

  const botItems = useCallback((target) => {
    const bot = storeRef.current.bots.find((b) => b.id === target.id);
    if (!bot) return null;
    return { label: bot.name, items: [
      { label: "Abrir chat", icon: "chat", onSelect: () => navigate(`/chat/${bot.id}`) },
      { label: "Ver ficha", icon: "profile", onSelect: () => navigate(`/colmena/${bot.id}`) },
    ] };
  }, []);

  useEffect(() => {
    const open = (e) => {
      if (e.defaultPrevented || e.target.closest?.("[data-window-chrome]")) {
        if (e.target.closest?.("[data-window-chrome]")) e.preventDefault();
        return;
      }
      // Page text selected (a selection inside a text field is not the page's).
      const selected = editableOf(document.activeElement || document.body) ? "" : String(window.getSelection?.() || "").trim();
      const field = editableOf(e.target);
      let next = null;
      if (field) {
        const readOnly = field.readOnly || field.disabled;
        const has = fieldSelection(field).length > 0;
        const secret = field.type === "password";
        next = { label: null, items: [
          { label: "Cortar", icon: "cut", hint: "Ctrl+X", disabled: readOnly || !has || secret, onSelect: () => editAction("cut", field) },
          { label: "Copiar", icon: "copy", hint: "Ctrl+C", disabled: !has || secret, onSelect: () => editAction("copy", field) },
          { label: "Pegar", icon: "paste", hint: "Ctrl+V", disabled: readOnly, onSelect: () => editAction("paste", field) },
          { separator: true },
          { label: "Seleccionar todo", icon: "all", hint: "Ctrl+A", onSelect: () => editAction("selectAll", field) },
        ] };
      } else {
        const a = e.target.closest?.("a[href]");
        const target = a ? linkTarget(a) : null;
        if (target?.kind === "mission") next = missionItems(target);
        else if (target?.kind === "bot") next = botItems(target);
        else if (target?.kind === "link") next = { label: null, items: [{ label: "Abrir", icon: "open", onSelect: () => navigate(target.href) }] };
        if (selected) {
          const copy = { label: "Copiar", icon: "copy", hint: "Ctrl+C", onSelect: () => copyText(selected) };
          next = next ? { ...next, items: [copy, { separator: true }, ...next.items] } : { label: null, items: [copy] };
        }
      }
      if (!next) return; // nothing to offer: no menu at all (as in other desktop apps)
      e.preventDefault();
      setMenu({ ...next, x: e.clientX, y: e.clientY });
    };
    document.addEventListener("contextmenu", open);
    return () => document.removeEventListener("contextmenu", open);
  }, [missionItems, botItems]);

  return (
    <>
      {menu ? <Menu key={menu.x + ":" + menu.y} menu={menu} onClose={close} onReplace={(next) => setMenu((m) => (m ? { ...m, ...next } : m))} /> : null}
      {confirm ? <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} /> : null}
      {rename ? <RenameDialog {...rename} onClose={() => setRename(null)} /> : null}
      {forget ? <ForgetDialog missionId={forget.missionId} title={forget.title} onClose={() => setForget(null)} /> : null}
    </>
  );
}
