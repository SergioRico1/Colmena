import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { addUnsent, removeUnsent } from "./unsent.js";
import { api } from "./api.js";
import { useHiddenVersion, visible } from "./undoToast.js";

// Global data layer: /api/state snapshot + SSE invalidation + live text deltas.
const StoreContext = createContext(null);
// Detail views refetch on every server change; only they listen to this counter, so a
// change that leaves /api/state identical does not re-render the whole app.
const RevisionContext = createContext(0);

const EMPTY = {
  account: null, provider: null, authError: null, models: [], settings: {}, usage: {}, paused: false,
  bots: [], missions: [], approvals: [], automations: [], suggestions: [], skills: [], memories: [],
  artifacts: [], folders: [], people: [], connectors: [], unread: 0, notifications: [],
};

const HIDEABLE = [["missions", "mission"], ["bots", "bot"], ["automations", "automation"], ["memories", "memory"], ["artifacts", "artifact"], ["folders", "folder"], ["people", "person"], ["approvals", "approval"], ["skills", "skill"], ["goals", "goal"], ["grants", "grant"], ["notifications", "notification"], ["watchNotes", "watchnote"]];

// The last /api/state, kept in the browser: the app opens with what you saw last time and
// refreshes behind it (OpenClaw keeps chat snapshots the same way). Never the source of truth.
const SNAPSHOT_KEY = "colmena:state-snapshot";
const SNAPSHOT_MAX = 1_500_000;
function readSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" && Array.isArray(v.bots) ? v : null;
  } catch {
    return null;
  }
}
let snapshotTimer = null;
function saveSnapshot(text) {
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    try {
      if (text.length < SNAPSHOT_MAX) localStorage.setItem(SNAPSHOT_KEY, text);
    } catch {}
  }, 800);
}

