import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bot, ChartColumn, Check, ChevronRight, Clock, CodeXml, FileText, File, Hash, Keyboard, MessageCircle, MessageSquareText, Pause, Play, Search, Settings2, Sparkles, Stethoscope, Undo2, UsersRound } from "lucide-react";
import { Avatar, Highlight, matchBots, mentionAt, mentionedBots } from "../components/home/shared.jsx";
import { useStore } from "../lib/store.jsx";
import { get, patch, post } from "../lib/api.js";
import { withMessage } from "../lib/reveal.js";
import { navigate } from "../lib/router.jsx";
import { botById } from "../lib/bots.js";
import { roomUrl, shortDate } from "../lib/format.js";
import { parseQuery, rank } from "../lib/palette.js";
import { isHidden, reversible, undoLast, useToasts } from "../lib/undoToast.js";
import { PLACES } from "../components/v2/Rail.jsx";
import { SECTIONS, searchSettings, SECTION_OF } from "../components/v2/settings/sections.js";
import { hitUrl } from "../components/v2/people/ShareSearch.jsx";

// «Buscar o pedir» (Ctrl+K, or the window event 'colmena:palette' with detail.text), T3 Code's
// CommandPalette in Colmena's words: one box finds chats, rooms, messages, deliverables, bots,
// Código tasks and every setting, grouped; the first row asks your team, so you never leave
// the place you were in to ask for something. «>» shows only actions (nuevo chat, nueva tarea,
// ir a…, cambiar el modelo…); «Ir a…» and «Cambiar el modelo…» open their own list and ⌫ on
// an empty box goes back. ↑↓ move, ↵ opens, Tab picks the bot of «Pedir», Esc closes.

const KIND_WORD = { document: "documento", table: "tabla", slides: "presentación", design: "diseño", code: "código", sheet: "hoja" };
const GROUP = (first) => ({ padding: first ? "10px 14px 6px" : "16px 14px 6px", fontSize: "12px", fontWeight: "500", color: "#6B6F7A" });
const KBD = { font: "500 12px/1 'Geist Mono', monospace", padding: "5px 8px", borderRadius: "8px", background: "rgba(18,19,26,.05)", color: "#5C606C", whiteSpace: "nowrap" };
const KBD_ON = { ...KBD, background: "#FFFFFF", color: "#12131A" };
const MUTED = { color: "#6B6F7A" };
const ic = (Icon) => <Icon size={18} strokeWidth={2} aria-hidden="true" style={{ flex: "none", margin: "0 5px" }} />;

const optionStyle = (on, tall) => ({ display: "flex", alignItems: "center", gap: "12px", minHeight: tall ? "54px" : "48px", padding: "0 14px", borderRadius: "16px", cursor: "pointer", ...(on ? { background: "#F4F4F0" } : {}) });
const short = (s, n = 48) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const isChat = (m) => !!m.conversation || m.mode === "solo";

/** Waits for the chat list to be on screen, then opens «Nuevo chat» in it (ConvList listens). */
function openNewChat() {
  navigate("/chats");
  let tries = 0;
  const look = () => {
    if (document.querySelector("[data-convlist]")) window.dispatchEvent(new Event("colmena:new-conversation"));
    else if (tries++ < 40) setTimeout(look, 50);
  };
  look();
}

