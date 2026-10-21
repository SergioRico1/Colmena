import { useSlidingPill } from "../lib/useSlidingPill.js";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SkeletonLines } from "../components/Skeleton.jsx";
import { useFileDrop, dropOverlay } from "../lib/useFileDrop.js";
import { css } from "../design/css/Main.js";
import Sidebar from "../components/Sidebar.jsx";
import { MissionCard } from "../components/home/MissionCards.jsx";
import { ContinueChips, H2, KICKER, RecentDone, StatusSentence, TodayCard, WaitingCard } from "../components/home/HomeSections.jsx";
import { Avatar, BotPopover, isToday, joinNames, matchBots, mentionAt, mentionedBots, openPalette, sortPending } from "../components/home/shared.jsx";
import { useAction, useStore } from "../lib/store.jsx";
import { pickFiles, post } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { botById } from "../lib/bots.js";
import { greeting, needsYou, roomUrl, time, todayLabel } from "../lib/format.js";
import { BellButton, NotificationCard, NotificationsPanel } from "../components/notifications/Notifications.jsx";
import { SuggestionCard, WeeklyDigestCard } from "../components/interaction/Ideas.jsx";
import { MicButton, appendDictation } from "../components/interaction/Voice.jsx";

const MODES = [
  { id: "solo", label: "Un bot", desc: "Hablas con un bot concreto. Lo más rápido para dudas y tareas cortas." },
  { id: "equipo", label: "Equipo", desc: "Atlas divide el encargo, reparte el trabajo entre los bots adecuados y te trae un único resultado." },
  { id: "debate", label: "Debate", desc: "Varios bots proponen enfoques distintos, se critican entre ellos y tú eliges el ganador." },
];
const DEBATE_DEFAULT = ["nora", "iris", "vera"];
const SAFETY = [
  { id: "preguntar", label: "Pregúntame antes de enviar nada fuera", hint: "Correos, mensajes o publicaciones esperan tu OK en la Bandeja." },
  { id: "avisar", label: "Avísame y sigue", hint: "Lo envían sin esperar y te lo cuentan en la Bandeja." },
];
const SUGGESTIONS = [
  "Resume los correos de ayer y dime cuáles piden respuesta",
  "Compara tres programas de contabilidad para nosotros",
  "Convierte este Excel en 5 diapositivas",
];

