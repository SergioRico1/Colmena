import { useEffect, useRef } from "react";
import { post } from "./api.js";

// You started typing in a chat or a room: the server opens the answering bot's connection
// now, so the reply does not wait for a handshake. At most once a minute per mission.
const last = new Map();
const EVERY = 60000;

export function warmMission(missionId) {
  if (!missionId) return;
  const at = last.get(missionId) || 0;
  if (Date.now() - at < EVERY) return;
  last.set(missionId, Date.now());
  post(`/missions/${encodeURIComponent(missionId)}/warm`, {}).catch(() => {});
}

/** Warms when `text` goes from empty to something (the first keystroke of a message). */
export function useWarmOnType(missionId, text) {
  const had = useRef(false);
  useEffect(() => {
    const has = !!String(text || "").trim();
    if (has && !had.current) warmMission(missionId);
    had.current = has;
  }, [missionId, text]);
}
