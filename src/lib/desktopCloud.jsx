import { useEffect, useRef } from "react";
import { useStore } from "./store.jsx";
import { isCloud } from "./cloud.js";

// The desktop app in cloud mode (docs/CLOUD.md › Phase 5; desktop/preload-cloud.cjs): the tray's
// face and the taskbar counter follow what waits for you and what your bots are doing, and a new
// notice of yours (an approval, a mention) shows as a system notification. In a browser, or in
// the local mode (whose server already tells the desktop), it renders nothing and does nothing.
const bridge = () => (typeof window !== "undefined" && isCloud() ? window.colmenaWindow?.cloud || null : null);
const WORKING = new Set(["queued", "planning", "running"]);

export default function DesktopCloudBridge() {
  const api = bridge();
  const { ready, approvals = [], missions = [], notifications = [], paused, settings = {} } = useStore();
  const seen = useRef(null);
  const waiting = approvals.filter((a) => a.status === "pending").length;
  const working = missions.filter((m) => WORKING.has(m.status)).length;
  const finished = missions.filter((m) => m.status === "completed").length;
  useEffect(() => {
    if (api && ready) api.presence({ working, waiting, paused: !!(paused || settings.paused), finished }).catch(() => {});
  }, [api, ready, working, waiting, paused, settings.paused, finished]);
  useEffect(() => {
    if (!api || !ready) return;
    const unread = notifications.filter((n) => !n.read);
    // The first state only marks what is already there: no burst of old notices at start.
    if (seen.current === null) { seen.current = new Set(unread.map((n) => n.id)); return; }
    for (const n of unread) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      api.notify({ title: n.title || "Colmena", body: n.text || "", url: n.url || "/bandeja" }).catch(() => {});
    }
  }, [api, ready, notifications]);
  return null;
}
