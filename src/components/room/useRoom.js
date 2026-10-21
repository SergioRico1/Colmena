import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useResource, useStore } from "../../lib/store.jsx";
import { useUnsent } from "../../lib/unsent.js";
import { carryOver, joinPages, loadOlder, useOlderPages } from "../../lib/history.js";

const RECENT_MS = 3 * 60 * 1000;
const EMPTY = [];

/** Mission detail (/api/missions/:id, refreshed by SSE) merged with its summary from /api/state. */
export function useRoom(id) {
  const store = useStore();
  // A long conversation opens with its latest messages; scrolling up (or «Ver mensajes
  // anteriores») brings the pages before them (src/lib/history.js), one at a time.
  const { data, error, loading } = useResource(id ? `/missions/${id}` : null);
  const older = useOlderPages(id);
  const cursor = older ? older.cursor : data?.cursor ?? null;
  const olderCount = older ? older.olderCount : data?.olderCount || 0;
  const showOlder = useCallback(() => loadOlder(id, cursor), [id, cursor]);
  // The recent window moved on (a refetch brings a later one): what left it joins the older
  // pages before this paints, so nothing goes missing in between.
  const recent = useRef(null);
  useLayoutEffect(() => {
    const prev = recent.current;
    recent.current = { id, messages: data?.messages || EMPTY, steps: data?.steps || EMPTY };
    if (!older || !prev || prev.id !== id || prev.messages === recent.current.messages) return;
    const kept = new Set(recent.current.messages.map((m) => m.id));
    const first = recent.current.messages[0]?.at || "";
    const dropped = prev.messages.filter((m) => !kept.has(m.id) && !m.optimistic && String(m.at || "") < first);
    if (dropped.length) carryOver(id, dropped, prev.steps.filter((s) => !recent.current.steps.some((x) => x.id === s.id)));
  }, [id, data, older]);
  const summary = store.missions.find((m) => m.id === id) || null;
  const unsent = useUnsent();
  // Messages and steps change only when records arrive (never with the live text), so the
  // timeline rows built from them stay the same objects while a bot streams.
  const timeline = useMemo(() => {
    const joined = joinPages(older, { messages: Array.isArray(data?.messages) ? data.messages : EMPTY, steps: Array.isArray(data?.steps) ? data.steps : EMPTY });
    // What failed to send stays at the end, marked «No se envió», even after a reload.
    const loaded = joined.messages;
    const lost = unsent.filter((u) => u.missionId === id && !loaded.some((m) => m.id === u.id))
      .map((u) => ({ id: u.id, missionId: id, role: "user", kind: "message", text: u.text, at: u.at, failed: u.error, attachments: [], reactions: [] }))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    // What a bot says while it works (server: kind «progress») belongs to its step, not to
    // the list of messages: steps[].progress, in order, each with the calls it announced.
    const said = new Map();
    for (const m of loaded) if (m.kind === "progress" && m.stepId) said.set(m.stepId, [...(said.get(m.stepId) || []), m]);
    const all = lost.length ? [...loaded, ...lost] : loaded;
    const messages = said.size ? all.filter((m) => m.kind !== "progress") : all;
    const rawSteps = joined.steps;
    const steps = said.size ? rawSteps.map((s) => (said.has(s.id) ? { ...s, progress: said.get(s.id) } : s)) : rawSteps;
    return { all, messages, steps };
  }, [data, older, unsent, id]);
  const records = useMemo(() => {
    const artifacts = Array.isArray(data?.artifacts) && data.artifacts.length
      ? data.artifacts
      : store.artifacts.filter((a) => a.missionId === id);
    const fromState = store.approvals.filter((a) => a.missionId === id);
    const fromDetail = Array.isArray(data?.approvals) ? data.approvals.filter((a) => !fromState.some((b) => b.id === a.id)) : [];
    const approvals = [...fromState, ...fromDetail];
    return { artifacts, approvals, pending: approvals.filter((a) => a.status === "pending") };
  }, [data, store.artifacts, store.approvals, id]);
  return useMemo(() => {
    const mission = data || summary ? { ...(summary || {}), ...(data || {}) } : null;
    const { all, messages, steps } = timeline;
    const thread = Array.isArray(data?.thread) ? data.thread : [];
    const proposals = Array.isArray(data?.proposals) ? data.proposals : [];
    const { artifacts, approvals, pending } = records;
    const live = Object.entries(store.live)
      .filter(([, v]) => v.mission === id)
      .map(([stepId, v]) => ({ stepId, ...v }));
    const now = Date.now();
    const activity = Object.entries(store.activity)
      .filter(([, v]) => v.mission === id && (!v.at || now - v.at < RECENT_MS))
      .map(([botId, v]) => ({ botId, ...v }));
    const memberIds = [...new Set([...(mission?.botIds || []), ...steps.map((s) => s.botId).filter(Boolean)])];
    // Rooms show those lines as messages of the bot (as OpenClaw does in channels): spoken.
    return { mission, messages, spoken: all, steps, thread, proposals, artifacts, approvals, pending, live, activity, memberIds, error, loading: loading && !mission, notFound: !loading && !mission, olderCount, showOlder, loadingOlder: !!older?.loading, olderError: older?.error || null };
  }, [data, summary, error, loading, records, store.live, store.activity, id, showOlder, timeline, olderCount, older]);
}

export const ACTIVE_STEP = new Set(["running", "active", "working", "in_progress"]);
export const DONE_STEP = new Set(["completed", "done", "final"]);
export const BLOCKED_STEP = new Set(["blocked", "failed", "error"]);

export function isRunning(mission) {
  return ["running", "planning", "queued"].includes(mission?.status);
}
