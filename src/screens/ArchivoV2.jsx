import { useEffect, useMemo, useRef, useState } from "react";
import Shell from "../components/v2/Shell.jsx";
import { BotPresence, gloss } from "../components/v2/Presence.jsx";
import MemoryImport from "../components/library/MemoryImport.jsx";
import { ArtifactContent } from "./Biblioteca.jsx";
import { useAction, useResource, useStore } from "../lib/store.jsx";
import { download, get, patch, pickTextFiles, post, del } from "../lib/api.js";
import { navigate, useRouter } from "../lib/router.jsx";
import { shortDate, time } from "../lib/format.js";
import { cancel, schedule, useUndoable } from "../lib/undoable.js";

// Colmena 2.0 · Archivo (design/V2Archivo.dc.html): what the colmena has made, the skills
// the bots learned (none is used until you review its steps) and what they know about you.

const INK = "#12131A";
const MUTED = "#5C606C";
const FAINT = "#6B6F7A";
const HONEY_RING = "0 0 0 1px rgba(255,201,60,.6), 0 0 0 7px rgba(255,201,60,.14)";

const KINDS = [["todo", "Todo", null], ["doc", "Documentos", ["document"]], ["hoja", "Hojas", ["table", "sheet"]], ["img", "Imágenes", ["design"]], ["diapo", "Diapositivas", ["slides"]], ["codigo", "Código", ["code"]]];
const IMAGE = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const PREVIEW = {
  document: "linear-gradient(#2B2D36, #2B2D36) 24px 26px / 46% 10px no-repeat, repeating-linear-gradient(180deg, #E6E6E1 0 7px, transparent 7px 18px) 24px 56px / calc(100% - 48px) 62% no-repeat, #FFFFFF",
  table: "linear-gradient(#0B8A5F, #0B8A5F) 0 0 / 100% 26px no-repeat, repeating-linear-gradient(90deg, transparent 0 calc(25% - 1px), #D5E9DF calc(25% - 1px) 25%), repeating-linear-gradient(180deg, #F3FAF6 0 22px, #FFFFFF 22px 44px)",
  slides: "linear-gradient(#2B2D36, #2B2D36) 24% 32% / 40% 8px no-repeat, linear-gradient(#FFFFFF, #FFFFFF) 18% 24% / 64% 52% no-repeat, linear-gradient(135deg, #FF5CA8, #7B4DFF)",
  code: "linear-gradient(#7DD3A8, #7DD3A8) 24px 32px / 30% 7px no-repeat, linear-gradient(#E6E7EC, #E6E7EC) 44px 54px / 52% 7px no-repeat, linear-gradient(#FFC93C, #FFC93C) 44px 76px / 36% 7px no-repeat, linear-gradient(#E6E7EC, #E6E7EC) 24px 98px / 44% 7px no-repeat, linear-gradient(#E6E7EC, #E6E7EC) 44px 120px / 28% 7px no-repeat, #12131A",
  design: "radial-gradient(circle at 72% 30%, #FFC93C 0 13%, rgba(255,201,60,0) 13.5%), radial-gradient(120% 70% at 20% 110%, #7B4DFF 0 48%, rgba(123,77,255,0) 48.5%), radial-gradient(120% 80% at 90% 120%, #2F6BFF 0 45%, rgba(47,107,255,0) 45.5%), linear-gradient(180deg, #FFF4D1, #F5E9FF)",
};
PREVIEW.sheet = PREVIEW.table;
/** The whole team: a plain ink circle (bots never show letters). */
const TeamDot = ({ size }) => <span aria-hidden="true" title="Todo el equipo" style={{ width: size + "px", height: size + "px", flex: "none", borderRadius: "50%", background: gloss(INK), filter: "drop-shadow(0 2px 3px rgba(18,19,26,.16))" }} />;
const when = (iso) => (iso ? `${shortDate(iso)}, ${time(iso)}` : "");