export function StoreProvider({ children }) {
  const [snapshot] = useState(readSnapshot);
  const [state, setState] = useState(() => (snapshot ? { ...EMPTY, ...snapshot } : EMPTY));
  // With a snapshot the lists show at once (no skeleton); the fresh state replaces it.
  const [ready, setReady] = useState(!!snapshot);
  const [error, setError] = useState(null);
  const [revision, setRevision] = useState(0); // bumps on every server change (detail views refetch)
  const [live, setLive] = useState({}); // stepId -> { text, botId, mission }
  const [activity, setActivity] = useState({}); // botId -> { verb, detail, mission, at }
  const [online, setOnline] = useState(true); // live channel to the local service
  const timer = useRef(null);
  const retryTimer = useRef(null);
  const lastState = useRef("");
  const deltas = useRef(new Map()); // stepId → text waiting for the next frame
  const frame = useRef(null);
  const flushDeltas = useCallback(() => {
    frame.current = null;
    if (!deltas.current.size) return;
    const batch = [...deltas.current];
    deltas.current.clear();
    setLive((all) => {
      const next = { ...all };
      for (const [stepId, d] of batch) next[stepId] = { botId: d.botId, mission: d.mission, text: (d.reset ? "" : all[stepId]?.text || "") + d.text };
      return next;
    });
    setActivity((all) => {
      const next = { ...all };
      for (const [, d] of batch) next[d.botId] = { verb: all[d.botId]?.verb === "programando" ? "programando" : "escribiendo", mission: d.mission, at: Date.now() };
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await api("/state");
      // Live missions send many change events; most refreshes bring the same snapshot.
      // Same snapshot → same object, so nothing re-renders.
      const text = JSON.stringify(next);
      if (text !== lastState.current) {
        lastState.current = text;
        setState({ ...EMPTY, ...next });
        // Incognito chats never reach the browser's storage (OpenClaw).
        saveSnapshot(next.missions?.some((m) => m.incognito) ? JSON.stringify({ ...next, missions: next.missions.filter((m) => !m.incognito) }) : text);
      }
      setReady(true);
      setError(null);
    } catch (e) {
      // The local service may still be starting (desktop launch): try again shortly.
      setError(e.message);
      clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => refresh(), 1500);
    }
  }, []);

  // What changed decides what is fetched again. Messages and steps arrive pushed, whole
  // (applied by applyPush), so they never make the open room fetch itself again; the event
  // log only bumps detail views every so often.
  const pendingKinds = useRef(new Set());
  const schedule = useCallback((kinds = null) => {
    if (kinds) kinds.forEach((k) => pendingKinds.current.add(k));
    else pendingKinds.current.add("*");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const all = [...pendingKinds.current];
      pendingKinds.current.clear();
      // Missions and approvals reach the rooms through /api/state (useRoom merges them).
      // The event log is not shown by any detail view: it only refreshes the summary.
      const others = all.filter((k) => !PUSHED.has(k) && !IN_STATE.has(k) && k !== "events");
      if (all.some((k) => k !== "messages")) refresh();
      if (others.length) setRevision((r) => r + 1);
    }, 150);
  }, [refresh]);

  useEffect(() => {
    refresh();
    let source;
    let retry;
    const connect = () => {
      source = new EventSource("/api/events");
      source.onopen = () => setOnline(true);
      source.onmessage = (message) => {
        let event;
        try {
          event = JSON.parse(message.data);
        } catch {
          return;
        }
        if (event.type === "browser_frame") {
          window.dispatchEvent(new CustomEvent("colmena:browser_frame", { detail: event }));
          return;
        }
        if (event.type === "delta") {
          // At most one repaint per frame however many deltas arrive (OpenClaw); a reset
          // (a retry, or a part of the answer already said in the room) applies at once.
          const queue = deltas.current;
          const prev = queue.get(event.stepId);
          queue.set(event.stepId, {
            botId: event.botId, mission: event.mission,
            reset: event.reset || prev?.reset || false,
            text: event.reset ? event.text || "" : (prev?.text || "") + (event.text || ""),
          });
          if (event.reset) flushDeltas();
          else if (!frame.current) frame.current = (typeof requestAnimationFrame === "function" && document.visibilityState !== "hidden" ? requestAnimationFrame : (fn) => setTimeout(fn, 16))(flushDeltas);
          return;
        }
        if (event.type === "activity") {
          // The bot stopped (paused, interrupted, failed): its half-written text goes too; it
          // writes it again when it goes on.
          if (!event.verb) {
            for (const [k, d] of deltas.current) if (d.botId === event.botId && d.mission === event.mission) deltas.current.delete(k);
            setLive((all) => {
              const stale = Object.entries(all).filter(([, l]) => l.botId === event.botId && l.mission === event.mission);
              return stale.length ? Object.fromEntries(Object.entries(all).filter(([, l]) => !(l.botId === event.botId && l.mission === event.mission))) : all;
            });
            setActivity((all) => {
              if (!all[event.botId] || all[event.botId].mission !== event.mission) return all;
              const { [event.botId]: _gone, ...rest } = all;
              return rest;
            });
            return;
          }
          setActivity((all) => ({ ...all, [event.botId]: { verb: event.verb, detail: event.detail, mission: event.mission, at: Date.now() } }));
          return;
        }
        if (event.type === "notify") {
          // Desktop shells (Electron) can turn this into a system notification.
          try {
            window.dispatchEvent(new CustomEvent("colmena:notify", { detail: { title: event.title, text: event.text, url: event.url, kind: event.kind } }));
          } catch {}
        }
        if (event.type === "push") {
          applyPush(event);
          return;
        }
        if (event.type === "changed") {
          schedule(event.kinds || []);
          return;
        }
        if (event.type === "step_done" || event.type === "completed") {
          for (const [k, d] of deltas.current) if (k === event.stepId || (event.type === "completed" && d.mission === event.mission)) deltas.current.delete(k);
          const done = (entry) => entry.mission === event.mission && (event.type === "completed" || entry.botId === event.botId);
          setLive((all) => Object.fromEntries(Object.entries(all).filter(([key, entry]) => !(key === event.stepId || (event.type === "completed" && entry.mission === event.mission)))));
          setActivity((all) => Object.fromEntries(Object.entries(all).filter(([botId, entry]) => !done({ ...entry, botId }))));
        }
        // A step or a mission ended: its records arrive pushed; only the summary refreshes.
        schedule(event.type === "step_done" || event.type === "completed" ? ["missions"] : null);
      };
      source.onerror = () => {
        setOnline(false);
        source.close();
        retry = setTimeout(() => {
          connect();
          schedule();
        }, 2000);
      };
    };
    connect();
    return () => {
      source?.close();
      clearTimeout(retry);
      clearTimeout(timer.current);
    };
  }, [refresh, schedule]);

  // Generic action runner: performs the call, refreshes, returns result or throws.
  const run = useCallback(async (fn) => {
    const result = await fn();
    await refresh();
    setRevision((r) => r + 1);
    return result;
  }, [refresh]);

  // Warm-up (OpenClaw session prefetch): once the app is idle, the three rooms or chats you
  // touched last are loaded, so opening any of them is instant.
  const warmed = useRef(false);
  useEffect(() => {
    if (warmed.current || !lastState.current || !state.missions.length) return undefined;
    warmed.current = true;
    const recent = [...state.missions]
      .filter((m) => !m.archived)
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))
      .slice(0, 3);
    const idle = typeof requestIdleCallback === "function" ? requestIdleCallback : (fn) => setTimeout(fn, 600);
    const handle = idle(() => { for (const m of recent) prefetch("/missions/" + m.id); });
    return () => (typeof cancelIdleCallback === "function" ? cancelIdleCallback(handle) : clearTimeout(handle));
  }, [state.missions]);

  // What waits five seconds to be deleted («Deshacer», src/lib/undoToast.js) leaves every list at once.
  const hiddenVersion = useHiddenVersion();
  const shown = useMemo(() => {
    const out = { ...state };
    for (const [key, kind] of HIDEABLE) if (Array.isArray(state[key])) out[key] = visible(kind, state[key]);
    return out;
  }, [state, hiddenVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const value = useMemo(() => ({ ...shown, state: shown, ready, error, online, live, activity, refresh, run }), [shown, ready, error, online, live, activity, refresh, run]);
  return <StoreContext.Provider value={value}><RevisionContext.Provider value={revision}>{children}</RevisionContext.Provider></StoreContext.Provider>;
}

export function useStore() {
  return useContext(StoreContext);
}

// Last answer per path: going back to a screen shows what it had at once and refreshes
// behind the scenes, instead of an empty "Cargando…" for a moment.
const resourceCache = new Map();
const resourceSubs = new Map(); // path → Set(setState) of the mounted useResource hooks
const PUSHED = new Set(["messages", "steps"]);
// Kinds that reach the screens through /api/state, or that no detail view shows.
const IN_STATE = new Set(["missions", "approvals", "notifications", "settings", "learningCounters", "usage", "suggestions"]);

/** Changes a cached resource in place and repaints whoever shows it (no fetch). */
export function patchResource(path, fn) {
  const prev = resourceCache.get(path);
  if (prev === undefined || prev === null) return;
  const next = fn(prev);
  if (next === prev || next === undefined) return;
  resourceCache.set(path, next);
  for (const set of resourceSubs.get(path) || []) set(next);
}

/** Loads a resource ahead of time (hovering a room or a chat): opening it is instant. */
const inflight = new Map();
export function prefetch(path) {
  if (!path) return Promise.resolve();
  if (resourceCache.has(path)) return Promise.resolve(resourceCache.get(path));
  if (inflight.has(path)) return inflight.get(path);
  const job = api(path).then((d) => {
    if (!resourceCache.has(path)) {
      resourceCache.set(path, d);
      for (const set of resourceSubs.get(path) || []) set(d);
    }
    return resourceCache.get(path);
  }).catch(() => null).finally(() => inflight.delete(path));
  inflight.set(path, job);
  return job;
}

const upsert = (list = [], record, op) => {
  if (op === "remove") return list.some((x) => x.id === record.id) ? list.filter((x) => x.id !== record.id) : list;
  const i = list.findIndex((x) => x.id === record.id);
  if (i >= 0) {
    if (JSON.stringify(list[i]) === JSON.stringify(record)) return list;
    const next = list.slice();
    next[i] = record;
    return next;
  }
  // A real message of yours replaces the one shown at once when you sent it.
  const base = record.role === "user" ? list.filter((x) => !(x.optimistic && x.text === record.text)) : list;
  // settled: it already rose in as the optimistic copy, so it does not animate again.
  return [...base, base.length < list.length ? { ...record, settled: true } : record];
};

/** A pushed message or step lands in the open room (and its cached copy) right away. */
function applyPush(event) {
  const key = event.kind === "messages" ? "messages" : "steps";
  for (const path of resourceCache.keys()) {
    const m = /^\/missions\/([^/?]+)(\?mensajes=todos)?$/.exec(path);
    if (!m || (event.op !== "remove" && m[1] !== event.mission)) continue;
    patchResource(path, (prev) => {
      const list = Array.isArray(prev[key]) ? prev[key] : [];
      const next = upsert(list, event.op === "remove" ? { id: event.id } : event.record, event.op);
      return next === list ? prev : { ...prev, [key]: next };
    });
  }
}

/** Fetches a detail resource and refetches whenever the server reports changes. */
export function useResource(path) {
  const revision = useContext(RevisionContext);
  const [data, setDataState] = useState(() => (path ? resourceCache.get(path) ?? null : null));
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(path) && !resourceCache.has(path));
  const [shownPath, setShownPath] = useState(path);
  if (shownPath !== path) {
    // Another path in the same screen (another chat, another mission): switch right away.
    setShownPath(path);
    setDataState(path ? resourceCache.get(path) ?? null : null);
    setLoading(Boolean(path) && !resourceCache.has(path));
    setError(null);
  }
  useEffect(() => {
    if (!path) return undefined;
    if (!resourceSubs.has(path)) resourceSubs.set(path, new Set());
    const subs = resourceSubs.get(path);
    subs.add(setDataState);
    return () => subs.delete(setDataState);
  }, [path]);
  const setData = useCallback((next) => {
    setDataState((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      if (path) resourceCache.set(path, value);
      return value;
    });
  }, [path]);
  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let alive = true;
    api(path)
      .then((d) => {
        if (!alive) return;
        // Unchanged detail (a refetch after an unrelated change): keep the same object.
        const prev = resourceCache.get(path);
        // A prefetch may have filled the cache after this hook first rendered and before it
        // subscribed: show that copy instead of staying empty.
        if (prev !== undefined && JSON.stringify(prev) === JSON.stringify(d)) { setDataState((cur) => (cur === prev ? cur : prev)); setError(null); return; }
        resourceCache.set(path, d);
        setDataState(d);
        setError(null);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, revision]);
  return { data, error, loading, setData };
}

