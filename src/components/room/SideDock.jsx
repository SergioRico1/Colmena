import { useEffect, useRef, useState } from "react";
import { ArrowLeftToLine, ArrowRightToLine, Maximize2, Minimize2, PanelRightClose, Plus, X } from "lucide-react";
import { usePanelWidth } from "../../lib/usePanelWidth.jsx";
import { comboLabel } from "../../lib/useDock.js";
import { popoverItem, popoverStyle, useDismiss } from "./common.jsx";

// The side panel of a room or chat (OpenClaw panel-tab-strip + chat-sidebar-region): a strip
// of tabs (roving keys, ←/→, close on hover or middle click, drag to reorder), «+» to add one,
// a layout menu (expand over the conversation, move left/right, minimise) and the bodies,
// which stay mounted once shown so a live view or a draft is never reloaded.
const TAB_TYPE = "application/x-colmena-dock-tab";

function MenuButton({ label, icon, children, align = "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <span ref={ref} style={{ position: "relative", display: "flex" }}>
      <button type="button" className="rm-focus" aria-haspopup="menu" aria-expanded={open ? "true" : "false"} aria-label={label} title={label} onClick={() => setOpen(!open)}
        style={{ width: "34px", height: "34px", display: "grid", placeItems: "center", background: open ? "#EEF0F4" : "transparent", border: "0", borderRadius: "9px", cursor: "pointer", color: "#2B2D36" }}>
        {icon}
      </button>
      {open ? (
        <div role="menu" aria-label={label} onClick={() => setOpen(false)} style={{ ...popoverStyle, top: "calc(100% + 6px)", [align]: "0", minWidth: "260px", zIndex: 20 }}>
          {children}
        </div>
      ) : null}
    </span>
  );
}

function MenuItem({ icon, label, hint, onClick, disabled }) {
  return (
    <button type="button" role="menuitem" className="rm-item" disabled={disabled} onClick={onClick} style={{ ...popoverItem, justifyContent: "flex-start", opacity: disabled ? 0.5 : 1 }}>
      <span style={{ width: "18px", display: "grid", placeItems: "center", color: "#4A4F5C", flex: "none" }}>{icon}</span>
      <span style={{ flex: "1", fontSize: "14px" }}>{label}</span>
      {hint ? <span style={{ font: "500 11px/1 'Geist Mono', monospace", color: "#555A68" }}>{hint}</span> : null}
    </button>
  );
}

/**
 * dock: useDock(...) state. tabs: [{id, label, icon, render()}] in dock order (resolved by
 * the screen). addable: [{key, label, icon, combo, tab}] for «+». width: usePanelWidth key.
 */
