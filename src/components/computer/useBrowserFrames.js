import { useEffect, useState } from "react";
import { get } from "../../lib/api.js";

/**
 * Live browser frames for one mission.
 * Listens to its own SSE stream (/api/computer/events?mission=…) and also to
 * window 'colmena:browser_frame' events (detail = {type:'browser_frame', mission, …})
 * in case the global store forwards them.
 * → { frame, available, takeover, closed }
 */
export function useBrowserFrames(missionId) {
  const [state, setState] = useState({ frame: null, available: null, takeover: false, closed: false });

  useEffect(() => {
    setState({ frame: null, available: null, takeover: false, closed: false });
    if (!missionId) return undefined;
    let alive = true;
    const handle = (event) => {
      if (!alive || !event || event.mission !== missionId) return;
      if (event.type === "browser_frame")
        setState((s) => ({ ...s, available: true, frame: event, takeover: !!event.takeover, closed: false }));
      else if (event.type === "computer_takeover") setState((s) => ({ ...s, takeover: true }));
      else if (event.type === "computer_returned") setState((s) => ({ ...s, takeover: false }));
      else if (event.type === "computer_closed") setState((s) => ({ ...s, takeover: false, closed: true, frame: null }));
    };
    get("/computer/frame/" + encodeURIComponent(missionId))
      .then((data) => {
        if (!alive) return;
        setState((s) => ({
          ...s,
          available: !!data?.available,
          frame: s.frame || data?.frame || null,
          takeover: s.frame ? s.takeover : !!data?.frame?.takeover,
        }));
      })
      .catch(() => alive && setState((s) => ({ ...s, available: s.available ?? false })));
    const source = new EventSource("/api/computer/events?mission=" + encodeURIComponent(missionId));
    source.onmessage = (message) => {
      try {
        handle(JSON.parse(message.data));
      } catch {}
    };
    const onWindow = (event) => handle(event.detail);
    window.addEventListener("colmena:browser_frame", onWindow);
    return () => {
      alive = false;
      source.close();
      window.removeEventListener("colmena:browser_frame", onWindow);
    };
  }, [missionId]);

  return state;
}
