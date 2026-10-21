import { useEffect, useRef } from "react";

/**
 * Opens a bot's new web page in «Vista previa»: once per version, and only for pages made
 * while you look at this chat or room (never the old ones when you open it).
 */
export function useAutoPreview(missionId, artifacts = [], open) {
  const state = useRef(null);
  if (state.current?.mission !== missionId) state.current = { mission: missionId, since: Date.now(), opened: new Set() };
  useEffect(() => {
    const { since, opened } = state.current;
    for (const a of artifacts) {
      if (!/\.html?$/i.test(a.workFile || "") || opened.has(a.id) || !(Date.parse(a.createdAt || 0) > since)) continue;
      opened.add(a.id);
      open(a.workFile);
    }
  }, [missionId, artifacts]); // eslint-disable-line react-hooks/exhaustive-deps
}
