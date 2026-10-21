import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Highlight, matchBots, mentionAt, mentionedBots, norm } from "../components/home/shared.jsx";
import { useStore } from "../lib/store.jsx";
import { get, post } from "../lib/api.js";
import { withMessage } from "../lib/reveal.js";
import { navigate } from "../lib/router.jsx";
import { botById } from "../lib/bots.js";
import { roomUrl, shortDate } from "../lib/format.js";
import { PLACES } from "../components/v2/Rail.jsx";

// «Buscar o pedir» (Ctrl+K, or the window event 'colmena:palette' with detail.text):
// a calm card over whatever you are doing, in the Colmena 2.0 language. Type to find chats,
// rooms, files and bots; the first row always asks your team, so you never leave the place
// you were in to ask for something. Esc closes.

const KIND_WORD = { document: "documento", table: "tabla", slides: "presentación", design: "diseño", code: "código", sheet: "hoja" };

const GROUP = (first) => ({ padding: first ? "10px 14px 6px" : "16px 14px 6px", fontSize: "12px", fontWeight: "500", color: "#6B6F7A" });
const KBD = { font: "500 12px/1 'Geist Mono', monospace", padding: "5px 8px", borderRadius: "8px", background: "rgba(18,19,26,.05)", color: "#5C606C" };
const KBD_ON = { font: "500 12px/1 'Geist Mono', monospace", padding: "5px 8px", borderRadius: "8px", background: "#FFFFFF", color: "#12131A" };
const ICON = { flex: "none", margin: "0 5px" };
const MUTED = { color: "#6B6F7A" };

const optionStyle = (on, tall) => (on
  ? { display: "flex", alignItems: "center", gap: "12px", minHeight: tall ? "54px" : "48px", padding: "0 14px", background: "#F4F4F0", borderRadius: "16px", cursor: "pointer" }
  : { display: "flex", alignItems: "center", gap: "12px", minHeight: tall ? "54px" : "48px", padding: "0 14px", borderRadius: "16px", cursor: "pointer" });

const ChatIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true" style={ICON}><path d="M4 5h11v8H8l-4 3z" /><path d="M15 9h5v8l-3-2h-6v-2" /></svg>;
const MissionIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={ICON}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></svg>;
const TableIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={ICON}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M9 10v9" /></svg>;
const FileIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true" style={ICON}><path d="M6 3h8l4 4v14H6z" /></svg>;
const ClockIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={ICON}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>;
const PauseIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={ICON}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>;
const PlayIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={ICON}><path d="M7 5v14l12-7z" /></svg>;

// Lucide code-xml, like the rail's «Código».
const CodeIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={ICON}><path d="m18 16 4-4-4-4" /><path d="m6 8-4 4 4 4" /><path d="m14.5 4-5 16" /></svg>;
const short = (s, n = 48) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

