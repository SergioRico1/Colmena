import { useCallback, useEffect, useRef, useState } from "react";
import { AlarmClock, Archive, ArchiveRestore, BellRing, BellSlash, Checks, ClipboardPaste, Copy, CopyPlus, DoorOpen, Eraser, ExternalLink, FileDown, MessageCircle, Pause, PencilLine, Play, Scissors, TextSelect, Trash2, UserRound } from "./Icon.js";
import { ForgetDialog } from "./interaction/Forget.jsx";
import { MenuSurface } from "./Menu.js";
import { del, patch, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { exportConversation } from "../lib/exportConversation.jsx";
import { useStore } from "../lib/store.jsx";
import { placeName, roomUrl } from "../lib/format.js";
import { roomSnoozeChoices } from "../lib/snooze.js";
import { later, reversible } from "../lib/undoToast.js";
import { useDialogFocus } from "../lib/useDialogFocus.js";

// Colmena's own right-click menu (the desktop window has none of its own). One listener
// for the whole app reads what is under the pointer, so screens keep the exact markup of
// the designs: rooms and chats (/sala/:id, /misiones/:id, /chat/:bot?c=id), direct
// conversations (/con/:id), bots (/chat/:bot, /equipo/:bot), other links, text fields and
// selected text. A part of the page with a menu of its own (a message) answers first
// (components/Menu.js › useContextMenu). Drawn by the app's one menu (components/Menu.js):
// grouped by intent, destructive actions last in red, taking effect after a five-second
// «Deshacer» (src/lib/undoToast.js) or asking in place when they cannot be undone.

const ACTIVE = ["queued", "running", "planning", "waiting", "awaiting_plan", "awaiting_choice"];

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
  if (room && room[1] !== "nueva") return { kind: "mission", id: decodeURIComponent(room[1]), href: url.pathname + url.search };
  const dm = /^\/con\/([^/]+)$/.exec(url.pathname);
  if (dm) return { kind: "dm", id: decodeURIComponent(dm[1]), href: url.pathname };
  const chat = /^\/(?:chat|equipo)\/([^/]+)$/.exec(url.pathname);
  if (chat && url.searchParams.get("c")) return { kind: "mission", id: url.searchParams.get("c"), href: url.pathname + url.search };
  if (chat && chat[1] !== "nuevo") return { kind: "bot", id: decodeURIComponent(chat[1]) };
  return { kind: "link", href: url.pathname + url.search };
}

