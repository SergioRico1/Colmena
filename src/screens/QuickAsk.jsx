import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppWindow, ArrowUp, ArrowUpRight, ClipboardPaste, Crop, FileText, History, LayoutGrid, LoaderCircle, Paperclip, Plus, X } from "lucide-react";
import { pickFiles, post } from "../lib/api.js";
import { useStore } from "../lib/store.jsx";
import { useRoom } from "../components/room/useRoom.js";
import LiveMarkdown from "../components/room/LiveMarkdown.jsx";
import Markdown from "../components/room/Markdown.jsx";
import { ago, roomUrl } from "../lib/format.js";
import { BotPresence } from "../components/v2/Presence.jsx";
import { toPlainText } from "../lib/exporting.js";
import WindowPicker from "../components/interaction/WindowPicker.jsx";

// «Pregunta rápida» (Alt+Espacio), after OpenClaw Quick Chat: a Colmena card over whatever
// you are doing. It knows the window you came from: «+» brings that app's text or a
// screenshot of it (or of another window, or of an area); the answer streams right here and
// «Pegar en Excel» puts it back where you were. ⏱ continues one of your last conversations.
// Enter sends · Mayús+Enter, new line · Ctrl+Enter sends and opens it in Colmena · Esc closes.
const api = typeof window !== "undefined" ? window.colmenaWindow?.quick : null;
const DONE = ["completed", "waiting", "awaiting_plan", "awaiting_choice", "failed", "paused", "blocked"];
const RECENTS = 5;
// Room around the card inside the transparent window: a little on top, more below for its shadow.
const PAD_TOP = 10;
const PAD_BOTTOM = 26;
// The window never scrolls: it grows with the card (up to the desktop limit) and the card scrolls inside.
const NO_SCROLL = "html,body,#root{overflow:hidden!important;height:auto;background:transparent}::-webkit-scrollbar{width:0;height:0}.c-quick>*{flex-shrink:0}";
const ICON = { size: 16, strokeWidth: 2.2, "aria-hidden": "true" };
const loadWindows = () => api?.windows();

function Chip({ on, onClick, children, label }) {
  return (
    <button type="button" role="radio" aria-checked={on ? "true" : "false"} aria-label={label} onClick={onClick} className="rm-focus"
      style={{ display: "flex", alignItems: "center", gap: "7px", height: "34px", padding: "0 12px 0 9px", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: "600", whiteSpace: "nowrap", background: on ? "#12131A" : "rgba(18,19,26,.05)", color: on ? "#FFFFFF" : "#2B2D36"}}>
      {children}
    </button>
  );
}

/** One thing attached to the question: a screenshot, an app's text or a file. */
function Attached({ item, onRemove }) {
  const busy = item.status === "busy";
  return (
    <span className="c-pop" style={{ display: "inline-flex", alignItems: "center", gap: "8px", maxWidth: "100%", height: "38px", padding: "0 6px 0 8px", background: "#F2F2EE", borderRadius: "12px", fontSize: "13px", color: "#2B2D36" }}>
      {busy ? <LoaderCircle {...ICON} size={15} className="c-spin" style={{ flex: "none", color: "#555A68" }} />
        : item.thumb ? <img src={item.thumb} alt="" style={{ width: "30px", height: "22px", objectFit: "cover", borderRadius: "4px", border: "1px solid #DCE0E8", flex: "none" }} />
          : item.kind === "text" ? <FileText {...ICON} size={15} style={{ flex: "none", color: "#555A68" }} /> : <Paperclip {...ICON} size={15} style={{ flex: "none", color: "#555A68" }} />}
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <strong style={{ fontWeight: "600" }}>{item.label}</strong>
        {item.detail ? <span style={{ color: "#555A68" }}>{" · " + item.detail}</span> : null}
      </span>
      {busy ? null : (
        <button type="button" className="rm-focus" onClick={onRemove} aria-label={"Quitar " + item.label} title="Quitar"
          style={{ width: "26px", height: "26px", flex: "none", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "7px", cursor: "pointer", color: "#555A68" }}>
          <X {...ICON} size={14} />
        </button>
      )}
    </span>
  );
}

