import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import Markdown from "react-markdown";
import {
  Home,
  Inbox,
  Target,
  Library,
  Clock3,
  Users,
  Plus,
  Settings,
  ArrowUpRight,
  ArrowRight,
  Search,
  ChevronDown,
  Check,
  X,
  Pause,
  Play,
  Square,
  Paperclip,
  ShieldCheck,
  Plug,
  MessageSquare,
  Network,
  MessagesSquare,
  Activity,
  FileText,
  Download,
  BookOpen,
  Brain,
  RefreshCw,
  LogOut,
  Menu,
  ChevronLeft,
  ExternalLink,
  Upload,
  CheckCircle2,
  AlertCircle,
  MoreHorizontal,
  Sparkles,
  Hexagon,
  Send,
  History,
} from "lucide-react";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist/700.css";
import "@fontsource/bricolage-grotesque/700.css";
import "@fontsource/bricolage-grotesque/800.css";
import "@fontsource/geist-mono/400.css";
import { api } from "./api";
import "./style.css";

const nav = [
  ["", "Inicio", Home],
  ["inbox", "Bandeja", Inbox],
  ["missions", "Misiones", Target],
  ["library", "Biblioteca", Library],
  ["automations", "Automatizaciones", Clock3],
];
const statusLabels = {
  queued: "En cola",
  running: "Trabajando",
  waiting: "Necesita tu OK",
  paused: "En pausa",
  blocked: "Bloqueada",
  completed: "Terminada",
  cancelled: "Cancelada",
  awaiting_choice: "Elige una propuesta",
  pending: "Pendiente",
  active: "Activa",
  disabled: "Desactivada",
  approved: "Aprobada",
  denied: "Denegada",
  executed: "Realizada",
  scheduled: "Programada",
};
const modeLabels = { solo: "Un bot", equipo: "Equipo", debate: "Debate" };
const go = (route) => {
  window.location.hash = "/" + route;
};
function useRoute() {
  const get = () => window.location.hash.replace(/^#\/?/, "").split("/");
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const listener = () => setRoute(get());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  return route;
}
function IconButton({ label, children, ...props }) {
  return (
    <button className="icon-button" title={label} aria-label={label} {...props}>
      {children}
    </button>
  );
}
function Avatar({ bot, size = 36 }) {
  return (
    <span
      className={"avatar " + (bot?.shape || "circle")}
      style={{
        "--avatar": bot?.color || "#dce0e8",
        width: size,
        height: size,
        fontSize: size * 0.43,
      }}
      aria-label={bot?.name}
    >
      {bot?.name?.[0] || "C"}
    </span>
  );
}
function Badge({ status }) {
  return (
    <span className={"badge " + status}>
      <i />
      {statusLabels[status] || status}
    </span>
  );
}
function Empty({ icon: Icon = Target, title, children, action }) {
  return (
    <div className="empty">
      <Icon size={30} strokeWidth={1.3} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
function Mark({ children }) {
  return (
    <div className="markdown">
      <Markdown>{children || ""}</Markdown>
    </div>
  );
}
function download(name, content) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/plain;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function App() {
  const [route, id, view] = useRoute(),
    [state, setState] = useState(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [mobile, setMobile] = useState(false),
    [live, setLive] = useState({}),
    [revision, setRevision] = useState(0);
  const refresh = async () => {
    try {
      setState(await api("/state"));
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    refresh();
    const events = new EventSource("/api/events");
    let timer;
    events.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.kind === "auth-success") {
        api("/auth/models", "POST", {})
          .then(refresh)
          .catch((e) => setError(e.message));
      }
      if (event.type === "delta") {
        setLive((prev) => ({
          ...prev,
          [event.stepId]: (prev[event.stepId] || "") + event.text,
        }));
        return;
      }
      if (event.stepId) setLive((prev) => ({ ...prev, [event.stepId]: "" }));
      clearTimeout(timer);
      timer = setTimeout(() => {
        refresh();
        setRevision((x) => x + 1);
      }, 100);
    };
    const poll = setInterval(refresh, 12000);
    return () => {
      events.close();
      clearTimeout(timer);
      clearInterval(poll);
    };
  }, []);
  useEffect(() => {
    setMobile(false);
    window.scrollTo(0, 0);
  }, [route, id]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 4000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  const action = async (fn, message) => {
    try {
      const result = await fn();
      await refresh();
      setRevision((x) => x + 1);
      if (message) setNotice(message);
      return result;
    } catch (e) {
      setError(e.message);
      return null;
    }
  };
  if (!state)
    return (
      <div className="boot">
        <Hexagon size={34} />
        <h1>Colmena</h1>
        {error ? <p role="alert">{error}</p> : <p>Abriendo tu espacio...</p>}
      </div>
    );
  const ctx = { state, action, refresh, live, revision };
  const pending = state.approvals.filter((a) => a.status === "pending");
  const current =
    nav.find((n) => n[0] === route)?.[1] ||
    {
      team: "Tu equipo",
      bot: "Perfil del bot",
      newbot: "Nuevo bot",
      chat: "Chat",
      mission: "Sala de equipo",
      settings: "Ajustes",
    }[route] ||
    "Colmena";
  return (
    <div className="app">
      <aside className={"sidebar " + (mobile ? "open" : "")}>
        <a className="brand" href="#/">
          <span className="brand-mark">
            <Hexagon fill="currentColor" size={32} />
            <span />
          </span>
          Colmena
        </a>
        <div className="workspace">
          <span>
            <small>ESPACIO</small>
            <strong>Mi equipo</strong>
          </span>
          <Hexagon size={17} />
        </div>
        <nav aria-label="Navegación principal">
          {nav.map(([path, label, Icon]) => (
            <a
              key={path}
              href={"#/" + path}
              className={route === path ? "selected" : ""}
            >
              <Icon size={19} />
              <span>{label}</span>
              {path === "inbox" && pending.length > 0 && (
                <b>{pending.length}</b>
              )}
              {path === "missions" && state.missions.length > 0 && (
                <small>{state.missions.length}</small>
              )}
            </a>
          ))}
        </nav>
        <div className="side-label">
          TU EQUIPO
          <IconButton label="Nuevo bot" onClick={() => go("newbot")}>
            <Plus size={16} />
          </IconButton>
        </div>
        <div className="bot-nav">
          {state.bots
            .filter((b) => b.enabled)
            .map((bot) => (
              <a
                href={"#/chat/" + bot.id}
                key={bot.id}
                className={route === "chat" && id === bot.id ? "active" : ""}
              >
                <Avatar bot={bot} size={27} />
                <span>
                  {bot.name}
                  <small>{bot.role}</small>
                </span>
                <i
                  className={
                    state.missions.some(
                      (m) =>
                        m.status === "running" && m.botIds.includes(bot.id),
                    )
                      ? "busy"
                      : "idle"
                  }
                />
              </a>
            ))}
        </div>
        <a
          className={"team-link " + (route === "team" ? "active" : "")}
          href="#/team"
        >
          <Users size={17} />
          Gestionar equipo
          <ArrowUpRight size={15} />
        </a>
        <div className="sidebar-bottom">
          <a href="#/settings">
            <Plug size={17} />
            <span>
              {state.account ? "ChatGPT conectado" : "Conectar ChatGPT"}
            </span>
            <i className={state.account ? "connected-dot" : "idle"} />
          </a>
          <a href="#/settings">
            <Settings size={17} />
            Ajustes
          </a>
          <div className="local-user">
            <span>C</span>
            <div>
              Tu Colmena<small>En este ordenador</small>
            </div>
          </div>
        </div>
      </aside>
      {mobile && (
        <button
          className="scrim"
          aria-label="Cerrar menú"
          onClick={() => setMobile(false)}
        />
      )}
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            <IconButton
              label="Abrir menú"
              className="icon-button mobile-menu"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={20} />
            </IconButton>
            <span>Mi espacio</span>
            <span>/</span>
            <strong>{current}</strong>
          </div>
          <div className="top-actions">
            <span className="local-status">
              <i />
              Guardado local
            </span>
            <a className="button subtle" href="#/inbox">
              <Inbox size={16} />
              <span>Bandeja</span>
              {pending.length > 0 && <b>{pending.length}</b>}
            </a>
            <a className="button dark" href="#/newbot">
              <Plus size={17} />
              <span>Nuevo bot</span>
            </a>
          </div>
        </header>
        <div className="page">
          {route === "" ? (
            <HomePage {...ctx} />
          ) : route === "inbox" ? (
            <InboxPage {...ctx} />
          ) : route === "missions" ? (
            <MissionsPage {...ctx} />
          ) : route === "team" ? (
            <TeamPage {...ctx} />
          ) : route === "newbot" ? (
            <BotEditor {...ctx} />
          ) : route === "bot" ? (
            <BotProfile {...ctx} botId={id} />
          ) : route === "chat" ? (
            <ChatPage {...ctx} botId={id} />
          ) : route === "mission" ? (
            <MissionPage {...ctx} missionId={id} view={view || "room"} />
          ) : route === "automations" ? (
            <AutomationsPage {...ctx} />
          ) : route === "library" ? (
            <LibraryPage {...ctx} />
          ) : route === "settings" ? (
            <SettingsPage {...ctx} />
          ) : (
            <Empty
              title="Esta página no existe"
              action={
                <a href="#/" className="button">
                  Volver al inicio
                </a>
              }
            />
          )}
        </div>
      </main>
      {error && (
        <div className="toast error" role="alert">
          <AlertCircle size={20} />
          <span>{error}</span>
          <IconButton label="Cerrar error" onClick={() => setError("")}>
            <X size={18} />
          </IconButton>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {notice}
        </div>
      )}
    </div>
  );
}

function Composer({ state, action, botId, compact = false, onCreated }) {
  const [mode, setMode] = useState(botId ? "solo" : "equipo"),
    [selected, setSelected] = useState(botId ? [botId] : ["nora", "vera"]),
    [prompt, setPrompt] = useState(""),
    [busy, setBusy] = useState(false),
    [attachments, setAttachments] = useState([]);
  const fileRef = useRef();
  useEffect(() => {
    if (botId) {
      setSelected([botId]);
      setMode("solo");
    }
  }, [botId]);
  const submit = async (e) => {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy(true);
    const m = await action(() =>
      api("/missions", "POST", {
        prompt,
        mode,
        botIds: mode === "solo" ? selected.slice(0, 1) : selected,
        attachments,
        conversation: !!botId,
      }),
    );
    setBusy(false);
    if (m) {
      setPrompt("");
      setAttachments([]);
      if (onCreated) onCreated(m);
      else go("mission/" + m.id);
    }
  };
  const attach = async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    await action(async () => {
      if (files.length + attachments.length > 5)
        throw Error("Máximo cinco archivos de texto.");
      const added = [];
      for (const f of files) {
        if (f.size > 200000)
          throw Error("Cada archivo admite hasta 200 KB de texto.");
        if (
          !/\.(txt|md|csv|json|js|ts|py|html|css|xml|yaml|yml)$/i.test(f.name)
        )
          throw Error("Adjunta un archivo de texto, Markdown, CSV o código.");
        added.push({ name: f.name, content: await f.text() });
      }
      setAttachments((a) => [...a, ...added]);
    });
  };
  return (
    <form
      className={"composer " + (compact ? "compact" : "")}
      onSubmit={submit}
    >
      {!botId && (
        <div className="composer-top">
          <div className="segmented" aria-label="Modo de trabajo">
            {[
              ["solo", "Un bot", MessageSquare],
              ["equipo", "Equipo", Network],
              ["debate", "Debate", MessagesSquare],
            ].map(([key, label, Icon]) => (
              <button
                type="button"
                key={key}
                aria-pressed={mode === key}
                className={mode === key ? "active" : ""}
                onClick={() => setMode(key)}
              >
                <Icon size={17} />
                {label}
              </button>
            ))}
          </div>
          <span className="composer-target">
            {mode === "equipo"
              ? "Coordina Atlas"
              : mode === "debate"
                ? "Propuestas independientes"
                : "Conversación directa"}
          </span>
        </div>
      )}
      {!botId && (
        <div className="bot-picker" aria-label="Bots participantes">
          {state.bots
            .filter((b) => b.enabled && b.id !== "atlas")
            .map((b) => (
              <button
                type="button"
                aria-pressed={selected.includes(b.id)}
                className={selected.includes(b.id) ? "picked" : ""}
                key={b.id}
                onClick={() =>
                  setSelected((a) =>
                    mode === "solo"
                      ? [b.id]
                      : a.includes(b.id)
                        ? a.filter((x) => x !== b.id)
                        : a.length < 4
                          ? [...a, b.id]
                          : a,
                  )
                }
              >
                <Avatar bot={b} size={23} />
                {b.name}
                {selected.includes(b.id) && <Check size={12} />}
              </button>
            ))}
        </div>
      )}
      <label className="sr-only" htmlFor={"prompt-" + (botId || "main")}>
        Tu encargo
      </label>
      <textarea
        id={"prompt-" + (botId || "main")}
        rows={compact ? 2 : 3}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={
          botId
            ? "¿Qué necesitas?"
            : "Cuéntale a tu equipo qué necesitas resolver."
        }
        required
        maxLength={20000}
      />
      {attachments.length > 0 && (
        <div className="attachments">
          {attachments.map((f, i) => (
            <span key={i}>
              <FileText size={14} />
              {f.name}
              <IconButton
                label={"Quitar " + f.name}
                onClick={() =>
                  setAttachments((a) => a.filter((_, j) => j !== i))
                }
                type="button"
              >
                <X size={12} />
              </IconButton>
            </span>
          ))}
        </div>
      )}
      <div className="composer-bottom">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".txt,.md,.csv,.json,.js,.ts,.py,.html,.css,.xml,.yaml,.yml"
          hidden
          onChange={attach}
        />
        <IconButton
          type="button"
          label="Adjuntar archivos de texto"
          onClick={() => fileRef.current.click()}
        >
          <Paperclip size={19} />
        </IconButton>
        <span className="permission">
          <ShieldCheck size={16} />
          Las escrituras necesitan tu OK
        </span>
        <button
          type="submit"
          className="button yellow"
          disabled={
            busy ||
            !prompt.trim() ||
            !selected.length ||
            (mode === "debate" && selected.length < 2)
          }
        >
          {busy ? "Creando..." : compact ? "Enviar" : "Empezar"}
          <ArrowRight size={18} />
        </button>
      </div>
    </form>
  );
}
function MissionCard({ mission, state }) {
  return (
    <article className="mission-card">
      <div className="row between">
        <span className="eyebrow">
          {modeLabels[mission.mode]}
          {mission.mode === "equipo" ? " · coordina Atlas" : ""}
        </span>
        <div className="avatar-stack">
          {mission.botIds.map((id) => (
            <Avatar
              key={id}
              bot={state.bots.find((b) => b.id === id)}
              size={29}
            />
          ))}
        </div>
      </div>
      <a className="mission-title" href={"#/mission/" + mission.id}>
        {mission.title}
      </a>
      <p>{mission.prompt}</p>
      <div className="mission-progress">
        <i
          style={{
            width:
              mission.status === "completed"
                ? "100%"
                : mission.status === "queued"
                  ? "0%"
                  : undefined,
          }}
          className={mission.status === "running" ? "indeterminate" : ""}
        />
      </div>
      <div className="row between">
        <Badge status={mission.status} />
        <a className="text-link" href={"#/mission/" + mission.id}>
          Abrir sala
          <ArrowUpRight size={15} />
        </a>
      </div>
    </article>
  );
}
function HomePage(ctx) {
  const { state } = ctx,
    active = state.missions.filter(
      (m) => !["completed", "cancelled"].includes(m.status),
    ),
    pending = state.approvals.filter((a) => a.status === "pending");
  const date = new Intl.DateTimeFormat("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  return (
    <>
      <div className="page-heading home-heading">
        <div>
          <p className="eyebrow">{date}</p>
          <h1>
            {active.length ? (
              <>
                Tu equipo tiene
                <br />
                {active.length} {active.length === 1 ? "misión" : "misiones"} en
                marcha.
              </>
            ) : (
              <>
                Tu próxima idea.
                <br />
                Todo un equipo para hacerla.
              </>
            )}
          </h1>
        </div>
        <div className="status-pills">
          {active.some((m) => m.status === "running") ? (
            <Badge status="running" />
          ) : (
            <span className="pill">Equipo disponible</span>
          )}
          <span className="pill">
            {state.bots.filter((b) => b.enabled).length} bots en tu equipo
          </span>
        </div>
      </div>
      {!state.account && (
        <div className="connection-banner">
          <span className="connection-symbol">
            <Plug size={20} />
          </span>
          <div>
            <strong>Tu equipo está listo. Conecta tu ChatGPT.</strong>
            <span>Usa tu cuenta y el modelo disponible en tu plan.</span>
          </div>
          <a href="#/settings" className="button dark">
            Conectar
            <ArrowUpRight size={16} />
          </a>
        </div>
      )}
      <Composer {...ctx} />
      <div className="home-grid">
        <section>
          <div className="section-heading">
            <h2>Misiones en marcha</h2>
            <a href="#/missions">
              Ver todas
              <ArrowUpRight size={15} />
            </a>
          </div>
          {active.length ? (
            active
              .slice()
              .reverse()
              .slice(0, 4)
              .map((m) => <MissionCard key={m.id} mission={m} state={state} />)
          ) : (
            <div className="first-mission">
              <div className="orbit-team">
                {state.bots.slice(0, 6).map((b) => (
                  <Avatar key={b.id} bot={b} size={45} />
                ))}
              </div>
              <h3>Un buen equipo empieza con un encargo.</h3>
              <p>Todo preparado para tu primera misión.</p>
              <div className="empty-rule" />
            </div>
          )}
          <div className="section-heading">
            <h2>Tu equipo</h2>
            <a href="#/team">
              Conocerlos
              <ArrowUpRight size={15} />
            </a>
          </div>
          <div className="team-mini">
            {state.bots
              .filter((b) => b.enabled)
              .slice(0, 6)
              .map((b) => (
                <a key={b.id} href={"#/chat/" + b.id}>
                  <Avatar bot={b} size={33} />
                  <strong>{b.name}</strong>
                  <span>{b.role}</span>
                  <ArrowUpRight size={14} />
                </a>
              ))}
          </div>
        </section>
        <aside className="home-aside">
          <section>
            <div className="section-heading">
              <h2>Necesitan tu OK</h2>
              <span className="counter">{pending.length}</span>
            </div>
            {pending.length ? (
              pending.slice(0, 3).map((a) => (
                <div className="approval-mini" key={a.id}>
                  <Avatar
                    bot={state.bots.find((b) => b.id === a.botId)}
                    size={28}
                  />
                  <div>
                    <p>
                      {a.tool === "write_file"
                        ? "Crear " + a.args.path
                        : "Guardar un recuerdo"}
                    </p>
                    <a href="#/inbox" className="text-link">
                      Revisar
                      <ArrowRight size={15} />
                    </a>
                  </div>
                </div>
              ))
            ) : (
              <div className="quiet-state">
                <CheckCircle2 size={22} />
                <strong>Todo al día</strong>
                <p>No hay decisiones pendientes.</p>
              </div>
            )}
          </section>
          <section>
            <div className="section-heading">
              <h2>Programado</h2>
              <Clock3 size={18} />
            </div>
            {state.automations
              .filter((a) => a.enabled)
              .slice(0, 3)
              .map((a) => (
                <a className="schedule-mini" href="#/automations" key={a.id}>
                  <span>
                    {new Date(a.nextRun).toLocaleTimeString("es", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <strong>{a.name}</strong>
                </a>
              ))}
            {!state.automations.some((a) => a.enabled) && (
              <p className="muted">Sin automatizaciones programadas.</p>
            )}
            <a href="#/automations" className="text-link">
              Automatizaciones
              <ArrowUpRight size={15} />
            </a>
          </section>
          <section className="learning-note">
            <Brain size={22} />
            <h3>Un equipo que aprende contigo.</h3>
            <p>
              {state.skills.filter((s) => s.status === "pending").length}{" "}
              habilidades por revisar
            </p>
            <a href="#/library" className="text-link">
              Abrir biblioteca
              <ArrowRight size={15} />
            </a>
          </section>
        </aside>
      </div>
    </>
  );
}

function PageHeading({ eyebrow, title, children, action }) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {children && <p className="muted">{children}</p>}
      </div>
      {action}
    </div>
  );
}
function MissionsPage({ state }) {
  const [filter, setFilter] = useState("all"),
    [search, setSearch] = useState("");
  const items = state.missions.filter(
    (m) =>
      (filter === "all" ||
        (filter === "active"
          ? !["completed", "cancelled"].includes(m.status)
          : m.status === filter)) &&
      m.title.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow="DE LA IDEA AL RESULTADO"
        title="Misiones"
        action={
          <a href="#/" className="button dark">
            <Plus size={17} />
            Nueva misión
          </a>
        }
      />
      <div className="toolbar">
        <div className="tabs">
          {[
            ["all", "Todas"],
            ["active", "En marcha"],
            ["completed", "Terminadas"],
            ["cancelled", "Canceladas"],
          ].map(([k, v]) => (
            <button
              key={k}
              className={filter === k ? "active" : ""}
              onClick={() => setFilter(k)}
            >
              {v}
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={17} />
          <input
            placeholder="Buscar misión"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {items.length ? (
        <div className="cards-grid">
          {items
            .slice()
            .reverse()
            .map((m) => (
              <MissionCard key={m.id} mission={m} state={state} />
            ))}
        </div>
      ) : (
        <Empty
          title="No hay misiones aquí"
          action={
            <a href="#/" className="button">
              Crear una misión
              <ArrowRight size={16} />
            </a>
          }
        />
      )}
    </>
  );
}
function InboxPage({ state, action }) {
  const [tab, setTab] = useState("pending");
  const items = state.approvals.filter((a) =>
    tab === "pending" ? a.status === "pending" : a.status !== "pending",
  );
  return (
    <>
      <PageHeading eyebrow="TÚ TIENES LA ÚLTIMA PALABRA" title="Bandeja" />
      <div className="tabs">
        <button
          className={tab === "pending" ? "active" : ""}
          onClick={() => setTab("pending")}
        >
          Pendientes{" "}
          <b>{state.approvals.filter((a) => a.status === "pending").length}</b>
        </button>
        <button
          className={tab === "resolved" ? "active" : ""}
          onClick={() => setTab("resolved")}
        >
          Resueltas
        </button>
      </div>
      {items.length ? (
        items.map((a) => (
          <article className="approval-card" key={a.id}>
            <div className="row">
              <Avatar bot={state.bots.find((b) => b.id === a.botId)} />
              <div>
                <strong>
                  {state.bots.find((b) => b.id === a.botId)?.name}
                </strong>
                <p className="muted">
                  {state.missions.find((m) => m.id === a.missionId)?.title}
                </p>
              </div>
              <Badge status={a.status} />
            </div>
            <h2>
              {a.tool === "write_file"
                ? "Crear " + a.args.path
                : a.tool === 'apps_execute' ? a.review?.name : "Guardar un recuerdo compartido"}
            </h2>
            <details>
              <summary>Revisar contenido completo</summary>
              <pre>{a.tool === 'apps_execute' ? JSON.stringify(a.review?.arguments, null, 2) : a.args.content || a.args.text}</pre>
            </details>
            <div className="row">
              <a href={"#/mission/" + a.missionId} className="text-link">
                Ver contexto
                <ArrowUpRight size={15} />
              </a>
              <span className="spacer" />
              {a.status === "pending" && a.tool === 'apps_execute' && (
                <a className="button yellow" href={'/connections/Permissions.dc.html?approval=' + encodeURIComponent(a.id)}>Revisar acción</a>
              )}
              {a.status === "pending" && a.tool !== 'apps_execute' && (
                <>
                  <button
                    className="button"
                    onClick={() =>
                      action(
                        () =>
                          api(
                            "/approvals/" + encodeURIComponent(a.id),
                            "POST",
                            { decision: "denied" },
                          ),
                        "Acción denegada",
                      )
                    }
                  >
                    <X size={16} />
                    Denegar
                  </button>
                  <button
                    className="button yellow"
                    onClick={() =>
                      action(
                        () =>
                          api(
                            "/approvals/" + encodeURIComponent(a.id),
                            "POST",
                            { decision: "approved" },
                          ),
                        "Aprobación guardada",
                      )
                    }
                  >
                    <Check size={16} />
                    Aprobar
                  </button>
                </>
              )}
            </div>
          </article>
        ))
      ) : (
        <Empty
          icon={CheckCircle2}
          title={
            tab === "pending"
              ? "Todo al día"
              : "Todavía no hay decisiones resueltas"
          }
        >
          Las decisiones de tu equipo aparecerán aquí.
        </Empty>
      )}
    </>
  );
}
function TeamPage({ state }) {
  return (
    <>
      <PageHeading
        eyebrow="DISTINTOS TALENTOS. UN MISMO OBJETIVO."
        title="Tu equipo"
        action={
          <a href="#/newbot" className="button dark">
            <Plus size={17} />
            Nuevo bot
          </a>
        }
      />
      <div className="bot-grid">
        {state.bots.map((b) => (
          <article
            className={"bot-card " + (!b.enabled ? "disabled" : "")}
            key={b.id}
          >
            <div className="row between">
              <Avatar bot={b} size={54} />
              <span className="pill">
                {b.id === "atlas"
                  ? "Coordinador"
                  : b.enabled
                    ? "Disponible"
                    : "En pausa"}
              </span>
            </div>
            <h2>{b.name}</h2>
            <span
              className="bot-role"
              style={{ color: b.color === "#FFC93C" ? "#785700" : b.color }}
            >
              {b.role}
            </span>
            <p>{b.instructions}</p>
            <div className="bot-card-footer">
              <a href={"#/chat/" + b.id} className="button dark">
                <MessageSquare size={16} />
                Hablar
              </a>
              <a href={"#/bot/" + b.id} className="text-link">
                Ver perfil
                <ArrowUpRight size={15} />
              </a>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function BotEditor({ state, action, bot, onSaved }) {
  const [form, setForm] = useState(
      bot || {
        name: "",
        role: "",
        instructions: "",
        color: "#2F6BFF",
        shape: "circle",
        enabled: true,
      },
    ),
    [busy, setBusy] = useState(false);
  const file = useRef();
  const set = (key, value) => setForm((s) => ({ ...s, [key]: value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const data = Object.fromEntries(
      ["name", "role", "instructions", "color", "shape", "enabled"].map((k) => [
        k,
        form[k],
      ]),
    );
    const result = await action(
      () =>
        api(bot ? "/bots/" + bot.id : "/bots", bot ? "PATCH" : "POST", data),
      bot ? "Perfil actualizado" : "Bot incorporado a tu equipo",
    );
    setBusy(false);
    if (result) {
      if (onSaved) onSaved();
      else go("bot/" + result.id);
    }
  };
  return (
    <>
      {!bot && (
        <PageHeading
          eyebrow="UN NUEVO TALENTO EN TU COLMENA"
          title="Nuevo bot"
        />
      )}
      <form className="editor-grid" onSubmit={submit}>
        <div className="form-fields">
          <label>
            Nombre
            <input
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="¿Cómo se llama?"
            />
          </label>
          <label>
            Especialidad
            <input
              required
              maxLength={100}
              value={form.role}
              onChange={(e) => set("role", e.target.value)}
              placeholder="Por ejemplo, atención al cliente"
            />
          </label>
          <label>
            Rol, personalidad e instrucciones
            <textarea
              required
              minLength={10}
              maxLength={12000}
              rows={9}
              value={form.instructions}
              onChange={(e) => set("instructions", e.target.value)}
              placeholder="Qué hace, cómo trabaja y qué esperas de él."
            />
          </label>
          <input
            ref={file}
            type="file"
            accept=".md,.txt"
            hidden
            onChange={async (e) => {
              const f = e.target.files[0];
              if (f)
                await action(async () => {
                  if (f.size > 12000)
                    throw Error("El perfil admite hasta 12 KB.");
                  set("instructions", await f.text());
                });
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="button align-start"
            onClick={() => file.current.click()}
          >
            <Upload size={16} />
            Importar SOUL.md o IDENTITY.md
          </button>
          <button className="button yellow align-start" disabled={busy}>
            {busy
              ? "Guardando..."
              : bot
                ? "Guardar cambios"
                : "Incorporar al equipo"}
            <ArrowRight size={17} />
          </button>
        </div>
        <aside className="identity-preview">
          <Avatar bot={form} size={90} />
          <h2>{form.name || "Tu nuevo bot"}</h2>
          <p>{form.role || "Una nueva especialidad"}</p>
          <fieldset>
            <legend>Color</legend>
            <div className="swatches">
              {[
                "#FFC93C",
                "#2F6BFF",
                "#0B8A5F",
                "#FF5CA8",
                "#7B4DFF",
                "#FF7A1A",
              ].map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  aria-label={"Color " + c}
                  aria-pressed={form.color === c}
                  style={{ background: c }}
                  onClick={() => set("color", c)}
                >
                  {form.color === c && <Check size={17} />}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Forma</legend>
            <div className="swatches">
              {["hex", "circle", "square", "diamond", "leaf", "arch"].map(
                (shape) => (
                  <button
                    key={shape}
                    type="button"
                    title={shape}
                    aria-label={"Forma " + shape}
                    aria-pressed={form.shape === shape}
                    onClick={() => set("shape", shape)}
                  >
                    <Avatar bot={{ ...form, shape, name: " " }} size={25} />
                  </button>
                ),
              )}
            </div>
          </fieldset>
          {bot && bot.id !== "atlas" && (
            <label className="switch-row">
              Bot disponible
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => set("enabled", e.target.checked)}
              />
            </label>
          )}
        </aside>
      </form>
    </>
  );
}
function BotProfile(ctx) {
  const bot = ctx.state.bots.find((b) => b.id === ctx.botId),
    [tab, setTab] = useState("role");
  if (!bot) return <Empty title="Bot no encontrado" />;
  return (
    <>
      <div className="profile-heading">
        <Avatar bot={bot} size={72} />
        <div>
          <p className="eyebrow">{bot.role}</p>
          <h1>{bot.name}</h1>
        </div>
        <a href={"#/chat/" + bot.id} className="button dark">
          <MessageSquare size={17} />
          Hablar con {bot.name}
        </a>
      </div>
      <div className="tabs">
        {[
          ["role", "Rol y personalidad"],
          ["memory", "Memoria"],
          ["activity", "Actividad"],
        ].map(([k, l]) => (
          <button
            key={k}
            className={tab === k ? "active" : ""}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "role" ? (
        <BotEditor {...ctx} bot={bot} />
      ) : tab === "memory" ? (
        <MemoryList {...ctx} botId={bot.id} />
      ) : (
        <div className="cards-grid">
          {ctx.state.missions
            .filter((m) => m.botIds.includes(bot.id))
            .map((m) => (
              <MissionCard key={m.id} mission={m} state={ctx.state} />
            ))}
          {!ctx.state.missions.some((m) => m.botIds.includes(bot.id)) && (
            <Empty title="Todavía no ha participado en una misión" />
          )}
        </div>
      )}
    </>
  );
}

function ChatPage(ctx) {
  const bot = ctx.state.bots.find((b) => b.id === ctx.botId);
  const history = ctx.state.missions.filter(
    (m) => m.mode === "solo" && m.botIds.includes(ctx.botId),
  );
  if (!bot) return <Empty title="Bot no encontrado" />;
  return (
    <div className="chat-layout">
      <section>
        <div className="chat-heading">
          <Avatar bot={bot} size={45} />
          <div>
            <h1>{bot.name}</h1>
            <p>{bot.role}</p>
          </div>
          <a href={"#/bot/" + bot.id} className="text-link">
            Ver perfil
            <ArrowUpRight size={16} />
          </a>
        </div>
        <div className="chat-history">
          {!history.length && (
            <Empty icon={MessageSquare} title={"Hola, soy " + bot.name + "."}>
              {bot.instructions}
            </Empty>
          )}
          {history.slice(-10).map((m) => (
            <div key={m.id} className="chat-turn">
              <div className="user-message">{m.prompt}</div>
              <div className="assistant-message">
                <Avatar bot={bot} size={28} />
                <div>
                  {m.result ? (
                    <Mark>{m.result}</Mark>
                  ) : (
                    <Badge status={m.status} />
                  )}
                  <a href={"#/mission/" + m.id} className="text-link">
                    Ver misión
                    <ArrowUpRight size={14} />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
        <Composer
          {...ctx}
          botId={bot.id}
          compact
          onCreated={(m) => go("mission/" + m.id)}
        />
      </section>
      <aside className="chat-aside">
        <h3>Sobre {bot.name}</h3>
        <p>{bot.instructions}</p>
        <hr />
        <ShieldCheck size={22} />
        <h3>Permisos</h3>
        <p>
          Archivos de la misión. Escrituras y nuevos recuerdos con tu
          aprobación.
        </p>
        <a href={"#/bot/" + bot.id} className="text-link">
          Editar perfil
          <ArrowRight size={15} />
        </a>
      </aside>
    </div>
  );
}

function MissionPage(ctx) {
  const { missionId, state, action, revision, live, view } = ctx,
    [mission, setMission] = useState(null);
  useEffect(() => {
    let mounted = true;
    api("/missions/" + missionId)
      .then((m) => {
        if (mounted) setMission(m);
      })
      .catch(() => {
        if (mounted) setMission(false);
      });
    return () => {
      mounted = false;
    };
  }, [missionId, revision]);
  if (mission === null) return <p>Cargando misión...</p>;
  if (!mission) return <Empty title="Misión no encontrada" />;
  const control = (command) =>
    action(() =>
      api("/missions/" + mission.id + "/control", "POST", { action: command }),
    );
  return (
    <>
      <div className="mission-heading">
        <a className="back" href="#/missions" aria-label="Volver a misiones">
          <ChevronLeft size={22} />
        </a>
        <div>
          <p className="eyebrow">
            {modeLabels[mission.mode]} ·{" "}
            {new Date(mission.createdAt).toLocaleDateString("es")}
          </p>
          <h1>{mission.title}</h1>
        </div>
        <Badge status={mission.status} />
      </div>
      <div className="toolbar">
        <div className="tabs">
          {[
            ["room", "Sala", MessageSquare],
            ["live", "En directo", Activity],
            ["timeline", "Línea de tiempo", History],
            ...(mission.mode === "debate"
              ? [["debate", "Propuestas", MessagesSquare]]
              : []),
          ].map(([key, label, Icon]) => (
            <a
              key={key}
              className={view === key ? "active" : ""}
              href={"#/mission/" + mission.id + "/" + key}
            >
              <Icon size={16} />
              {label}
            </a>
          ))}
        </div>
        <div className="row">
          {mission.status === "running" ? (
            <IconButton label="Pausar misión" onClick={() => control("pause")}>
              <Pause size={18} />
            </IconButton>
          ) : (
            ["paused", "blocked"].includes(mission.status) && (
              <button className="button" onClick={() => control("resume")}>
                <Play size={15} />
                Continuar
              </button>
            )
          )}
          {!["completed", "cancelled"].includes(mission.status) && (
            <IconButton
              label="Cancelar misión"
              onClick={() => control("cancel")}
            >
              <Square size={16} />
            </IconButton>
          )}
        </div>
      </div>
      {mission.error && (
        <div className="inline-error">
          <AlertCircle size={19} />
          {mission.error}
        </div>
      )}
      {mission.status === "waiting" && (
        <div className="connection-banner">
          <ShieldCheck size={22} />
          <strong>El equipo necesita tu decisión para continuar.</strong>
          <a href="#/inbox" className="button yellow">
            Revisar Bandeja
            <ArrowRight size={16} />
          </a>
        </div>
      )}
      {view === "live" ? (
        <div className="live-grid">
          {mission.steps.map((step) => {
            const b = state.bots.find((b) => b.id === step.botId);
            return (
              <article className="live-card" key={step.id}>
                <div className="row">
                  <Avatar bot={b} />
                  <div>
                    <h3>{b.name}</h3>
                    <small>{step.kind}</small>
                  </div>
                  <Badge status={step.status} />
                </div>
                <div className="live-output">
                  {live[step.id] ? (
                    <>
                      <pre>{live[step.id]}</pre>
                      <span className="stream-label">Respuesta en curso</span>
                    </>
                  ) : step.text ? (
                    <Mark>{step.text}</Mark>
                  ) : (
                    <div className="live-idle">
                      <Activity
                        size={24}
                        className={step.status === "running" ? "pulse" : ""}
                      />
                      <span>
                        {step.status === "running"
                          ? "Preparando su respuesta"
                          : step.status === "waiting"
                            ? "Esperando tu decisión"
                            : "Esperando su turno"}
                      </span>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : view === "timeline" ? (
        <div className="timeline">
          {mission.events.map((e) => (
            <div className="timeline-event" key={e.id}>
              <time>
                {new Date(e.at).toLocaleTimeString("es", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </time>
              <span className="timeline-dot" />
              <div>
                {e.botId && (
                  <strong>
                    {state.bots.find((b) => b.id === e.botId)?.name}
                  </strong>
                )}
                <p>{e.text}</p>
              </div>
            </div>
          ))}
        </div>
      ) : view === "debate" ? (
        <>
          <div className="proposal-grid">
            {mission.steps
              .filter((s) => s.kind === "proposal")
              .map((s) => {
                const b = state.bots.find((b) => b.id === s.botId);
                return (
                  <article className="proposal" key={s.id}>
                    <Avatar bot={b} size={44} />
                    <h2>Propuesta de {b.name}</h2>
                    {s.text ? (
                      <Mark>{s.text}</Mark>
                    ) : (
                      <Badge status={s.status} />
                    )}
                    <button
                      className="button yellow"
                      disabled={mission.status !== "awaiting_choice"}
                      onClick={() =>
                        action(
                          () =>
                            api("/missions/" + mission.id + "/choose", "POST", {
                              botId: b.id,
                            }),
                          "Propuesta elegida",
                        )
                      }
                    >
                      <Check size={16} />
                      {mission.chosenBotId === b.id
                        ? "Elegida"
                        : "Elegir propuesta"}
                    </button>
                  </article>
                );
              })}
          </div>
          {mission.steps
            .filter((s) => s.kind === "critique" && s.text)
            .map((s) => (
              <article className="critique" key={s.id}>
                <h3>
                  La valoración de{" "}
                  {state.bots.find((b) => b.id === s.botId)?.name}
                </h3>
                <Mark>{s.text}</Mark>
              </article>
            ))}
        </>
      ) : (
        <div className="room-layout">
          <section>
            <div className="user-brief">
              <span className="eyebrow">TU ENCARGO</span>
              <p>{mission.prompt}</p>
            </div>
            {mission.messages.map((m) => (
              <article className="room-message" key={m.id}>
                <Avatar
                  bot={state.bots.find((b) => b.id === m.botId)}
                  size={34}
                />
                <div>
                  <div className="row">
                    <strong>
                      {state.bots.find((b) => b.id === m.botId)?.name}
                    </strong>
                    <time>
                      {new Date(m.at).toLocaleTimeString("es", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <Mark>{m.text}</Mark>
                </div>
              </article>
            ))}
            {!mission.messages.length && (
              <Empty
                icon={MessageSquare}
                title={
                  mission.status === "blocked"
                    ? "La misión está esperando"
                    : "Aquí empieza el trabajo del equipo"
                }
              >
                {mission.status === "blocked"
                  ? "Resuelve el bloqueo y pulsa Continuar."
                  : "Las respuestas aparecerán en esta sala."}
              </Empty>
            )}
            {mission.status === "awaiting_choice" && (
              <a
                className="button yellow"
                href={"#/mission/" + mission.id + "/debate"}
              >
                Comparar propuestas
                <ArrowRight size={17} />
              </a>
            )}
            {mission.result && (
              <div className="result-footer">
                <CheckCircle2 size={20} />
                <strong>Entrega guardada</strong>
                <button
                  className="button"
                  onClick={() =>
                    download(mission.title + ".md", mission.result)
                  }
                >
                  <Download size={16} />
                  Descargar
                </button>
              </div>
            )}
          </section>
          <aside className="mission-aside">
            <h3>Quién hace qué</h3>
            {mission.steps.map((s) => (
              <div className="step-summary" key={s.id}>
                <Avatar
                  bot={state.bots.find((b) => b.id === s.botId)}
                  size={27}
                />
                <div>
                  <strong>
                    {state.bots.find((b) => b.id === s.botId)?.name}
                  </strong>
                  <Badge status={s.status} />
                </div>
              </div>
            ))}
            <hr />
            <h3>Aprendizaje</h3>
            <p className="muted">
              {mission.learningStatus === "completed"
                ? "Reflexión terminada. Las propuestas están en Biblioteca."
                : mission.learningStatus === "failed"
                  ? "No se pudo completar la reflexión."
                  : mission.learningStatus === "running"
                    ? "Extrayendo aprendizajes..."
                    : "Al terminar la misión."}
            </p>
          </aside>
        </div>
      )}
    </>
  );
}

function AutomationsPage({ state, action }) {
  const [open, setOpen] = useState(false),
    [form, setForm] = useState({
      name: "",
      prompt: "",
      botId: "vera",
      intervalMinutes: 1440,
      enabled: true,
    });
  const submit = async (e) => {
    e.preventDefault();
    const result = await action(
      () => api("/automations", "POST", form),
      "Automatización creada",
    );
    if (result) setOpen(false);
  };
  return (
    <>
      <PageHeading
        eyebrow="EL TRABAJO QUE VUELVE, RESUELTO"
        title="Automatizaciones"
        action={
          <button className="button dark" onClick={() => setOpen(!open)}>
            <Plus size={17} />
            Nueva automatización
          </button>
        }
      />
      <p className="muted schedule-note">
        <Clock3 size={16} />
        Se ejecutan mientras Colmena está abierta.
      </p>
      {open && (
        <form className="automation-form" onSubmit={submit}>
          <h2>Nueva automatización</h2>
          <div className="form-row">
            <label>
              Nombre
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Bot
              <select
                value={form.botId}
                onChange={(e) => setForm({ ...form, botId: e.target.value })}
              >
                {state.bots
                  .filter((b) => b.enabled)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Cada
              <select
                value={form.intervalMinutes}
                onChange={(e) =>
                  setForm({ ...form, intervalMinutes: Number(e.target.value) })
                }
              >
                {[
                  [5, "5 minutos"],
                  [60, "Hora"],
                  [1440, "24 horas"],
                  [10080, "7 días"],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Encargo
            <textarea
              required
              rows={3}
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            />
          </label>
          <div className="row">
            <button className="button yellow">
              Guardar
              <Check size={16} />
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setOpen(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      {state.automations.length ? (
        <div className="automation-list">
          {state.automations.map((a) => (
            <article key={a.id}>
              <Avatar bot={state.bots.find((b) => b.id === a.botId)} />
              <div>
                <h3>{a.name}</h3>
                <p>{a.prompt}</p>
                {a.error && <p className="error-text">{a.error}</p>}
                <span className="muted">
                  Próxima: {new Date(a.nextRun).toLocaleString("es")}
                </span>
                {a.lastMissionId && (
                  <a
                    className="text-link"
                    href={"#/mission/" + a.lastMissionId}
                  >
                    Última ejecución
                    <ArrowUpRight size={14} />
                  </a>
                )}
              </div>
              <label className="switch-row">
                <span>{a.enabled ? "Activa" : "En pausa"}</span>
                <input
                  aria-label={"Activar " + a.name}
                  type="checkbox"
                  checked={a.enabled}
                  onChange={(e) =>
                    action(() =>
                      api("/automations/" + a.id, "PATCH", {
                        enabled: e.target.checked,
                      }),
                    )
                  }
                />
              </label>
            </article>
          ))}
        </div>
      ) : (
        !open && (
          <Empty
            icon={Clock3}
            title="Dale una rutina a tu equipo"
            action={
              <button className="button" onClick={() => setOpen(true)}>
                <Plus size={16} />
                Crear automatización
              </button>
            }
          />
        )
      )}
    </>
  );
}

function MemoryList({ state, action, botId }) {
  const [text, setText] = useState("");
  const memories = state.memories.filter((m) => !botId || m.botId === botId);
  return (
    <>
      <form
        className="memory-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await action(
              () => api("/memories", "POST", { text }),
              "Recuerdo guardado",
            )
          )
            setText("");
        }}
      >
        <label className="sr-only" htmlFor="memory">
          Nuevo recuerdo
        </label>
        <input
          id="memory"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          placeholder="Una preferencia que tu equipo debe recordar"
          required
        />
        <button className="button dark">
          <Plus size={17} />
          Guardar
        </button>
      </form>
      {memories.length ? (
        memories.map((m) => (
          <article className="memory-item" key={m.id}>
            <Brain size={20} />
            <p>{m.text}</p>
            <label className="switch-row">
              <input
                aria-label="Recuerdo activo"
                type="checkbox"
                checked={m.active}
                onChange={(e) =>
                  action(() =>
                    api("/memories/" + encodeURIComponent(m.id), "PATCH", {
                      active: e.target.checked,
                    }),
                  )
                }
              />
            </label>
          </article>
        ))
      ) : (
        <Empty icon={Brain} title="Todavía no hay recuerdos" />
      )}
    </>
  );
}
function LibraryPage(ctx) {
  const { state, action } = ctx,
    [tab, setTab] = useState("artifacts"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(null);
  const file = useRef();
  const pending = state.skills.filter((s) => s.status === "pending").length;
  const importFile = async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f)
      await action(async () => {
        if (f.size > 60000) throw Error("El archivo admite hasta 60 KB.");
        return api("/skills", "POST", {
          content: await f.text(),
          source: f.name,
        });
      }, "Habilidad importada para revisión");
  };
  return (
    <>
      <PageHeading
        eyebrow="EL CONOCIMIENTO SE QUEDA EN CASA"
        title="Biblioteca"
        action={
          <>
            <input
              type="file"
              ref={file}
              accept=".md"
              hidden
              onChange={importFile}
            />
            <button
              className="button dark"
              onClick={() => file.current.click()}
            >
              <Upload size={17} />
              Importar habilidad
            </button>
          </>
        }
      />
      <div className="toolbar">
        <div className="tabs">
          {[
            ["artifacts", "Entregables"],
            [
              "skills",
              "Habilidades" + (pending ? " · " + pending + " por revisar" : ""),
            ],
            ["memory", "Memoria compartida"],
          ].map(([k, l]) => (
            <button
              key={k}
              className={tab === k ? "active" : ""}
              onClick={() => {
                setTab(k);
                setSelected(null);
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={16} />
          <input
            aria-label="Buscar en biblioteca"
            placeholder="Buscar"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {tab === "memory" ? (
        <MemoryList {...ctx} />
      ) : tab === "artifacts" ? (
        <>
          {state.artifacts.length ? (
            <div className="artifact-grid">
              {state.artifacts
                .filter((a) =>
                  a.title.toLowerCase().includes(search.toLowerCase()),
                )
                .map((a) => (
                  <article className="artifact-card" key={a.id}>
                    <div className="document-preview">
                      <FileText size={30} />
                      <span>{a.content.slice(0, 180)}</span>
                    </div>
                    <div className="artifact-info">
                      <small>
                        {a.kind === "file" ? "ARCHIVO" : "DOCUMENTO"} ·{" "}
                        {new Date(a.createdAt).toLocaleDateString("es")}
                      </small>
                      <h3>{a.title}</h3>
                      <div className="row">
                        <button
                          className="text-link"
                          onClick={() => setSelected(a)}
                        >
                          Abrir
                          <ArrowUpRight size={15} />
                        </button>
                        <span className="spacer" />
                        <IconButton
                          label="Descargar entregable"
                          onClick={() =>
                            download(
                              a.title + (a.kind === "document" ? ".md" : ""),
                              a.content,
                            )
                          }
                        >
                          <Download size={17} />
                        </IconButton>
                      </div>
                    </div>
                  </article>
                ))}
            </div>
          ) : (
            <Empty
              icon={FileText}
              title="Tu primera entrega empieza con una misión"
            />
          )}
        </>
      ) : (
        <>
          <div className="catalog-links">
            <a
              href="https://github.com/VoltAgent/awesome-openclaw-skills"
              target="_blank"
              rel="noreferrer"
            >
              <BookOpen size={18} />
              Catálogo OpenClaw
              <ExternalLink size={14} />
            </a>
            <a
              href="https://github.com/will-assistant/openclaw-agents"
              target="_blank"
              rel="noreferrer"
            >
              <Users size={18} />
              Personalidades
              <ExternalLink size={14} />
            </a>
          </div>
          {state.skills.length ? (
            state.skills
              .filter((s) =>
                (s.name + " " + s.description)
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((s) => (
                <article className="skill-row" key={s.id}>
                  <BookOpen size={24} />
                  <div>
                    <button
                      className="text-link"
                      onClick={() => setSelected(s)}
                    >
                      <strong>{s.name}</strong>
                    </button>
                    <p>{s.description}</p>
                    <small>
                      v{s.version} · {s.source} · {s.uses} usos
                    </small>
                  </div>
                  <Badge status={s.status} />
                  <button className="button" onClick={() => setSelected(s)}>
                    Revisar
                    <ArrowRight size={15} />
                  </button>
                </article>
              ))
          ) : (
            <Empty
              icon={BookOpen}
              title="Cada misión puede dejar un aprendizaje"
            />
          )}
        </>
      )}
      {selected && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={selected.title || selected.name}
          >
            <header>
              <h2>{selected.title || selected.name}</h2>
              <IconButton label="Cerrar" onClick={() => setSelected(null)}>
                <X size={20} />
              </IconButton>
            </header>
            <div className="modal-content">
              <Mark>{selected.content}</Mark>
            </div>
            {selected.hash && (
              <footer>
                <Badge status={selected.status} />
                <span className="spacer" />
                <button
                  className="button"
                  onClick={async () => {
                    const result = await action(
                      () =>
                        api("/skills/" + selected.id, "PATCH", {
                          status: "disabled",
                        }),
                      "Habilidad desactivada",
                    );
                    if (result) setSelected(result);
                  }}
                >
                  Desactivar
                </button>
                <button
                  className="button yellow"
                  onClick={async () => {
                    const result = await action(
                      () =>
                        api("/skills/" + selected.id, "PATCH", {
                          status: "active",
                        }),
                      "Versión activada",
                    );
                    if (result) setSelected(result);
                  }}
                >
                  <Check size={17} />
                  Activar esta versión
                </button>
              </footer>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function SettingsPage({ state, action }) {
  const [connecting, setConnecting] = useState(false),
    [loading, setLoading] = useState(false),
    [authUrl, setAuthUrl] = useState("");
  const login = async () => {
    setConnecting(true);
    const result = await action(() => api("/auth/start", "POST", {}));
    if (result) {
      setAuthUrl(result.url);
      window.open(result.url, "_blank", "noopener,noreferrer");
    }
    setConnecting(false);
  };
  const models = async () => {
    setLoading(true);
    await action(() => api("/auth/models", "POST", {}), "Modelos actualizados");
    setLoading(false);
  };
  return (
    <>
      <PageHeading eyebrow="TU CUENTA. TUS REGLAS." title="Ajustes" />
      <div className="settings-section">
        <div>
          <Plug size={24} />
          <h2>Login with ChatGPT</h2>
          <p>Conecta una cuenta propia para Colmena.</p>
        </div>
        <section>
          {state.account ? (
            <>
              <div className="account">
                <CheckCircle2 size={24} />
                <div>
                  <strong>{state.account.label}</strong>
                  <p>
                    {state.account.persistent
                      ? "Sesión cifrada en este ordenador"
                      : "Sesión en memoria"}
                  </p>
                </div>
              </div>
              <div className="row">
                <button className="button" onClick={models} disabled={loading}>
                  <RefreshCw size={16} className={loading ? "spin" : ""} />
                  {loading ? "Consultando..." : "Consultar modelos"}
                </button>
                <button
                  className="button"
                  onClick={() =>
                    action(
                      () => api("/auth/logout", "POST", {}),
                      "Sesión desconectada",
                    )
                  }
                >
                  <LogOut size={16} />
                  Desconectar
                </button>
              </div>
            </>
          ) : (
            <button
              className="button dark"
              onClick={login}
              disabled={connecting}
            >
              <Plug size={18} />
              {connecting ? "Abriendo..." : "Login with ChatGPT"}
              <ArrowUpRight size={16} />
            </button>
          )}
          {state.authError && <p className="error-text">{state.authError}</p>}
          {!state.account && authUrl && (
            <p className="auth-link">
              <a
                href={authUrl}
                target="_blank"
                rel="noreferrer"
                className="text-link"
              >
                Continuar en la página de ChatGPT
                <ExternalLink size={15} />
              </a>
            </p>
          )}
          <label className="model-select">
            Modelo
            <select
              disabled={!state.models?.length}
              value={state.settings.model}
              onChange={(e) =>
                action(() =>
                  api("/settings", "PATCH", { model: e.target.value }),
                )
              }
            >
              <option value="">
                {state.account
                  ? "Consulta los modelos de tu cuenta"
                  : "Conecta ChatGPT primero"}
              </option>
              {state.models?.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.display_name || m.name || m.slug}
                </option>
              ))}
            </select>
          </label>
        </section>
      </div>
      <div className="settings-section">
        <div>
          <Brain size={24} />
          <h2>Aprendizaje continuo</h2>
          <p>El equipo aprende de sus misiones terminadas.</p>
        </div>
        <section>
          <label className="switch-row">
            <span>
              <strong>Proponer nuevas habilidades</strong>
              <small>
                Las nuevas versiones quedan en Biblioteca para tu revisión.
              </small>
            </span>
            <input
              type="checkbox"
              checked={state.settings.learning}
              onChange={(e) =>
                action(() =>
                  api("/settings", "PATCH", { learning: e.target.checked }),
                )
              }
            />
          </label>
        </section>
      </div>
      <div className="settings-section">
        <div>
          <ShieldCheck size={24} />
          <h2>Permisos y datos</h2>
        </div>
        <section>
          <div className="setting-line">
            <strong>Archivos</strong>
            <span>Carpeta de cada misión</span>
          </div>
          <div className="setting-line">
            <strong>Escrituras y recuerdos</strong>
            <span>Aprobación por acción</span>
          </div>
          <div className="setting-line">
            <strong>Conexiones externas</strong>
            <a href="/connections/Connections.dc.html">Conexiones</a>
          </div>
          <div className="setting-line">
            <strong>Datos locales</strong>
            <code>{state.workspace}</code>
          </div>
        </section>
      </div>
      <footer className="settings-footer">
        <Hexagon size={18} />
        Colmena · 0.1.0 <span>SOUL de OpenClaw · OAuth de NEXO</span>
      </footer>
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