const ERROR = { margin: "0", fontSize: "13px", color: "#B4372A", fontWeight: "600" };

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export default function Main({ query = {} }) {
  const store = useStore();
  const { bots, missions, approvals, automations, connectors, account, provider, authError, ready, suggestions = [], weeklyDigest = null, artifacts = [], people = [] } = store;
  const ideas = suggestions.filter((s) => s.kind === "idea" || s.kind === "automation").slice(0, 2);
  const team = bots.filter((b) => b.enabled !== false);

  // ── Compositor ────────────────────────────────────────────────
  const initialMode = MODES.some((d) => d.id === query.modo) ? query.modo : "equipo";
  const [mode, setMode] = useState(initialMode);
  useEffect(() => {
    if (MODES.some((d) => d.id === query.modo)) setMode(query.modo);
  }, [query.modo]);
  const [text, setText] = useState("");
  // Templates (Misiones, Biblioteca) hand over a draft through sessionStorage.
  useEffect(() => {
    try {
      const draft = JSON.parse(sessionStorage.getItem("colmena:draft") || "null");
      sessionStorage.removeItem("colmena:draft");
      if (draft?.text) setText(String(draft.text));
      if (MODES.some((d) => d.id === draft?.mode)) setMode(draft.mode);
    } catch {}
  }, []);
  const [files, setFiles] = useState([]);
  const [safety, setSafety] = useState("preguntar");
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [mention, setMention] = useState(null); // { query, start }
  const [mentionIndex, setMentionIndex] = useState(0);
  const [formError, setFormError] = useState(null);
  const [starting, setStarting] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const area = useRef(null);
  const safetyRef = useRef(null);

  const mentioned = useMemo(() => mentionedBots(text, team), [text, team]);
  const options = mention ? matchBots(team, mention.query).slice(0, 6) : [];
  const popoverOpen = Boolean(mention) && options.length > 0;
  const def = MODES.find((d) => d.id === mode) || MODES[1];
  const [modesRef, modePill] = useSlidingPill(mode);

  const soloBot = mentioned[0] || botById(team, "nora") || team.find((b) => b.id !== "atlas") || team[0];
  const debateBots = mentioned.length >= 2 ? mentioned : DEBATE_DEFAULT.map((id) => botById(team, id)).filter(Boolean);
  const target = mode === "solo"
    ? `Para: @${soloBot?.name || "Nora"} · cambia con @`
    : mode === "debate"
      ? `Para: ${joinNames(debateBots.map((b) => b.name))} · debatirán`
      : `Para: el equipo · coordina ${botById(team, "atlas")?.name || "Atlas"}`;

  const updateMention = (value, caret) => {
    const m = mentionAt(value, caret);
    setMention(m);
    setMentionIndex(0);
  };

  const pickBot = (b) => {
    if (!mention) return;
    const el = area.current;
    const caret = el ? el.selectionStart : text.length;
    const insert = `@${b.name} `;
    const next = text.slice(0, mention.start) + insert + text.slice(caret);
    setText(next);
    setMention(null);
    const pos = mention.start + insert.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const start = async () => {
    const prompt = text.trim();
    if (!prompt) {
      setFormError("Escribe qué necesitas para que el equipo pueda empezar.");
      area.current?.focus();
      return;
    }
    if (starting) return;
    const botIds = mode === "solo" ? [soloBot?.id || "nora"] : mode === "debate" ? debateBots.map((b) => b.id) : [];
    setStarting(true);
    setFormError(null);
    try {
      const created = await store.run(() => post("/missions", {
        prompt,
        mode,
        botIds,
        safety,
        attachments: files.map(({ name, content, encoding }) => ({ name, content, encoding: encoding || "utf8" })),
      }));
      const m = created?.mission || created;
      // Launched from a goal's milestone («Lanzar misión para este hito»): link it.
      try {
        const goal = JSON.parse(sessionStorage.getItem("colmena:goal") || "null");
        sessionStorage.removeItem("colmena:goal");
        if (goal?.goalId && m?.id) await post(`/goals/${encodeURIComponent(goal.goalId)}/link`, { missionId: m.id, milestoneId: goal.milestoneId || undefined });
      } catch {}
      setText("");
      setFiles([]);
      navigate(m?.id ? roomUrl(m) : "/misiones");
    } catch (e) {
      setFormError(e.message || "No se pudo empezar la misión.");
    } finally {
      setStarting(false);
    }
  };

  const onKeyDown = (e) => {
    if (popoverOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => (i + 1) % options.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => (i - 1 + options.length) % options.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickBot(options[mentionIndex] || options[0]); return; }
      if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      start();
    }
  };

  const addFiles = useCallback((picked) => {
    setFormError(null);
    setFiles((prev) => {
      const merged = [...prev.filter((f) => !picked.some((p) => p.name === f.name)), ...picked];
      if (merged.length > 5) { setFormError("Máximo cinco archivos."); return prev; }
      return merged;
    });
  }, []);
  const drop = useFileDrop(addFiles, setFormError);
  const attach = async () => {
    setFormError(null);
    try {
      const picked = await pickFiles();
      const merged = [...files.filter((f) => !picked.some((p) => p.name === f.name)), ...picked];
      if (merged.length > 5) throw Error("Máximo cinco archivos.");
      setFiles(merged);
    } catch (e) {
      setFormError(e.message);
    }
  };

  useEffect(() => {
    if (!safetyOpen) return;
    const close = (e) => {
      if (e.type === "keydown" ? e.key === "Escape" : !safetyRef.current?.contains(e.target)) setSafetyOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [safetyOpen]);

  // ── Datos ─────────────────────────────────────────────────────
  const active = missions
    .filter((m) => !m.conversation && !["completed", "cancelled"].includes(m.status))
    .sort((a, b) => Number(needsYou(b)) - Number(needsYou(a)) || Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));
  const working = active.filter((m) => ["running", "planning"].includes(m.status));
  const pending = [...sortPending(approvals), ...approvals.filter((a) => a.status === "expired")];
  const connected = connectors.filter((c) => c.connected).length;
  const noAccount = ready && !account && !provider?.kind;
  // While the first state loads, «Te espera» keeps the height it had last time (no jump).
  const WAIT_KEY = "colmena:home-waiting-height";
  const [waitHeight] = useState(() => { try { return Number(localStorage.getItem(WAIT_KEY)) || 0; } catch { return 0; } });
  useLayoutEffect(() => {
    if (!ready) return;
    const h = document.getElementById("te-espera")?.offsetHeight || 0;
    try { localStorage.setItem(WAIT_KEY, String(h)); } catch {}
  });
  // «Buenos días, Marina.» — the status of everything goes in one sentence below.
  const me = people.find((x) => x.self);
  const firstName = me?.name && me.name !== "Tu cuenta" ? me.name.split(/\s+/)[0] : null;
  const headline = firstName ? greeting().replace(/\.$/, ", " + firstName + ".") : greeting();
  // Rooms by last activity, for «Seguir con».
  const rooms = missions.filter((m) => !m.conversation && m.status !== "cancelled")
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));

  const today = [];
  for (const a of automations) {
    const bot = botById(bots, a.botId);
    if (isToday(a.lastRun)) today.push({ key: a.id + ":last", at: a.lastRun, a, bot, done: true });
    if (isToday(a.nextRun) && Date.parse(a.nextRun) > Date.now()) today.push({ key: a.id + ":next", at: a.nextRun, a, bot, done: false });
  }
  today.sort((x, y) => Date.parse(x.at) - Date.parse(y.at));

  return (
    <>
      <style>{css}</style>
      <div style={{ minHeight: "100vh", display: "flex", flexWrap: "wrap", background: "#EEF0F4" }}>
        <Sidebar variant="home" active="inicio" />
        <main style={{ flex: "999 1 560px", minWidth: "0", padding: "20px clamp(16px, 3vw, 40px) 56px", display: "flex", flexDirection: "column", gap: "32px" }}>
          <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
            <label style={{ flex: "1 1 320px", display: "flex", alignItems: "center", gap: "10px", height: "46px", padding: "0 14px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "12px", color: "#555A68", cursor: "text" }} onMouseDown={(e) => { e.preventDefault(); openPalette(); }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></svg>
              <input
                type="search"
                aria-label="Buscar o dar una orden"
                aria-haspopup="dialog"
                placeholder="Busca salas, archivos y bots"
                value=""
                readOnly
                onKeyDown={(e) => {
                  if (e.key === "Tab" || e.key === "Shift" || e.metaKey || e.ctrlKey || e.altKey) return;
                  e.preventDefault();
                  openPalette(e.key.length === 1 ? e.key : "");
                }}
                style={{ flex: "1", minWidth: "0", border: "0", outline: "none", background: "transparent", fontSize: "15px" }}
              />
              <span style={{ font: "500 12px/1 'Geist Mono', monospace", padding: "5px 7px", border: "1px solid #DCE0E8", borderRadius: "6px", color: "#555A68" }}>⌘K</span>
            </label>
            <BellButton expanded={noticesOpen} onClick={() => setNoticesOpen(true)} />
          </header>
          <NotificationsPanel open={noticesOpen} onClose={() => setNoticesOpen(false)} />

          <section aria-labelledby="saludo" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxWidth: "820px" }}>
              <p style={{ margin: "0", font: "500 13px/1 'Geist Mono', monospace", letterSpacing: "0.08em", textTransform: "uppercase", color: "#555A68" }}>{capital(todayLabel())}</p>
              <h1 id="saludo" style={{ margin: "0", font: "800 clamp(30px, 3.6vw, 44px)/1.04 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.025em", textWrap: "balance" }}>{headline}</h1>
              {ready ? <StatusSentence pending={pending} working={working} team={team} /> : <SkeletonLines lines={1} label="Cargando tu equipo" style={{ width: "360px", maxWidth: "100%", padding: "6px 0" }} />}
            </div>

            {noAccount ? (
              <div role="status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px 18px", padding: "16px 18px", background: "#FFF4D1", border: "2px solid #12131A", borderRadius: "16px", boxShadow: "6px 6px 0 #FFC93C" }}>
                <span aria-hidden="true" style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", background: "#12131A", color: "#FFC93C", borderRadius: "12px" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5" /></svg>
                </span>
                <div style={{ flex: "1 1 360px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  <strong style={{ fontSize: "16px" }}>Tu equipo aún no puede pensar: falta conectar tu cuenta de IA.</strong>
                  <span style={{ fontSize: "15px", lineHeight: "1.5", color: "#2B2D36" }}>{authError || "Conecta ChatGPT (o una clave) y los bots podrán empezar las misiones que les pidas."}</span>
                </div>
                <a href="/ajustes/ia" style={{ display: "flex", alignItems: "center", height: "46px", padding: "0 20px", background: "#12131A", color: "#FFFFFF", borderRadius: "12px", fontWeight: "700", fontSize: "14px" }}>Conectar ChatGPT</a>
              </div>
            ) : null}

            {ready ? <WaitingCard pending={pending} bots={bots} missions={missions} /> : waitHeight ? (
              <div aria-hidden="true" style={{ height: waitHeight + "px", boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #E6E8EE", borderLeft: "6px solid #EEF0F4", borderRadius: "16px", padding: "18px 20px", display: "flex", flexDirection: "column", gap: "14px", overflow: "hidden" }}>
                <SkeletonLines lines={Math.max(1, Math.min(4, Math.round((waitHeight - 50) / 56)))} />
              </div>
            ) : null}

            <form onSubmit={(e) => { e.preventDefault(); start(); }} {...drop.props} aria-busy={starting ? "true" : "false"} style={{ position: "relative", background: "#FFFFFF", border: "2px solid #12131A", borderRadius: "22px", boxShadow: "8px 8px 0 #FFC93C", padding: "20px 22px", display: "flex", flexDirection: "column", gap: "16px" }}>
              {drop.dragging ? <div aria-hidden="true" style={dropOverlay}>Suelta aquí para adjuntar</div> : null}
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                <div ref={modesRef} role="group" aria-label="Modo de trabajo" className="c-seg" style={{ display: "flex", gap: "4px", padding: "4px", background: "#EEF0F4", borderRadius: "14px" }}>
                  {modePill ? <span aria-hidden="true" className="c-seg-pill" style={{ ...modePill, background: "#12131A", borderRadius: "11px" }} /> : null}
                  {MODES.map((d) => {
                    const on = d.id === mode;
                    return (
                      <button key={d.id} type="button" aria-pressed={on ? "true" : "false"} data-seg-active={on ? "true" : undefined} onClick={() => setMode(d.id)} style={{ height: "44px", padding: "0 18px", border: "0", borderRadius: "11px", cursor: "pointer", fontWeight: "600", fontSize: "14px", display: "flex", alignItems: "center", gap: "8px", background: on && !modePill ? "#12131A" : "transparent", color: on ? "#FFFFFF" : "#12131A", transition: "color 160ms ease" }}>
                        {d.label}
                      </button>
                    );
                  })}
                </div>
                <p style={{ margin: "0", flex: "1 1 280px", fontSize: "14px", lineHeight: "1.45", color: "#555A68" }}>{def.desc}</p>
              </div>
              <label style={{ position: "relative", display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={{ font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" }}>{target}</span>
                <textarea
                  ref={area}
                  rows="2"
                  value={text}
                  placeholder="Describe lo que necesitas. Escribe @ para llamar a un bot concreto."
                  role="combobox"
                  aria-expanded={popoverOpen ? "true" : "false"}
                  aria-controls="mencion-bots"
                  aria-autocomplete="list"
                  aria-activedescendant={popoverOpen ? `mencion-bots-${options[mentionIndex]?.id}` : undefined}
                  onChange={(e) => { setText(e.target.value); setFormError(null); updateMention(e.target.value, e.target.selectionStart); }}
                  onClick={(e) => updateMention(e.target.value, e.target.selectionStart)}
                  onKeyDown={onKeyDown}
                  onBlur={() => setTimeout(() => setMention(null), 120)}
                  style={{ resize: "none", border: "0", outline: "none", fontSize: "20px", lineHeight: "1.4", padding: "0", background: "transparent" }}
                />
                {popoverOpen ? <BotPopover id="mencion-bots" bots={options} active={mentionIndex} onPick={pickBot} onHover={setMentionIndex} style={{ top: "100%", left: "0", marginTop: "6px" }} /> : null}
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                <button type="button" onClick={attach} aria-label={files.length ? `Adjuntar · ${files.length} ${files.length === 1 ? "archivo adjunto" : "archivos adjuntos"}: ${files.map((f) => f.name).join(", ")}` : "Adjuntar"} title={files.map((f) => f.name).join("\n") || undefined} style={{ display: "flex", alignItems: "center", gap: "8px", height: "44px", padding: "0 14px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "12px", cursor: "pointer", fontSize: "14px" }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M20 11.5 12.5 19a5 5 0 0 1-7-7L13 4.5a3.3 3.3 0 0 1 4.7 4.7L10.4 16.5a1.7 1.7 0 0 1-2.4-2.4L15 7" /></svg>
                  Adjuntar
                  {files.length ? <span key={files.length} className="c-pop" style={{ minWidth: "22px", height: "22px", padding: "0 6px", borderRadius: "11px", background: "#12131A", color: "#FFC93C", font: "600 12px/22px 'Geist Mono', monospace", textAlign: "center" }}>{files.length}</span> : null}
                </button>
                <MicButton onText={appendDictation((fn) => { setText(fn); setFormError(null); })} size={44} bordered style={{ borderRadius: "12px", background: "#FFFFFF" }} />
                {files.length ? (
                  <button type="button" onClick={() => setFiles([])} aria-label="Quitar los adjuntos" style={{ width: "36px", height: "36px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "8px", cursor: "pointer", color: "#4A4F5C", marginLeft: "-6px" }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>
                ) : null}
                <button type="button" onClick={() => navigate("/ajustes")} style={{ display: "flex", alignItems: "center", gap: "8px", height: "44px", padding: "0 14px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "12px", cursor: "pointer", fontSize: "14px" }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5" /></svg>
                  {connected === 0 ? "Conectar apps" : connected === 1 ? "1 app conectada" : `${connected} apps conectadas`}
                </button>
                <span ref={safetyRef} style={{ position: "relative", display: "flex" }}>
                  <button type="button" aria-haspopup="menu" aria-expanded={safetyOpen ? "true" : "false"} onClick={() => setSafetyOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: "8px", height: "44px", padding: "0 14px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "12px", cursor: "pointer", fontSize: "14px" }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" /></svg>
                    {SAFETY.find((s) => s.id === safety).label}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                  {safetyOpen ? (
                    <div role="menu" aria-label="Antes de enviar algo fuera" style={{ position: "absolute", zIndex: 30, top: "calc(100% + 6px)", left: "0", width: "min(380px, 86vw)", background: "#FFFFFF", border: "2px solid #12131A", borderRadius: "16px", boxShadow: "6px 6px 0 #FFC93C", padding: "8px", display: "flex", flexDirection: "column", gap: "2px" }}>
                      {SAFETY.map((s) => {
                        const on = s.id === safety;
                        return (
                          <button key={s.id} type="button" role="menuitemradio" aria-checked={on ? "true" : "false"} autoFocus={on} onClick={() => { setSafety(s.id); setSafetyOpen(false); }} style={on
                            ? { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px", padding: "10px 12px", background: "#FFF4D1", border: "1.5px solid #12131A", borderRadius: "12px", cursor: "pointer", textAlign: "left" }
                            : { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px", padding: "10px 12px", background: "transparent", border: "1.5px solid transparent", borderRadius: "12px", cursor: "pointer", textAlign: "left" }}>
                            <strong style={{ fontSize: "15px" }}>{s.label}</strong>
                            <span style={{ fontSize: "13px", lineHeight: "1.4", color: "#4A4F5C" }}>{s.hint}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </span>
                <span style={{ flex: "1" }} />
                <button type="submit" disabled={starting} style={{ display: "flex", alignItems: "center", gap: "10px", height: "48px", padding: "0 22px", background: "#FFC93C", color: "#12131A", border: "2px solid #12131A", borderRadius: "14px", cursor: starting ? "progress" : "pointer", fontWeight: "700", fontSize: "15px", opacity: starting ? "0.6" : "1" }}>
                  Empezar
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
              </div>
              {formError ? <p role="alert" style={ERROR}>{formError}</p> : null}
            </form>
            <ContinueChips rooms={rooms} suggestions={SUGGESTIONS} onSuggest={(s) => { setText(s); setFormError(null); area.current?.focus(); }} />
          </section>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "flex-start" }}>
            <section aria-labelledby="trabajo" style={{ flex: "2 1 520px", minWidth: "0", display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
                <h2 id="trabajo" style={H2}>Tu trabajo</h2>
                <a href="/misiones" style={{ fontSize: "14px", fontWeight: "600", color: "#1F4FD1" }}>Ver todas las misiones</a>
              </div>
              {active.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <span style={KICKER}>{"Abiertas · " + active.length}</span>
                  {active.slice(0, 3).map((m) => <MissionCard key={m.id} m={m} bots={bots} />)}
                  {active.length > 3 ? <a href="/misiones" style={{ fontSize: "14px", fontWeight: "600", color: "#1F4FD1" }}>{"Y " + (active.length - 3) + " más en Misiones"}</a> : null}
                </div>
              ) : null}
              <RecentDone missions={missions} artifacts={artifacts} bots={bots} />
              {!active.length && !missions.some((m) => !m.conversation && m.status === "completed" && Date.parse(m.completedAt || m.updatedAt || 0) > Date.now() - 3 * 864e5) ? (
                <p style={{ margin: "0", padding: "18px 20px", background: "#FFFFFF", border: "1px dashed #C9CCD6", borderRadius: "18px", fontSize: "15px", lineHeight: "1.5", color: "#4A4F5C" }}>
                  {"Pide algo arriba y aquí verás cómo avanza y lo que tu equipo termina."}
                </p>
              ) : null}
            </section>

            <aside aria-label="Hoy e ideas" style={{ flex: "1 1 320px", minWidth: "0", display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Alerts (a failure, Atlas's check-in); finished work shows in «Terminado hace poco». */}
              <NotificationCard onMore={() => setNoticesOpen(true)} filter={(n) => n.kind !== "done"} />
              <TodayCard today={today} />
              <WeeklyDigestCard digest={weeklyDigest} bots={bots} />
              {ideas.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <span style={KICKER}>Ideas de Atlas</span>
                  {ideas.map((x) => <SuggestionCard key={x.id} s={x} bots={bots} />)}
                </div>
              ) : null}
            </aside>
          </div>
        </main>
      </div>
    </>
  );
}