// -------------------------------------------------------------------- rename dialog
function RenameDialog({ current, onSave, onClose }) {
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);
  const box = useDialogFocus({ onEscape: onClose });
  useEffect(() => { input.current?.select(); }, []);
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
    <div onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 2147482000, background: "rgb(from var(--c-text) 0 0 0 / .55)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "96px 16px 16px" }}>
      <form ref={box} onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="renombrar-t" style={{ width: "min(440px, 100%)", background: "var(--c-card)", color: "var(--c-text)", border: "2px solid var(--c-text)", borderRadius: "var(--r-xl)", boxShadow: "var(--c-shadow-pop)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 22px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <h2 id="renombrar-t" style={{ margin: "0", font: "700 var(--t-heading)/1.15 'Bricolage Grotesque', sans-serif" }}>Renombrar sala</h2>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", height: "46px", padding: "0 14px", border: "1.5px solid var(--c-text)", borderRadius: "var(--r-md)", fontSize: "var(--t-read)" }}>
            <span aria-hidden="true" style={{ color: "var(--c-text-4)", fontWeight: "700" }}>#</span>
            <input className="c-bare" ref={input} data-autofocus="" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Nombre de la sala" maxLength={60} style={{ flex: "1", minWidth: "0", border: "0", fontSize: "var(--t-read)", background: "transparent" }} />
          </label>
          <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-2)" }}>{preview ? `Quedará así: #${preview}` : "Escribe un nombre con letras o números."}</span>
          {error ? <span role="alert" style={{ fontSize: "var(--t-meta)", color: "var(--c-error)", fontWeight: "600" }}>{error}</span> : null}
        </div>
        <div style={{ padding: "14px 22px 18px", borderTop: "1px solid var(--c-line)", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button type="button" onClick={onClose} disabled={busy} style={{ height: "44px", padding: "0 14px", background: "transparent", border: "1px solid var(--c-line)", borderRadius: "var(--r-md)", cursor: "pointer", fontSize: "var(--t-ui)" }}>Cancelar</button>
          <button type="submit" disabled={busy || !preview} style={{ height: "44px", padding: "0 16px", background: "var(--c-btn)", color: "var(--c-btn-text)", border: "0", borderRadius: "var(--r-md)", cursor: "pointer", fontWeight: "600", fontSize: "var(--t-ui)", opacity: busy || !preview ? 0.6 : 1 }}>{busy ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </div>
  );
}


// -------------------------------------------------------------------- the layer
export default function ContextMenuLayer() {
  const store = useStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const [menu, setMenu] = useState(null);
  const [rename, setRename] = useState(null);
  const [forget, setForget] = useState(null);
  const close = useCallback(() => setMenu(null), []);

  // A room or a chat with a bot: a room of the list (with people, or a sala of your bots), or
  // a mission alone (an older chat). Grouped by intent; what cannot be undone ends it.
  const missionItems = useCallback((target) => {
    const { missions = [], rooms = [], bots, run } = storeRef.current;
    const r = rooms.find((x) => x.id === target.id || x.missionId === target.id || x.shareId === target.id) || null;
    const m = missions.find((x) => x.id === (r?.missionId || target.id)) || null;
    if (!r && !m) return null;
    const isChat = !r && !!m?.conversation;
    const name = r ? "#" + (r.title || (m ? placeName(m) : "sala")) : isChat ? (m.title || "Conversación") : placeName(m);
    const href = target.href || (m ? roomUrl(m) : `/sala/${encodeURIComponent(r.id)}`);
    const word = isChat ? "Conversación" : "Sala";
    // Changes to a room go to the room (PATCH /api/rooms/:id); a chat alone, to its mission.
    const base = r ? `/rooms/${encodeURIComponent(r.id)}` : `/missions/${encodeURIComponent(m.id)}`;
    const change = (body) => run(() => patch(base, body));
    // Archiving and snoozing happen at once and are undone with the opposite change (5 s notice).
    const tidy = (body, text, back) => change(body).then(() => reversible({ id: "mission:" + (r?.id || m.id), text, undo: () => change(back) })).catch(() => {});
    const snoozedUntil = r?.snoozedUntil || m?.snoozedUntil;
    const snoozed = snoozedUntil && Date.parse(snoozedUntil) > Date.now();
    const archived = r ? !!r.archived : !!m?.archived;
    const busy = m && ["queued", "running", "planning"].includes(m.status);
    const shared = !!(r?.shareId);

    return { label: name, items: [
      { group: null, items: [
        { label: isChat ? "Abrir la conversación" : "Abrir la sala", icon: ExternalLink, onSelect: () => navigate(href) },
        r?.unread ? { label: "Marcar como leída", icon: Checks, onSelect: () => run(() => post(`/rooms/${encodeURIComponent(r.id)}/seen`)).catch(() => {}) } : null,
        m && ACTIVE.includes(m.status) ? { label: "Pausar a los bots", icon: Pause, onSelect: () => run(() => post(`/missions/${encodeURIComponent(m.id)}/control`, { action: "pause" })).catch(() => {}) } : null,
        m?.status === "paused" ? { label: "Reanudar", icon: Play, onSelect: () => run(() => post(`/missions/${encodeURIComponent(m.id)}/control`, { action: "resume" })).catch(() => {}) } : null,
      ] },
      { group: null, items: [
        snoozed
          ? { label: "Mostrar ya", icon: BellRing, meta: new Date(snoozedUntil).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }), onSelect: () => change({ snoozedUntil: null }).catch(() => {}) }
          : archived ? null : { label: "Posponer", icon: AlarmClock, subLabel: "Posponer " + name, items: roomSnoozeChoices().map((c) => ({ label: c.label, meta: c.hint, onSelect: () => tidy({ snooze: c.id }, `${word} pospuesta · ${c.label.toLowerCase()}`, { snoozedUntil: null }) })) },
        archived
          ? { label: "Desarchivar", icon: ArchiveRestore, onSelect: () => tidy({ archived: false }, word + " desarchivada", { archived: true }) }
          : busy ? null : { label: "Archivar", icon: Archive, onSelect: () => tidy({ archived: true }, word + " archivada", { archived: false }) },
      ] },
      m ? { group: null, items: [
        !isChat && !shared ? { label: "Cambiar el nombre…", icon: PencilLine, onSelect: () => setRename({ current: m.room || "", onSave: (room) => run(() => patch(`/missions/${encodeURIComponent(m.id)}`, { room })) }) } : null,
        m.mode !== "debate" && !shared ? { label: isChat ? "Duplicar la conversación" : "Duplicar la sala", icon: CopyPlus, onSelect: () => run(() => post(`/missions/${encodeURIComponent(m.id)}/fork`, {})).then((copy) => copy && navigate(roomUrl(copy))).catch(() => {}) } : null,
        // The whole conversation as a document (OpenClaw /export).
        { label: "Exportar", icon: FileDown, subLabel: "Exportar " + name, items: [
          { label: "Documento de Word", meta: ".doc", icon: FileDown, onSelect: () => exportConversation(m.id, "word", { bots }).catch(() => {}) },
          { label: "Markdown", meta: ".md", icon: FileDown, onSelect: () => exportConversation(m.id, "markdown", { bots }).catch(() => {}) },
          { label: "Copiar como Markdown", icon: Copy, onSelect: () => exportConversation(m.id, "copy", { bots }).catch(() => {}) },
        ] },
        // What the bots learned here (memories, skills) can be seen and forgotten.
        busy ? null : { label: "Olvidar lo aprendido aquí…", icon: Eraser, onSelect: () => setForget({ missionId: m.id, title: m.title || name }) },
      ] } : null,
      // With people: leaving asks first (it cannot be undone from here).
      shared && !r.general ? { label: "Salir de la sala", icon: DoorOpen, danger: true, onSelect: () => run(() => post(`/rooms/${encodeURIComponent(r.id)}/leave`)).then(() => { if (location.pathname.includes(r.id)) navigate("/chats", { replace: true }); }).catch(() => {}), confirm: { title: `¿Salir de ${name}?`, text: "Dejarás de recibir lo que se escriba aquí. Lo que ya escribiste sigue en la sala de los demás.", action: "Salir" } } : null,
      // Yours alone: it leaves the list at once and is deleted after the five-second «Deshacer».
      // A team at work here stops only when the delete goes through.
      m && !shared ? {
        label: isChat ? "Borrar la conversación" : "Borrar la sala", icon: Trash2, danger: true,
        onSelect: () => {
          const working = ACTIVE.includes(m.status) && m.status !== "awaiting_choice";
          later({
            id: "mission:" + m.id, keys: ["mission:" + m.id],
            text: (isChat ? "Conversación borrada" : "Sala borrada") + (working ? " · el equipo se detendrá" : ""),
            error: isChat ? "No se pudo borrar la conversación" : "No se pudo borrar la sala",
            run: () => run(() => del(`/missions/${encodeURIComponent(m.id)}`)),
          });
          if (location.pathname.includes(m.id) || new URLSearchParams(location.search).get("c") === m.id)
            navigate(isChat ? `/chat/${m.botIds?.[0] || ""}` : "/", { replace: true });
        },
      } : null,
    ] };
  }, []);

  // A direct conversation with a person (the «Personas» rows): the same choices as its «…».
  const dmItems = useCallback((target) => {
    const { peers, run } = storeRef.current;
    const s = (peers?.shares || []).find((x) => x.id === target.id);
    if (!s) return null;
    const other = (s.members || []).find((p) => !p.me) || null;
    const prefs = (body) => run(() => patch(`/peers/shares/${encodeURIComponent(s.id)}/prefs`, body)).catch(() => {});
    return { label: s.title || other?.name || "Conversación", items: [
      { label: "Abrir la conversación", icon: MessageCircle, onSelect: () => navigate(target.href) },
      { group: null, items: [
        { label: s.muted ? "Volver a avisarme" : "Silenciar", icon: s.muted ? BellRing : BellSlash, onSelect: () => prefs({ muted: !s.muted }) },
        { label: "Archivar", icon: Archive, onSelect: () => prefs({ archived: true }).then(() => reversible({ id: "dm:" + s.id, text: "Conversación archivada", undo: () => prefs({ archived: false }) })) },
      ] },
    ] };
  }, []);

  const botItems = useCallback((target) => {
    const bot = storeRef.current.bots.find((b) => b.id === target.id);
    if (!bot) return null;
    return { label: bot.name, items: [
      { label: "Abrir el chat", icon: MessageCircle, onSelect: () => navigate(`/chat/${bot.id}`) },
      { label: "Ver su ficha", icon: UserRound, onSelect: () => navigate(`/equipo/${bot.id}`) },
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
        next = { label: "Texto", keep: true, items: [
          { group: null, items: [
            { label: "Cortar", icon: Scissors, shortcut: "Ctrl+X", disabled: readOnly ? "Este campo es de solo lectura" : !has ? "Selecciona texto primero" : secret ? "Una contraseña no se copia" : false, onSelect: () => editAction("cut", field) },
            { label: "Copiar", icon: Copy, shortcut: "Ctrl+C", disabled: !has ? "Selecciona texto primero" : secret ? "Una contraseña no se copia" : false, onSelect: () => editAction("copy", field) },
            { label: "Pegar", icon: ClipboardPaste, shortcut: "Ctrl+V", disabled: readOnly ? "Este campo es de solo lectura" : false, onSelect: () => editAction("paste", field) },
          ] },
          { label: "Seleccionar todo", icon: TextSelect, shortcut: "Ctrl+A", onSelect: () => editAction("selectAll", field) },
        ] };
      } else {
        const a = e.target.closest?.("a[href]");
        const target = a ? linkTarget(a) : null;
        if (target?.kind === "mission") next = missionItems(target);
        else if (target?.kind === "dm") next = dmItems(target);
        else if (target?.kind === "bot") next = botItems(target);
        else if (target?.kind === "link") next = { label: null, items: [{ label: "Abrir", icon: ExternalLink, onSelect: () => navigate(target.href) }] };
        if (selected) {
          const copy = { group: null, items: [{ label: "Copiar", icon: Copy, shortcut: "Ctrl+C", onSelect: () => copyText(selected) }] };
          next = next ? { ...next, items: [copy, ...next.items] } : { label: null, items: [copy] };
        }
      }
      if (!next) return; // nothing to offer: no menu at all (as in other desktop apps)
      e.preventDefault();
      // The keyboard's menu key: under the focused element instead of at the pointer.
      const keyboard = !e.clientX && !e.clientY;
      const at = keyboard ? (e.target.closest?.("a, button, input, textarea, [tabindex]") || e.target).getBoundingClientRect() : { x: e.clientX, y: e.clientY };
      setMenu({ ...next, anchor: at, keyboard, back: document.activeElement, n: Date.now() });
    };
    document.addEventListener("contextmenu", open);
    return () => document.removeEventListener("contextmenu", open);
  }, [missionItems, dmItems, botItems]);

  return (
    <>
      {/* A text field keeps focus (and its caret) while its menu is open; keys still work. */}
      {menu ? <MenuSurface key={menu.n} entries={menu.items} label={menu.label || "Acciones"} anchor={menu.anchor} placement={menu.keyboard ? "bottom-start" : "point"} initial={menu.keyboard ? "first" : "none"} autoFocus={!menu.keep} returnFocus={menu.back} onClose={close} /> : null}
      {rename ? <RenameDialog {...rename} onClose={() => setRename(null)} /> : null}
      {forget ? <ForgetDialog missionId={forget.missionId} title={forget.title} onClose={() => setForget(null)} /> : null}
    </>
  );
}