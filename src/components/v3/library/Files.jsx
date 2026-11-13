import { useEffect, useMemo, useState } from "react";
import { BotPresence, shapeOf } from "../../v2/Presence.jsx";
import { ArtifactContent } from "./ArtifactContent.jsx";
import { useResource } from "../../../lib/store.jsx";
import { download, get } from "../../../lib/api.js";
import { navigate } from "../../../lib/router.jsx";
import { time } from "../../../lib/format.js";
import { isSala } from "../../../lib/rooms.js";
import { useDialogFocus } from "../../../lib/useDialogFocus.js";

// Biblioteca › Archivos (design/V3Archivos.dc.html): what the bots delivered, as small pages
// with their type, who made it and when; the chosen one on the right with where it was made,
// its versions and Abrir (the full preview: slides, Word pages, workbooks, code, images).

const IMAGE = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const LINES = (c) => "linear-gradient(" + c + ", " + c + ") 0 0 / 70% 5px no-repeat content-box, repeating-linear-gradient(180deg, #E6E7EC 0 3px, transparent 3px 10px) 0 14px / 100% calc(100% - 14px) no-repeat content-box, #FFFFFF";
// [thumb background, label ink, page pattern] per type, as drawn on the board (code added).
const T = {
  doc: ["#E3EBFF", "#1F4FD1", LINES("#1F4FD1")],
  xls: ["#E3F4EC", "#0B6B4A", "linear-gradient(#0B8A5F, #0B8A5F) 0 0 / 100% 6px no-repeat content-box, linear-gradient(90deg, #D3E6DC 1px, transparent 1px) 0 0 / 25% 100% content-box, linear-gradient(180deg, #D3E6DC 1px, transparent 1px) 0 0 / 100% 11px content-box, #FFFFFF"],
  ppt: ["#FFE9DC", "#C2410C", "linear-gradient(#FF7A1A, #FF7A1A) 0 0 / 55% 7px no-repeat content-box, linear-gradient(#FFE9DC, #FFE9DC) 0 100% / 100% 58% no-repeat content-box, #FFFFFF"],
  img: ["#FFE3F0", "#B4236E", "radial-gradient(circle at 70% 32%, #FF5CA8 0 16%, transparent 17%), linear-gradient(180deg, #FFF4F9 0 58%, #F8CFE1 58%)"],
  pdf: ["#FBE9EA", "#B4232A", LINES("#B4232A")],
  md: ["#ECECE7", "#3D404A", LINES("#12131A")],
  code: ["#E6E7EC", "#12131A", "linear-gradient(#7DD3A8, #7DD3A8) 0 0 / 40% 5px no-repeat content-box, repeating-linear-gradient(180deg, #4A4D57 0 3px, transparent 3px 10px) 0 14px / 80% calc(100% - 14px) no-repeat content-box, #12131A"],
};
const typeOf = (a) => {
  if (IMAGE.has(a.format) || a.format === "svg" || a.kind === "design") return "img";
  if (a.format === "pdf") return "pdf";
  if (a.kind === "slides") return "ppt";
  if (a.kind === "table" || a.kind === "sheet") return "xls";
  if (a.kind === "code") return "code";
  if (a.format === "md" || a.format === "txt") return "md";
  return "doc";
};
const KINDS = [["todo", "Todo"], ["docs", "Documentos"], ["hojas", "Hojas"], ["imagenes", "Imágenes"], ["codigo", "Código"]];
const GROUP = { doc: "docs", md: "docs", pdf: "docs", ppt: "docs", xls: "hojas", img: "imagenes", code: "codigo" };

/** «hace 10 min», «hoy 09:26», «ayer», «lunes», «12 oct». */
export function whenShort(iso, withTime = false) {
  if (!iso) return "";
  const d = new Date(iso);
  const mins = (Date.now() - d.getTime()) / 60000;
  if (mins >= 0 && mins < 60) return mins < 1 ? "ahora" : `hace ${Math.round(mins)} min`;
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return withTime ? "hoy " + time(iso) : "hoy";
  if (d.toDateString() === new Date(Date.now() - 864e5).toDateString()) return withTime ? "ayer " + time(iso) : "ayer";
  if (Date.now() - d.getTime() < 6 * 864e5) return d.toLocaleDateString("es-ES", { weekday: "long" });
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "");
}

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
/** The real picture when there is one: an image, an SVG, the first slide or page. */
function usePicture(a) {
  const svg = useSvg(a.id, a.format === "svg");
  if (IMAGE.has(a.format)) return `/api/artifacts/${encodeURIComponent(a.id)}/file`;
  if (svg) return svg;
  if (a.thumbs > 0) return `/api/artifacts/${encodeURIComponent(a.id)}/thumbs/1`;
  return null;
}

