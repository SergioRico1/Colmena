// Hovering a row of the sidebar loads what that place shows, so a click opens it with its
// messages already there: a sala (/sala/:id: its room view and its messages), a chat with a bot
// (/chat/:bot?c=:id) or a channel of hosted Colmena (/canal/:id, src/chat/pages.js).
import { prefetch } from "./store.jsx";
import { prefetchChannel } from "../chat/pages.js";

export function prefetchHref(href) {
  if (!href || typeof href !== "string") return;
  let url;
  try { url = new URL(href, "http://x"); } catch { return; }
  const sala = /^\/sala\/([^/]+)$/.exec(url.pathname);
  if (sala) { prefetch("/rooms/" + sala[1]); prefetch("/missions/" + sala[1]); return; }
  const chat = /^\/chat\/[^/]+$/.test(url.pathname) && url.searchParams.get("c");
  if (chat) { prefetch("/missions/" + encodeURIComponent(chat)); return; }
  const channel = /^\/canal\/([^/]+)$/.exec(url.pathname);
  if (channel) prefetchChannel(decodeURIComponent(channel[1]));
}
