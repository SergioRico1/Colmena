import { useClickAway } from "../../lib/useClickAway.js";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowDownRight, ArrowUp, ArrowUpRight, CircleCheck, CircleX, Ellipsis, ExternalLink, Globe, MessageCircle, Minus, Pin, PinOff, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { Shape } from "../v3/dia/parts.jsx";
import { del, post } from "../../lib/api.js";
import { useStore } from "../../lib/store.jsx";
import { roomUrl } from "../../lib/format.js";
import { later, reversible } from "../../lib/undoToast.js";
import {
  STATE_LABEL, asOfLabel, cellText, deltaLabel, externalHref, formatValue, hostOf, isStale, progressPercent, sourceLabel, sparklineEnd, sparklinePath, updatedLabel,
} from "../../lib/blocks.js";

// One live block (server/blocks.mjs; docs/CONTRACT.md §17): a figure, a short list, a small
// table, a progress or a state that a bot keeps up to date. The same card in the conversation
// where it was posted and on the panel of Inicio. It is data: nothing in it starts anything.
// Every value is drawn as text (React escapes it) and every number is formatted here.
// Colours follow the design system: ink for the value, green and red only for «better» and
// «worse», never honey (honey means «te necesita»).

const INK = "#12131A", MUTED = "#5C606C", SOFT = "#4A4D57", GOOD = "#0B6B4A", BAD = "#B4372A", STALE = "#666A75", LINK = "#1F4FD1";
const CARD = {
  chat: { padding: "18px 20px", borderRadius: "20px", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(18,19,26,.05), 0 20px 40px -30px rgba(18,19,26,.35)" },
  panel: { padding: "16px 18px", borderRadius: "20px", background: "#FFFFFF" },
};
const quiet = { height: "32px", padding: "0 10px", display: "inline-flex", alignItems: "center", gap: "6px", border: "0", borderRadius: "999px", background: "transparent", color: SOFT, fontSize: "13.5px", fontWeight: "500", cursor: "pointer" };

/** Re-renders every minute so «hace 2 h» and the stale state stay true while the screen is open. */
function useMinute() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Sparkline({ values, tone }) {
  const W = 120, H = 34;
  const path = sparklinePath(values, W, H, 3);
  if (!path) return null;
  const end = sparklineEnd(values, W, H, 3);
  const color = tone || INK;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false" style={{ flex: "none", overflow: "visible" }}>
      <path d={path} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      {end ? <circle cx={end.x} cy={end.y} r="2.75" fill={color} /> : null}
    </svg>
  );
}

function OutLink({ url, label = null }) {
  const href = externalHref(url);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener nofollow" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "5px", maxWidth: "100%", fontSize: "13px", fontWeight: "500", color: LINK, overflowWrap: "anywhere" }}>
      <ExternalLink size={13} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none" }} />{label || hostOf(href)}
    </a>
  );
}

const STATE_ICON = { ok: [CircleCheck, GOOD], atencion: [TriangleAlert, INK], fallo: [CircleX, BAD] };
function StateMark({ state, size = 16, muted = false }) {
  const [Icon, color] = STATE_ICON[state] || [Minus, MUTED];
  return <Icon size={size} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", color: muted ? STALE : color }} />;
}

function Kpi({ block, stale }) {
  const s = block.spec;
  const delta = deltaLabel(block.delta, s.unit);
  const tone = stale ? STALE : delta?.tone === "good" ? GOOD : delta?.tone === "bad" ? BAD : MUTED;
  const Arrow = delta?.direction === "up" ? ArrowUpRight : delta?.direction === "down" ? ArrowDownRight : Minus;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "14px" }}>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
        <span style={{ fontSize: "13px", color: stale ? STALE : MUTED, overflowWrap: "anywhere" }}>{s.label}</span>
        <span data-block-value="" style={{ font: "600 34px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", color: stale ? STALE : INK, overflowWrap: "anywhere" }}>{formatValue(s.value, s.unit)}</span>
        {delta ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "13px", fontWeight: "600", color: tone, fontVariantNumeric: "tabular-nums" }}>
            <Arrow size={14} strokeWidth={2.4} aria-hidden="true" style={{ flex: "none" }} />
            <span aria-hidden="true">{delta.text}</span>
            <span style={srOnly}>{delta.spoken}</span>
          </span>
        ) : null}
      </div>
      <Sparkline values={block.sparkline} tone={stale ? STALE : delta?.tone === "good" ? GOOD : delta?.tone === "bad" ? BAD : INK} />
    </div>
  );
}