/** A small menu inside the card (it cannot leave the window): ↑/↓, Enter, Esc. */
function Menu({ label, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector("button:not(:disabled)")?.focus(); }, []);
  const onKeyDown = (e) => {
    const buttons = [...ref.current.querySelectorAll("button:not(:disabled)")];
    const i = buttons.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  return (
    <div ref={ref} role="menu" aria-label={label} onKeyDown={onKeyDown} className="c-pop"
      style={{ margin: "0", padding: "6px", background: "#FFFFFF", borderRadius: "18px", boxShadow: "0 20px 40px -20px rgba(18,19,26,.35), 0 0 0 1px rgba(18,19,26,.06)", display: "flex", flexDirection: "column", gap: "2px" }}>
      {items.map((it, i) => (it.separator ? <div key={"s" + i} role="separator" style={{ height: "1px", margin: "4px 6px", background: "#E6E8EE" }} /> : (
        <button key={it.id} type="button" role="menuitem" className="rm-item" disabled={it.disabled} onClick={() => { onClose(); it.run(); }} aria-checked={it.checked ? "true" : undefined}
          style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "38px", padding: "6px 10px", background: it.checked ? "#F7F8FA" : "transparent", border: "0", borderRadius: "9px", cursor: it.disabled ? "default" : "pointer", textAlign: "left", fontSize: "14px", color: it.disabled ? "#8C91A0" : "#12131A" }}>
          <span style={{ width: "18px", flex: "none", display: "grid", placeItems: "center", color: "#4A4F5C" }}>{it.icon}</span>
          <span style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: it.checked ? "600" : "500" }}>{it.label}</span>
            {it.hint ? <span style={{ fontSize: "12px", color: "#555A68", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.hint}</span> : null}
          </span>
        </button>
      )))}
    </div>
  );
}

const dataPart = (url) => String(url || "").replace(/^data:[^,]*,/, "");
const slug = (s) => String(s || "app").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "app";
const chars = (n) => n.toLocaleString("es-ES") + " caracteres";

