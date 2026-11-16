// Notices of messages for you while Colmena is open (hosted; server/cloud/chat.mjs › notify sends
// «chat.notify» to the screens of whoever it is for, with the same rules as Web Push: direct
// messages, mentions, threads you are in, your keywords, mute and «no molestar»). As in Slack the
// app shows it as a system notice unless that conversation is in front of you right now: the
// desktop app through its bridge (desktop/preload-cloud.cjs), a browser with the Notification API
// once you allowed it. A click opens the conversation. «Ajustes › Avisos › Cómo te avisa»
// (settings.notifyMode: both | windows | sound | off) decides the notice and its sound.
import { isOpenChannel, onChatEvent } from "./store.js";
import { navigate } from "../lib/router.jsx";
import { playNoticeSound } from "../lib/noticeSounds.js";

const bridge = () => (typeof window !== "undefined" ? window.colmenaWindow?.cloud || null : null);
const inFront = (ev) => typeof document !== "undefined" && document.hasFocus() && isOpenChannel(ev.channel);

export function showNotice(ev, mode = "both") {
  if (!ev?.title || inFront(ev) || mode === "off") return false;
  if (mode === "both" || mode === "sound") void playNoticeSound("message");
  if (mode === "sound") return true;
  const notice = { title: String(ev.title).slice(0, 120), body: String(ev.body || "").slice(0, 300), url: String(ev.url || "/canales").slice(0, 300) };
  const api = bridge();
  if (api?.notify) { api.notify(notice).catch(() => {}); return true; }
  if (typeof Notification !== "function" || Notification.permission !== "granted") return false;
  try {
    const n = new Notification(notice.title, { body: notice.body, tag: ev.tag || "chat-" + ev.channel, icon: "/colmena-icon-128.png" });
    n.onclick = () => { try { window.focus(); } catch {} navigate(notice.url); n.close(); };
    return true;
  } catch { return false; }
}

/** Starts listening (once); returns the function that stops it. */
export function startNotices({ mode = () => "both" } = {}) {
  return onChatEvent((ev) => { if (ev?.type === "chat.notify") showNotice(ev, mode() || "both"); });
}