/**
 * Small helper for buttons: tracks busy state, last error message and its HTTP status.
 * A 409 (content changed, or expired) refreshes the state so the latest version shows up.
 */
export function useAction() {
  const { run } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setErrorText] = useState(null);
  const [status, setStatus] = useState(null);
  const setError = useCallback((value) => {
    setErrorText(value);
    if (!value) setStatus(null);
  }, []);
  const act = useCallback(async (fn) => {
    if (busy) return;
    setBusy(true);
    setErrorText(null);
    setStatus(null);
    try {
      return await run(fn);
    } catch (e) {
      setErrorText(e.message);
      setStatus(e.status ?? null);
      if (e.status === 409) await run(async () => null).catch(() => {});
    } finally {
      setBusy(false);
    }
  }, [busy, run]);
  return { act, busy, error, status, conflict: status === 409, setError };
}

/** Your message, shown in the room the moment you send it (OpenClaw optimistic send). */
const sentText = new Map(); // optimistic id → text (what failSent keeps in «No enviados»)
export function showSent(path, text, attachments = []) {
  const id = "sending-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
  sentText.set(id, text);
  if (sentText.size > 50) sentText.delete(sentText.keys().next().value);
  const add = (prev) => ({
    ...prev,
    messages: [...(prev.messages || []), { id, missionId: path.split("/")[2] || null, role: "user", text, kind: "message", at: new Date().toISOString(), optimistic: true, attachments: (attachments || []).map((f) => ({ name: f.name, size: f.size ?? null })), reactions: [] }],
  });
  patchResource(path, add);
  patchResource(path + "?mensajes=todos", add);
  return id;
}
/** Sending failed: the message stays, marked «No se envió», with Reintentar / Descartar. */
export function failSent(path, id, error) {
  const text = sentText.get(id);
  if (text) addUnsent({ id, missionId: path.split("/")[2], text, error: String(error || "No se pudo enviar.") });
  const mark = (prev) => ({ ...prev, messages: (prev.messages || []).map((m) => (m.id === id ? { ...m, optimistic: false, failed: String(error || "No se pudo enviar.") } : m)) });
  patchResource(path, mark);
  patchResource(path + "?mensajes=todos", mark);
}
export function unshowSent(path, id) {
  removeUnsent(id);
  const drop = (prev) => ({ ...prev, messages: (prev.messages || []).filter((m) => m.id !== id) });
  patchResource(path, drop);
  patchResource(path + "?mensajes=todos", drop);
}