export default function QuickAsk() {
  const { bots, live, missions } = useStore();
  const team = useMemo(() => bots.filter((b) => b.enabled !== false && b.id !== "atlas"), [bots]);
  const [target, setTarget] = useState("equipo");
  const [replyIn, setReplyIn] = useState(null); // a recent conversation or room to continue
  const [text, setText] = useState("");
  const [attached, setAttached] = useState([]); // [{id, kind:'image'|'text'|'file', label, detail, thumb, file, status}]
  const [source, setSource] = useState(null); // the window you came from {hwnd, app, title}
  const [menu, setMenu] = useState(null); // 'add' | 'recents' | 'windows'
  const [sent, setSent] = useState(null); // { id, prompt, botId|null, conversation, room, files }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [pasted, setPasted] = useState(null);
  const input = useRef(null);
  const card = useRef(null);
  const [shown, setShown] = useState(0);
  const room = useRoom(sent?.id || null);

  // A new visit: the window you came from; what was attached last time is cleared, as is
  // a finished answer (one still being written stays).
  const fresh = useCallback((payload) => {
    setSource(payload?.source || null);
    setAttached([]);
    setMenu(null);
    setError(null);
    setPasted(null);
    setShown((n) => n + 1);
  }, []);
  useEffect(() => {
    document.documentElement.classList.add("colmena-quick");
    input.current?.focus();
    api?.source?.().then((s) => setSource(s || null)).catch(() => {});
    const off = api?.onShown?.(fresh);
    return () => off?.();
  }, [fresh]);
  useEffect(() => {
    if (!shown) return;
    if (sent && DONE.includes(room.mission?.status) && !Object.values(live || {}).some((v) => v.mission === sent.id)) setSent(null);
    requestAnimationFrame(() => input.current?.focus());
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps

  // The window is as tall as the card needs (OpenClaw: compact, with text, with a reply).
  useLayoutEffect(() => {
    const el = card.current;
    if (!el || !api?.size) return undefined;
    const report = () => api.size(Math.ceil(el.scrollHeight) + PAD_TOP + PAD_BOTTOM);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => ro.disconnect();
  });

  // Esc: closes an open menu first, then the card.
  useEffect(() => {
    const key = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (menu) { setMenu(null); input.current?.focus(); return; }
      api?.hide();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [menu]);

  // «@Vera …» picks Vera, as everywhere else in Colmena.
  const onChange = (value) => {
    setText(value);
    setError(null);
    const m = /^@(\S+)\s/.exec(value);
    if (m) {
      const bot = team.find((b) => b.name.toLowerCase() === m[1].toLowerCase());
      if (bot) { setTarget(bot.id); setReplyIn(null); setText(value.slice(m[0].length)); }
    }
  };

  const add = (item) => setAttached((all) => [...all.filter((x) => x.id !== item.id), item].slice(-5));
  const drop = (id) => setAttached((all) => all.filter((x) => x.id !== id));
  const attempt = async (id, placeholder, work) => {
    add({ id, status: "busy", ...placeholder });
    setError(null);
    try {
      const item = await work();
      if (item) add({ id, ...item });
      else drop(id);
    } catch (e) {
      drop(id);
      setError(e?.message || "No se pudo.");
    } finally {
      requestAnimationFrame(() => input.current?.focus());
    }
  };
  const bringText = () => attempt("text", { kind: "text", label: "Texto de " + (source?.app || "la app") }, async () => {
    const r = await api.readText();
    const body = `[Texto de ${r.app}${r.title ? " — " + r.title : ""}, para que lo tengas como dato]\n\n` + r.text + (r.truncated ? "\n\n[…recortado]" : "");
    return { kind: "text", label: "Texto de " + r.app, detail: chars(r.text.length) + (r.truncated ? " (recortado)" : ""), file: { name: `texto-de-${slug(r.app)}.txt`, content: body, size: body.length, encoding: "utf8" } };
  });
  const shot = (id, label, run) => attempt(id, { kind: "image", label }, async () => {
    const r = await run();
    if (!r) return null; // cancelled
    return { kind: "image", label, detail: `${r.width} × ${r.height}`, thumb: r.dataUrl, file: { name: `captura-${slug(id === "area" ? "zona" : r.name || label)}.jpg`, content: dataPart(r.dataUrl), size: r.bytes, encoding: "base64" } };
  });
  const attachFiles = async () => {
    try {
      const picked = await pickFiles();
      for (const f of picked) add({ id: "file:" + f.name, kind: "file", label: f.name, file: f });
    } catch (e) {
      setError(e.message);
    }
  };

  const recents = useMemo(() => [...missions]
    .filter((m) => !m.archived && !m.automationId)
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))
    .slice(0, RECENTS), [missions]);
  const recentName = (m) => (m.conversation ? (bots.find((b) => b.id === m.botIds?.[0])?.name || "Chat") + " · " + (m.title || m.prompt || "Conversación") : "#" + (m.room || m.title || "sala"));

  const send = async (e, { open = false } = {}) => {
    e?.preventDefault();
    const prompt = text.trim();
    const files = attached.filter((a) => a.file && a.status !== "busy").map((a) => a.file);
    if ((!prompt && !files.length) || busy || attached.some((a) => a.status === "busy")) return;
    const ask = prompt || (source ? `Échale un vistazo a lo que te adjunto de ${source.app}.` : "Échale un vistazo a lo que te adjunto.");
    setBusy(true);
    setError(null);
    try {
      let next;
      if (replyIn) {
        await post(`/missions/${replyIn.id}/messages`, files.length ? { text: ask, attachments: files } : { text: ask });
        next = { id: replyIn.id, prompt: ask, botId: replyIn.conversation ? replyIn.botIds?.[0] : null, room: replyIn.room, conversation: !!replyIn.conversation, files: files.length };
      } else {
        const body = target === "equipo"
          ? { prompt: ask, mode: "equipo", botIds: [], safety: "preguntar", attachments: files }
          : { prompt: ask, mode: "solo", botIds: [target], conversation: true, attachments: files };
        const created = await post("/missions", body);
        const m = created?.mission || created;
        next = { id: m.id, prompt: ask, botId: target === "equipo" ? null : target, room: m.room, conversation: target !== "equipo", files: files.length };
      }
      // Only what is answered from now on (a recent conversation already has older answers).
      setSent({ ...next, at: new Date(Date.now() - 2000).toISOString() });
      setText("");
      setAttached([]);
      setPasted(null);
      if (open) api?.open(next.conversation ? `/chat/${next.botId}?c=${next.id}` : roomUrl({ id: next.id, room: next.room }));
    } catch (err) {
      setError(err.message || "No se pudo enviar.");
    } finally {
      setBusy(false);
    }
  };
  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!e.repeat) send(e, { open: e.ctrlKey || e.metaKey });
    }
  };

  const bot = sent?.botId ? bots.find((b) => b.id === sent.botId) : bots.find((b) => b.id === "atlas");
  const since = sent?.at || null;
  const answers = (room.messages || []).filter((m) => m.role === "assistant" && m.text && (!since || m.at >= since));
  const streaming = Object.values(live || {}).filter((v) => v.mission === sent?.id).map((v) => v.text).join("");
  const reply = streaming || (answers.length ? answers.map((a) => a.text).join("\n\n") : "");
  const done = !!sent && !streaming && DONE.includes(room.mission?.status);
  const openUrl = sent ? (sent.conversation ? `/chat/${sent.botId}?c=${sent.id}` : roomUrl({ id: sent.id, room: sent.room, status: room.mission?.status })) : "/";
  const paste = async () => {
    setError(null);
    try {
      const r = await api.paste(toPlainText(reply));
      setPasted(r?.app || source?.app);
    } catch (e) {
      setError(e.message || "No se pudo pegar.");
    }
  };

  const who = replyIn ? null : target === "equipo" ? "tu equipo" : team.find((b) => b.id === target)?.name || "tu bot";
  const placeholder = replyIn ? `Responder en ${recentName(replyIn)}…` : target === "equipo" ? "Pídele algo a tu equipo…" : `Pregúntale a ${who}…`;
  const addItems = [
    ...(source ? [
      { id: "text", icon: <FileText {...ICON} />, label: `Traer el texto de ${source.app}`, hint: source.title || "La ventana en la que estabas", run: bringText },
      { id: "win", icon: <AppWindow {...ICON} />, label: `Captura de ${source.app}`, hint: "Una imagen de esa ventana", run: () => shot("win", "Captura de " + source.app, () => api.captureWindow()) },
    ] : []),
    { id: "other", icon: <LayoutGrid {...ICON} />, label: "Captura de otra ventana…", run: () => setMenu("windows") },
    { id: "area", icon: <Crop {...ICON} />, label: "Captura de una zona de la pantalla", hint: "Arrastra para elegirla · Esc cancela", run: () => shot("area", "Zona de la pantalla", () => api.captureArea()) },
    { separator: true },
    { id: "file", icon: <Paperclip {...ICON} />, label: "Adjuntar archivo…", run: attachFiles },
  ];
  const recentItems = [
    { id: "new", icon: <Plus {...ICON} />, label: "Pregunta nueva", checked: !replyIn, run: () => setReplyIn(null) },
    ...(recents.length ? [{ separator: true }] : []),
    ...recents.map((m) => ({ id: m.id, icon: <History {...ICON} />, label: recentName(m), hint: ago(m.updatedAt || m.createdAt) || undefined, checked: replyIn?.id === m.id, run: () => setReplyIn(m) })),
  ];
  const iconBtn = (pressed) => ({ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", background: pressed ? "#EEF0F4" : "transparent", border: "1px solid " + (pressed ? "#C9CED8" : "transparent"), borderRadius: "10px", cursor: "pointer", color: "#2B2D36", WebkitAppRegion: "no-drag" });
  const canSend = (text.trim() || attached.some((a) => a.file)) && !busy && !attached.some((a) => a.status === "busy");

  return (
    <div style={{ padding: `${PAD_TOP}px 18px ${PAD_BOTTOM}px 18px`, boxSizing: "border-box" }}>
      <style>{NO_SCROLL}</style>
      <section ref={card} key={shown} className="c-quick" aria-label="Pregunta rápida" style={{ boxSizing: "border-box", maxHeight: `calc(100vh - ${PAD_TOP + PAD_BOTTOM}px)`, overflowY: "auto", scrollbarWidth: "none", background: "rgba(255,255,255,.96)", borderRadius: "28px", boxShadow: "0 30px 60px -28px rgba(18,19,26,.55), 0 0 0 1px rgba(18,19,26,.06)", display: "flex", flexDirection: "column", color: "#12131A" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "16px 18px 0", WebkitAppRegion: "drag" }}>
          <img src="/colmena-icon-128.png" alt="" width="24" height="24" style={{ display: "block", width: "24px", height: "24px" }} />
          <h2 style={{ flex: "1", margin: "0", fontSize: "14px", fontWeight: "600" }}>Pregunta rápida</h2>
          <span style={{ fontSize: "12px", color: "#6B6F7A" }}>Esc para cerrar</span>
        </div>
        <form onSubmit={send} style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px 18px 16px" }}>
          <textarea ref={input} rows="2" value={text} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} disabled={busy}
            placeholder={placeholder} aria-label="Pregunta rápida"
            style={{ minWidth: "0", minHeight: "58px", maxHeight: "150px", padding: "6px 2px", border: "0", outline: "none", resize: "none", fontSize: "21px", lineHeight: "1.4", letterSpacing: "-0.01em", background: "transparent", fieldSizing: "content", color: "#12131A" }} />
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
            {attached.map((a) => <Attached key={a.id} item={a} onRemove={() => drop(a.id)} />)}
            <button type="button" className="rm-focus" aria-haspopup="menu" aria-expanded={menu === "add" || menu === "windows" ? "true" : "false"} onClick={() => setMenu(menu === "add" ? null : "add")}
              style={{ display: "flex", alignItems: "center", gap: "6px", height: "38px", padding: "0 12px", border: "0", borderRadius: "12px", background: menu === "add" || menu === "windows" ? "#F2F2EE" : "transparent", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.12)", cursor: "pointer", fontSize: "13px", fontWeight: "500", color: "#12131A" }}>
              <Plus {...ICON} size={13} strokeWidth={2.6} />Añadir contexto
            </button>
            {source && !attached.length && !sent && !menu ? <span style={{ fontSize: "12px", color: "#6B6F7A" }}>{"Vienes de "}<strong style={{ color: "#3D404A", fontWeight: "600" }}>{source.app}</strong></span> : null}
          </div>
          {menu === "add" ? <Menu label="Añadir contexto" items={addItems} onClose={() => setMenu((m) => (m === "add" ? null : m))} /> : null}
          {menu === "windows" ? <WindowPicker load={loadWindows} onClose={() => setMenu(null)} onPick={(w) => { setMenu(null); shot("w:" + w.id, "Captura de " + w.name.split(" - ").pop(), () => api.captureWindow(w.id)); }} /> : null}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", paddingTop: "10px", borderTop: "1px solid rgba(18,19,26,.06)" }}>
            {replyIn ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", height: "34px", padding: "0 4px 0 12px", background: "#F2F2EE", borderRadius: "999px", fontSize: "13px", minWidth: 0 }}>
                <History {...ICON} size={14} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{"Respondiendo en "}<strong style={{ fontWeight: "600" }}>{recentName(replyIn)}</strong></span>
                <button type="button" className="rm-focus" onClick={() => setReplyIn(null)} aria-label="Volver a una pregunta nueva" style={{ width: "26px", height: "26px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "50%", cursor: "pointer" }}><X {...ICON} size={13} /></button>
              </span>
            ) : (
              <>
                <span style={{ fontSize: "13px", color: "#6B6F7A" }}>Para</span>
                <div role="radiogroup" aria-label="Para quién" style={{ display: "flex", flexWrap: "wrap", gap: "4px", minWidth: 0 }}>
                  <Chip on={target === "equipo"} onClick={() => setTarget("equipo")} label="Para el equipo (coordina Atlas)">
                    {bots.find((b) => b.id === "atlas") ? <BotPresence bot={bots.find((b) => b.id === "atlas")} size={14} /> : null}Equipo · coordina Atlas
                  </Chip>
                  {team.slice(0, 3).map((b) => <Chip key={b.id} on={target === b.id} onClick={() => setTarget(b.id)} label={`Para ${b.name}`}><BotPresence bot={b} size={14} />{b.name}</Chip>)}
                </div>
              </>
            )}
            <button type="submit" aria-label="Enviar" title="Enviar (Intro) · Ctrl+Intro: enviar y abrir en Colmena" disabled={!canSend} style={{ marginLeft: "auto", width: "44px", height: "44px", flex: "none", display: "grid", placeItems: "center", border: "0", borderRadius: "50%", cursor: canSend ? "pointer" : "default", transition: "background .2s ease", background: canSend || busy ? "#12131A" : "#C9CBD1", color: "#FFFFFF" }}>
              {busy ? <LoaderCircle {...ICON} size={18} className="c-spin" /> : <ArrowUp {...ICON} size={18} strokeWidth={2.4} />}
            </button>
          </div>
          {error ? <p role="alert" style={{ margin: "0", fontSize: "13px", fontWeight: "600", color: "#B4372A" }}>{error}</p> : null}
          {!sent ? <span style={{ fontSize: "12px", color: "#8A8D96" }}>Intro envía · Ctrl+Intro envía y abre Colmena</span> : null}
        </form>

        {!sent && !replyIn && recents.length ? (
          <div style={{ padding: "10px 10px 12px", background: "rgba(18,19,26,.03)", borderTop: "1px solid rgba(18,19,26,.05)" }}>
            <span style={{ display: "block", padding: "4px 10px 6px", fontSize: "12px", fontWeight: "500", color: "#6B6F7A" }}>Seguir una conversación reciente</span>
            {recents.slice(0, 3).map((m) => {
              const b = m.conversation ? bots.find((x) => x.id === m.botIds?.[0]) : null;
              return (
                <button key={m.id} type="button" className="rm-focus rm-item" onClick={() => { setReplyIn(m); requestAnimationFrame(() => input.current?.focus()); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", minHeight: "44px", padding: "0 10px", border: "0", borderRadius: "12px", background: "transparent", cursor: "pointer", textAlign: "left", color: "#12131A" }}>
                  {b ? <BotPresence bot={b} size={18} /> : <span aria-hidden="true" style={{ width: "18px", height: "18px", display: "grid", placeItems: "center", font: "600 12px/1 'Geist', sans-serif", color: "#5C606C" }}>#</span>}
                  <span style={{ flex: "1", minWidth: 0, fontSize: "14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{recentName(m).replace(/^#/, "")}</span>
                  <span style={{ fontSize: "12px", color: "#8A8D96" }}>{ago(m.updatedAt || m.createdAt)}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {sent ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "4px 22px 20px", animation: "fade .3s ease-out" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              {bot ? <BotPresence bot={bot} size={34} state={done ? null : "work"} /> : null}
              <span style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
                <strong style={{ fontSize: "16px", fontWeight: "600" }}>{done ? `${bot?.name || "Tu equipo"} ha terminado` : sent.conversation ? `${bot?.name || "El bot"} está pensando…` : "Atlas está repartiendo el trabajo…"}</strong>
                <span role="status" style={{ fontSize: "14px", color: pasted ? "#0B6B4A" : "#5C606C" }}>{pasted ? `Pegado en ${pasted}.` : done ? "Listo." : "Sigue trabajando; puedes cerrar esto, te avisará."}</span>
              </span>
            </div>
            <div style={{ maxHeight: "300px", overflowY: "auto", padding: "14px 16px", borderRadius: "16px", background: "#F2F2EE", fontSize: "15px", lineHeight: "1.5" }}>
              {!reply && room.mission?.error ? <p role="alert" style={{ margin: "0", fontWeight: "600", color: "#B4372A" }}>{room.mission.error}</p>
                : streaming ? <LiveMarkdown text={streaming} size={15} caret />
                  : reply ? <Markdown text={reply} size={15} />
                    : <span style={{ color: "#3D404A" }}>{`«${sent.prompt}»`}{sent.files ? ` · con ${sent.files === 1 ? "1 adjunto" : sent.files + " adjuntos"}` : ""}</span>}
              {!sent.conversation && room.mission?.status === "awaiting_plan" ? <p style={{ margin: "8px 0 0", fontWeight: "600" }}>El plan espera tu OK en la sala.</p> : null}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <button type="button" className="rm-focus" onClick={() => api?.open(openUrl)} style={{ display: "flex", alignItems: "center", gap: "6px", height: "42px", padding: "0 18px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "14px" }}>
                Abrir en Colmena<ArrowUpRight {...ICON} size={14} />
              </button>
              {done && reply && source ? (
                <button type="button" className="rm-focus" onClick={paste} title={`Copia la respuesta y la pega en ${source.app}`} style={{ display: "flex", alignItems: "center", gap: "6px", height: "42px", padding: "0 16px", background: "rgba(18,19,26,.06)", border: "0", borderRadius: "999px", cursor: "pointer", fontWeight: "600", fontSize: "14px", color: "#12131A" }}>
                  <ClipboardPaste {...ICON} size={15} />{`Pegar en ${source.app}`}
                </button>
              ) : null}
              <button type="button" className="rm-focus" onClick={() => { setSent(null); setPasted(null); input.current?.focus(); }} style={{ height: "42px", padding: "0 16px", background: "rgba(18,19,26,.06)", border: "0", borderRadius: "999px", cursor: "pointer", fontSize: "14px", fontWeight: "600", color: "#12131A" }}>Nueva pregunta</button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
