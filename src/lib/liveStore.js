import { useRef, useSyncExternalStore } from "react";

// What changes on every streamed frame lives here, outside the app's context (store.jsx):
//   live      stepId → { text, botId, mission }      the text being written
//   activity  botId  → { verb, detail, mission, at } what each bot is doing
// A component subscribes to the piece it shows (useLiveText, useMissionLive, useActivity…),
// so a frame repaints that component alone instead of every useStore() caller.

function createStore(initial) {
  let value = initial;
  const subs = new Set();
  return {
    get: () => value,
    /** Same object back → nobody is told. */
    set(next) {
      const v = typeof next === "function" ? next(value) : next;
      if (v === value) return;
      value = v;
      for (const fn of [...subs]) fn();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export const liveStore = createStore({});
export const activityStore = createStore({});

export const RECENT_MS = 3 * 60 * 1000;

/** The selected piece of a store; the component repaints only when `equal` says it changed. */
function useSelected(store, select, equal = Object.is) {
  const cache = useRef(null);
  const snapshot = () => {
    const next = select(store.get());
    const prev = cache.current;
    if (prev && equal(prev.value, next)) return prev.value;
    cache.current = { value: next };
    return next;
  };
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}

const sameList = (same) => (a, b) => a.length === b.length && a.every((x, i) => same(x, b[i]));
const sameLive = (a, b) => a === b || (!!a && !!b && a.stepId === b.stepId && a.text === b.text && a.botId === b.botId && a.mission === b.mission);
// `at` moves on every frame while a bot writes: it only decides whether the entry still
// counts (RECENT_MS), so it alone does not repaint anyone.
const sameActivity = (a, b) => a === b || (!!a && !!b && a.botId === b.botId && a.verb === b.verb && a.detail === b.detail && a.mission === b.mission);

/** Any piece of the live text (`select` gets the whole stepId → entry map). */
export function useLiveSelector(select, equal) {
  return useSelected(liveStore, select, equal);
}

/** The text one step is writing right now ("" when it is not writing). */
export function useLiveText(stepId) {
  return useSelected(liveStore, (all) => (stepId && all[stepId]?.text) || "");
}

/** The steps writing in one mission: [{ stepId, botId, mission, text }], in arrival order. */
export function useMissionLive(missionId) {
  return useSelected(liveStore, (all) => Object.entries(all).filter(([, v]) => v.mission === missionId).map(([stepId, v]) => ({ stepId, ...v })), sameList(sameLive));
}

/** The ids of every step writing now (changes when one starts or ends, not on each frame). */
export function useLiveStepIds() {
  const ids = useSelected(liveStore, (all) => Object.keys(all).join("\n"));
  return ids ? ids.split("\n") : [];
}

/** What one bot is doing: { verb, detail, mission, at } or undefined. */
export function useActivity(botId) {
  return useSelected(activityStore, (all) => (botId ? all[botId] : undefined), sameActivity);
}

/** The whole botId → activity map, `at` included: repaints on every frame a bot writes. */
export function useActivityMap() {
  return useSyncExternalStore(activityStore.subscribe, activityStore.get, activityStore.get);
}

/** The bots at work in one mission (seen in the last three minutes): [{ botId, verb, detail, mission, at }]. */
export function useMissionActivity(missionId) {
  return useSelected(activityStore, (all) => {
    const now = Date.now();
    return Object.entries(all).filter(([, v]) => v.mission === missionId && (!v.at || now - v.at < RECENT_MS)).map(([botId, v]) => ({ botId, ...v }));
  }, sameList(sameActivity));
}
