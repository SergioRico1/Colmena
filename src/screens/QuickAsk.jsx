import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import BotFace from "../components/BotFace.jsx";
import { AppWindow, ArrowUpRight, ClipboardPaste, Crop, FileText, History, LayoutGrid, LoaderCircle, Plus, X, ArrowUp } from "../components/Icon.js";
import { pickFiles, post } from "../lib/api.js";
import { useStore } from "../lib/store.jsx";
import { useMissionLive } from "../lib/liveStore.js";
import { useRoom } from "../components/room/useRoom.js";
import LiveMarkdown from "../components/room/LiveMarkdown.jsx";
import Markdown from "../components/room/Markdown.jsx";
import { ago, placeName, roomUrl } from "../lib/format.js";
import { BotPresence } from "../components/v2/Presence.jsx";
import { toPlainText } from "../lib/exporting.js";
import WindowPicker from "../components/interaction/WindowPicker.jsx";

// Colmena 3 · «Pregunta rápida» (design/V3Rapida.dc.html; Alt+Espacio), after OpenClaw Quick
// Chat: a Colmena card over whatever you are doing. It knows the window you came from: «Con:»
// adds a screenshot of it (or of another window, or of an area), its text («+ Selección») or a
// file; «Para …» picks the team or one bot; the answer streams right here and «Pegar en Excel»
// puts it back where you were. «O sigue una conversación» continues one of your last ones.
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