// SVG deliverables show themselves; fetched once per id and drawn as <img>, never inline.
const svgCache = new Map();
function useSvg(id, enabled) {
  const [src, setSrc] = useState(() => svgCache.get(id) || null);
  useEffect(() => {
    if (!enabled || svgCache.has(id)) return undefined;
    let alive = true;
    get(`/artifacts/${encodeURIComponent(id)}`).then((a) => {
      if (!a?.content || !/<svg[\s>]/i.test(a.content)) return;
      const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(a.content)}`;
      svgCache.set(id, url);
      if (alive) setSrc(url);
    }).catch(() => {});
    return () => { alive = false; };
  }, [id, enabled]);
  return src;
}
function Preview({ a, height = "168px", style = null }) {
  const svg = useSvg(a.id, a.format === "svg");
  const img = IMAGE.has(a.format) ? `/api/artifacts/${encodeURIComponent(a.id)}/file` : svg;
  return (
    <span aria-hidden="true" style={{ display: "block", height, borderRadius: "18px", overflow: "hidden", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.05)", background: img ? "#F6F6F3" : PREVIEW[a.kind] || PREVIEW.document, ...style }}>
      {img ? <img src={img} alt="" loading="lazy" style={{ display: "block", width: "100%", height: "100%", objectFit: a.format === "svg" ? "contain" : "cover" }} /> : null}
    </span>
  );
}

export default function ArchivoV2() {
  const { query } = useRouter();
  const { artifacts = [], bots = [], missions = [], skills = [], memories = [], ready } = useStore();
  const tabFrom = (v) => ({ habilidades: "skills", memoria: "mem", "saben-de-ti": "mem" }[v] || "done");
  const [tab, setTab] = useState(tabFrom(query.pestana || query.tab));
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("todo");
  const [look, setLook] = useState(query.archivo || query.artefacto || null);
  useEffect(() => { if (query.pestana || query.tab) setTab(tabFrom(query.pestana || query.tab)); }, [query.pestana, query.tab]);
  useEffect(() => { if (query.archivo || query.artefacto) { setTab("done"); setLook(query.archivo || query.artefacto); } }, [query.archivo, query.artefacto]);

  const botOf = (id) => bots.find((b) => b.id === id) || null;
  const missionOf = (id) => missions.find((m) => m.id === id) || null;
  const placeOf = (a) => {
    const m = missionOf(a.missionId);
    if (m?.conversation) return "Chat con " + (botOf(m.botIds?.[0])?.name || "un bot");
    const room = a.room || m?.room || m?.title;
    return room ? "#" + room : null;
  };
  const pendingSkills = skills.filter((s) => s.status === "pending").length;
  const review = memories.filter((m) => m.review).length;
  const tabs = [["done", "Lo que han hecho", 0], ["skills", "Habilidades", pendingSkills], ["mem", "Lo que saben de ti", review]];
  const desc = {
    done: "Todo lo que ha hecho tu colmena, con quién lo hizo y para qué.",
    skills: "Lo que tus bots han aprendido a hacer. Una habilidad nueva no se usa hasta que revisas sus pasos.",
    mem: "Lo que tus bots recuerdan de ti y de cómo trabajáis. Puedes corregirlo u olvidarlo cuando quieras.",
  }[tab];

  const needle = q.trim().toLowerCase();
  const kinds = KINDS.find(([k]) => k === kind)?.[2];
  const items = useMemo(() => artifacts
    .filter((a) => !kinds || kinds.includes(a.kind) || (kind === "img" && IMAGE.has(a.format)))
    .filter((a) => !needle || [a.title, botOf(a.botId)?.name, placeOf(a), a.format].filter(Boolean).join(" ").toLowerCase().includes(needle))
    .sort((x, y) => Date.parse(y.createdAt || 0) - Date.parse(x.createdAt || 0)), [artifacts, kind, needle, bots, missions]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = look ? artifacts.find((a) => a.id === look) : null;
  const closeLook = () => {
    setLook(null);
    if (/[?&](archivo|artefacto)=/.test(location.search)) navigate("/archivo", { replace: true });
  };

  return (
    <Shell active="archivo">
      <main style={{ maxWidth: "1240px", margin: "0 auto", padding: "64px clamp(20px, 4vw, 48px) 40px", display: "flex", flexDirection: "column", gap: "34px" }}>
        <header style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <h1 style={{ margin: 0, font: "600 clamp(48px, 7vw, 84px)/0.95 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.05em" }}>Archivo</h1>
            <p style={{ margin: 0, fontSize: "17px", color: MUTED }}>{desc}</p>
          </div>
          <div role="tablist" aria-label="Qué ver" style={{ alignSelf: "flex-start", display: "flex", flexWrap: "wrap", gap: "2px", padding: "4px", borderRadius: "999px", background: "rgba(18,19,26,.05)" }}>
            {tabs.map(([id, label, badge]) => {
              const on = tab === id;
              return (
                <button key={id} type="button" role="tab" aria-selected={on} onClick={() => setTab(id)} style={{ display: "flex", alignItems: "center", gap: "8px", height: "44px", padding: "0 18px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "15px", fontWeight: 600, transition: "all .2s ease", color: INK, background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 3px rgba(18,19,26,.15)" : "none" }}>
                  {label}
                  {badge ? <span aria-label={`${badge} por revisar`} style={{ minWidth: "20px", height: "20px", padding: "0 6px", borderRadius: "10px", font: "600 11px/20px 'Geist', sans-serif", textAlign: "center", background: "#FFC93C", color: INK }}>{badge}</span> : null}
                </button>
              );
            })}
          </div>
          {tab === "done" ? (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px" }}>
              <label style={{ flex: "1 1 320px", display: "flex", alignItems: "center", gap: "12px", height: "56px", padding: "0 22px", borderRadius: "999px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 14px 34px -22px rgba(18,19,26,.3)", color: FAINT }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></svg>
                <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>Buscar en el archivo</span>
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca por nombre, bot o sala" style={{ flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", fontSize: "16px", color: INK }} />
              </label>
              <div role="radiogroup" aria-label="Tipo" style={{ display: "flex", flexWrap: "wrap", gap: "2px", padding: "4px", borderRadius: "999px", background: "rgba(18,19,26,.05)" }}>
                {KINDS.map(([id, label]) => {
                  const on = kind === id;
                  return <button key={id} type="button" role="radio" aria-checked={on} onClick={() => setKind(id)} style={{ height: "40px", padding: "0 16px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "14px", fontWeight: 500, transition: "all .2s ease", color: INK, background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 3px rgba(18,19,26,.15)" : "none" }}>{label}</button>;
                })}
              </div>
            </div>
          ) : null}
        </header>

        {tab === "done" ? (
          <>
            {!ready ? <div style={{ height: "240px", borderRadius: "28px", background: "#FFFFFF", animation: "shimmer 1.6s ease-in-out infinite" }} /> : null}
            {ready && !items.length ? (
              <p style={{ margin: 0, padding: "60px 0", textAlign: "center", fontSize: "17px", color: FAINT }}>
                {artifacts.length ? "No hay nada que coincida. Prueba con otra palabra." : "Aún no han hecho nada. Lo que entreguen tus bots aparecerá aquí."}
              </p>
            ) : null}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "22px" }}>
              {items.map((a) => {
                const bot = botOf(a.botId);
                return (
                  <button key={a.id} type="button" onClick={() => setLook(a.id)} style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "12px 12px 16px", textAlign: "left", border: 0, borderRadius: "28px", background: "#FFFFFF", cursor: "pointer", color: INK, boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 14px 34px -24px rgba(18,19,26,.3)", animation: "rise .35s ease-out" }}>
                    <Preview a={a} />
                    <span style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "0 6px" }}>
                      <strong style={{ fontSize: "16px", fontWeight: 600, lineHeight: 1.3, fontFamily: a.kind === "code" ? "'Geist Mono', monospace" : undefined }}>{a.title}</strong>
                      <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: FAINT }}>
                        {bot ? <BotPresence bot={bot} size={12} /> : null}
                        {[bot?.name, when(a.createdAt)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
        {tab === "skills" ? <Skills skills={skills} bots={bots} /> : null}
        {tab === "mem" ? <Memories memories={memories} bots={bots} /> : null}
      </main>
      {cur ? <Look a={cur} bot={botOf(cur.botId)} place={placeOf(cur)} mission={missionOf(cur.missionId)} onClose={closeLook} /> : null}
    </Shell>
  );
}

// ───────────────────────────────────────────────────────────── Vista previa
const MIME = { md: "text/markdown", csv: "text/csv", svg: "image/svg+xml", html: "text/html", py: "text/x-python", json: "application/json" };
const fileName = (a) => `${(a.title || "entregable").replace(/[\\/:*?"<>|]+/g, "-").trim()}.${a.format || "txt"}`;

function Look({ a, bot, place, mission, onClose }) {
  const { data, error, loading } = useResource(`/artifacts/${encodeURIComponent(a.id)}`);
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const key = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  const binary = IMAGE.has(a.format);
  const save = () => {
    if (data?.content && !binary) download(fileName(a), data.content, `${MIME[a.format] || "text/plain"};charset=utf-8`);
    else window.open(`/api/artifacts/${encodeURIComponent(a.id)}/download`, "_blank");
  };
  const share = async () => {
    try {
      await navigator.clipboard.writeText(data?.content && !binary ? data.content : a.title);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard denied: nothing to do */ }
  };
  const rows = [
    ["Lo hizo", bot ? <span style={{ display: "flex", alignItems: "center", gap: "8px" }}><BotPresence bot={bot} size={16} />{bot.name}</span> : "—"],
    ["Dónde", place || "—"],
    ["Cuándo", when(a.createdAt) || "—"],
    ["Versiones", a.version > 1 ? `${a.version} · esta es la última` : "1"],
    a.status && a.status !== "final" ? ["Estado", a.status] : null,
  ].filter(Boolean);
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", padding: "40px 20px", background: "rgba(18,19,26,.32)", WebkitBackdropFilter: "blur(10px)", backdropFilter: "blur(10px)", animation: "fade .25s ease-out" }}>
      <div role="dialog" aria-modal="true" aria-labelledby="look-t" style={{ width: full ? "min(1240px, 100%)" : "min(980px, 100%)", maxHeight: "100%", overflow: "auto", display: "flex", flexWrap: "wrap", background: "#FFFFFF", borderRadius: "34px", boxShadow: "0 60px 120px -40px rgba(18,19,26,.6)", animation: "sheet .45s cubic-bezier(.2,.8,.2,1)" }}>
        <div style={{ flex: full ? "1 1 100%" : "3 1 420px", minHeight: "420px", maxHeight: full ? "none" : "70vh", margin: "14px", borderRadius: "24px", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.05)", overflow: "auto", background: "#FBFBF9" }}>
          {binary || a.format === "svg" ? <Preview a={a} height="100%" style={{ minHeight: "420px", borderRadius: 0, boxShadow: "none" }} /> : (
            <div style={{ padding: "26px 28px" }}><ArtifactContent a={data} loading={loading} error={error} /></div>
          )}
        </div>
        <div style={{ flex: "2 1 300px", padding: full ? "8px 32px 28px" : "34px 32px 28px 18px", display: "flex", flexDirection: "column", gap: "22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
            <h2 id="look-t" style={{ margin: 0, font: "600 30px/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em", overflowWrap: "anywhere" }}>{a.title}</h2>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Cerrar" style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "50%", background: "rgba(18,19,26,.06)", cursor: "pointer", color: INK }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "96px 1fr", gap: "14px 12px", fontSize: "15px" }}>
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt style={{ color: FAINT }}>{k}</dt>
                <dd style={{ margin: 0 }}>{v}</dd>
              </div>
            ))}
          </dl>
          <div style={{ marginTop: "auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
            <button type="button" onClick={() => (binary || a.format === "svg" ? save() : setFull((x) => !x))} style={{ height: "48px", padding: "0 24px", border: 0, borderRadius: "999px", background: INK, color: "#FFFFFF", cursor: "pointer", fontSize: "15px", fontWeight: 600 }}>
              {binary || a.format === "svg" ? "Descargar" : full ? "Reducir" : "Abrir"}
            </button>
            <button type="button" onClick={binary || a.format === "svg" ? share : save} style={{ height: "48px", padding: "0 20px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "15px", fontWeight: 600, color: INK }}>
              {binary || a.format === "svg" ? (copied ? "Copiado ✓" : "Copiar el nombre") : "Descargar"}
            </button>
            {!binary && a.format !== "svg" && data?.content ? (
              <button type="button" onClick={share} style={{ height: "48px", padding: "0 20px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "15px", fontWeight: 600, color: INK }}>{copied ? "Copiado ✓" : "Copiar"}</button>
            ) : null}
            {mission ? (
              <a href={mission.conversation ? `/chat/${encodeURIComponent(mission.botIds?.[0] || "")}?c=${encodeURIComponent(mission.id)}` : `/encargo/${encodeURIComponent(mission.id)}`} style={{ display: "flex", alignItems: "center", height: "48px", padding: "0 12px", fontSize: "15px", fontWeight: 500, color: "#1F4FD1" }}>Cómo se hizo</a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Habilidades
/** Numbered steps of a SKILL.md («1. Haz esto»). */
const stepsOf = (content) => String(content || "").split(/\r?\n/).map((l) => /^\s*\d+[.)]\s+(.+)$/.exec(l)?.[1]?.trim()).filter(Boolean);

function SkillCard({ s, bot }) {
  const [open, setOpen] = useState(false);
  const detail = useResource(open ? `/skills/${encodeURIComponent(s.id)}` : null);
  const act = useAction();
  const improved = s.status === "pending" && s.version > 1;
  const pending = s.status === "pending";
  const steps = stepsOf(detail.data?.content);
  const before = new Set(stepsOf(detail.data?.previous?.content));
  const state = pending ? (improved ? "Versión mejorada" : "Revisa los pasos") : s.status === "active" ? "Activa" : s.status === "archived" ? "Archivada" : "Desactivada";
  const meta = pending
    ? improved ? `${bot?.name || "Un bot"} propone una versión mejorada · v${s.version}` : [bot ? `${bot.name} la aprendió` : "Importada", s.learnedFrom, "nueva"].filter(Boolean).join(" · ")
    : [bot?.name || "Para todo el equipo", s.uses ? `usada ${s.uses} ${s.uses === 1 ? "vez" : "veces"}` : "aún sin usar"].join(" · ");
  const setStatus = (status) => act.act(() => patch(`/skills/${encodeURIComponent(s.id)}`, { status }));
  return (
    <article style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "22px 24px", background: "#FFFFFF", borderRadius: "26px", transition: "box-shadow .3s ease", boxShadow: pending ? HONEY_RING : "0 1px 2px rgba(18,19,26,.05)", opacity: ["disabled", "archived"].includes(s.status) ? 0.7 : 1 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px" }}>
        {bot ? <BotPresence bot={bot} size={30} /> : <TeamDot size={30} />}
        <span style={{ flex: "1 1 280px", display: "flex", flexDirection: "column", gap: "3px" }}>
          <strong style={{ font: "600 20px/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.015em" }}>{s.name}</strong>
          <span style={{ fontSize: "14px", color: MUTED }}>{meta}</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", borderRadius: "999px", fontSize: "13px", fontWeight: 600, background: pending ? "#FFF4D1" : s.status === "active" ? "#E1F4EC" : "rgba(18,19,26,.06)", color: pending ? "#8A5A00" : s.status === "active" ? "#0B5A3E" : MUTED }}>{state}</span>
      </div>
      {s.description ? <p style={{ margin: 0, fontSize: "15px", lineHeight: 1.55, color: "#3D404A" }}>{s.description}</p> : null}
      {open ? (
        <ol style={{ margin: 0, padding: "14px 18px 14px 38px", borderRadius: "18px", background: "#F6F6F3", display: "flex", flexDirection: "column", gap: "8px", fontSize: "14px", lineHeight: 1.5, animation: "rise .25s ease-out" }}>
          {detail.loading && !detail.data ? <li style={{ listStyle: "none", marginLeft: "-20px", color: FAINT }}>Cargando los pasos…</li> : null}
          {detail.data && !steps.length ? <li style={{ listStyle: "none", marginLeft: "-20px", color: FAINT }}>Esta habilidad no tiene pasos numerados.</li> : null}
          {steps.map((t, i) => {
            const added = improved && before.size && !before.has(t);
            return <li key={i}><span style={{ padding: "1px 4px", borderRadius: "4px", background: added ? "rgba(11,138,95,.14)" : "transparent" }}>{(added ? "+ " : "") + t}</span></li>;
          })}
        </ol>
      ) : null}
      {act.error ? <p role="alert" style={{ margin: 0, fontSize: "14px", color: "#B4231A" }}>{act.error}</p> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <button type="button" aria-expanded={open} onClick={() => setOpen((x) => !x)} style={{ height: "42px", padding: "0 16px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "14px", fontWeight: 600, color: INK }}>
          {open ? "Ocultar pasos" : improved ? "Ver qué cambia" : "Ver pasos"}
        </button>
        <button type="button" disabled={act.busy} onClick={() => setStatus(s.status === "active" ? "disabled" : "active")} style={{ height: "42px", padding: "0 18px", border: 0, borderRadius: "999px", cursor: "pointer", fontSize: "14px", fontWeight: 600, background: pending ? INK : "rgba(18,19,26,.06)", color: pending ? "#FFFFFF" : INK }}>
          {pending ? (improved ? "Usar la nueva versión" : "Activar") : s.status === "active" ? "Desactivar" : "Activar"}
        </button>
        {pending ? <button type="button" disabled={act.busy} onClick={() => setStatus("disabled")} style={{ height: "42px", padding: "0 14px", border: 0, borderRadius: "999px", background: "transparent", cursor: "pointer", fontSize: "14px", fontWeight: 600, color: "#B4372A" }}>Descartar</button> : null}
      </div>
    </article>
  );
}

function Skills({ skills, bots }) {
  const act = useAction();
  const [note, setNote] = useState(null);
  const order = { pending: 0, active: 1, disabled: 2, stale: 2, archived: 3 };
  const list = [...skills].sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2) || (b.uses || 0) - (a.uses || 0));
  const importSkill = async () => {
    const files = await pickTextFiles({ multiple: false, accept: ".md,.txt" });
    if (!files?.length) return;
    const ok = await act.act(() => post("/skills", { content: files[0].content, source: files[0].name }));
    if (ok !== undefined) setNote(`«${files[0].name}» importada. Revisa sus pasos antes de activarla.`);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px", animation: "fade .3s ease-out" }}>
      {!list.length ? <p style={{ margin: 0, padding: "40px 0", textAlign: "center", fontSize: "17px", color: FAINT }}>Aún no han aprendido nada. Cuando un bot repita una tarea, te propondrá guardarla como habilidad.</p> : null}
      {list.map((s) => <SkillCard key={s.id} s={s} bot={bots.find((b) => b.id === s.botId) || null} />)}
      {note || act.error ? <p role="status" style={{ margin: 0, fontSize: "14px", color: act.error ? "#B4231A" : MUTED }}>{act.error || note}</p> : null}
      <button type="button" onClick={importSkill} disabled={act.busy} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "8px", height: "46px", padding: "0 18px", border: 0, borderRadius: "999px", background: "transparent", boxShadow: "inset 0 0 0 1.5px rgba(18,19,26,.15)", cursor: "pointer", fontSize: "14px", fontWeight: 600, color: INK }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Importar una habilidad
      </button>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Lo que saben de ti
function MemoryRow({ m, bot }) {
  const id = "memory-forget:" + m.id;
  const { run } = useStore();
  const { waiting, secs } = useUndoable(id);
  const forget = () => schedule(id, () => run(() => del(`/memories/${encodeURIComponent(m.id)}`)));
  const src = [m.sourceLabel, bot?.name].filter(Boolean).join(" · ");
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", minHeight: "64px", padding: "10px 24px", borderTop: "1px solid rgba(18,19,26,.06)", animation: "fade .3s ease-out", opacity: waiting ? 0.5 : 1, transition: "opacity .2s ease" }}>
      {bot ? <BotPresence bot={bot} size={20} /> : <TeamDot size={20} />}
      <span style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: "3px" }}>
        <span style={{ fontSize: "16px", lineHeight: 1.45, textDecoration: waiting ? "line-through" : "none" }}>{m.text}</span>
        <span style={{ fontSize: "13px", color: FAINT }}>{waiting ? `Se olvida en ${secs} s` : src}</span>
      </span>
      {waiting ? (
        <button type="button" onClick={() => cancel(id)} style={{ height: "36px", padding: "0 14px", border: 0, borderRadius: "999px", background: INK, color: "#FFFFFF", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>Deshacer</button>
      ) : (
        <button type="button" onClick={forget} style={{ height: "36px", padding: "0 14px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.05)", cursor: "pointer", fontSize: "13px", fontWeight: 500, color: INK }}>Olvidar</button>
      )}
    </div>
  );
}

function Memories({ memories, bots }) {
  const act = useAction();
  const [importing, setImporting] = useState(false);
  const [telling, setTelling] = useState(false);
  const [text, setText] = useState("");
  const botOf = (id) => bots.find((b) => b.id === id) || null;
  const toReview = memories.filter((m) => m.review);
  const known = memories.filter((m) => !m.review).sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  const tell = async () => {
    if (!text.trim()) return;
    const ok = await act.act(() => post("/memories", { text: text.trim(), scope: "equipo" }));
    if (ok !== undefined) { setText(""); setTelling(false); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "22px", animation: "fade .3s ease-out" }}>
      {importing ? <MemoryImport onClose={() => setImporting(false)} /> : null}
      {toReview.length ? (
        <section aria-labelledby="rev-h" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "22px 24px", borderRadius: "26px", background: "#FFFFFF", boxShadow: HONEY_RING }}>
          <h2 id="rev-h" style={{ margin: "0 0 4px", display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", fontWeight: 600, color: "#8A5A00" }}>
            <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#FFC93C", animation: "halo 1.8s ease-out infinite" }} />
            Por revisar · lo dedujeron leyendo correos y webs
          </h2>
          {toReview.map((m) => (
            <div key={m.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", padding: "10px 0", borderTop: "1px solid rgba(18,19,26,.06)", animation: "fade .3s ease-out" }}>
              <span style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: "3px" }}>
                <span style={{ fontSize: "16px", lineHeight: 1.45 }}>{m.text}</span>
                <span style={{ fontSize: "13px", color: FAINT }}>{botOf(m.botId) ? `Lo dedujo ${botOf(m.botId).name}` + (m.origin === "externo" ? " de una web, un correo o una app" : "") : m.sourceLabel}</span>
              </span>
              <span style={{ display: "flex", gap: "6px" }}>
                <button type="button" disabled={act.busy} onClick={() => act.act(() => del(`/memories/${encodeURIComponent(m.id)}`))} style={{ height: "38px", padding: "0 14px", border: 0, borderRadius: "999px", background: "transparent", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#B4372A" }}>No es así</button>
                <button type="button" disabled={act.busy} onClick={() => act.act(() => patch(`/memories/${encodeURIComponent(m.id)}`, { review: false }))} style={{ height: "38px", padding: "0 16px", border: 0, borderRadius: "999px", background: INK, color: "#FFFFFF", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>Es correcto</button>
              </span>
            </div>
          ))}
        </section>
      ) : null}
      <section aria-labelledby="ok-h" style={{ display: "flex", flexDirection: "column", background: "#FFFFFF", borderRadius: "26px", overflow: "hidden" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "20px 24px 10px" }}>
          <h2 id="ok-h" style={{ margin: 0, font: "600 22px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>Lo que saben de ti</h2>
          <span style={{ display: "flex", gap: "8px" }}>
            <button type="button" onClick={() => setImporting(true)} style={{ height: "40px", padding: "0 14px", border: 0, borderRadius: "999px", background: "rgba(18,19,26,.06)", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: INK }}>Importar de ChatGPT</button>
            <button type="button" onClick={() => setTelling((x) => !x)} aria-expanded={telling} style={{ height: "40px", padding: "0 14px", border: 0, borderRadius: "999px", background: INK, color: "#FFFFFF", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>Contarles algo</button>
          </span>
        </div>
        {telling ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "6px 24px 14px", padding: "6px 6px 6px 18px", borderRadius: "18px", background: "#F4F4F0", animation: "rise .25s ease-out" }}>
            <input type="text" autoFocus aria-label="Qué quieres que sepan" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") tell(); if (e.key === "Escape") setTelling(false); }} placeholder="Por ejemplo: los viernes por la tarde no tengo reuniones" style={{ flex: 1, minWidth: 0, height: "44px", border: 0, outline: "none", background: "transparent", fontSize: "15px" }} />
            <button type="button" onClick={tell} disabled={!text.trim() || act.busy} style={{ height: "40px", padding: "0 16px", border: 0, borderRadius: "999px", cursor: text.trim() ? "pointer" : "default", fontSize: "14px", fontWeight: 600, background: text.trim() ? INK : "rgba(18,19,26,.08)", color: text.trim() ? "#FFFFFF" : "#8A8D96" }}>Guardar</button>
          </div>
        ) : null}
        {act.error ? <p role="alert" style={{ margin: "0 24px 12px", fontSize: "14px", color: "#B4231A" }}>{act.error}</p> : null}
        {!known.length ? <p style={{ margin: 0, padding: "18px 24px 22px", borderTop: "1px solid rgba(18,19,26,.06)", fontSize: "15px", color: FAINT }}>Todavía no saben nada de ti. Cuéntales algo o tráelo de ChatGPT.</p> : null}
        {known.map((m) => <MemoryRow key={m.id} m={m} bot={botOf(m.botId)} />)}
      </section>
      <p style={{ margin: "0 8px", fontSize: "13px", lineHeight: 1.5, color: FAINT }}>Lo que deducen de webs, correos o apps queda «por revisar» y no lo usan hasta que digas que es correcto.</p>
    </div>
  );
}