export default function SideDock({ dock, tabs, addable = [], widthKey = "room", label = "Panel lateral" }) {
  const resize = usePanelWidth(widthKey, { min: 340, side: dock.dock });
  const [mounted, setMounted] = useState(() => new Set(dock.active ? [dock.active] : []));
  const [drag, setDrag] = useState(null);
  const [drop, setDrop] = useState(null); // {id, after}
  const strip = useRef(null);
  useEffect(() => {
    if (dock.active && !mounted.has(dock.active)) setMounted((m) => new Set([...m, dock.active]));
    // The active tab is always in view in the strip.
    if (dock.active) requestAnimationFrame(() => strip.current?.querySelector(`[data-tab="${CSS.escape(dock.active)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  }, [dock.active]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!dock.open || !tabs.length) return null;
  const active = tabs.find((t) => t.id === dock.active) || tabs[0];
  const focusTab = (id) => requestAnimationFrame(() => strip.current?.querySelector(`[data-tab="${CSS.escape(id)}"]`)?.focus());
  const onTabKey = (e, i) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      dock.select(next.id);
      focusTab(next.id);
    } else if (e.key === "Delete") {
      e.preventDefault();
      const survivor = tabs[i + 1] || tabs[i - 1];
      dock.close(tabs[i].id);
      if (survivor) focusTab(survivor.id);
    }
  };
  const left = dock.dock === "left";
  const asideStyle = dock.expanded
    ? { flex: "1 1 auto", width: "100%", maxWidth: "none", minWidth: 0, position: "relative" }
    : { flex: "1 1 400px", minWidth: "0", ...resize.style };

  return (
    <aside aria-label={label} className="c-panel" style={{ background: "#F7F8FA", [left ? "borderRight" : "borderLeft"]: "1px solid #DCE0E8", display: "flex", flexDirection: "column", order: left ? -1 : 2, ...asideStyle }}>
      {dock.expanded ? null : resize.handle}
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: "4px", minHeight: "52px", padding: "8px 8px 8px 10px", borderBottom: "1px solid #E6E8EE", background: "#F7F8FA" }}>
        <div ref={strip} role="tablist" aria-label={label} style={{ flex: "1", minWidth: 0, display: "flex", alignItems: "center", gap: "4px", overflowX: "auto", scrollbarWidth: "none" }}>
          {tabs.map((t, i) => {
            const on = t.id === active.id;
            const dropLine = drop?.id === t.id && drag && drag !== t.id ? { boxShadow: drop.after ? "inset -2px 0 0 #FFC93C" : "inset 2px 0 0 #FFC93C" } : {};
            return (
              <span key={t.id} className="c-dock-tab" role="presentation" aria-selected={on ? "true" : "false"}
                draggable={tabs.length > 1}
                onDragStart={(e) => { e.dataTransfer.setData(TAB_TYPE, t.id); e.dataTransfer.effectAllowed = "move"; setDrag(t.id); }}
                onDragEnd={() => { setDrag(null); setDrop(null); }}
                onDragOver={(e) => {
                  if (!drag || drag === t.id) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  const after = e.clientX > r.left + r.width / 2;
                  if (drop?.id !== t.id || drop.after !== after) setDrop({ id: t.id, after });
                }}
                onDrop={(e) => { e.preventDefault(); if (drag && drop) dock.reorder(drag, drop.id, drop.after); setDrag(null); setDrop(null); }}
                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); dock.close(t.id); } }}
                style={{ display: "flex", alignItems: "center", flex: "none", maxWidth: "200px", height: "34px", borderRadius: "9px", border: on ? "1px solid #DCE0E8" : "1px solid transparent", opacity: drag === t.id ? 0.5 : 1, ...dropLine }}>
                <button type="button" role="tab" data-tab={t.id} aria-selected={on ? "true" : "false"} tabIndex={on ? 0 : -1} className="rm-focus" title={t.title || t.label}
                  onClick={() => (on && t.onActivate ? t.onActivate() : dock.select(t.id))} onKeyDown={(e) => onTabKey(e, i)}
                  style={{ display: "flex", alignItems: "center", gap: "7px", minWidth: 0, height: "32px", padding: "0 4px 0 10px", background: "transparent", border: "0", cursor: "pointer", fontSize: "13px", fontWeight: on ? "600" : "500", color: on ? "#12131A" : "#4A4F5C" }}>
                  <span style={{ display: "grid", flex: "none" }}>{t.icon}</span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</span>
                  {t.badge ? <span style={{ flex: "none", font: "600 11px/1 'Geist Mono', monospace", color: "#555A68" }}>{t.badge}</span> : null}
                </button>
                <button type="button" className="rm-focus c-dock-x" tabIndex={on ? 0 : -1} aria-label={"Cerrar " + t.label} title="Cerrar (o clic con la rueda)" onClick={() => dock.close(t.id)}
                  style={{ width: "24px", height: "24px", marginRight: "4px", flex: "none", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "6px", cursor: "pointer", color: "#555A68" }}>
                  <X size={13} strokeWidth={2.4} aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
        {addable.length ? (
          <MenuButton label="Abrir otra pestaña" icon={<Plus size={17} strokeWidth={2.2} aria-hidden="true" />}>
            {addable.map((a) => <MenuItem key={a.key} icon={a.icon} label={a.label} hint={a.combo ? comboLabel(a.combo) : null} disabled={a.disabled} onClick={() => dock.open(a.tab)} />)}
          </MenuButton>
        ) : null}
        <MenuButton label="Diseño del panel" icon={<PanelRightClose size={17} strokeWidth={2.2} aria-hidden="true" style={left ? { transform: "scaleX(-1)" } : undefined} />}>
          <MenuItem icon={dock.expanded ? <Minimize2 size={15} strokeWidth={2.2} aria-hidden="true" /> : <Maximize2 size={15} strokeWidth={2.2} aria-hidden="true" />} label={dock.expanded ? "Volver a verlo al lado" : "Ampliar sobre la conversación"} onClick={() => dock.setExpanded(!dock.expanded)} />
          {left
            ? <MenuItem icon={<ArrowRightToLine size={15} strokeWidth={2.2} aria-hidden="true" />} label="Llevarlo a la derecha" onClick={() => dock.setDock("right")} />
            : <MenuItem icon={<ArrowLeftToLine size={15} strokeWidth={2.2} aria-hidden="true" />} label="Llevarlo a la izquierda" onClick={() => dock.setDock("left")} />}
          <MenuItem icon={<PanelRightClose size={15} strokeWidth={2.2} aria-hidden="true" />} label="Ocultar el panel" hint="Las pestañas se guardan" onClick={() => dock.setOpen(false)} />
        </MenuButton>
      </div>
      <div style={{ flex: "1", minHeight: 0, position: "relative" }}>
        {tabs.map((t) => (mounted.has(t.id) || t.id === active.id ? (
          <div key={t.id} role="tabpanel" aria-label={t.label} hidden={t.id !== active.id} style={{ position: "absolute", inset: 0, overflowY: "auto", overscrollBehavior: "contain", display: t.id === active.id ? "flex" : "none", flexDirection: "column" }}>
            {t.render()}
          </div>
        ) : null))}
      </div>
    </aside>
  );
}