/** The board's thumbnail: a tinted band with a small page and the type label in a corner. */
function Thumb({ a, big = false }) {
  const t = T[typeOf(a)];
  const pic = usePicture(a);
  const ext = String(a.format || "").toUpperCase().slice(0, 5) || "DOC";
  return (
    <span aria-hidden="true" style={big
      ? { position: "relative", height: "170px", display: "grid", placeItems: "center", borderRadius: "var(--r-lg)", background: t[0] }
      : { position: "relative", height: "112px", display: "grid", placeItems: "center", background: t[0] }}>
      <span style={{ width: big ? "58%" : "62%", height: big ? "78%" : "72%", boxSizing: "border-box", padding: pic ? "0" : big ? "14px" : "12px", borderRadius: big ? "var(--r-sm)" : "var(--r-sm)", overflow: "hidden", background: pic ? "#FFFFFF" : t[2], boxShadow: big ? "0 12px 24px -14px rgba(18,19,26,.5)" : "0 10px 20px -14px rgba(18,19,26,.5)" }}>
        {pic ? <img src={pic} alt="" loading="lazy" style={{ display: "block", width: "100%", height: "100%", objectFit: a.format === "svg" ? "contain" : "cover" }} /> : null}
      </span>
      <span style={{ position: "absolute", left: big ? "12px" : "10px", top: big ? "12px" : "10px", height: "22px", padding: "0 7px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-sm)", background: "rgba(255,255,255,.92)", color: t[1], fontSize: "var(--t-micro)", fontWeight: "700" }}>{ext}</span>
    </span>
  );
}
const BotMark = ({ bot }) => (bot
  ? <span aria-hidden="true" style={{ flex: "none", width: "11px", height: "11px", background: bot.color || "#C9CBD1", borderRadius: shapeOf(bot).radius, clipPath: shapeOf(bot).clip }} />
  : <span aria-hidden="true" style={{ flex: "none", width: "11px", height: "11px", borderRadius: "var(--r-circle)", background: "#12131A" }} />);

const missionHref = (m) => (m ? (m.conversation && m.botIds?.length === 1 && !m.room ? `/chat/${encodeURIComponent(m.botIds[0])}?c=${encodeURIComponent(m.id)}` : isSala(m) ? `/sala/${encodeURIComponent(m.id)}` : `/encargo/${encodeURIComponent(m.id)}`) : null);