export default function CommandPalette() {
  const store = useStore();
  const { bots, missions, artifacts, paused, ai = null, models = [], settings = {} } = store;
  const toasts = useToasts();
  const team = useMemo(() => bots.filter((b) => b.enabled !== false), [bots]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [cycled, setCycled] = useState(null); // bot chosen with Tab
  const [active, setActive] = useState(0);
  const [results, setResults] = useState(null);
  const [peopleHits, setPeopleHits] = useState([]); // conversations with people (/api/peers/search)
  const [searchFailed, setSearchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [menu, setMenu] = useState(null); // {id, title, before}: a list opened from an action
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
    setMenu(null);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    setMenu(null);
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

  const { actionsOnly, query } = parseQuery(menu ? "" : text);
  const typed = menu ? text.trim() : query;
  // Text without @mentions is what we search and what we ask.
  const mention = open && !actionsOnly && !menu ? mentionAt(text, caret) : null;
  const mentioned = mentionedBots(text, team);
  const plain = actionsOnly || menu ? "" : text.replace(/@[\p{L}\p{N}_-]+/gu, "").replace(/\s+/g, " ").trim();
  const bot = mentioned[0] || cycled || botById(team, "nora") || team.find((b) => b.id !== "atlas") || team[0];
  const atlas = botById(team, "atlas");
  const soloFirst = mentioned.length > 0 || !!cycled;

  // Search (debounced). Falls back to the local state when /api/search is unavailable.
  useEffect(() => {
    if (!open) return;
    const q = plain;
    if (!q) {
      setResults(null);
      setPeopleHits([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      get("/peers/search?q=" + encodeURIComponent(q)).then((r) => alive && setPeopleHits(r.hits || [])).catch(() => alive && setPeopleHits([]));
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

  const go = (to) => { close(); navigate(to); };
  const missionRow = (m) => {
    const owner = botById(bots, m.botIds?.[0]);
    const chat = isChat(m);
    return {
      key: "m:" + m.id,
      icon: chat ? (owner ? <Avatar bot={owner} size={28} /> : ic(MessageCircle)) : ic(Hash),
      label: chat
        ? <>{`${owner?.name || "Un bot"} · `}<Highlight text={m.title || m.prompt || "Chat"} query={plain} /></>
        : <><Highlight text={"#" + (m.room || m.title || m.prompt || "sala")} query={plain} />{m.room && m.title && m.title !== m.room ? <span style={MUTED}>{" · " + short(m.title, 40)}</span> : null}</>,
      right: shortDate(m.updatedAt || m.createdAt) || (chat ? "Chat" : "Sala"),
      run: () => go(m.status ? roomUrl(m) : `/misiones/${m.id}`),
    };
  };

  // What the box finds, one group per kind (T3: Threads, Projects, Settings…).
  const found = useMemo(() => {
    let src = results;
    if (!plain) {
      const recent = missions
        .filter((m) => m.status !== "cancelled" && !m.archived)
        .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))
        .slice(0, 5);
      return [{ title: "Recientes", items: recent.map(missionRow), empty: "Aún no hay chats ni salas." }];
    }
    if (!src) {
      src = {
        missions: rank(missions, plain, (m) => [m.title, m.room, m.prompt]),
        artifacts: rank(artifacts, plain, (a) => [a.title, KIND_WORD[a.kind]]),
        files: [],
        bots: rank(team, plain, (b) => [b.name, b.role]),
      };
    }
    const ms = (src.missions || []).map((m) => missions.find((x) => x.id === m.id) || m).filter((m) => !isHidden("mission:" + m.id) && m.status !== "cancelled");
    const groups = [
      { title: "Chats", items: ms.filter(isChat).slice(0, 4).map(missionRow) },
      { title: "Salas", items: ms.filter((m) => !isChat(m)).slice(0, 4).map(missionRow) },
    ];
    // Messages found by their words: open the conversation at that message (OpenClaw search).
    const messages = [];
    for (const hit of (src.messages || []).slice(0, 4)) {
      const m = missions.find((x) => x.id === hit.missionId);
      if (!m) continue;
      const who = hit.role === "user" ? "Tú" : botById(bots, hit.botId)?.name || "Un bot";
      messages.push({
        key: "msg:" + hit.id,
        icon: ic(MessageSquareText),
        label: <><span style={{ fontWeight: "600" }}>{who + ": "}</span><Highlight text={hit.snippet} query={plain} /><span style={MUTED}>{" · " + (m.conversation ? m.title || "chat" : "#" + (m.room || m.title))}</span></>,
        right: shortDate(hit.at) || "Mensaje",
        run: () => go(withMessage(roomUrl(m), hit.id)),
      });
    }
    groups.push({ title: "Mensajes", items: messages });
    // What was said with people (on this computer only): opens that conversation or thread at the message.
    groups.push({
      title: "Con personas",
      items: peopleHits.slice(0, 4).map((h) => ({
        key: "peer:" + h.id, icon: ic(UsersRound),
        label: <><span style={{ fontWeight: "600" }}>{(h.bot ? h.bot : h.author.split(" ")[0]) + ": "}</span><Highlight text={h.snippet} query={plain.split(/\s+/)[0]} /><span style={MUTED}>{" · " + (h.kind === "dm" ? h.title : "#" + h.title) + (h.thread ? " · hilo" : "")}</span></>,
        right: shortDate(h.at) || "Personas",
        run: () => go(hitUrl(h)),
      })),
    });
    groups.push({
      title: "Tareas de Código",
      items: rank(codeTasks.filter((t) => !isHidden("codetask:" + t.id)), plain, (t) => [t.title, t.project]).slice(0, 4).map((t) => ({
        key: "code:" + t.id, icon: ic(CodeXml),
        label: <><Highlight text={t.title} query={plain} /><span style={MUTED}>{" · " + t.project}</span></>,
        right: "Código", run: () => go("/codigo/" + t.id),
      })),
    });
    const deliverables = (src.artifacts || []).slice(0, 3).map((a) => {
      const owner = botById(bots, a.botId);
      return {
        key: "a:" + a.id, icon: ic(FileText),
        label: <><Highlight text={a.title} query={plain} />{" "}<span style={MUTED}>{`· ${KIND_WORD[a.kind] || "entregable"}${owner ? " de " + owner.name : ""}`}</span></>,
        right: "Archivo", run: () => go(`/archivo?archivo=${encodeURIComponent(a.id)}`),
      };
    });
    for (const f of (src.files || []).slice(0, 3)) {
      const name = typeof f === "string" ? f : f.name || f.path || "";
      const m = f.missionId ? missions.find((x) => x.id === f.missionId) : null;
      deliverables.push({ key: "f:" + (f.id || f.path || name), icon: ic(File), mono: true, label: <Highlight text={name} query={plain} />, right: "Archivo", run: () => go(m ? roomUrl(m) : f.missionId ? `/encargo/${f.missionId}` : "/archivo") });
    }
    groups.push({ title: "Entregables y archivos", items: deliverables });
    groups.push({
      title: "Bots",
      items: (src.bots || []).slice(0, 3).map((b) => {
        const full = botById(bots, b.id) || b;
        return { key: "b:" + b.id, icon: <Avatar bot={full} size={28} />, label: <><Highlight text={full.name} query={plain} />{full.role ? <span style={MUTED}>{" · " + full.role}</span> : null}</>, right: "Bot", run: () => go(`/chat/${b.id}`) };
      }),
    });
    groups.push({
      title: "Ajustes",
      items: searchSettings(plain, undefined, 4).map((s) => {
        const Icon = SECTION_OF[s.section].icon;
        return { key: "s:" + s.key, icon: ic(Icon), label: <Highlight text={s.label} query={plain} />, right: s.isSection ? "Ajustes" : SECTION_OF[s.section].label, run: () => go(s.href) };
      }),
    });
    return groups;
  }, [plain, results, peopleHits, missions, artifacts, team, bots, codeTasks]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const was = paused;
    try {
      await store.run(() => post("/control", { action: was ? "resume-all" : "pause-all" }));
      close();
      reversible({ id: "pause-all", text: was ? "El equipo sigue" : "Equipo en pausa", undo: () => store.run(() => post("/control", { action: was ? "pause-all" : "resume-all" })) });
    } catch (e) {
      setError(e.message || "No se pudo cambiar la pausa.");
    } finally {
      setBusy(false);
    }
  };
  // «Cambiar el modelo»: the team's AI (Ajustes › Inteligencia › Piensan con) and, with
  // ChatGPT, its model; the change can be undone for five seconds.
  const setPrimary = async (id, label) => {
    const before = ai?.primary;
    try {
      await store.run(() => patch("/ai/engines", { primary: id }));
      close();
      reversible({ id: "primary", text: `Ahora piensan con ${label}`, undo: () => store.run(() => patch("/ai/engines", { primary: before })) });
    } catch (e) { setError(e.message); }
  };
  const setModel = async (slug, label) => {
    const before = settings.model;
    try {
      await store.run(() => patch("/settings", { model: slug }));
      close();
      reversible({ id: "model", text: `Ahora usan ${label}`, undo: () => store.run(() => patch("/settings", { model: before })) });
    } catch (e) { setError(e.message); }
  };
  const openMenu = (id, title) => { setMenu({ id, title, before: text }); setText(""); setCaret(0); setActive(0); };

  // Actions (T3's «Actions» group): shown on their own after «>», and among the results when
  // their words match what you typed.
  const actions = useMemo(() => {
    const inCode = location.pathname.startsWith("/codigo");
    const list = [
      { key: "new-chat", icon: ic(MessageCircle), label: "Nuevo chat", terms: ["Nuevo chat", "conversación hablar bot privado incógnito"], kbd: inCode ? null : "Ctrl N", run: () => { close(); openNewChat(); } },
      { key: "code-new", icon: ic(CodeXml), label: "Nueva tarea de código", terms: ["Nueva tarea de código", "programar proyecto bruno"], kbd: inCode ? "Ctrl N" : null, run: () => go("/codigo") },
      { key: "auto", icon: ic(Clock), label: "Nueva rutina", terms: ["Nueva rutina", "automatización cada día programar horario"], run: () => go("/rutinas?nueva=1") },
      { key: "new-bot", icon: ic(Bot), label: "Nuevo bot", terms: ["Nuevo bot", "crear bot equipo colmena"], run: () => go("/colmena/nuevo") },
      { key: "goto", icon: ic(ChevronRight), label: "Ir a…", terms: ["Ir a", "lugar sección ajustes abrir"], submenu: true, run: () => openMenu("goto", "Ir a") },
      ...(ai?.engines?.some((e) => e.connected) || models.length ? [{ key: "model", icon: ic(Sparkles), label: "Cambiar el modelo…", terms: ["Cambiar el modelo", "ia chatgpt claude opencode piensan con gpt"], submenu: true, run: () => openMenu("model", "Cambiar el modelo") }] : []),
      paused
        ? { key: "pause", icon: ic(Play), label: "Reanudar a todo el equipo", terms: ["Reanudar a todo el equipo", "seguir continuar"], kbd: "Ctrl ⇧ P", run: togglePause }
        : { key: "pause", icon: ic(Pause), label: "Pausar a todo el equipo", terms: ["Pausar a todo el equipo", "parar detener"], kbd: "Ctrl ⇧ P", run: togglePause },
      { key: "doctor", icon: ic(Stethoscope), label: "Comprobar que todo funciona", terms: ["Comprobar que todo funciona", "diagnóstico problema error lento doctor"], run: () => go("/ajustes/diagnostico") },
      { key: "usage", icon: ic(ChartColumn), label: "Ver lo que gastan", terms: ["Ver lo que gastan", "uso tokens límite plan caché"], run: () => go("/ajustes/uso") },
      { key: "settings", icon: ic(Settings2), label: "Abrir Ajustes", terms: ["Abrir Ajustes", "configuración preferencias"], run: () => go("/ajustes") },
      ...(inCode ? [{ key: "code-keys", icon: ic(Keyboard), label: "Atajos de Código", terms: ["Atajos de Código", "teclado"], kbd: "F1", run: () => { close(); window.dispatchEvent(new Event("colmena:code-shortcuts")); } }] : []),
    ];
    const last = toasts.filter((t) => t.undo).at(-1);
    if (last) list.unshift({ key: "undo", icon: ic(Undo2), label: <>{"Deshacer: "}<span style={MUTED}>{short(last.text, 40)}</span></>, terms: ["Deshacer " + last.text], kbd: "Ctrl Z", run: () => { close(); undoLast(); } });
    return list;
  }, [paused, ai, models, toasts, text]); // eslint-disable-line react-hooks/exhaustive-deps

  // The list of an action («Ir a…», «Cambiar el modelo…»).
  const menuItems = useMemo(() => {
    if (!menu) return [];
    if (menu.id === "goto") {
      const placeIcon = (p) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", margin: "0 5px" }}>{p.icon}</svg>;
      const places = PLACES.map((p) => ({ key: "p:" + p.id, icon: placeIcon(p), label: p.label.join(""), terms: [p.label.join("")], group: "Lugares", run: () => go(p.href) }));
      const sections = SECTIONS.map((s) => ({ key: "p:s:" + s.id, icon: ic(s.icon), label: s.label, terms: [s.label, s.lead], group: "Ajustes", run: () => go("/ajustes/" + s.id) }));
      return rank([...places, ...sections], typed);
    }
    const engines = (ai?.engines || []).filter((e) => e.connected);
    const items = engines.map((e) => ({ key: "e:" + e.id, icon: e.id === ai?.primary ? ic(Check) : ic(Sparkles), label: <>{"Pensar con "}<strong>{e.label}</strong></>, terms: [e.label, e.detail || ""], group: "IA del equipo", right: e.id === ai?.primary ? "Ahora" : e.detail || "", run: () => (e.id === ai?.primary ? close() : setPrimary(e.id, e.label)) }));
    if (!ai || ai.primary === "openai") {
      for (const m of models.filter((x) => !String(x.slug).includes("/"))) {
        const on = m.slug === settings.model;
        items.push({ key: "gm:" + m.slug, icon: on ? ic(Check) : ic(Sparkles), label: m.label || m.slug, terms: [m.label || m.slug, m.description || ""], group: "Modelo de ChatGPT", right: on ? "Ahora" : null, run: () => (on ? close() : setModel(m.slug, m.label || m.slug)) });
      }
    }
    return rank(items, typed);
  }, [menu, typed, ai, models, settings.model]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const groups = [];
  if (menu) {
    // One group per kind of choice (lugares and ajustes; the team's AI and ChatGPT's model).
    for (const it of menuItems) {
      const g = groups.find((x) => x.title === it.group);
      if (g) g.items.push(it); else groups.push({ title: it.group, items: [it] });
    }
    if (!groups.length) groups.push({ title: menu.title, items: [], empty: menu.id === "model" ? "Conecta una IA en Ajustes › Inteligencia." : "Nada se llama así." });
  } else if (mention) {
    const matches = matchBots(team, mention.query).slice(0, 6);
    groups.push({ title: "Elegir bot", items: matches.map((b) => ({ key: "pick:" + b.id, tall: true, icon: <Avatar bot={b} size={28} />, label: <><strong>{b.name}</strong> <span style={MUTED}>{"· " + b.role}</span></>, kbd: "↵", run: () => pickBot(b) })), empty: "Ningún bot de tu equipo se llama así." });
  } else if (actionsOnly) {
    groups.push({ title: "Acciones", items: rank(actions, query), empty: "Ninguna acción se llama así." });
  } else {
    if (plain) {
      // The team first (Enter); a bot you named (@Nora) or chose with Tab comes first instead.
      const solo = { key: "ask", tall: true, icon: <Avatar bot={bot} size={28} />, label: <>{"Pedírselo a "}<strong>{bot?.name}</strong>{`: «${short(plain)}»`}</>, kbd: soloFirst ? "↵" : "Tab", run: () => createMission("solo") };
      const teamRow = { key: "team", tall: true, icon: <Avatar bot={atlas} size={28} />, label: <>{"Pedírselo a tu equipo: "}<strong>{`«${short(plain)}»`}</strong><span style={MUTED}>{` · coordina ${atlas?.name || "Atlas"}`}</span></>, kbd: soloFirst ? "Ctrl ↵" : "↵", run: () => createMission("equipo") };
      groups.push({ title: "Pedir", items: soloFirst ? [solo, teamRow] : [teamRow, solo] });
      const matching = rank(actions, plain).slice(0, 3);
      for (const g of found) if (g.items.length) groups.push(g);
      if (matching.length) groups.push({ title: "Acciones", items: matching });
      if (!found.some((g) => g.items.length) && !matching.length) groups.push({ title: "Ir a", items: [], empty: searchFailed ? "La búsqueda no responde ahora mismo y no hay coincidencias aquí." : "Nada coincide con lo que buscas." });
    } else {
      groups.push({ title: "Acciones", items: actions.slice(0, toasts.some((t) => t.undo) ? 5 : 4) });
      groups.push(...found);
      const placeIcon = (p) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", margin: "0 5px" }}>{p.icon}</svg>;
      groups.push({ title: "Lugares", items: [...PLACES.map((p) => ({ key: "p:" + p.id, icon: placeIcon(p), label: p.label.join(""), run: () => go(p.href) })), { key: "p:ajustes", icon: ic(Settings2), label: "Ajustes", run: () => go("/ajustes") }] });
    }
  }
  const options = [];
  for (const g of groups) for (const it of g.items) options.push(it);
  const current = Math.min(active, Math.max(0, options.length - 1));

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current, open]);

  if (!open) return null;

  const back = () => { const before = menu?.before ?? ""; setMenu(null); setText(before); setCaret(before.length); setActive(0); };
  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (menu) return back();
      if (mention) {
        // First Esc only closes the bot picker.
        setText(text.slice(0, mention.start) + text.slice(caret));
        setCaret(mention.start);
        return;
      }
      close();
    } else if (e.key === "Backspace" && menu && !text) {
      e.preventDefault();
      back();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((current + 1) % Math.max(1, options.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((current - 1 + options.length) % Math.max(1, options.length));
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!mention && !menu && !actionsOnly) createMission(soloFirst ? "equipo" : "solo");
    } else if (e.key === "Enter") {
      e.preventDefault();
      options[current]?.run();
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (mention) {
        options[current]?.run();
        return;
      }
      if (menu || actionsOnly) return;
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

  const placeholder = menu ? (menu.id === "model" ? "Elige con qué piensan…" : "¿Adónde quieres ir?") : "Busca chats, salas, archivos, bots o ajustes… o pide algo. «>» para acciones";
  let index = -1;
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }} style={{ position: "fixed", inset: "0", zIndex: 1000, background: "rgba(18,19,26,.28)", WebkitBackdropFilter: "blur(10px)", backdropFilter: "blur(10px)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "clamp(24px, 10vh, 96px) 16px 32px", overflowY: "auto", animation: "fade .2s ease-out" }}>
      <div role="dialog" aria-modal="true" aria-label="Buscar o pedir" style={{ width: "min(680px, 100%)", background: "#FFFFFF", borderRadius: "28px", boxShadow: "0 60px 120px -40px rgba(18,19,26,.55), 0 0 0 1px rgba(18,19,26,.06)", overflow: "hidden", animation: "sheet .35s cubic-bezier(.2,.8,.2,1)", display: "flex", flexDirection: "column", fontFamily: "'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#12131A" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "12px", padding: "0 20px", minHeight: "68px", borderBottom: "1px solid rgba(18,19,26,.06)", color: "#6B6F7A" }}>
          {menu ? (
            <button type="button" onClick={back} aria-label="Volver" style={{ display: "flex", alignItems: "center", gap: "6px", flex: "none", height: "32px", padding: "0 12px 0 8px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#12131A" }}>
              <ArrowLeft size={14} strokeWidth={2.4} aria-hidden="true" />{menu.title}
            </button>
          ) : actionsOnly ? <span style={{ flex: "none", display: "inline-flex", alignItems: "center", height: "28px", padding: "0 10px", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "12px", fontWeight: 600 }}>Acciones</span> : <Search size={20} strokeWidth={2} aria-hidden="true" />}
          <input
            ref={input}
            type="text"
            value={text}
            placeholder={placeholder}
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
                    <span style={it.mono ? { flex: "1", minWidth: 0, fontFamily: "'Geist Mono', monospace", fontSize: "14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } : { flex: "1", minWidth: 0, fontSize: "15px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
                    {it.right ? <span style={{ flex: "none", fontSize: "13px", color: "#8A8D96" }}>{it.right}</span> : null}
                    {it.submenu ? <ChevronRight size={15} strokeWidth={2.2} color="#9A9DA6" aria-hidden="true" style={{ flex: "none" }} /> : null}
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
          {menu ? <span><strong style={{ color: "#12131A" }}>⌫</strong> volver</span> : <span><strong style={{ color: "#12131A" }}>{">"}</strong> solo acciones</span>}
          {menu || actionsOnly ? null : <span><strong style={{ color: "#12131A" }}>Tab</strong> pedírselo a un bot</span>}
          {menu || actionsOnly ? null : <span><strong style={{ color: "#12131A" }}>@</strong> elegir bot</span>}
          <span><strong style={{ color: "#12131A" }}>Esc</strong> {menu ? "atrás" : "cerrar"}</span>
        </div>
      </div>
    </div>
  );
}
