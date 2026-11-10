import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { get } from "../../../lib/api.js";

// «Código» data: the project list and the open task, kept live through /api/code/events
// (text as Bruno writes it, items as they appear or change, task status).

let source = null;
const subscribers = new Set();
function subscribe(fn) {
  subscribers.add(fn);
  if (!source) {
    source = new EventSource("/api/code/events");
    source.onmessage = (message) => {
      let event;
      try { event = JSON.parse(message.data); } catch { return; }
      for (const s of subscribers) s(event);
    };
  }
  return () => {
    subscribers.delete(fn);
    if (!subscribers.size && source) { source.close(); source = null; }
  };
}

/** Projects with their tasks; refetched when the server says the list changed. */
export function useCodeProjects() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const timer = useRef(null);
  const load = useCallback(() => get("/code").then((d) => { setData(d); setError(null); }, (e) => setError(e.message)), []);
  useEffect(() => {
    load();
    const off = subscribe((event) => {
      if (event.type === "projects") { clearTimeout(timer.current); timer.current = setTimeout(load, 120); return; }
      if (event.type === "task" && event.task) {
        setData((d) => d && { ...d, projects: d.projects.map((p) => p.id !== event.task.projectId ? p : { ...p, tasks: p.tasks.map((t) => (t.id === event.task.id ? event.task : t)) }) });
      }
    });
    return () => { off(); clearTimeout(timer.current); };
  }, [load]);
  return { data, error, reload: load };
}

// The text being written right now, per task, outside React state: a delta (one every ~50 ms)
// repaints only whoever shows that text (useCodeLive), never the whole task screen. Deltas
// wait for the next frame, so several in one frame are one repaint.
const liveText = new Map(); // taskId → text
const liveSubs = new Set();
const waiting = new Map(); // taskId → text waiting for the next frame
let liveFrame = null;
const tellLive = () => { for (const fn of [...liveSubs]) fn(); };
function setLive(taskId, text) {
  waiting.delete(taskId);
  if ((liveText.get(taskId) || "") === text) return;
  if (text) liveText.set(taskId, text); else liveText.delete(taskId);
  tellLive();
}
function flushLive() {
  liveFrame = null;
  if (!waiting.size) return;
  for (const [taskId, text] of waiting) liveText.set(taskId, (liveText.get(taskId) || "") + text);
  waiting.clear();
  tellLive();
}
function addLive(taskId, text) {
  if (!text) return;
  waiting.set(taskId, (waiting.get(taskId) || "") + text);
  if (!liveFrame) liveFrame = (typeof requestAnimationFrame === "function" && document.visibilityState !== "hidden" ? requestAnimationFrame : (fn) => setTimeout(fn, 16))(flushLive);
}
const subscribeLive = (fn) => { liveSubs.add(fn); return () => liveSubs.delete(fn); };

/** The text Bruno is writing in a task right now ("" when he is not writing). */
export function useCodeLive(taskId) {
  const get = () => liveText.get(taskId) || "";
  return useSyncExternalStore(subscribeLive, get, get);
}

/** One task: its record and timeline (the text being written: useCodeLive). */
export function useCodeTask(taskId) {
  const [state, setState] = useState({ id: null, task: null, project: null, items: [], models: [], commands: [] });
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    if (!taskId) return Promise.resolve();
    return get("/code/tasks/" + taskId).then((d) => {
      setLive(taskId, d.live?.text || "");
      setState({ id: taskId, task: d.task, project: d.project, items: d.items, models: d.models, commands: d.commands });
      setError(null);
    }, (e) => setError(e.message));
  }, [taskId]);
  useEffect(() => {
    if (!taskId) return undefined;
    setState((s) => (s.id === taskId ? s : { id: taskId, task: null, project: null, items: [], models: [], commands: [] }));
    setLive(taskId, "");
    load();
    const off = subscribe((event) => {
      if (event.task !== taskId && event.task?.id !== taskId && event.item?.taskId !== taskId) return;
      if (event.type === "reload") { load(); return; }
      if (event.type === "delta") {
        if (event.reset) setLive(taskId, ""); else addLive(taskId, event.text);
        return;
      }
      setState((s) => {
        if (s.id !== taskId) return s;
        if (event.type === "task") return { ...s, task: event.task };
        if (event.type === "item") {
          const i = s.items.findIndex((x) => x.id === event.item.id);
          const items = i < 0 ? [...s.items, event.item].sort((a, b) => a.seq - b.seq) : s.items.map((x, k) => (k === i ? event.item : x));
          return { ...s, items };
        }
        return s;
      });
    });
    return () => { off(); setLive(taskId, ""); };
  }, [taskId, load]);
  return { ...state, error, reload: load };
}
