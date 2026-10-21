import { useEffect, useState } from "react";

// New versions of the desktop app (desktop/updater.cjs through the window's bridge).
// Outside the desktop app (a browser while developing) there is nothing to update: null.
const bridge = typeof window !== "undefined" ? window.colmenaWindow?.updates || null : null;

export const updates = bridge;

export function useUpdates() {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!bridge) return undefined;
    let live = true;
    bridge.state().then((s) => live && setState(s)).catch(() => {});
    const off = bridge.onState((s) => live && setState(s));
    return () => { live = false; off(); };
  }, []);
  return state;
}
