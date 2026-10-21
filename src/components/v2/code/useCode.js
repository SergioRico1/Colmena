import { useCallback, useEffect, useRef, useState } from "react";
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

/** One task: its record, timeline and the text being written right now. */
export function useCodeTask(taskId) {
  const [state, setState] = useState({ id: null, task: null, project: null, items: [], live: "", models: [], commands: [] });
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    if (!taskId) return Promise.resolve();
    return get("/code/tasks/" + taskId).then((d) => {
      setState({ id: taskId, task: d.task, project: d.project, items: d.items, live: d.live?.text || "", models: d.models, commands: d.commands });
      setError(null);
    }, (e) => setError(e.message));
  }, [taskId]);
  useEffect(() => {
    if (!taskId) return undefined;
    setState((s) => (s.id === taskId ? s : { id: taskId, task: null, project: null, items: [], live: "", models: [], commands: [] }));
    load();
    return subscribe((event) => {
      if (event.task !== taskId && event.task?.id !== taskId && event.item?.taskId !== taskId) return;
      if (event.type === "reload") { load(); return; }
      setState((s) => {
        if (s.id !== taskId) return s;
        if (event.type === "delta") return { ...s, live: event.reset ? "" : s.live + (event.text || "") };
        if (event.type === "task") return { ...s, task: event.task };
        if (event.type === "item") {
          const i = s.items.findIndex((x) => x.id === event.item.id);
          const items = i < 0 ? [...s.items, event.item].sort((a, b) => a.seq - b.seq) : s.items.map((x, k) => (k === i ? event.item : x));
          return { ...s, items };
        }
        return s;
      });
    });
  }, [taskId, load]);
  return { ...state, error, reload: load };
}