/** One thing attached to the question (a screenshot, an app's text or a file), as the board's dark «Con:» pill. */
function Attached({ item, onRemove }) {
  const busy = item.status === "busy";
  const ext = item.kind === "file" ? (String(item.label).split(".").pop() || "").slice(0, 3).toUpperCase() : null;
  return (
    <span className="c-pop" style={{ display: "inline-flex", alignItems: "center", gap: "8px", maxWidth: "100%", height: "32px", padding: busy ? "0 12px" : "0 4px 0 12px", background: "var(--c-btn)", borderRadius: "var(--r-pill)", fontSize: "var(--t-meta)", color: "var(--c-btn-text)" }}>
      {busy ? <LoaderCircle {...ICON} size={14} className="c-spin" style={{ flex: "none" }} />
        : item.thumb ? <img src={item.thumb} alt="" style={{ width: "24px", height: "18px", objectFit: "cover", borderRadius: "var(--r-xs)", flex: "none" }} />
          : ext ? <span aria-hidden="true" style={{ fontSize: "var(--t-micro)", fontWeight: "700" }}>{ext}</span>
            : <FileText {...ICON} size={14} style={{ flex: "none" }} />}
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.label}
        {item.detail ? <span style={{ opacity: ".7" }}>{" · " + item.detail}</span> : null}
      </span>
      {busy ? null : (
        <button type="button" className="rm-focus" onClick={onRemove} aria-label={"Quitar " + item.label} title="Quitar"
          style={{ width: "24px", height: "24px", flex: "none", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "var(--r-circle)", cursor: "pointer", color: "#FFFFFF" }}>
          <X {...ICON} size={13} />
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
      style={{ margin: "0", padding: "6px", background: "var(--c-card)", borderRadius: "var(--r-xl)", boxShadow: "0 20px 40px -20px rgba(18,19,26,.35), 0 0 0 1px rgba(18,19,26,.06)", display: "flex", flexDirection: "column", gap: "2px" }}>
      {items.map((it, i) => (it.separator ? <div key={"s" + i} role="separator" style={{ height: "1px", margin: "4px 6px", background: "var(--c-line)" }} /> : (
        <button key={it.id} type="button" role="menuitem" className="rm-item" disabled={it.disabled} onClick={() => { onClose(); it.run(); }} aria-checked={it.checked ? "true" : undefined}
          style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "38px", padding: "6px 10px", background: it.checked ? "var(--c-sunken)" : "transparent", border: "0", borderRadius: "var(--r-sm)", cursor: it.disabled ? "default" : "pointer", textAlign: "left", fontSize: "var(--t-ui)", color: it.disabled ? "#8C91A0" : "var(--c-text)" }}>
          <span style={{ width: "18px", flex: "none", display: "grid", placeItems: "center", color: "var(--c-text-2)" }}>{it.icon}</span>
          <span style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: it.checked ? "600" : "500" }}>{it.label}</span>
            {it.hint ? <span style={{ fontSize: "var(--t-caption)", color: "var(--c-text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.hint}</span> : null}
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
  const { bots, missions } = useStore();
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
  const live = useMissionLive(sent?.id);

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
    if (sent && DONE.includes(room.mission?.status) && !live.length) setSent(null);
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
  const recentName = (m) => (m.conversation ? (bots.find((b) => b.id === m.botIds?.[0])?.name || "Chat") + " · " + (m.title || m.prompt || "Conversación") : placeName(m));

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
  const streaming = live.map((v) => v.text).join("");
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
  const placeholder = replyIn ? `Responder en ${recentName(replyIn)}…` : target === "equipo" ? "Pídele algo a tu equipo" : `Pregúntale a ${who}`;
  const atlas = bots.find((b) => b.id === "atlas") || null;
  const targetBot = target === "equipo" ? atlas : team.find((b) => b.id === target) || null;
  // «+ Captura»: the window you came from, another window or an area of the screen.
  const shotItems = [
    ...(source ? [{ id: "win", icon: <AppWindow {...ICON} />, label: `Captura de ${source.app}`, hint: "Una imagen de esa ventana", run: () => shot("win", "Captura de " + source.app, () => api.captureWindow()) }] : []),
    { id: "other", icon: <LayoutGrid {...ICON} />, label: "Captura de otra ventana…", run: () => setMenu("windows") },
    { id: "area", icon: <Crop {...ICON} />, label: "Captura de una zona de la pantalla", hint: "Arrastra para elegirla · Esc cancela", run: () => shot("area", "Zona de la pantalla", () => api.captureArea()) },
  ];
  // «Para …»: the team (Atlas coordinates) or one bot.
  const targetItems = [
    { id: "equipo", icon: atlas ? <BotPresence bot={atlas} size={14} /> : <Plus {...ICON} />, label: "Tu equipo", hint: (atlas?.name || "Atlas") + " decide quién lo hace", checked: target === "equipo" && !replyIn, run: () => { setTarget("equipo"); setReplyIn(null); } },
    ...team.map((b) => ({ id: b.id, icon: <BotPresence bot={b} size={14} />, label: b.name, hint: b.role, checked: target === b.id && !replyIn, run: () => { setTarget(b.id); setReplyIn(null); } })),
  ];
  const pill = { height: "32px", padding: "0 12px", display: "inline-flex", alignItems: "center", gap: "8px", border: "1px solid rgb(var(--c-ink-rgb) / .12)", borderRadius: "var(--r-pill)", background: "var(--c-card)", color: "var(--c-text-2)", fontSize: "var(--t-meta)", cursor: "pointer", whiteSpace: "nowrap" };
  const canSend = (text.trim() || attached.some((a) => a.file)) && !busy && !attached.some((a) => a.status === "busy");
  const recentWhen = (m) => { const at = m.updatedAt || m.createdAt; return at && new Date(at).toDateString() === new Date().toDateString() ? new Date(at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : ago(at); };
  const dot = (b, size) => (b ? <BotFace bot={b} size={Math.max(16, size)} decorative /> : <span aria-hidden="true" style={{ flex: "none", width: size + "px", height: size + "px", background: "var(--c-line-strong)", borderRadius: "var(--r-xs)" }} />);

  return (
    <div style={{ padding: `${PAD_TOP}px 18px ${PAD_BOTTOM}px 18px`, boxSizing: "border-box" }}>
      <style>{NO_SCROLL}</style>
      <section ref={card} key={shown} className="c-quick c-ring" role="dialog" aria-label="Pregunta rápida" style={{ boxSizing: "border-box", maxHeight: `calc(100vh - ${PAD_TOP + PAD_BOTTOM}px)`, overflowY: "auto", scrollbarWidth: "none", display: "flex", flexDirection: "column", borderRadius: "var(--r-2xl)", background: "var(--c-card)", boxShadow: "0 2px 6px rgba(18,19,26,.08), 0 40px 90px -30px rgba(18,19,26,.55)", color: "var(--c-text)", animation: "sheet .25s ease-out" }}>
        <form onSubmit={send} style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 10px 10px 18px" }}>
            <img src="/colmena-icon-128.png" alt="" width="28" height="28" style={{ display: "block", width: "28px", height: "28px", flex: "none", WebkitAppRegion: "drag" }} />
            <label style={{ flex: "1", display: "flex", minWidth: 0 }}>
              <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Pídele algo a tu equipo"}</span>
              <textarea className="c-bare" ref={input} rows="1" value={text} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} disabled={busy} placeholder={placeholder}
                style={{ flex: "1", minWidth: "0", minHeight: "52px", maxHeight: "150px", padding: "14px 0", border: "0", resize: "none", fontSize: "var(--t-title)", lineHeight: "1.3", background: "transparent", fieldSizing: "content", color: "var(--c-text)" }} />
            </label>
            <button type="submit" aria-label="Enviar" title="Enviar (Intro) · Ctrl+Intro: enviar y abrir en Colmena" disabled={!canSend} style={{ width: "46px", height: "46px", flex: "none", display: "grid", placeItems: "center", border: "0", borderRadius: "var(--r-circle)", cursor: canSend ? "pointer" : "default", background: "var(--c-btn)", color: "var(--c-btn-text)", opacity: canSend || busy ? 1 : 0.35, transition: "opacity .2s ease" }}>
              {busy ? <LoaderCircle {...ICON} size={18} className="c-spin" /> : <ArrowUp size={18} weight="bold" />}
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", padding: "0 18px 14px" }}>
            <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{"Con:"}</span>
            {attached.map((a) => <Attached key={a.id} item={a} onRemove={() => drop(a.id)} />)}
            <button type="button" aria-haspopup="menu" aria-expanded={menu === "shot" || menu === "windows" ? "true" : "false"} onClick={() => setMenu(menu === "shot" ? null : "shot")} style={pill}>{"+ Captura"}</button>
            {source ? <button type="button" onClick={bringText} title={`El texto de ${source.app}${source.title ? " — " + source.title : ""}`} style={pill}>{"+ Selección"}</button> : null}
            <button type="button" onClick={attachFiles} style={pill}>{"+ Archivo"}</button>
            <span style={{ flex: "1" }} />
            {replyIn ? (
              <span style={{ ...pill, padding: "0 4px 0 12px", background: "var(--c-hover)", maxWidth: "100%", minWidth: 0, cursor: "default" }}>
                <History {...ICON} size={13} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{"En "}<strong style={{ fontWeight: "600" }}>{recentName(replyIn)}</strong></span>
                <button type="button" onClick={() => setReplyIn(null)} aria-label="Volver a una pregunta nueva" style={{ width: "24px", height: "24px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "var(--r-circle)", cursor: "pointer", color: "var(--c-text-2)" }}><X {...ICON} size={12} /></button>
              </span>
            ) : (
              <button type="button" aria-haspopup="menu" aria-expanded={menu === "to" ? "true" : "false"} onClick={() => setMenu(menu === "to" ? null : "to")} style={{ ...pill, background: "var(--c-hover)" }}>
                {dot(targetBot, 12)}{target === "equipo" ? "Para tu equipo" : `Para ${who}`}
              </button>
            )}
          </div>
          {menu === "shot" ? <div style={{ padding: "0 18px 14px" }}><Menu label="Captura" items={shotItems} onClose={() => setMenu((m) => (m === "shot" ? null : m))} /></div> : null}
          {menu === "to" ? <div style={{ padding: "0 18px 14px" }}><Menu label="Para quién" items={targetItems} onClose={() => setMenu((m) => (m === "to" ? null : m))} /></div> : null}
          {menu === "windows" ? <div style={{ padding: "0 18px 14px" }}><WindowPicker load={loadWindows} onClose={() => setMenu(null)} onPick={(w) => { setMenu(null); shot("w:" + w.id, "Captura de " + w.name.split(" - ").pop(), () => api.captureWindow(w.id)); }} /></div> : null}
          {error ? <p role="alert" style={{ margin: "0", padding: "0 18px 14px", fontSize: "var(--t-meta)", fontWeight: "600", color: "var(--c-error)" }}>{error}</p> : null}
        </form>

        {!sent && !replyIn && recents.length ? (
          <div style={{ display: "flex", flexDirection: "column", padding: "8px", borderTop: "1px solid rgb(var(--c-ink-rgb) / .07)" }}>
            <span style={{ padding: "8px 10px 4px", fontSize: "var(--t-caption)", fontWeight: "600", color: "var(--c-text-3)" }}>{"O sigue una conversación"}</span>
            {recents.slice(0, 3).map((m) => {
              const b = m.conversation ? bots.find((x) => x.id === m.botIds?.[0]) : null;
              return (
                <button key={m.id} type="button" className="rm-item" onClick={() => { setReplyIn(m); requestAnimationFrame(() => input.current?.focus()); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", minHeight: "44px", padding: "0 10px", border: "0", borderRadius: "var(--r-md)", background: "transparent", cursor: "pointer", textAlign: "left", color: "var(--c-text)" }}>
                  {dot(b, 16)}
                  <span style={{ flex: "1", minWidth: 0, fontSize: "var(--t-ui)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.conversation ? recentName(m) : "# " + (m.room || m.title || "sala")}</span>
                  <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{recentWhen(m)}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {sent ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "18px 20px", borderTop: "1px solid rgb(var(--c-ink-rgb) / .07)", animation: "fade .3s ease-out" }}>
            <div role="status" style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "var(--t-body)" }}>
              {bot ? <BotFace bot={bot} size={20} state={done ? null : "work"} decorative /> : null}
              <span><strong style={{ fontWeight: "600" }}>{bot?.name || "Tu equipo"}</strong>{pasted ? ` · pegado en ${pasted}.` : done ? " ha terminado." : sent.conversation ? " está en ello" : " está repartiendo el trabajo"}</span>
              {done ? null : (
                <span aria-hidden="true" style={{ display: "inline-flex", gap: "3px" }}>
                  {[0, 0.2, 0.4].map((d) => <span key={d} style={{ width: "4px", height: "4px", borderRadius: "var(--r-circle)", background: "#12131A", animation: `dots 1.2s ${d}s infinite` }} />)}
                </span>
              )}
            </div>
            {!done && !reply ? <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-2)" }}>{"Puedes cerrar esto: te avisará cuando lo tenga."}</span> : null}
            {reply || room.mission?.error ? (
              <div style={{ maxHeight: "300px", overflowY: "auto", padding: "14px 16px", borderRadius: "var(--r-lg)", background: "var(--c-hover)", fontSize: "var(--t-body)", lineHeight: "1.5" }}>
                {!reply && room.mission?.error ? <p role="alert" style={{ margin: "0", fontWeight: "600", color: "var(--c-error)" }}>{room.mission.error}</p>
                  : streaming ? <LiveMarkdown text={streaming} size={15} caret streamKey={sent?.id} />
                    : <Markdown text={reply} size={15} />}
              </div>
            ) : null}
            {!sent.conversation && room.mission?.status === "awaiting_plan" ? <span style={{ fontSize: "var(--t-ui)", fontWeight: "600" }}>{"El plan espera tu OK en la sala."}</span> : null}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <button type="button" onClick={() => api?.open(openUrl)} style={{ height: "38px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "6px", border: "0", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-ui)", fontWeight: "600", cursor: "pointer" }}>{"Abrir en Colmena"}<ArrowUpRight {...ICON} size={14} /></button>
              {done && reply && source ? (
                <button type="button" onClick={paste} title={`Copia la respuesta y la pega en ${source.app}`} style={{ height: "38px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "6px", border: "1px solid rgb(var(--c-ink-rgb) / .14)", borderRadius: "var(--r-pill)", background: "var(--c-card)", fontSize: "var(--t-ui)", cursor: "pointer", color: "var(--c-text)" }}>
                  <ClipboardPaste {...ICON} size={14} />{`Pegar en ${source.app}`}
                </button>
              ) : null}
              <button type="button" onClick={() => { setSent(null); setPasted(null); input.current?.focus(); }} style={{ height: "38px", padding: "0 14px", border: "1px solid rgb(var(--c-ink-rgb) / .14)", borderRadius: "var(--r-pill)", background: "var(--c-card)", fontSize: "var(--t-ui)", cursor: "pointer", color: "var(--c-text)" }}>{"Otra pregunta"}</button>
            </div>
          </div>
        ) : null}

        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", padding: "10px 18px", background: "var(--c-hover)", fontSize: "var(--t-meta)", color: "var(--c-text-3)", WebkitAppRegion: "drag" }}>
          <span>{"Alt Espacio desde cualquier app"}</span><span>{"Intro envía"}</span><span>{"Ctrl Intro envía y abre Colmena"}</span><span>{"Esc cierra"}</span>
          {source && !attached.length && !sent ? <span>{"Vienes de "}<strong style={{ color: "var(--c-text-2)", fontWeight: "600" }}>{source.app}</strong></span> : null}
        </div>
      </section>
    </div>
  );
}