export default function CommandPalette() {
  const store = useStore();
  const { bots, missions, artifacts, paused } = store;
  const team = useMemo(() => bots.filter((b) => b.enabled !== false), [bots]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [cycled, setCycled] = useState(null); // bot chosen with Tab
  const [active, setActive] = useState(0);
  const [results, setResults] = useState(null);
  const [searchFailed, setSearchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);
  const restore = useRef(null);
  const list = useRef(null);

  const show = useCallback((initial = "") => {
    restore.current = document.activeElement;
    setText(initial);
    setCaret(initial.length);
    setCycled(null);
    setActive(0);
    setError(null);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    const el = restore.current;
    restore.current = null;
    if (el && typeof el.focus === "function" && el !== document.body) requestAnimationFrame(() => el.focus());
  }, []);

  useEffect(() => {
    const onEvent = (e) => show(e?.detail?.text || "");
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else show("");
      }
    };
    window.addEventListener("colmena:palette", onEvent);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("colmena:palette", onEvent);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, show, close]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => input.current?.focus());
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Text without @mentions is what we search and what we ask.
  const mention = open ? mentionAt(text, caret) : null;
  const mentioned = mentionedBots(text, team);
  const plain = text.replace(/@[\p{L}\p{N}_-]+/gu, "").replace(/\s+/g, " ").trim();
  const bot = mentioned[0] || cycled || botById(team, "nora") || team.find((b) => b.id !== "atlas") || team[0];
  const atlas = botById(team, "atlas");
  const soloFirst = mentioned.length > 0 || !!cycled;

  // Search (debounced). Falls back to the local state when /api/search is unavailable.
  useEffect(() => {
    if (!open) return;
    const q = plain;
    if (!q) {
      setResults(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      get("/search?q=" + encodeURIComponent(q))
        .then((r) => {
          if (!alive) return;
          setResults(r || {});
          setSearchFailed(false);
        })
        .catch(() => {
          if (!alive) return;
          setSearchFailed(true);
          setResults(null);
        });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [plain, open]);

  // «Código» tasks are found here too (their own store: /api/code).
  const [codeTasks, setCodeTasks] = useState([]);
  useEffect(() => {
    if (!open) return;
    get("/code").then((d) => setCodeTasks((d.projects || []).flatMap((p) => p.tasks.map((t) => ({ ...t, project: p.name }))))).catch(() => setCodeTasks([]));
  }, [open]);

  const goto = useMemo(() => {
    const q = norm(plain);
    let src = results;
    if (!plain) {
      const recent = missions
        .filter((m) => m.status !== "cancelled")
        .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))
        .slice(0, 4);
      src = { missions: recent, artifacts: [], files: [], bots: [] };
    } else if (!src) {
      const has = (s) => norm(s).includes(q);
      src = {
        missions: missions.filter((m) => has(m.title) || has(m.room) || has(m.prompt)),
        artifacts: artifacts.filter((a) => has(a.title)),
        files: [],
        bots: team.filter((b) => has(b.name) || has(b.role)),
      };
    }
    const items = [];
    for (const m of (src.missions || []).slice(0, 4)) {
      const owner = botById(bots, m.botIds?.[0]);
      const chat = m.conversation || m.mode === "solo";
      items.push({
        key: "m:" + m.id,
        icon: chat ? <ChatIcon /> : <MissionIcon />,
        label: chat
          ? <>{`Chat con ${owner?.name || "un bot"} · `}<Highlight text={m.title || m.prompt} query={plain} /></>
          : <><Highlight text={m.title || m.prompt} query={plain} />{m.room ? <span style={MUTED}>{" · #" + m.room}</span> : null}</>,
        right: shortDate(m.updatedAt || m.createdAt) || "Misión",
        run: () => navigate(m.status ? roomUrl(m) : `/misiones/${m.id}`),
      });
    }
    // Messages found by their words: open the conversation at that message (OpenClaw search).
    for (const hit of (src.messages || []).slice(0, 4)) {
      const m = missions.find((x) => x.id === hit.missionId);
      if (!m) continue;
      const who = hit.role === "user" ? "Tú" : botById(bots, hit.botId)?.name || "Un bot";
      items.push({
        key: "msg:" + hit.id,
        icon: <ChatIcon />,
        label: <><span style={{ fontWeight: "600" }}>{who + ": "}</span><Highlight text={hit.snippet} query={plain} /><span style={MUTED}>{" · " + (m.conversation ? m.title || "chat" : "#" + (m.room || m.title))}</span></>,
        right: shortDate(hit.at) || "Mensaje",
        run: () => navigate(withMessage(roomUrl(m), hit.id)),
      });
    }
    for (const t of (plain ? codeTasks.filter((t) => norm(t.title).includes(q) || norm(t.project).includes(q)) : []).slice(0, 4)) {
      items.push({
        key: "code:" + t.id,
        icon: <CodeIcon />,
        label: <><Highlight text={t.title} query={plain} /><span style={MUTED}>{" · " + t.project}</span></>,
        right: "Código",
        run: () => navigate("/codigo/" + t.id),
      });
    }
    for (const a of (src.artifacts || []).slice(0, 3)) {
      const owner = botById(bots, a.botId);
      items.push({
        key: "a:" + a.id,
        icon: <TableIcon />,
        label: <><Highlight text={a.title} query={plain} />{" "}<span style={MUTED}>{`· ${KIND_WORD[a.kind] || "entregable"}${owner ? " de " + owner.name : ""}`}</span></>,
        right: "Archivo",
        run: () => navigate(`/archivo?archivo=${encodeURIComponent(a.id)}`),
      });
    }
    for (const f of (src.files || []).slice(0, 3)) {
      const name = typeof f === "string" ? f : f.name || f.path || "";
      const m = f.missionId ? missions.find((x) => x.id === f.missionId) : null;
      items.push({
        key: "f:" + (f.id || f.path || name),
        icon: <FileIcon />,
        mono: true,
        label: <Highlight text={name} query={plain} />,
        right: "Archivo",
        run: () => navigate(m ? roomUrl(m) : f.missionId ? `/encargo/${f.missionId}` : "/archivo"),
      });
    }
    for (const b of (src.bots || []).slice(0, 3)) {
      const full = botById(bots, b.id) || b;
      items.push({
        key: "b:" + b.id,
        icon: <Avatar bot={full} size={28} />,
        label: <><Highlight text={full.name} query={plain} />{full.role ? <span style={MUTED}>{" · " + full.role}</span> : null}</>,
        right: "Bot",
        run: () => navigate(`/chat/${b.id}`),
      });
    }
    return items;
  }, [plain, results, missions, artifacts, team, bots, codeTasks]);

  const createMission = async (mode) => {
    const prompt = plain;
    if (!prompt || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await store.run(() => post("/missions", { prompt, mode, botIds: mode === "solo" && bot ? [bot.id] : [], safety: "preguntar", attachments: [] }));
      const m = created?.mission || created;
      close();
      navigate(m?.id ? (mode === "solo" ? roomUrl(m) : `/encargo/${m.id}`) : "/");
    } catch (e) {
      setError(e.message || "No se pudo crear la misión.");
    } finally {
      setBusy(false);
    }
  };
  const togglePause = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await store.run(() => post("/control", { action: paused ? "resume-all" : "pause-all" }));
      close();
    } catch (e) {
      setError(e.message || "No se pudo cambiar la pausa.");
    } finally {
      setBusy(false);
    }
  };

  const pickBot = (b) => {
    const before = text.slice(0, mention.start);
    const after = text.slice(caret);
    const next = before + `@${b.name} ` + after.replace(/^\s+/, "");
    const pos = before.length + b.name.length + 2;
    setText(next);
    setCaret(pos);
    setCycled(null);
    setActive(0);
    requestAnimationFrame(() => input.current?.setSelectionRange(pos, pos));
  };

  // Flat option list (order = keyboard order).
  const options = [];
  const groups = [];
  if (mention) {
    const matches = matchBots(team, mention.query).slice(0, 6);
    groups.push({ title: "Elegir bot", items: matches.map((b) => ({ key: "pick:" + b.id, tall: true, icon: <Avatar bot={b} size={28} />, label: <><strong>{b.name}</strong> <span style={MUTED}>{"· " + b.role}</span></>, kbd: "↵", run: () => pickBot(b) })), empty: "Ningún bot de tu equipo se llama así." });
  } else {
    if (plain) {
      // The team first (Enter); a bot you named (@Nora) or chose with Tab comes first instead.
      const solo = { key: "ask", tall: true, icon: <Avatar bot={bot} size={28} />, label: <>{"Pedírselo a "}<strong>{bot?.name}</strong>{`: «${short(plain)}»`}</>, kbd: soloFirst ? "↵" : "Tab", run: () => createMission("solo") };
      const teamRow = { key: "team", tall: true, icon: <Avatar bot={atlas} size={28} />, label: <>{"Pedírselo a tu equipo: "}<strong>{`«${short(plain)}»`}</strong><span style={MUTED}>{` · coordina ${atlas?.name || "Atlas"}`}</span></>, kbd: soloFirst ? "Ctrl ↵" : "↵", run: () => createMission("equipo") };
      groups.push({ title: "Pedir", items: soloFirst ? [solo, teamRow] : [teamRow, solo] });
    }
    groups.push({ title: plain ? "Ir a" : "Ir a · recientes", items: goto, empty: plain ? (searchFailed && goto.length === 0 ? "La búsqueda no responde ahora mismo y no hay coincidencias aquí." : "Nada coincide con lo que buscas.") : "Aún no hay misiones." });
    if (!plain) {
      const placeIcon = (p) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={ICON}>{p.icon}</svg>;
      groups.push({ title: "Lugares", items: [...PLACES.map((p) => ({ key: "p:" + p.id, icon: placeIcon(p), label: p.label.join("").replace("-", ""), run: () => { close(); navigate(p.href); } })), { key: "p:ajustes", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" style={ICON}><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>, label: "Ajustes", run: () => { close(); navigate("/ajustes"); } }] });
    }
    groups.push({
      title: "Acciones",
      items: [
        { key: "auto", icon: <ClockIcon />, label: plain ? `Hacerlo una rutina: ${short(plain, 64)}` : "Nueva rutina…", run: () => { close(); navigate("/rutinas?nueva=1"); } },
        { key: "code-new", icon: <CodeIcon />, label: "Nueva tarea de código…", run: () => { close(); navigate("/codigo"); } },
        ...(location.pathname.startsWith("/codigo") ? [{ key: "code-keys", icon: <CodeIcon />, label: "Atajos de Código", kbd: "F1", run: () => { close(); window.dispatchEvent(new Event("colmena:code-shortcuts")); } }] : []),
        paused
          ? { key: "pause", icon: <PlayIcon />, label: "Reanudar a todo el equipo", kbd: "Ctrl ⇧ P", run: togglePause }
          : { key: "pause", icon: <PauseIcon />, label: "Pausar a todo el equipo", kbd: "Ctrl ⇧ P", run: togglePause },
      ],
    });
  }
  for (const g of groups) for (const it of g.items) options.push(it);
  const current = Math.min(active, Math.max(0, options.length - 1));

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current, open]);

  if (!open) return null;

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (mention) {
        // First Esc only closes the bot picker.
        setText(text.slice(0, mention.start) + text.slice(caret));
        setCaret(mention.start);
        return;
      }
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((current + 1) % Math.max(1, options.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((current - 1 + options.length) % Math.max(1, options.length));
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!mention) createMission(soloFirst ? "equipo" : "solo");
    } else if (e.key === "Enter") {
      e.preventDefault();
      options[current]?.run();
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (mention) {
        options[current]?.run();
        return;
      }
      // Cycle the bot of «Pedir a …» (removes a typed @mention so Tab wins).
      const ring = team.filter((b) => b.id !== "atlas");
      if (!ring.length) return;
      const idx = ring.findIndex((b) => b.id === bot?.id);
      const next = ring[(idx + (e.shiftKey ? -1 : 1) + ring.length) % ring.length];
      if (mentioned.length) {
        const cleaned = text.replace(/@[\p{L}\p{N}_-]+\s?/gu, "");
        setText(cleaned);
        setCaret(cleaned.length);
      }
      setCycled(next);
      setActive(0);
    } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      togglePause();
    }
  };

  let index = -1;
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }} style={{ position: "fixed", inset: "0", zIndex: 1000, background: "rgba(18,19,26,.28)", WebkitBackdropFilter: "blur(10px)", backdropFilter: "blur(10px)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "96px 16px 32px", overflowY: "auto", animation: "fade .2s ease-out" }}>
      <div role="dialog" aria-modal="true" aria-label="Buscar o pedir" style={{ width: "min(680px, 100%)", background: "#FFFFFF", borderRadius: "28px", boxShadow: "0 60px 120px -40px rgba(18,19,26,.55), 0 0 0 1px rgba(18,19,26,.06)", overflow: "hidden", animation: "sheet .35s cubic-bezier(.2,.8,.2,1)", display: "flex", flexDirection: "column", fontFamily: "'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#12131A" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "12px", padding: "0 20px", minHeight: "68px", borderBottom: "1px solid rgba(18,19,26,.06)", color: "#6B6F7A" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></svg>
          <input
            ref={input}
            type="text"
            value={text}
            placeholder="Busca un chat, un archivo o un bot… o pide algo"
            aria-label="Buscar o pedir"
            role="combobox"
            aria-expanded="true"
            aria-controls="paleta-resultados"
            aria-autocomplete="list"
            aria-activedescendant={options[current] ? `paleta-${options[current].key}` : undefined}
            onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); setActive(0); setError(null); }}
            onSelect={(e) => setCaret(e.target.selectionStart)}
            onKeyDown={onKeyDown}
            style={{ flex: "1", minWidth: "0", height: "60px", border: "0", outline: "none", background: "transparent", font: "400 21px/1 'Geist', sans-serif", letterSpacing: "-0.01em", color: "#12131A" }}
          />
          <button type="button" onClick={close} aria-label="Cerrar" style={{ ...KBD, border: "0", cursor: "pointer" }}>Esc</button>
        </label>
        <div ref={list} id="paleta-resultados" role="listbox" aria-label="Resultados" style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "2px", maxHeight: "min(60vh, 560px)", overflowY: "auto" }}>
          {groups.map((g, gi) => (
            <div key={g.title} role="group" aria-label={g.title} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={GROUP(gi === 0)}>{g.title}</span>
              {g.items.length === 0 && g.empty ? <span style={{ padding: "8px 14px 10px", fontSize: "14px", color: "#6B6F7A" }}>{g.empty}</span> : null}
              {g.items.map((it) => {
                index += 1;
                const i = index;
                const on = i === current;
                return (
                  <div
                    key={it.key}
                    id={`paleta-${it.key}`}
                    role="option"
                    aria-selected={on ? "true" : "false"}
                    onMouseMove={() => { if (!on) setActive(i); }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => it.run()}
                    style={optionStyle(on, it.tall)}
                  >
                    {it.icon}
                    <span style={it.mono ? { flex: "1", fontFamily: "'Geist Mono', monospace", fontSize: "14px" } : { flex: "1", fontSize: "15px" }}>{it.label}</span>
                    {it.right ? <span style={{ fontSize: "13px", color: "#8A8D96" }}>{it.right}</span> : null}
                    {it.kbd ? <span style={on ? KBD_ON : KBD}>{it.kbd}</span> : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {error ? <p role="alert" style={{ margin: "0", padding: "10px 20px", borderTop: "1px solid rgba(18,19,26,.06)", fontSize: "13px", color: "#B4372A", fontWeight: "600" }}>{error}</p> : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", padding: "12px 20px", background: "rgba(18,19,26,.03)", borderTop: "1px solid rgba(18,19,26,.05)", fontSize: "12px", color: "#6B6F7A" }}>
          <span><strong style={{ color: "#12131A" }}>↑ ↓</strong> moverse</span>
          <span><strong style={{ color: "#12131A" }}>↵</strong> abrir</span>
          <span><strong style={{ color: "#12131A" }}>Tab</strong> pedírselo a un bot</span>
          <span><strong style={{ color: "#12131A" }}>@</strong> elegir bot</span>
        </div>
      </div>
    </div>
  );
}
