// A «Código» task shared with people (server/peers/codeshare.mjs), in the browser: who a task
// of yours is shared with and who is looking at it; the ones shared with you, kept live.
import { useCallback, useEffect, useState } from "react";
import { del, get, post, put } from "./api.js";

/** «I am looking at it» while the window is visible, every 30 s; «not any more» on leaving. */
function useLooking(body) {
  const key = JSON.stringify(body);
  useEffect(() => {
    if (!body.task && !body.mirror) return undefined;
    const say = (on) => post("/peers/code/looking", { ...body, on }).catch(() => {});
    const tick = () => say(document.visibilityState === "visible");
    tick();
    const timer = setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); say(false); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
/** Live «code» events of /api/peers/events. */
function useCodeEvents(onEvent) {
  useEffect(() => {
    const source = new EventSource("/api/peers/events?share=code");
    source.onmessage = (e) => { let ev; try { ev = JSON.parse(e.data); } catch { return; } if (ev.type === "code") onEvent(ev); };
    return () => source.close();
  }, [onEvent]);
}

/** A task of yours: who it is shared with, who is looking, what they said of the plan. */
export function useTaskPeople(taskId, { looking = true } = {}) {
  const [view, setView] = useState(null);
  const load = useCallback(() => get("/peers/code/tasks/" + encodeURIComponent(taskId)).then(setView).catch(() => setView(null)), [taskId]);
  useEffect(() => { setView(null); void load(); }, [load]);
  useLooking(looking ? { task: taskId } : {});
  useCodeEvents(useCallback((ev) => {
    if (ev.task !== taskId) return;
    if (ev.viewers) setView((v) => (v ? { ...v, viewers: ev.viewers } : v));
    if (ev.votes) setView((v) => (v ? { ...v, votes: ev.votes } : v));
    if (ev.comments || ev.reviews) void load();
  }, [taskId, load]));
  const share = useCallback(async (people) => setView(await put("/peers/code/tasks/" + encodeURIComponent(taskId) + "/people", { people })), [taskId]);
  const askReview = useCallback(async (person, note = "") => setView(await post("/peers/code/tasks/" + encodeURIComponent(taskId) + "/review", { person, note })), [taskId]);
  const invite = useCallback(async (projectId, people) => { await put("/peers/code/projects/" + encodeURIComponent(projectId) + "/people", { people }); await load(); }, [load]);
  return { view, load, share, invite, askReview };
}

/** The tasks other people share with you. */
export function useSharedTasks() {
  const [items, setItems] = useState(null);
  const load = useCallback(() => get("/peers/code/shared").then((r) => setItems(r.items)).catch(() => setItems([])), []);
  useEffect(() => { void load(); }, [load]);
  useCodeEvents(useCallback((ev) => { if (ev.mirror) void load(); }, [load]));
  return items;
}

/** One task shared with you, as its owner's Colmena tells it. */
export function useSharedTask(id) {
  const [state, setState] = useState({ item: null, error: null });
  const load = useCallback(() => get("/peers/code/shared/" + encodeURIComponent(id)).then((item) => setState({ item, error: null })).catch((e) => setState({ item: null, error: e.status === 404 ? "missing" : e.message })), [id]);
  useEffect(() => { void load(); }, [load]);
  useLooking({ mirror: id });
  useCodeEvents(useCallback((ev) => {
    if (ev.mirror !== id) return;
    if (ev.viewers) setState((s) => (s.item ? { ...s, item: { ...s.item, viewers: ev.viewers } } : s));
    else if (ev.log) setState((s) => (s.item ? { ...s, item: { ...s.item, snapshot: { ...s.item.snapshot, log: ev.log } } } : s));
    else void load();
  }, [id, load]));
  const vote = useCallback(async (action, text = "") => setState({ item: await post("/peers/code/shared/" + encodeURIComponent(id) + "/plan", { action, text }), error: null }), [id]);
  const askDiff = useCallback(() => post("/peers/code/shared/" + encodeURIComponent(id) + "/diff"), [id]);
  const comment = useCallback(async (c) => setState({ item: await post("/peers/code/shared/" + encodeURIComponent(id) + "/comments", c), error: null }), [id]);
  const base = "/peers/code/shared/" + encodeURIComponent(id) + "/review";
  const review = {
    add: async (f) => setState({ item: await post(base + "/draft", f), error: null }),
    remove: async (fid) => setState({ item: await del(base + "/draft/" + encodeURIComponent(fid)), error: null }),
    bot: async () => setState({ item: await post(base + "/bot"), error: null }),
    send: async (verdict, summary = "") => setState({ item: await post(base + "/send", { verdict, summary }), error: null }),
  };
  return { ...state, load, vote, askDiff, comment, review };
}
