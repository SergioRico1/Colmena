// Hosted Colmena (docs/CLOUD.md › Phase 1) in the browser. The Worker marks the app's page with
// <meta name="colmena-host" content="cloud">; without it (the desktop) everything here is inert.
// The live channel there is a WebSocket (/api/live) instead of SSE: liveSource hands out an
// object with EventSource's shape, so the code that listens does not change.

export const isCloud = () => typeof document !== "undefined" && !!document.querySelector('meta[name="colmena-host"][content="cloud"]');

/** Where to sign in again, coming back here afterwards. */
export const signInUrl = () => "/entrar?next=" + encodeURIComponent(location.pathname + location.search);

/** Leaves the session (POST /auth/logout with the session's CSRF token) and goes to the sign-in page. */
export async function signOut() {
  try {
    const me = await (await fetch("/auth/me", { credentials: "same-origin" })).json();
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Colmena-Token": me?.csrf || "" }, body: "{}" });
  } catch {}
  location.assign("/entrar?salir=1");
}

/** The hosted live channel with EventSource's shape: onopen, onmessage({data}), onerror, close(). */
class LiveSocket {
  constructor(path) {
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.readyState = 0;
    this.closed = false;
    const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + path;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.readyState = 1;
      this.onopen?.({});
      // Answered by the object without waking it (setWebSocketAutoResponse).
      this.ping = setInterval(() => { try { this.ws.send('{"type":"ping"}'); } catch {} }, 25000);
    };
    this.ws.onmessage = (e) => {
      if (e.data === '{"type":"pong"}' || e.data === '{"type":"ready"}') return;
      this.onmessage?.({ data: e.data });
    };
    this.ws.onclose = (e) => {
      clearInterval(this.ping);
      this.readyState = 2;
      if (this.closed) return;
      // Taken out of the company, or signed out elsewhere: back to the company page.
      if (e.code === 4003) { location.assign("/empresa"); return; }
      this.onerror?.({});
    };
  }
  close() {
    this.closed = true;
    clearInterval(this.ping);
    this.readyState = 2;
    try { this.ws.close(1000, "bye"); } catch {}
  }
}
/** A stream nobody serves in the cloud (desktop-only places): it never opens, never retries. */
class Silent {
  constructor() { this.readyState = 2; this.onopen = this.onmessage = this.onerror = null; }
  close() {}
}

/** `new EventSource(path)` on the desktop; in the cloud, /api/events becomes the WebSocket. */
export function liveSource(path) {
  if (!isCloud()) return new EventSource(path);
  return path === "/api/events" ? new LiveSocket("/api/live") : new Silent();
}
