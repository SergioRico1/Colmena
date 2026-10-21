import { useCallback, useEffect, useRef, useState } from "react";

// The side panel of a room or chat (OpenClaw unified side panel, sidebar-layout.ts): tabs you
// open, reorder and close; one active; docked right or left; minimised (tabs kept) or
// expanded over the conversation. Saved per conversation in this computer, the 500 most
// recent (LRU). A conversation without a saved layout starts empty: it never inherits the
// panels of another one.
const KEY = "colmena:dock:v1";
const MAX = 500;
const EMPTY = { tabs: [], active: null, open: false, dock: "right", expanded: false };

const readAll = () => {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
};
const writeOne = (key, layout) => {
  try {
    const all = readAll();
    delete all[key];
    all[key] = layout;
    const entries = Object.entries(all).slice(-MAX);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {}
};
const normalize = (v) => {
  const tabs = Array.isArray(v?.tabs) ? v.tabs.filter((t) => t && typeof t.id === "string" && typeof t.kind === "string").slice(0, 12) : [];
  const ids = new Set();
  const unique = tabs.filter((t) => (ids.has(t.id) ? false : ids.add(t.id)));
  const active = unique.some((t) => t.id === v?.active) ? v.active : unique[0]?.id || null;
  return { tabs: unique, active, open: !!v?.open && unique.length > 0, dock: v?.dock === "left" ? "left" : "right", expanded: !!v?.expanded && !!v?.open };
};

/**
 * `key`: the room or chat. `transient(tab)`: tabs that are not saved (they come and go with
 * the work, e.g. the live browser). Returns the layout and its operations.
 */
export function useDock(key, { transient = () => false } = {}) {
  const [layout, setLayout] = useState(() => normalize(key ? readAll()[key] : EMPTY));
  // Never saved before: the screen may open a sensible first tab (the thread, if any).
  const [fresh, setFresh] = useState(() => !!key && !(key in readAll()));
  const keyRef = useRef(key);
  const transientRef = useRef(transient);
  transientRef.current = transient;
  if (keyRef.current !== key) {
    keyRef.current = key;
    const all = readAll();
    const next = normalize(key ? all[key] : EMPTY);
    if (JSON.stringify(next) !== JSON.stringify(layout)) setLayout(next);
    const isFresh = !!key && !(key in all);
    if (isFresh !== fresh) setFresh(isFresh);
  }
  const commit = useCallback((fn) => {
    setLayout((prev) => {
      const next = normalize(fn(prev));
      if (keyRef.current) {
        setFresh(false);
        const saved = { ...next, tabs: next.tabs.filter((t) => !transientRef.current(t)) };
        if (!saved.tabs.some((t) => t.id === saved.active)) saved.active = saved.tabs[0]?.id || null;
        if (!saved.tabs.length) saved.open = false;
        writeOne(keyRef.current, saved);
      }
      return next;
    });
  }, []);

  /** Opens (or brings forward) a tab; its fields are refreshed if it was already there. */
  const open = useCallback((tab) => commit((l) => {
    const exists = l.tabs.some((t) => t.id === tab.id);
    return { ...l, tabs: exists ? l.tabs.map((t) => (t.id === tab.id ? { ...t, ...tab } : t)) : [...l.tabs, tab], active: tab.id, open: true, expanded: l.expanded && l.active === tab.id ? l.expanded : l.expanded };
  }), [commit]);
  /** Closes a tab; the neighbour at the same place becomes active; no tabs → panel closes. */
  const close = useCallback((id) => commit((l) => {
    const i = l.tabs.findIndex((t) => t.id === id);
    if (i < 0) return l;
    const tabs = l.tabs.filter((t) => t.id !== id);
    const active = l.active === id ? tabs[Math.min(i, tabs.length - 1)]?.id || null : l.active;
    return { ...l, tabs, active, open: tabs.length ? l.open : false, expanded: tabs.length ? l.expanded : false };
  }), [commit]);
  const select = useCallback((id) => commit((l) => ({ ...l, active: id, open: true })), [commit]);
  /** Keyboard shortcuts toggle: visible → close; otherwise open and show it. */
  const toggle = useCallback((tab) => commit((l) => {
    const visible = l.open && l.active === tab.id;
    if (visible) {
      const i = l.tabs.findIndex((t) => t.id === tab.id);
      const tabs = l.tabs.filter((t) => t.id !== tab.id);
      return { ...l, tabs, active: tabs[Math.min(i, tabs.length - 1)]?.id || null, open: tabs.length > 0 && l.open, expanded: false };
    }
    const exists = l.tabs.some((t) => t.id === tab.id);
    return { ...l, tabs: exists ? l.tabs : [...l.tabs, tab], active: tab.id, open: true };
  }), [commit]);
  const reorder = useCallback((id, target, after) => commit((l) => {
    const moving = l.tabs.find((t) => t.id === id);
    if (!moving || id === target) return l;
    const rest = l.tabs.filter((t) => t.id !== id);
    let i = rest.findIndex((t) => t.id === target);
    if (i < 0) return l;
    if (after) i += 1;
    return { ...l, tabs: [...rest.slice(0, i), moving, ...rest.slice(i)] };
  }), [commit]);
  const setOpen = useCallback((value) => commit((l) => ({ ...l, open: value && l.tabs.length > 0, expanded: value ? l.expanded : false })), [commit]);
  const setDock = useCallback((dock) => commit((l) => ({ ...l, dock })), [commit]);
  const setExpanded = useCallback((value) => commit((l) => ({ ...l, expanded: value && l.open })), [commit]);
  const isVisible = useCallback((id) => layout.open && layout.active === id, [layout.open, layout.active]);
  return { ...layout, fresh, isVisible, open, close, select, toggle, reorder, setOpen, setDock, setExpanded };
}

/**
 * Panel shortcuts (OpenClaw keyboard-shortcut-contract: chords with Alt so they never clash
 * with the browser or editing keys). `map`: [{combo, run}]; combo like "mod+shift+b".
 */
export function usePanelShortcuts(map, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.repeat || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      for (const s of ref.current) {
        if (matches(s.combo, e)) {
          e.preventDefault();
          s.run();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

export function matches(combo, e) {
  const parts = combo.toLowerCase().split("+");
  const key = parts.pop();
  const want = { mod: parts.includes("mod") || parts.includes("ctrl"), shift: parts.includes("shift"), alt: parts.includes("alt") };
  const k = e.code?.startsWith("Key") ? e.code.slice(3).toLowerCase() : e.code === "Backquote" ? "`" : String(e.key || "").toLowerCase();
  return (e.ctrlKey || e.metaKey) === want.mod && e.shiftKey === want.shift && e.altKey === want.alt && k === key;
}

/** «Ctrl+Mayús+B» for tooltips and the shortcuts list. */
export function comboLabel(combo) {
  return combo.split("+").map((p) => ({ mod: "Ctrl", ctrl: "Ctrl", shift: "Mayús", alt: "Alt" })[p] || (p.length === 1 ? p.toUpperCase() : p)).join("+");
}
