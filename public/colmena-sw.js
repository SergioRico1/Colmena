// Colmena's service worker (hosted app only, registered by src/chat/push.js): it shows the
// notifications the workspace pushes and opens their address when one is clicked. It caches
// nothing and does not see the page's requests (no fetch handler).
/* eslint-env serviceworker */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Only a path of this site («/canal/…»); anything else opens the app's start. */
function safePath(url) {
  const s = typeof url === "string" ? url : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : "/";
}

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  const title = String(data.title || "Colmena").slice(0, 200);
  const options = {
    body: String(data.body || "").slice(0, 500),
    icon: "/colmena-icon-128.png",
    badge: "/colmena-icon-128.png",
    data: { url: safePath(data.url) },
    renotify: false,
  };
  if (data.tag) options.tag = String(data.tag).slice(0, 100);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const tab = tabs.find((c) => { try { return new URL(c.url).origin === self.location.origin; } catch { return false; } });
    if (!tab) { await self.clients.openWindow(url); return; }
    await tab.focus();
    // A tab this worker controls can be sent there; any other is asked to go there itself.
    try { if (tab.navigate) { await tab.navigate(url); return; } } catch { /* not controlled */ }
    tab.postMessage({ type: "colmena:navigate", url });
  })());
});