export default function Files({ artifacts, bots, missions, ready, expert, initial = null }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("todo");
  const [sel, setSel] = useState(initial);
  const [look, setLook] = useState(initial);
  useEffect(() => { if (initial) { setSel(initial); setLook(initial); } }, [initial]);
  const botOf = (id) => bots.find((b) => b.id === id) || null;
  const missionOf = (id) => missions.find((m) => m.id === id) || null;
  const placeOf = (a) => {
    const m = missionOf(a.missionId);
    if (m?.conversation && !m.room) return "Chat con " + (botOf(m.botIds?.[0])?.name || "un bot");
    const room = a.room || m?.room;
    return m?.title || (room ? "#" + room : null);
  };
  const needle = q.trim().toLowerCase();
  const items = useMemo(() => artifacts
    .filter((a) => kind === "todo" || GROUP[typeOf(a)] === kind)
    .filter((a) => !needle || [a.title, botOf(a.botId)?.name, placeOf(a), a.format, a.room].filter(Boolean).join(" ").toLowerCase().includes(needle))
    .sort((x, y) => Date.parse(y.updatedAt || y.createdAt || 0) - Date.parse(x.updatedAt || x.createdAt || 0)), [artifacts, kind, needle, bots, missions]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = items.find((a) => a.id === sel) || items[0] || null;
  const open = look ? artifacts.find((a) => a.id === look) : null;
  const closeLook = () => {
    setLook(null);
    if (/[?&](archivo|artefacto)=/.test(location.search)) navigate(location.pathname, { replace: true });
  };

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
        <label style={{ flex: "1 1 260px", display: "flex", alignItems: "center", gap: "10px", height: "40px", padding: "0 14px", borderRadius: "var(--r-md)", background: "#FFFFFF", border: "1px solid rgba(18,19,26,.08)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5C606C" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.2-4.2" /></svg>
          <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Buscar archivos"}</span>
          <input className="c-bare" type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o contenido" style={{ flex: "1", minWidth: "0", border: "0", background: "transparent", fontSize: "var(--t-body)" }} />
        </label>
        {KINDS.map(([id, label]) => {
          const on = kind === id;
          return <button key={id} type="button" aria-pressed={on} onClick={() => setKind(id)} style={{ height: "36px", padding: "0 13px", border: "0", borderRadius: "var(--r-pill)", background: on ? "#12131A" : "#FFFFFF", color: on ? "#FFFFFF" : "#3D404A", fontSize: "var(--t-ui)", fontWeight: "500", cursor: "pointer" }}>{label}</button>;
        })}
      </div>
      {!ready ? <div style={{ height: "240px", borderRadius: "var(--r-2xl)", background: "#FFFFFF", animation: "shimmer 1.6s ease-in-out infinite" }} /> : null}
      {ready && !items.length ? (
        <p style={{ margin: 0, padding: "60px 0", textAlign: "center", fontSize: "var(--t-read)", color: "#5C606C" }}>
          {artifacts.length ? "No hay nada que coincida. Prueba con otra palabra." : "Aún no han entregado nada. Lo que hagan tus bots aparecerá aquí."}
        </p>
      ) : null}
      {items.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "flex-start" }}>
          <div style={{ flex: "999 1 480px", minWidth: "0", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(190px, 100%), 1fr))", gap: "12px" }}>
            {items.map((a) => {
              const bot = botOf(a.botId);
              const on = cur?.id === a.id;
              return (
                <button key={a.id} type="button" aria-pressed={on} onClick={() => setSel(a.id)} onDoubleClick={() => setLook(a.id)} style={{ display: "flex", flexDirection: "column", gap: "0", padding: "0", border: `2px solid ${on ? "#12131A" : "transparent"}`, borderRadius: "var(--r-xl)", background: "#FFFFFF", textAlign: "left", overflow: "hidden", cursor: "pointer" }}>
                  <Thumb a={a} />
                  <span style={{ display: "flex", flexDirection: "column", gap: "3px", padding: "12px 14px 14px" }}>
                    <span style={{ fontSize: "var(--t-ui)", fontWeight: "600", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: a.kind === "code" ? "'Geist Mono', monospace" : undefined }}>{a.title}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--t-meta)", color: "#5C606C" }}>
                      <BotMark bot={bot} />
                      {[bot?.name || "Equipo", whenShort(a.updatedAt || a.createdAt), a.status && a.status !== "final" ? a.status : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {cur ? <Detail key={cur.id} a={cur} bot={botOf(cur.botId)} place={placeOf(cur)} mission={missionOf(cur.missionId)} expert={expert} onOpen={() => setLook(cur.id)} /> : null}
        </div>
      ) : null}
      {open ? <Look a={open} bot={botOf(open.botId)} place={placeOf(open)} mission={missionOf(open.missionId)} onClose={closeLook} /> : null}
    </>
  );
}

const MIME = { md: "text/markdown", csv: "text/csv", svg: "image/svg+xml", html: "text/html", py: "text/x-python", json: "application/json" };
const fileName = (a) => `${(a.title || "entregable").replace(/[\\/:*?"<>|]+/g, "-").trim()}.${a.format || "txt"}`;
const saveFile = (a, content) => {
  if (content && !IMAGE.has(a.format)) download(fileName(a), content, `${MIME[a.format] || "text/plain"};charset=utf-8`);
  else window.open(`/api/artifacts/${encodeURIComponent(a.id)}/download`, "_blank");
};

/** The aside: the chosen file, where it was made, its versions and what to do with it. */
function Detail({ a, bot, place, mission, expert, onOpen }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    try {
      const full = !IMAGE.has(a.format) ? await get(`/artifacts/${encodeURIComponent(a.id)}`).catch(() => null) : null;
      await navigator.clipboard.writeText(full?.content || a.title);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard denied: nothing to do */ }
  };
  const save = async () => {
    const full = !IMAGE.has(a.format) ? await get(`/artifacts/${encodeURIComponent(a.id)}`).catch(() => null) : null;
    saveFile(a, full?.content);
  };
  const v = a.version || 1;
  const versions = [
    { v: "v" + v, note: v > 1 ? "La última" : a.status && a.status !== "final" ? "En curso" : "La única por ahora", when: whenShort(a.updatedAt || a.createdAt, true) },
    v > 2 ? { v: "…", note: v - 2 === 1 ? "1 versión intermedia" : `${v - 2} versiones intermedias`, when: "" } : null,
    v > 1 ? { v: "v1", note: "Primer borrador", when: whenShort(a.createdAt, true) } : null,
  ].filter(Boolean);
  const href = missionHref(mission);
  return (
    <aside aria-label="Detalle del archivo" style={{ flex: "1 1 300px", minWidth: "0", position: "sticky", top: "24px", display: "flex", flexDirection: "column", gap: "14px", padding: "20px", borderRadius: "var(--r-2xl)", background: "#FFFFFF", animation: "fade .25s ease-out" }}>
      <Thumb a={a} big />
      <h2 style={{ margin: "0", font: "600 var(--t-title)/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em", overflowWrap: "anywhere" }}>{a.title}</h2>
      <dl style={{ margin: "0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 14px", fontSize: "var(--t-ui)" }}>
        <dt style={{ color: "#5C606C" }}>{"Lo hizo"}</dt>
        <dd style={{ margin: "0", display: "flex", alignItems: "center", gap: "6px" }}>{bot ? <BotPresence bot={bot} size={14} /> : null}{bot?.name || "El equipo"}</dd>
        {place ? <><dt style={{ color: "#5C606C" }}>{"Dónde"}</dt><dd style={{ margin: "0" }}>{href ? <a href={href} style={{ color: "#1F4FD1" }}>{place}</a> : place}</dd></> : null}
        <dt style={{ color: "#5C606C" }}>{"Cuándo"}</dt>
        <dd style={{ margin: "0" }}>{whenShort(a.createdAt, true) || "—"}</dd>
        {a.slides ? <><dt style={{ color: "#5C606C" }}>{"Tiene"}</dt><dd style={{ margin: "0" }}>{a.slides === 1 ? "1 diapositiva" : `${a.slides} diapositivas`}</dd></> : null}
        {a.paged && a.pages ? <><dt style={{ color: "#5C606C" }}>{"Tiene"}</dt><dd style={{ margin: "0" }}>{a.pages === 1 ? "1 página" : `${a.pages} páginas`}</dd></> : null}
        {a.sheets?.length ? <><dt style={{ color: "#5C606C" }}>{"Hojas"}</dt><dd style={{ margin: "0" }}>{a.sheets.join(", ")}</dd></> : null}
      </dl>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <span style={{ fontSize: "var(--t-meta)", fontWeight: "600", color: "#5C606C" }}>{"Versiones"}</span>
        {versions.map((x) => (
          <div key={x.v} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "34px", fontSize: "var(--t-ui)" }}>
            <span style={{ font: "500 var(--t-caption)/1 'Geist Mono', monospace", color: "#4A4D57" }}>{x.v}</span>
            <span style={{ flex: "1" }}>{x.note}</span>
            <span style={{ fontSize: "var(--t-meta)", color: "#5C606C" }}>{x.when}</span>
          </div>
        ))}
      </div>
      {expert ? (
        <span style={{ padding: "10px 12px", borderRadius: "var(--r-md)", background: "#F6F6F3", font: "500 var(--t-caption)/1.6 'Geist Mono', monospace", color: "#4A4D57", overflowWrap: "anywhere" }}>
          {[`${a.kind} · ${a.format} · v${v}`, a.workFile ? a.workFile : null, a.id].filter(Boolean).map((l) => <span key={l} style={{ display: "block" }}>{l}</span>)}
        </span>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <button type="button" onClick={onOpen} style={{ flex: "1", height: "40px", border: "0", borderRadius: "var(--r-pill)", background: "#12131A", color: "#FFFFFF", fontSize: "var(--t-ui)", fontWeight: "600", cursor: "pointer" }}>{"Abrir"}</button>
        <button type="button" onClick={share} title="Copia el contenido para pegarlo donde quieras" style={{ height: "40px", padding: "0 14px", border: "1px solid rgba(18,19,26,.14)", borderRadius: "var(--r-pill)", background: "#FFFFFF", fontSize: "var(--t-ui)", cursor: "pointer" }}>{copied ? "Copiado ✓" : "Compartir"}</button>
        <button type="button" onClick={save} aria-label="Descargar el archivo" style={{ height: "40px", padding: "0 14px", border: "1px solid rgba(18,19,26,.14)", borderRadius: "var(--r-pill)", background: "#FFFFFF", fontSize: "var(--t-ui)", cursor: "pointer" }}>{"Descargar"}</button>
      </div>
      {href ? <a href={href} style={{ fontSize: "var(--t-ui)", color: "#1F4FD1" }}>{mission?.conversation ? "Cómo se hizo: ver la conversación" : "Cómo se hizo: ver la tarea"}</a> : null}
    </aside>
  );
}

/** «Abrir»: the whole file — slides, Word pages, workbooks, Markdown, code or the picture. */
function Look({ a, bot, place, mission, onClose }) {
  const { data, error, loading } = useResource(`/artifacts/${encodeURIComponent(a.id)}`);
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useDialogFocus({ onEscape: onClose });
  const binary = IMAGE.has(a.format);
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
    ["Cuándo", whenShort(a.createdAt, true) || "—"],
    ["Versiones", a.version > 1 ? `${a.version} · esta es la última` : "1"],
    a.status && a.status !== "final" ? ["Estado", a.status] : null,
  ].filter(Boolean);
  const pill = { height: "44px", padding: "0 18px", border: "1px solid rgba(18,19,26,.14)", borderRadius: "var(--r-pill)", background: "#FFFFFF", cursor: "pointer", fontSize: "var(--t-body)", color: "#12131A" };
  const href = missionHref(mission);
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", padding: "40px 20px", background: "rgba(18,19,26,.32)", WebkitBackdropFilter: "blur(10px)", backdropFilter: "blur(10px)", animation: "fade .25s ease-out" }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="look-t" style={{ width: full ? "min(1240px, 100%)" : "min(980px, 100%)", maxHeight: "100%", overflow: "auto", display: "flex", flexWrap: "wrap", background: "#FFFFFF", borderRadius: "var(--r-3xl)", boxShadow: "0 60px 120px -40px rgba(18,19,26,.6)", animation: "sheet .45s cubic-bezier(.2,.8,.2,1)" }}>
        <div style={{ flex: full ? "1 1 100%" : "3 1 420px", minHeight: "420px", maxHeight: full ? "none" : "70vh", margin: "14px", borderRadius: "var(--r-xl)", boxShadow: "inset 0 0 0 1px rgba(18,19,26,.05)", overflow: "auto", background: "#FBFBF9" }}>
          {binary ? <img src={`/api/artifacts/${encodeURIComponent(a.id)}/file`} alt={a.title} style={{ display: "block", width: "100%", height: "100%", minHeight: "420px", objectFit: "contain" }} /> : (
            <div style={{ padding: "26px 28px" }}><ArtifactContent a={data} loading={loading} error={error} /></div>
          )}
        </div>
        <div style={{ flex: "2 1 300px", padding: full ? "8px 32px 28px" : "30px 30px 26px 16px", display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
            <h2 id="look-t" style={{ margin: 0, font: "600 var(--t-heading)/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em", overflowWrap: "anywhere" }}>{a.title}</h2>
            <button data-autofocus="" type="button" onClick={onClose} aria-label="Cerrar" style={{ width: "40px", height: "40px", flex: "none", display: "grid", placeItems: "center", border: 0, borderRadius: "var(--r-circle)", background: "#F1F1EC", cursor: "pointer", color: "#12131A" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "10px 14px", fontSize: "var(--t-ui)" }}>
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt style={{ color: "#5C606C" }}>{k}</dt>
                <dd style={{ margin: 0 }}>{v}</dd>
              </div>
            ))}
          </dl>
          <div style={{ marginTop: "auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
            <button type="button" onClick={() => saveFile(a, data?.content)} style={{ ...pill, border: 0, background: "#12131A", color: "#FFFFFF", fontWeight: 600 }}>{"Descargar"}</button>
            {!binary ? <button type="button" onClick={() => setFull((x) => !x)} style={pill}>{full ? "Reducir" : "Ampliar"}</button> : null}
            <button type="button" onClick={share} style={pill}>{copied ? "Copiado ✓" : binary ? "Copiar el nombre" : "Copiar"}</button>
            {href ? <a href={href} style={{ display: "flex", alignItems: "center", height: "44px", padding: "0 8px", fontSize: "var(--t-body)", color: "#1F4FD1" }}>{"Cómo se hizo"}</a> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
