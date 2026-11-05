import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bot, ChartColumn, Check, ChevronRight, Clock, CodeXml, Keyboard, ListChecks, MessageCircle, MessageSquareText, Pause, Play, Settings2, Sparkles, Stethoscope, Target, Undo2, UsersRound } from "lucide-react";
import { Highlight, matchBots, mentionAt, mentionedBots } from "../components/home/shared.jsx";
import { Shape } from "../components/v3/dia/parts.jsx";
import { ATLAS_FALLBACK, likelyBot } from "../components/v3/dia/route.js";
import { useStore } from "../lib/store.jsx";
import { get, patch, post } from "../lib/api.js";
import { withMessage } from "../lib/reveal.js";
import { navigate } from "../lib/router.jsx";
import { botById } from "../lib/bots.js";
import { ago, roomUrl, shortDate } from "../lib/format.js";
import { parseQuery, rank } from "../lib/palette.js";
import { isHidden, reversible, undoLast, useToasts } from "../lib/undoToast.js";
import { useExpert } from "../lib/expert.js";
import { PLACES } from "../components/v3/Sidebar.jsx";
import { SECTIONS, searchSettings, SECTION_OF } from "../components/v2/settings/sections.js";
import { hitUrl } from "../components/v2/people/ShareSearch.jsx";
import { shareUrl } from "../lib/peers.js";

// Colmena 3 · «Buscar o pedir» (design/V3Buscar.dc.html; Ctrl K, or the window event
// 'colmena:palette' with detail.text). One box finds chats, tareas, archivos, bots, rutinas,
// ajustes and commands, grouped, with tabs that narrow it (Todo · Chats · Tareas · Archivos ·
// Bots · Ajustes · Comandos) and a preview of the selected result on the right. The first row
// asks your team for what you typed (Ctrl Intro from anywhere in the list); Tab hands it to
// one bot instead. «>» shows only commands («Ir a…» and «Cambiar el modelo…» open their own
// list; ⌫ on an empty box goes back); «@» picks a bot or a person. ↑↓ move, Intro opens, Esc closes.

const KIND_WORD = { document: "documento", table: "tabla", slides: "presentación", design: "diseño", code: "código", sheet: "hoja de cálculo" };
const KBD = { font: "500 11.5px/1 'Geist Mono', monospace", color: "#5C606C", whiteSpace: "nowrap" };
const SCOPES = [["todo", "Todo"], ["chats", "Chats"], ["tareas", "Tareas"], ["archivos", "Archivos"], ["bots", "Bots"], ["ajustes", "Ajustes"], ["comandos", "Comandos"]];
const short = (s, n = 48) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const isChat = (m) => !!m.conversation || m.mode === "solo";
const ext = (name) => (String(name || "").split(".").pop() || "").slice(0, 3).toUpperCase();

/** The square at the start of each row: a glyph, an icon or a bot's shape. */
function Tile({ children, dark = false, small = false }) {
  return <span aria-hidden="true" style={{ flex: "none", width: "30px", height: "30px", display: "grid", placeItems: "center", borderRadius: "10px", background: dark ? "#12131A" : "#F1F1EC", font: `600 ${small ? "10px" : "12px"}/1 'Geist', sans-serif`, color: "#3D404A" }}>{children}</span>;
}
const glyph = (g, small) => <Tile small={small}>{g}</Tile>;
const iconTile = (Icon) => <Tile><Icon size={16} strokeWidth={2} /></Tile>;
const botTile = (bot) => <Tile><Shape bot={bot} size={16} /></Tile>;
const pathTile = (d) => <Tile><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg></Tile>;

/** Waits for the chat list to be on screen, then opens «Nuevo chat» in it (Chats listens). */
function openNewChat() {
  navigate("/chats");
  let tries = 0;
  const look = () => {
    if (document.querySelector("[data-convlist], [data-chats-home]")) window.dispatchEvent(new Event("colmena:new-conversation"));
    else if (tries++ < 40) setTimeout(look, 50);
  };
  look();
}