function List({ block, stale }) {
  return (
    <ul style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column" }}>
      {block.spec.rows.map((row, i) => {
        const href = externalHref(row.url);
        const label = <span style={{ flex: "1", minWidth: 0, color: stale ? STALE : INK, overflowWrap: "anywhere" }}>{row.label}</span>;
        return (
          <li key={i} style={{ display: "flex", alignItems: "baseline", gap: "10px", minHeight: "34px", padding: "6px 0", borderTop: i ? "1px solid rgba(18,19,26,.07)" : "0", fontSize: "14px", lineHeight: "1.4" }}>
            {row.status ? <span style={{ alignSelf: "center", display: "inline-flex" }}><StateMark state={row.status} size={15} muted={stale} /><span style={srOnly}>{STATE_LABEL[row.status] + ": "}</span></span> : null}
            {href ? <a href={href} target="_blank" rel="noreferrer noopener nofollow" style={{ flex: "1", minWidth: 0, color: stale ? STALE : LINK, overflowWrap: "anywhere" }}>{row.label}</a> : label}
            {row.value !== undefined && row.value !== null ? <span style={{ flex: "none", maxWidth: "55%", textAlign: "right", fontWeight: "600", fontVariantNumeric: "tabular-nums", color: stale ? STALE : INK, overflowWrap: "anywhere" }}>{cellText(row.value)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function Table({ block, stale }) {
  const { columns, rows } = block.spec;
  // A column is numbers when every filled cell is one: then it lines up on the right.
  const numeric = columns.map((_, c) => rows.some((r) => typeof r[c] === "number") && rows.every((r) => r[c] === null || typeof r[c] === "number"));
  const cell = (c) => ({ padding: "7px 10px 7px 0", textAlign: numeric[c] ? "right" : "left", fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere", verticalAlign: "top" });
  return (
    <div role="group" aria-label={`Tabla: ${block.title}`} tabIndex={0} style={{ overflowX: "auto", margin: "0 -4px", padding: "0 4px" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13.5px", lineHeight: "1.4", color: stale ? STALE : INK }}>
        <thead>
          <tr>{columns.map((name, c) => <th key={c} scope="col" style={{ ...cell(c), paddingTop: "0", fontSize: "12.5px", fontWeight: "500", color: stale ? STALE : MUTED, borderBottom: "1px solid rgba(18,19,26,.12)" }}>{name}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, r) => <tr key={r}>{row.map((value, c) => <td key={c} style={{ ...cell(c), borderTop: r ? "1px solid rgba(18,19,26,.07)" : "0" }}>{cellText(value)}</td>)}</tr>)}
          {!rows.length ? <tr><td colSpan={columns.length} style={{ padding: "10px 0", color: MUTED }}>{"Sin filas por ahora."}</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function Progress({ block, stale }) {
  const s = block.spec, p = progressPercent(s.value, s.max);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px", fontSize: "14px" }}>
        <span style={{ minWidth: 0, color: stale ? STALE : INK, overflowWrap: "anywhere" }}>{s.label}</span>
        <span style={{ flex: "none", fontWeight: "600", fontVariantNumeric: "tabular-nums", color: stale ? STALE : INK }}>{formatValue(s.value) + " de " + formatValue(s.max, s.unit)}</span>
      </div>
      <div role="progressbar" aria-label={s.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-valuetext={p + " %"} style={{ position: "relative", height: "6px", borderRadius: "3px", background: "#ECECE7", overflow: "hidden" }}>
        <span style={{ position: "absolute", inset: "0 auto 0 0", width: p + "%", borderRadius: "3px", background: stale ? STALE : INK, transition: "width .4s ease" }} />
      </div>
    </div>
  );
}

function Status({ block, stale }) {
  const s = block.spec;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "15px", fontWeight: "600", color: stale ? STALE : INK }}>
        <StateMark state={s.state} size={18} muted={stale} />
        <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{s.label}</span>
        <span style={{ flex: "none", marginLeft: "auto", height: "24px", padding: "0 10px", display: "inline-flex", alignItems: "center", borderRadius: "999px", background: stale ? "#F1F1EC" : s.state === "ok" ? "#E3F4EC" : s.state === "fallo" ? "#FBE6E3" : "#ECECE7", color: stale ? STALE : s.state === "ok" ? GOOD : s.state === "fallo" ? BAD : INK, fontSize: "12px", fontWeight: "600" }}>{STATE_LABEL[s.state] || s.state}</span>
      </div>
      {s.note ? <span style={{ fontSize: "13.5px", lineHeight: "1.45", color: stale ? STALE : SOFT, overflowWrap: "anywhere" }}>{s.note}</span> : null}
    </div>
  );
}

const BODY = { kpi: Kpi, list: List, table: Table, progress: Progress, status: Status };
const srOnly = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

/** The «…» menu of a block: pin or unpin, move on the panel, open its conversation, remove. Arrow keys, Home, End, Escape. */
function BlockMenu({ block, where, move, onMove, onError }) {
  const { run, missions } = useStore();
  const [open, setOpen] = useState(false);
  const box = useRef(null), button = useRef(null), menu = useRef(null);
  useEffect(() => {
    if (open) menu.current?.querySelector("[role='menuitem']:not([aria-disabled='true'])")?.focus({ preventScroll: true });
  }, [open]);
  useClickAway(open, box, () => setOpen(false), { escape: false });
  const close = (refocus = true) => { setOpen(false); if (refocus) button.current?.focus({ preventScroll: true }); };
  const onKeyDown = (e) => {
    if (!open) return;
    const rows = [...(menu.current?.querySelectorAll("[role='menuitem']:not([aria-disabled='true'])") || [])];
    const at = rows.indexOf(document.activeElement);
    const to = e.key === "ArrowDown" ? rows[(at + 1) % rows.length] : e.key === "ArrowUp" ? rows[(at - 1 + rows.length) % rows.length] : e.key === "Home" ? rows[0] : e.key === "End" ? rows.at(-1) : null;
    if (to) { e.preventDefault(); to.focus({ preventScroll: true }); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "Tab") setOpen(false);
  };
  const act = async (work) => {
    onError(null);
    close();
    try { await work(); } catch (e) { onError(e?.message || "No se pudo hacer. Vuelve a intentarlo."); }
  };
  const path = "/blocks/" + encodeURIComponent(block.id);
  const pin = (pinned) => act(async () => {
    await run(() => post(path + "/pin", { pinned }));
    // Off the panel with its conversation gone, the block itself is gone: nothing to undo.
    if (pinned || !block.source?.gone) reversible({ id: "block-pin:" + block.id, text: pinned ? "Fijado en el panel" : "Quitado del panel", undo: () => run(() => post(path + "/pin", { pinned: !pinned })) });
  });
  const remove = () => act(async () => { later({ id: "block-del:" + block.id, text: "Dato quitado", keys: ["block:" + block.id], run: () => run(() => del(path)), error: "No se pudo quitar" }); });
  const mission = block.source?.missionId ? missions.find((m) => m.id === block.source.missionId) : null;
  const item = { display: "flex", alignItems: "center", gap: "10px", minHeight: "38px", padding: "0 10px", border: "0", borderRadius: "10px", background: "transparent", textAlign: "left", cursor: "pointer", fontSize: "14px", color: INK, textDecoration: "none" };
  const off = { ...item, color: "#A3A6AE", cursor: "default" };
  const I = { size: 16, strokeWidth: 2, "aria-hidden": "true", style: { flex: "none" } };
  return (
    <span ref={box} onKeyDown={onKeyDown} style={{ position: "relative", flex: "none", display: "inline-flex" }}>
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open ? "true" : "false"} aria-label={`Opciones de «${block.title}»`} title="Opciones" data-block-menu="" onClick={() => setOpen((v) => !v)}
        style={{ width: "32px", height: "32px", display: "grid", placeItems: "center", border: "0", borderRadius: "50%", background: open ? "rgba(18,19,26,.06)" : "transparent", color: SOFT, cursor: "pointer" }}>
        <Ellipsis size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>
      {open ? (
        <div ref={menu} role="menu" aria-label={`Opciones de «${block.title}»`} style={{ position: "absolute", zIndex: 20, top: "calc(100% + 6px)", right: "0", minWidth: "232px", display: "flex", flexDirection: "column", gap: "2px", padding: "6px", borderRadius: "16px", background: "#FFFFFF", boxShadow: "0 2px 6px rgba(18,19,26,.08), 0 24px 48px -20px rgba(18,19,26,.4)", animation: "fade .15s ease-out" }}>
          <style>{".blk-item:hover,.blk-item:focus-visible{background:rgba(18,19,26,.05)!important}"}</style>
          {block.pinned
            ? <button type="button" role="menuitem" className="blk-item" onClick={() => pin(false)} style={item}><PinOff {...I} />{"Quitar del panel"}</button>
            : <button type="button" role="menuitem" className="blk-item" onClick={() => pin(true)} style={item}><Pin {...I} />{"Fijar en el panel"}</button>}
          {where === "panel" && move ? (<>
            <button type="button" role="menuitem" className={move.up ? "blk-item" : undefined} aria-disabled={move.up ? undefined : "true"} onClick={() => { if (move.up) { close(); onMove("up"); } }} style={move.up ? item : off}><ArrowUp {...I} />{"Subir"}</button>
            <button type="button" role="menuitem" className={move.down ? "blk-item" : undefined} aria-disabled={move.down ? undefined : "true"} onClick={() => { if (move.down) { close(); onMove("down"); } }} style={move.down ? item : off}><ArrowDown {...I} />{"Bajar"}</button>
          </>) : null}
          {where === "panel" && mission ? <a role="menuitem" className="blk-item" href={roomUrl(mission)} onClick={() => setOpen(false)} style={item}><MessageCircle {...I} />{"Abrir la conversación"}</a> : null}
          <button type="button" role="menuitem" className="blk-item" onClick={remove} style={{ ...item, color: BAD }}><Trash2 {...I} />{"Quitar"}</button>
          {block.outside || (where === "panel" && block.source?.gone) ? (
            <div style={{ margin: "4px 4px 2px", paddingTop: "8px", borderTop: "1px solid rgba(18,19,26,.08)", display: "flex", flexDirection: "column", gap: "6px" }}>
              {block.outside ? <span role="note" data-block-outside="" style={{ display: "flex", alignItems: "flex-start", gap: "8px", padding: "0 6px", fontSize: "12.5px", lineHeight: "1.4", color: MUTED }}><Globe size={14} strokeWidth={2} aria-hidden="true" style={{ flex: "none", marginTop: "2px" }} />{"Incluye datos de fuera (una web, un correo o una app). Tómalo como un dato sin confirmar."}</span> : null}
              {where === "panel" && block.source?.gone ? <span role="note" style={{ padding: "0 6px", fontSize: "12.5px", lineHeight: "1.4", color: MUTED }}>{"La conversación donde se dejó ya no existe."}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}

/**
 * @param {object} p
 * @param {object} p.block a block as the server sends it (blockView)
 * @param {'chat'|'panel'} [p.where] where it is drawn: the card's own look and what its menu offers
 * @param {{up: boolean, down: boolean}} [p.move] on the panel: which way it can still move
 * @param {(direction: 'up'|'down') => void} [p.onMove]
 */
export default function BlockCard({ block, where = "chat", move = null, onMove = null }) {
  const { bots, run } = useStore();
  const now = useMinute();
  const [error, setError] = useState(null);
  // «Actualizar»: the routine runs now; the card says so until the block changes (or two minutes pass).
  const [refreshing, setRefreshing] = useState(null);
  useEffect(() => {
    if (!refreshing) return undefined;
    if (refreshing !== block.updatedAt) { setRefreshing(null); return undefined; }
    const timer = setTimeout(() => setRefreshing(null), 120_000);
    return () => clearTimeout(timer);
  }, [refreshing, block.updatedAt]);
  const stale = isStale(block, now);
  const Body = BODY[block.type];
  const bot = bots.find((b) => b.id === block.source?.botId) || null;
  const refresh = async () => {
    if (refreshing) return;
    setError(null);
    setRefreshing(block.updatedAt);
    try { await run(() => post("/blocks/" + encodeURIComponent(block.id) + "/refresh", {})); }
    catch (e) { setRefreshing(null); setError(e?.message || "No se pudo actualizar. Vuelve a intentarlo."); }
  };
  const asOf = block.type === "kpi" && block.spec.asOf ? asOfLabel(block.spec.asOf, now) : "";
  return (
    <article data-block={block.id} data-block-type={block.type} data-stale={stale ? "true" : "false"} aria-label={block.title} style={{ ...CARD[where === "panel" ? "panel" : "chat"], minWidth: 0, display: "flex", flexDirection: "column", gap: "14px", color: INK }}>
      <header style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
        <div style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
          <h3 style={{ margin: "0", fontSize: "15.5px", lineHeight: "1.3", fontWeight: "600", overflowWrap: "anywhere" }}>{block.title}</h3>
          <span style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0, fontSize: "12.5px", color: MUTED }}>
            {bot ? <Shape bot={bot} size={10} /> : null}
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sourceLabel(block)}</span>
          </span>
        </div>
        <BlockMenu block={block} where={where} move={move} onMove={onMove} onError={setError} />
      </header>
      {Body ? <Body block={block} stale={stale} /> : <span style={{ fontSize: "14px", color: MUTED }}>{"Este tipo de dato no se puede mostrar en esta versión."}</span>}
      {block.spec?.url ? <OutLink url={block.spec.url} /> : null}
      <footer style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px", fontSize: "12.5px", color: stale ? SOFT : MUTED }}>
        <span data-block-updated="" style={{ fontWeight: stale ? "600" : "400" }}>{updatedLabel(block, now)}</span>
        {asOf ? <span>{"· " + asOf}</span> : null}
        {/* Only a block a routine keeps can be refreshed: it runs that routine now. */}
        {block.canRefresh ? (
          <button type="button" onClick={refresh} aria-disabled={refreshing ? "true" : undefined} data-block-refresh="" title="Pone en marcha su rutina ahora" style={{ ...quiet, flex: "none", marginLeft: "auto", marginRight: "-10px", cursor: refreshing ? "progress" : "pointer" }}>
            <RefreshCw size={14} strokeWidth={2.2} aria-hidden="true" style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }} />
            {refreshing ? "Actualizando…" : "Actualizar"}
          </button>
        ) : null}
      </footer>
      <span role="status" aria-live="polite" style={srOnly}>{refreshing ? "Actualizando " + block.title : ""}</span>
      {error ? <span role="alert" style={{ fontSize: "13px", lineHeight: "1.45", fontWeight: "600", color: BAD }}>{error}</span> : null}
    </article>
  );
}