export default function CommandPalette() {
  const store = useStore();
  const { bots, missions, artifacts, automations = [], paused, ai = null, models = [], settings = {}, peers = null } = store;
  const [expert] = useExpert();
  const toasts = useToasts();
  const team = useMemo(() => bots.filter((b) => b.enabled !== false), [bots]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [cycled, setCycled] = useState(null); // bot chosen with Tab
  const [active, setActive] = useState(null); // null: the first result
  const [scope, setScope] = useState("todo");
  const [results, setResults] = useState(null);
  const [peopleHits, setPeopleHits] = useState([]); // conversations with people (/api/peers/search)
  const [codeHits, setCodeHits] = useState([]); // what was said in «Código» tasks (/api/code/search)
  const [searchFailed, setSearchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [menu, setMenu] = useState(null); // {id, title, before}: a list opened from a command
  const input = useRef(null);
  const restore = useRef(null);
  const list = useRef(null);

  const show = useCallback((initial = "") => {
    restore.current = document.activeElement;
    setText(initial);
    setCaret(initial.length);
    setCycled(null);
    setActive(null);
    setScope("todo");
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

  const parsed = parseQuery(menu ? "" : text);
  const actionsOnly = parsed.actionsOnly || (scope === "comandos" && !menu);
  const query = parsed.query;
  const typed = menu ? text.trim() : query;
  // Text without @mentions is what we search and what we ask.
  const mention = open && !parsed.actionsOnly && !menu ? mentionAt(text, caret) : null;
  const mentioned = mentionedBots(text, team);
  const plain = parsed.actionsOnly || menu ? "" : text.replace(/@[\p{L}\p{N}_-]+/gu, "").replace(/\s+/g, " ").trim();
  const soloBot = mentioned.find((b) => b.id !== "atlas") || cycled || null;
  const atlas = botById(team, "atlas") || ATLAS_FALLBACK;
  const likely = likelyBot(plain, team);

  // Search (debounced). Falls back to the local state when /api/search is unavailable.
  useEffect(() => {
    if (!open) return;
    const q = plain;
    if (!q) {
      setResults(null);
      setPeopleHits([]);
      setCodeHits([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      get("/peers/search?q=" + encodeURIComponent(q)).then((r) => alive && setPeopleHits(r.hits || [])).catch(() => alive && setPeopleHits([]));
      // What was said in «Código» tasks (GET /api/code/search; titles come from /api/code below).
      get("/code/search?q=" + encodeURIComponent(q) + "&limit=12").then((r) => alive && setCodeHits((r.hits || []).filter((h) => h.itemId))).catch(() => alive && setCodeHits([]));
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
  const namesOf = (ids = []) => ids.map((id) => botById(bots, id)?.name).filter(Boolean).join(", ");
  const missionRow = (m) => {
    const owner = botById(bots, m.botIds?.[0]);
    const chat = isChat(m);
    const name = chat ? `${owner?.name || "Un bot"} · ${m.title || m.prompt || "Chat"}` : m.room ? "# " + m.room : m.title || m.prompt || "Tarea";
    const when = shortDate(m.updatedAt || m.createdAt);
    return {
      key: "m:" + m.id, scope: chat ? "chats" : "tareas", group: chat ? "Chats" : "Tareas", name,
      icon: chat ? (owner ? botTile(owner) : iconTile(MessageCircle)) : m.room ? glyph("#") : glyph("✓"),
      title: <Highlight text={name} query={plain} />,
      meta: [chat ? m.lastLine : m.room && m.title !== m.room ? m.title : null, m.statusLabel, when].filter(Boolean).join(" · "),
      run: () => go(m.status ? roomUrl(m) : `/misiones/${m.id}`),
      preview: {
        kind: chat ? "Chat" : m.status === "completed" ? "Tarea · hecha" : "Tarea · " + String(m.statusLabel || "").toLowerCase(),
        title: chat ? m.title || "Chat" : m.title || m.room, desc: (chat ? m.lastLine : m.activityLine) || m.prompt || "",
        facts: [[chat ? "Con" : "Bots", namesOf(m.botIds) || "Atlas"], m.room && !chat ? ["Sala", "#" + m.room] : null, ["Último cambio", when || "—"]],
        cta: chat ? "Abrir el chat" : "Abrir la tarea",
      },
    };
  };
  const artifactRow = (a) => {
    const owner = botById(bots, a.botId);
    const word = KIND_WORD[a.kind] || "entregable";
    const name = a.title + (a.format && !String(a.title).includes(".") ? "." + a.format : "");
    return {
      key: "a:" + a.id, scope: "archivos", group: "Archivos", name, icon: glyph(ext(name) || "DOC", true),
      title: <Highlight text={name} query={plain} />, meta: [capital(word), owner?.name, shortDate(a.updatedAt || a.createdAt)].filter(Boolean).join(" · "),
      run: () => go(`/biblioteca/archivos?archivo=${encodeURIComponent(a.id)}`),
      preview: { kind: "Archivo · " + word, title: name, desc: a.summary || (a.room ? `De la sala #${a.room}.` : ""), facts: [["Lo hizo", owner?.name || "—"], a.version ? ["Versiones", String(a.version)] : null, ["Dónde", "Biblioteca › Archivos"]], cta: "Abrir el archivo" },
    };
  };
  const botRow = (b) => ({
    key: "b:" + b.id, scope: "bots", group: "Bots", name: b.name, icon: botTile(b),
    title: <Highlight text={b.name} query={plain} />, meta: [b.role, String(b.statusLabel || "").toLowerCase()].filter(Boolean).join(" · "),
    run: () => go(`/chat/${b.id}`),
    preview: { kind: "Bot", title: b.name, desc: b.instructions ? String(b.instructions).split(/(?<=\.)\s/)[0] : b.role || "", facts: [["Hace", b.role || "—"], ["Ahora", b.statusLabel || "—"], expert && b.model?.label ? ["Modelo", b.model.label] : null], cta: `Hablar con ${b.name}` },
  });
  const routineRow = (r) => {
    const owner = botById(bots, r.botId);
    return {
      key: "r:" + r.id, scope: "tareas", group: "Rutinas", name: r.name || r.prompt, icon: glyph("↻"),
      title: <Highlight text={r.name || r.prompt} query={plain} />, meta: ["Rutina", r.enabled ? "activa" : "en pausa", r.nextRun ? "próxima " + shortDate(r.nextRun) : null].filter(Boolean).join(" · "),
      run: () => go("/trabajo/rutinas"),
      preview: { kind: "Rutina", title: r.name || r.prompt, desc: r.prompt && r.prompt !== r.name ? r.prompt : r.trigger?.sentence ? `Cuando ${r.trigger.sentence}.` : "", facts: [["Cuándo", r.subtitle || r.trigger?.sentence || "—"], ["La hace", owner?.name || "—"], ["Última vez", r.lastRun ? ago(r.lastRun) : "todavía no"]], cta: "Ver la rutina" },
    };
  };
  function codeRow(t) {
    return {
      key: "code:" + t.id, scope: "tareas", group: "Código", name: t.title, icon: glyph("</>", true),
      title: <Highlight text={t.title} query={plain} />, meta: ["Código", t.project, t.statusLabel || t.status].filter(Boolean).join(" · "), run: () => go("/codigo/" + t.id),
      preview: { kind: "Tarea de código", title: t.title, desc: t.summary || "", facts: [["Proyecto", t.project || "—"], ["Estado", t.statusLabel || t.status || "—"]], cta: "Abrir en Código" },
    };
  }

  const createMission = async (mode, who = null) => {
    const prompt = plain;
    if (!prompt || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await store.run(() => post("/missions", { prompt, mode, botIds: mode === "solo" && who ? [who.id] : [], safety: "preguntar", attachments: [] }));
      const m = created?.mission || created;
      close();
      navigate(m?.id ? (mode === "solo" ? roomUrl(m) : `/encargo/${m.id}`) : "/");
    } catch (e) {
      setError(e.message || "No se pudo pedir.");
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
  // «Cambiar el modelo»: the team's AI (Ajustes › Cuentas de IA › Piensan con) and, with
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
  const openMenu = (id, title) => { setMenu({ id, title, before: text }); setText(""); setCaret(0); setActive(null); };

  // Commands (T3's «Actions»): on their own after «>» or in «Comandos», and among the results when their words match.
  const actions = useMemo(() => {
    const inCode = location.pathname.startsWith("/codigo");
    const cmd = (o) => ({ scope: "comandos", group: "Comandos", meta: o.hint || "Comando", ...o, name: o.label, title: o.label, preview: { kind: "Comando", title: o.label, desc: o.hint || "", facts: o.kbd ? [["Atajo", o.kbd]] : [], cta: "Ejecutar" } });
    const out = [
      cmd({ key: "new-chat", icon: iconTile(MessageCircle), label: "Nuevo chat", hint: "Habla con un bot, en privado o de incógnito", terms: ["Nuevo chat", "conversación hablar bot privado incógnito"], kbd: inCode ? null : "Ctrl N", run: () => { close(); openNewChat(); } }),
      cmd({ key: "new-task", icon: iconTile(ListChecks), label: "Nueva tarea", hint: "Un trabajo con plan y entrega", terms: ["Nueva tarea", "encargo trabajo plan"], run: () => go("/trabajo?nueva=1") }),
      cmd({ key: "auto", icon: iconTile(Clock), label: "Nueva rutina", hint: "Algo que se repite solo", terms: ["Nueva rutina", "automatización cada día programar horario"], run: () => go("/trabajo/rutinas?nueva=1") }),
      cmd({ key: "goal", icon: iconTile(Target), label: "Nuevo objetivo", hint: "Una meta a largo plazo", terms: ["Nuevo objetivo", "meta largo plazo"], run: () => go("/trabajo/objetivos?nuevo=1") }),
      cmd({ key: "code-new", icon: iconTile(CodeXml), label: "Nueva tarea de código", hint: "En uno de tus proyectos", terms: ["Nueva tarea de código", "programar proyecto"], kbd: inCode ? "Ctrl N" : null, run: () => go("/codigo") }),
      cmd({ key: "new-bot", icon: iconTile(Bot), label: "Nuevo bot", hint: "Un compañero nuevo para tu equipo", terms: ["Nuevo bot", "crear bot equipo"], run: () => go("/equipo/nuevo") }),
      cmd({ key: "goto", icon: iconTile(ChevronRight), label: "Ir a…", hint: "Un lugar o una sección de Ajustes", terms: ["Ir a", "lugar sección ajustes abrir"], submenu: true, run: () => openMenu("goto", "Ir a") }),
      ...(ai?.engines?.some((e) => e.connected) || models.length ? [cmd({ key: "model", icon: iconTile(Sparkles), label: "Cambiar el modelo…", hint: "Con qué IA piensan tus bots", terms: ["Cambiar el modelo", "ia chatgpt claude opencode piensan con gpt"], submenu: true, run: () => openMenu("model", "Cambiar el modelo") })] : []),
      paused
        ? cmd({ key: "pause", icon: iconTile(Play), label: "Reanudar a todo el equipo", hint: "Todos siguen donde lo dejaron", terms: ["Reanudar a todo el equipo", "seguir continuar"], kbd: "Ctrl ⇧ P", run: togglePause })
        : cmd({ key: "pause", icon: iconTile(Pause), label: "Pausar a todo el equipo", hint: "Para a todos los bots y rutinas al momento; lo hecho se conserva", terms: ["Pausar a todo el equipo", "parar detener"], kbd: "Ctrl ⇧ P", run: togglePause }),
      cmd({ key: "activity", icon: pathTile("M3 12h4l2.5-6 5 12 2.5-6H21"), label: "Ver la actividad", hint: "Qué hace cada bot ahora y qué ha hecho", terms: ["Ver la actividad", "registro qué hace historial log"], run: () => go("/actividad") }),
      cmd({ key: "doctor", icon: iconTile(Stethoscope), label: "Comprobar que todo funciona", hint: "Ajustes › Ayuda y diagnóstico", terms: ["Comprobar que todo funciona", "diagnóstico problema error lento doctor"], run: () => go("/ajustes/ayuda") }),
      cmd({ key: "usage", icon: iconTile(ChartColumn), label: "Ver lo que gastan", hint: "Ajustes › Uso y límites", terms: ["Ver lo que gastan", "uso tokens límite plan caché"], run: () => go("/ajustes/uso") }),
      cmd({ key: "settings", icon: iconTile(Settings2), label: "Abrir Ajustes", hint: "Todas las secciones, con buscador", terms: ["Abrir Ajustes", "configuración preferencias"], run: () => go("/ajustes") }),
      ...(inCode ? [cmd({ key: "code-keys", icon: iconTile(Keyboard), label: "Atajos de Código", hint: "Todos los atajos de teclado de Código", terms: ["Atajos de Código", "teclado"], kbd: "F1", run: () => { close(); window.dispatchEvent(new Event("colmena:code-shortcuts")); } })] : []),
    ];
    const last = toasts.filter((t) => t.undo).at(-1);
    if (last) out.unshift(cmd({ key: "undo", icon: iconTile(Undo2), label: "Deshacer: " + short(last.text, 40), hint: "Lo último que hiciste", terms: ["Deshacer " + last.text], kbd: "Ctrl Z", run: () => { close(); undoLast(); } }));
    return out;
  }, [paused, ai, models, toasts, text]); // eslint-disable-line react-hooks/exhaustive-deps

  const placeItems = () => [
    ...PLACES.map((p, i) => ({ key: "p:" + p.id, scope: "comandos", group: "Lugares", name: p.label, icon: pathTile(p.icon), title: p.label, meta: `Ctrl ${i + 1}`, terms: [p.label], run: () => go(p.href), preview: { kind: "Lugar", title: p.label, desc: "", facts: [["Atajo", `Ctrl ${i + 1}`]], cta: "Ir" } })),
    { key: "p:actividad", scope: "comandos", group: "Lugares", name: "Actividad", icon: pathTile("M3 12h4l2.5-6 5 12 2.5-6H21"), title: "Actividad", meta: "Qué hace cada bot ahora", terms: ["Actividad"], run: () => go("/actividad"), preview: { kind: "Lugar", title: "Actividad", desc: "Qué hace cada bot ahora, qué ha hecho y lo que ha costado.", facts: [], cta: "Ir" } },
    { key: "p:ajustes", scope: "ajustes", group: "Lugares", name: "Ajustes", icon: iconTile(Settings2), title: "Ajustes", meta: "Cuenta, IA, permisos, avisos…", terms: ["Ajustes"], run: () => go("/ajustes"), preview: { kind: "Lugar", title: "Ajustes", desc: "Todas las secciones, con buscador.", facts: [], cta: "Ir" } },
  ];
  const sectionRows = () => SECTIONS.filter((s) => !s.hidden && (!s.expert || expert)).map((s) => ({ key: "p:s:" + s.id, scope: "ajustes", group: "Ajustes", name: s.label, icon: iconTile(s.icon), title: s.label, meta: s.lead, terms: [s.label, s.lead], run: () => go("/ajustes/" + s.id), preview: { kind: "Ajustes", title: s.label, desc: s.lead, facts: [["Sección", s.label]], cta: "Ir a la sección" } }));

  // What the box finds, one group per kind.
  const found = useMemo(() => {
    const live = (m) => !isHidden("mission:" + m.id) && m.status !== "cancelled" && !m.archived;
    if (!plain) {
      const recent = missions.filter(live).sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));
      if (scope === "chats") return [{ title: "Chats recientes", items: recent.filter(isChat).slice(0, 10).map(missionRow), empty: "Aún no hay chats." }];
      if (scope === "tareas") return [
        { title: "Tareas recientes", items: recent.filter((m) => !isChat(m)).slice(0, 8).map(missionRow) },
        { title: "Rutinas", items: automations.slice(0, 6).map(routineRow) },
        { title: "Código", items: codeTasks.slice(0, 4).map(codeRow) },
      ];
      if (scope === "archivos") return [{ title: "Archivos recientes", items: [...artifacts].sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0)).slice(0, 10).map(artifactRow), empty: "Tu equipo aún no ha entregado nada." }];
      if (scope === "bots") return [{ title: "Tu equipo", items: team.map(botRow) }];
      if (scope === "ajustes") return [{ title: "Ajustes", items: sectionRows() }];
      return [
        { title: "Comandos", items: actions.slice(0, toasts.some((t) => t.undo) ? 5 : 4) },
        { title: "Recientes", items: recent.slice(0, 5).map(missionRow), empty: "Aún no hay chats ni tareas." },
        { title: "Lugares", items: placeItems() },
      ];
    }
    let src = results;
    if (!src) {
      src = {
        missions: rank(missions, plain, (m) => [m.title, m.room, m.prompt]),
        artifacts: rank(artifacts, plain, (a) => [a.title, KIND_WORD[a.kind]]),
        files: [],
        bots: rank(team, plain, (b) => [b.name, b.role]),
      };
    }
    const ms = (src.missions || []).map((m) => missions.find((x) => x.id === m.id) || m).filter(live);
    const groups = [{ title: "Chats", items: ms.filter(isChat).slice(0, 4).map(missionRow) }];
    // Messages found by their words: open the conversation at that message (OpenClaw search).
    const messages = [];
    for (const hit of (src.messages || []).slice(0, 4)) {
      const m = missions.find((x) => x.id === hit.missionId);
      if (!m) continue;
      const who = hit.role === "user" ? "Tú" : botById(bots, hit.botId)?.name || "Un bot";
      const where = m.conversation ? m.title || "chat" : "#" + (m.room || m.title);
      messages.push({
        key: "msg:" + hit.id, scope: "chats", group: "Mensajes", name: hit.snippet, icon: iconTile(MessageSquareText),
        title: <><span style={{ fontWeight: "600" }}>{who + ": "}</span><Highlight text={hit.snippet} query={plain} /></>,
        meta: [where, shortDate(hit.at)].filter(Boolean).join(" · "),
        run: () => go(withMessage(roomUrl(m), hit.id)),
        preview: { kind: "Mensaje", title: where, desc: `${who}: ${hit.snippet}`, facts: [["De", who], ["Cuándo", shortDate(hit.at) || "—"]], cta: "Ir al mensaje" },
      });
    }
    groups.push({ title: "Mensajes", items: messages });
    // What was said with people (on this computer only): opens that conversation or thread at the message.
    groups.push({
      title: "Con personas",
      items: peopleHits.slice(0, 4).map((h) => {
        const who = h.bot ? h.bot : h.author.split(" ")[0];
        const where = (h.kind === "dm" ? h.title : "#" + h.title) + (h.thread ? " · hilo" : "");
        return {
          key: "peer:" + h.id, scope: "chats", group: "Con personas", name: h.snippet, icon: iconTile(UsersRound),
          title: <><span style={{ fontWeight: "600" }}>{who + ": "}</span><Highlight text={h.snippet} query={plain.split(/\s+/)[0]} /></>,
          meta: [where, shortDate(h.at)].filter(Boolean).join(" · "), run: () => go(hitUrl(h)),
          preview: { kind: "Con personas", title: where, desc: `${who}: ${h.snippet}`, facts: [["De", h.author || who], ["Cuándo", shortDate(h.at) || "—"]], cta: "Ir al mensaje" },
        };
      }),
    });
    groups.push({ title: "Tareas", items: ms.filter((m) => !isChat(m)).slice(0, 4).map(missionRow) });
    const codeTitles = rank(codeTasks.filter((t) => !isHidden("codetask:" + t.id)), plain, (t) => [t.title, t.project]).slice(0, 4).map(codeRow);
    // A Código task found by what was said in it: opens the task at that message.
    const codeSaid = codeHits.filter((h) => !isHidden("codetask:" + h.taskId)).slice(0, Math.max(2, 5 - codeTitles.length)).map((h) => ({
      key: "codemsg:" + h.itemId, scope: "tareas", group: "Código", name: h.snippet, icon: iconTile(MessageSquareText),
      title: <><span style={{ fontWeight: "600" }}>{h.who + ": "}</span><Highlight text={h.snippet} query={plain} /></>,
      meta: [h.title, h.project, h.archived ? "archivada" : null, shortDate(h.at)].filter(Boolean).join(" · "),
      run: () => go(withMessage("/codigo/" + h.taskId, h.itemId)),
      preview: { kind: "Tarea de código" + (h.archived ? " · archivada" : ""), title: h.title, desc: `${h.who}: ${h.snippet}`, facts: [["Proyecto", h.project || "—"], ["Cuándo", shortDate(h.at) || "—"]], cta: "Ir al mensaje" },
    }));
    groups.push({ title: "Código", items: [...codeTitles, ...codeSaid] });
    const files = (src.artifacts || []).slice(0, 3).map(artifactRow);
    for (const f of (src.files || []).slice(0, 3)) {
      const name = typeof f === "string" ? f : f.name || f.path || "";
      const m = f.missionId ? missions.find((x) => x.id === f.missionId) : null;
      const where = m ? (m.conversation ? m.title : "#" + (m.room || m.title)) : null;
      files.push({
        key: "f:" + (f.id || f.path || name), scope: "archivos", group: "Archivos", name, icon: glyph(ext(name) || "DOC", true),
        title: <Highlight text={name} query={plain} />, meta: ["Archivo de trabajo", where].filter(Boolean).join(" · "),
        run: () => go(m ? roomUrl(m) : f.missionId ? `/encargo/${f.missionId}` : "/biblioteca/archivos"),
        preview: { kind: "Archivo de trabajo", title: name, desc: f.path && f.path !== name ? f.path : "", facts: [["Dónde", where || "Biblioteca"]], cta: "Abrir donde está" },
      });
    }
    groups.push({ title: "Archivos", items: files });
    groups.push({ title: "Bots", items: (src.bots || []).slice(0, 3).map((b) => botRow(botById(bots, b.id) || b)) });
    groups.push({ title: "Rutinas", items: rank(automations, plain, (r) => [r.name, r.prompt, r.subtitle]).slice(0, 3).map(routineRow) });
    groups.push({
      title: "Ajustes",
      items: searchSettings(plain, undefined, 4).map((s) => {
        const sec = SECTION_OF[s.section];
        return { key: "s:" + s.key, scope: "ajustes", group: "Ajustes", name: s.label, icon: iconTile(sec.icon), title: <Highlight text={s.label} query={plain} />, meta: s.isSection ? "Ajustes" : "Ajustes › " + sec.label, run: () => go(s.href), preview: { kind: "Ajuste", title: s.label, desc: sec.lead, facts: [["Sección", sec.label]], cta: "Ir al ajuste" } };
      }),
    });
    const matching = rank(actions, plain).slice(0, 3);
    // «Nueva rutina: …» with what you typed (the board's «Nueva rutina de facturas…»).
    const routine = `Nueva rutina: «${short(plain, 36)}»…`;
    matching.push({ key: "routine-of", scope: "comandos", group: "Comandos", name: routine, icon: glyph(">"), title: routine, meta: "Comando", run: () => go("/trabajo/rutinas?nueva=1&texto=" + encodeURIComponent(plain)), preview: { kind: "Comando", title: routine, desc: "Abre el creador de rutinas con lo que has escrito ya puesto.", facts: [["Atajo", "> rutina"]], cta: "Ejecutar" } });
    groups.push({ title: "Comandos", items: matching });
    return groups;
  }, [plain, scope, results, peopleHits, codeHits, missions, artifacts, automations, team, bots, codeTasks, actions, expert]); // eslint-disable-line react-hooks/exhaustive-deps

  // The list of a command («Ir a…», «Cambiar el modelo…»).
  const menuItems = useMemo(() => {
    if (!menu) return [];
    if (menu.id === "goto") return rank([...placeItems(), ...sectionRows()], typed);
    const engines = (ai?.engines || []).filter((e) => e.connected);
    const items = engines.map((e) => ({ key: "e:" + e.id, group: "IA del equipo", name: `Pensar con ${e.label}`, icon: iconTile(e.id === ai?.primary ? Check : Sparkles), title: <>{"Pensar con "}<strong>{e.label}</strong></>, terms: [e.label, e.detail || ""], meta: e.id === ai?.primary ? "Ahora" : e.detail || "", run: () => (e.id === ai?.primary ? close() : setPrimary(e.id, e.label)), preview: { kind: "IA del equipo", title: e.label, desc: e.detail || "", facts: [["Ahora", e.id === ai?.primary ? "sí" : "no"]], cta: e.id === ai?.primary ? "Cerrar" : "Usar" } }));
    if (!ai || ai.primary === "openai") {
      for (const m of models.filter((x) => !String(x.slug).includes("/"))) {
        const on = m.slug === settings.model;
        items.push({ key: "gm:" + m.slug, group: "Modelo de ChatGPT", name: m.label || m.slug, icon: iconTile(on ? Check : Sparkles), title: m.label || m.slug, terms: [m.label || m.slug, m.description || ""], meta: on ? "Ahora" : m.description || "", run: () => (on ? close() : setModel(m.slug, m.label || m.slug)), preview: { kind: "Modelo de ChatGPT", title: m.label || m.slug, desc: m.description || "", facts: [["Ahora", on ? "sí" : "no"]], cta: on ? "Cerrar" : "Usar" } });
      }
    }
    return rank(items, typed);
  }, [menu, typed, ai, models, settings.model, expert]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickMention = (label) => {
    const before = text.slice(0, mention.start);
    const after = text.slice(caret);
    const next = before + `@${label} ` + after.replace(/^\s+/, "");
    const pos = before.length + label.length + 2;
    setText(next);
    setCaret(pos);
    setCycled(null);
    setActive(null);
    requestAnimationFrame(() => input.current?.setSelectionRange(pos, pos));
  };

  // The rows, in groups (order = keyboard order); `lead` is how many rows ask before the results.
  const groups = [];
  let lead = 0;
  if (menu) {
    for (const it of menuItems) {
      const g = groups.find((x) => x.title === it.group);
      if (g) g.items.push(it); else groups.push({ title: it.group, items: [it] });
    }
    if (!groups.length) groups.push({ title: menu.title, items: [], empty: menu.id === "model" ? "Conecta una IA en Ajustes › Cuentas de IA." : "Nada se llama así." });
  } else if (mention) {
    const matches = matchBots(team, mention.query).slice(0, 6);
    groups.push({ title: "Bots", items: matches.map((b) => ({ ...botRow(b), key: "pick:" + b.id, meta: b.role, kbd: "Intro", run: () => pickMention(b.name) })), empty: "Ningún bot de tu equipo se llama así." });
    // People you are connected with: their conversation with you.
    const q = String(mention.query || "").toLowerCase();
    const people = (peers?.contacts || []).filter((c) => c.status === "active" && String(c.name || "").toLowerCase().includes(q)).slice(0, 4);
    if (people.length) groups.push({
      title: "Personas",
      items: people.map((c) => {
        const dm = (peers?.shares || []).find((s) => s.kind === "dm" && s.members?.some((m) => m.id === c.id));
        const initials = String(c.name || "?").split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
        return { key: "person:" + c.id, name: c.name, icon: glyph(initials, true), title: c.name, meta: dm ? "Abrir vuestra conversación" : "Persona conectada", run: () => go(dm ? shareUrl(dm.id) : "/equipo"), preview: { kind: "Persona", title: c.name, desc: "", facts: [], cta: dm ? "Abrir la conversación" : "Ver en Equipo" } };
      }),
    });
  } else if (actionsOnly) {
    groups.push({ title: "Comandos", items: rank(actions, query), empty: "Ningún comando se llama así." });
  } else {
    if (plain) {
      // Ask first: your team (Atlas decides), or the bot you named (@Nora) or chose with Tab.
      const who = soloBot;
      groups.push({
        title: null,
        items: [{
          key: "ask", ask: true, name: `Pedir «${short(plain)}» a ${who ? who.name : "tu equipo"}`,
          icon: who ? botTile(who) : <Tile dark><Shape bot={{ ...atlas, color: "#FFFFFF" }} size={14} /></Tile>,
          title: <>{"Pedir "}<span>{`«${short(plain)}»`}</span>{` a ${who ? who.name : "tu equipo"}`}</>,
          meta: who ? `Solo ${who.name}, en un chat · Tab cambia de bot` : `${atlas.name} decide quién lo hace${likely ? " · probablemente " + likely.name : ""}`,
          kbd: "Ctrl Intro", run: () => createMission(who ? "solo" : "equipo", who),
          preview: {
            kind: who ? `Pedir a ${who.name}` : "Pedir a tu equipo", title: `«${plain}»`,
            desc: who ? `${who.name} lo hará en un chat contigo. Lo verás en Chats mientras lo hace.` : `${atlas.name} lo lee y se lo da a quien mejor lo haga. Lo verás en Inicio, en «En marcha».`,
            facts: [["Lo hará", who ? who.name : likely ? `${atlas.name} decide (probablemente ${likely.name})` : `${atlas.name} decide`], ["Antes de enviar nada", "te pregunta"]], cta: "Pedirlo",
          },
        }],
      });
      lead = 1;
      for (const g of found) {
        const items = g.items.filter((it) => scope === "todo" || it.scope === scope);
        if (items.length) groups.push({ ...g, items });
      }
      if (groups.length === 1) groups.push({ title: "Resultados", items: [], empty: searchFailed ? "La búsqueda no responde ahora mismo y no hay coincidencias aquí." : "Nada coincide con lo que buscas. Pídeselo a tu equipo." });
    } else {
      groups.push(...found);
    }
  }
  const options = [];
  for (const g of groups) for (const it of g.items) options.push(it);
  // With results, Intro opens the first one and Ctrl Intro asks (the board selects a result, not «Pedir»).
  const auto = lead && options.length > lead ? lead : 0;
  const current = Math.min(active ?? auto, Math.max(0, options.length - 1));
  const counts = useMemo(() => {
    if (!plain) return null;
    const c = Object.fromEntries(SCOPES.map(([id]) => [id, 0]));
    for (const g of found) for (const it of g.items) { c.todo += 1; if (it.scope in c) c[it.scope] += 1; }
    return c;
  }, [found, plain]);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current, open]);

  if (!open) return null;

  const back = () => { const before = menu?.before ?? ""; setMenu(null); setText(before); setCaret(before.length); setActive(null); };
  const ask = () => { if (plain && !mention && !menu && !actionsOnly) createMission(soloBot ? "solo" : "equipo", soloBot); };
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
      ask();
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
      // Cycle who «Pedir» goes to: the team (Atlas decides), then each bot (a typed @mention goes so Tab wins).
      const ring = [null, ...team.filter((b) => b.id !== "atlas")];
      const idx = Math.max(0, ring.findIndex((b) => (b?.id || null) === (soloBot?.id || null)));
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

  const placeholder = menu ? (menu.id === "model" ? "Elige con qué piensan…" : "¿Adónde quieres ir?") : "Busca chats, tareas, archivos, bots, ajustes… o pide algo";
  const cur = options[current] || null;
  const preview = cur?.preview || null;
  const hint = { ...KBD, color: "#12131A" };
  let index = -1;
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }} style={{ position: "fixed", inset: "0", zIndex: 1000, background: "rgba(18,19,26,.38)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "72px 24px 24px", overflowY: "auto", animation: "fade .2s ease-out" }}>
      <div role="dialog" aria-modal="true" aria-label="Buscar o pedir" style={{ width: "100%", maxWidth: "920px", display: "flex", flexDirection: "column", borderRadius: "26px", background: "#FFFFFF", boxShadow: "0 2px 6px rgba(18,19,26,.08), 0 40px 90px -30px rgba(18,19,26,.6)", overflow: "hidden", animation: "sheet .25s ease-out", fontFamily: "'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#12131A" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "0 22px", height: "70px", borderBottom: "1px solid rgba(18,19,26,.07)" }}>
          {menu ? (
            <button type="button" onClick={back} aria-label="Volver" style={{ display: "flex", alignItems: "center", gap: "6px", flex: "none", height: "32px", padding: "0 12px 0 8px", border: 0, borderRadius: "999px", background: "#F1F1EC", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#12131A" }}>
              <ArrowLeft size={14} strokeWidth={2.4} aria-hidden="true" />{menu.title}
            </button>
          ) : parsed.actionsOnly ? <span style={{ flex: "none", display: "inline-flex", alignItems: "center", height: "28px", padding: "0 10px", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "12px", fontWeight: 600 }}>{"Comandos"}</span>
            : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4A4D57" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true" style={{ flex: "none" }}><path d="M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.2-4.2" /></svg>}
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
            aria-activedescendant={cur ? `paleta-${cur.key}` : undefined}
            onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); setActive(null); setError(null); }}
            onSelect={(e) => setCaret(e.target.selectionStart)}
            onKeyDown={onKeyDown}
            style={{ flex: "1", minWidth: "0", height: "48px", border: "0", outline: "none", background: "transparent", fontSize: "20px", color: "#12131A" }}
          />
          <button type="button" onClick={close} aria-label="Cerrar" style={{ padding: "5px 8px", border: "0", borderRadius: "7px", background: "#F1F1EC", font: "500 12px/1 'Geist Mono', monospace", color: "#4A4D57", cursor: "pointer" }}>{"Esc"}</button>
        </div>

        {menu || mention || parsed.actionsOnly ? null : (
          <div role="tablist" aria-label="Qué buscar" style={{ display: "flex", flexWrap: "wrap", gap: "6px", padding: "12px 22px", borderBottom: "1px solid rgba(18,19,26,.07)" }}>
            {SCOPES.map(([id, label]) => {
              const on = scope === id;
              return (
                <button key={id} type="button" role="tab" aria-selected={on ? "true" : "false"} onMouseDown={(e) => e.preventDefault()} onClick={() => { setScope(id); setActive(null); input.current?.focus(); }}
                  style={{ height: "32px", padding: "0 12px", display: "inline-flex", alignItems: "center", gap: "6px", border: "0", borderRadius: "999px", background: on ? "#12131A" : "#F1F1EC", color: on ? "#FFFFFF" : "#3D404A", fontSize: "13.5px", fontWeight: "500", cursor: "pointer" }}>
                  {label}{counts ? <span style={{ fontSize: "12px", opacity: ".75" }}>{counts[id]}</span> : null}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", minHeight: "460px" }}>
          <div ref={list} id="paleta-resultados" role="listbox" aria-label="Resultados" style={{ flex: "1 1 420px", minWidth: "0", display: "flex", flexDirection: "column", gap: "2px", padding: "10px", maxHeight: "520px", overflow: "auto" }}>
            {groups.map((g, gi) => (
              <div key={(g.title || "pedir") + gi} role="group" aria-label={g.title || "Pedir"} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                {g.title ? <span style={{ padding: "12px 12px 4px", fontSize: "12px", fontWeight: "600", color: "#5C606C" }}>{g.title}</span> : null}
                {g.items.length === 0 && g.empty ? <span style={{ padding: "8px 12px 10px", fontSize: "14px", color: "#5C606C" }}>{g.empty}</span> : null}
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
                      style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: it.ask ? "52px" : "48px", padding: it.ask ? "8px 12px" : "6px 12px", borderRadius: "12px", cursor: "pointer", background: on ? "#F1F1EC" : "transparent", boxShadow: it.ask ? "inset 0 0 0 1px rgba(18,19,26,.1)" : "none" }}
                    >
                      {it.icon}
                      <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "2px" }}>
                        <span style={{ fontSize: "14.5px", fontWeight: it.ask ? "600" : "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</span>
                        {it.meta ? <span style={{ fontSize: "12.5px", color: "#5C606C", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.meta}</span> : null}
                      </span>
                      {it.submenu ? <ChevronRight size={15} strokeWidth={2.2} color="#8A8D96" aria-hidden="true" style={{ flex: "none" }} /> : null}
                      {it.kbd ? <kbd style={KBD}>{it.kbd}</kbd> : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <aside aria-label="Vista previa" style={{ flex: "1 1 300px", minWidth: "0", display: "flex", flexDirection: "column", gap: "14px", padding: "22px", background: "#F6F6F3", borderLeft: "1px solid rgba(18,19,26,.06)" }}>
            {preview ? (
              <>
                <span style={{ fontSize: "12px", fontWeight: "600", color: "#5C606C" }}>{preview.kind}</span>
                <h2 style={{ margin: "0", font: "600 22px/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", overflowWrap: "anywhere" }}>{preview.title}</h2>
                {preview.desc ? <p style={{ margin: "0", fontSize: "14px", lineHeight: "1.5", color: "#4A4D57", display: "-webkit-box", WebkitLineClamp: "5", WebkitBoxOrient: "vertical", overflow: "hidden" }}>{preview.desc}</p> : null}
                {preview.facts?.filter(Boolean).length ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "14px", borderRadius: "16px", background: "#FFFFFF", fontSize: "13.5px" }}>
                    {preview.facts.filter(Boolean).map(([k, v]) => <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}><span style={{ color: "#5C606C" }}>{k}</span><span style={{ fontWeight: "500", textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span></div>)}
                  </div>
                ) : null}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cur.run()} disabled={busy} style={{ height: "40px", padding: "0 16px", display: "inline-flex", alignItems: "center", border: "0", borderRadius: "999px", background: "#12131A", color: "#FFFFFF", fontSize: "14px", fontWeight: "600", cursor: "pointer" }}>{preview.cta}</button>
                </div>
              </>
            ) : <p style={{ margin: "0", fontSize: "14px", lineHeight: "1.5", color: "#5C606C" }}>{"Escribe para buscar en todo, o pide algo a tu equipo."}</p>}
          </aside>
        </div>

        {error ? <p role="alert" style={{ margin: "0", padding: "10px 22px", borderTop: "1px solid rgba(18,19,26,.07)", fontSize: "13px", color: "#B4232A", fontWeight: "600" }}>{error}</p> : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px", padding: "12px 22px", borderTop: "1px solid rgba(18,19,26,.07)", fontSize: "12.5px", color: "#5C606C" }}>
          <span><kbd style={hint}>{"↑ ↓"}</kbd>{" moverse"}</span>
          <span><kbd style={hint}>{"Intro"}</kbd>{" abrir"}</span>
          {menu ? <span><kbd style={hint}>{"⌫"}</kbd>{" volver"}</span> : null}
          {menu || actionsOnly ? null : <span><kbd style={hint}>{"Ctrl Intro"}</kbd>{" pedirlo al equipo"}</span>}
          {menu ? null : <span><kbd style={hint}>{">"}</kbd>{" solo comandos"}</span>}
          {menu || actionsOnly ? null : <span><kbd style={hint}>{"@"}</kbd>{" un bot o persona"}</span>}
          {expert && !menu && !actionsOnly ? <span><kbd style={hint}>{"Tab"}</kbd>{" pedírselo a un bot"}</span> : null}
        </div>
      </div>
    </div>
  );
}
