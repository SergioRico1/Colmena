// Notifications on this device (Web Push, docs/CLOUD.md › Phase 2). Only in the hosted app: the
// service worker public/colmena-sw.js shows what the workspace pushes ({ title, body, url, tag })
// and opens its address on a click. The desktop app never registers it.
import { chat } from "./api.js";
import { isCloud } from "../lib/cloud.js";
import { navigate } from "../lib/router.jsx";

const WORKER = "/colmena-sw.js";

/** Whether this browser, here, can receive pushes (hosted app, secure page, the APIs present). */
export function pushSupported() {
  return typeof window !== "undefined" && isCloud() && window.isSecureContext &&
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registration() {
  try { return (await navigator.serviceWorker.getRegistration("/")) || null; } catch { return null; }
}
async function subscription() {
  const reg = await registration();
  try { return reg ? await reg.pushManager.getSubscription() : null; } catch { return null; }
}

/** "unsupported" | "denied" | "off" | "on" (async: it asks the browser for its subscription). */
export async function pushState() {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const sub = await subscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function keyBytes(base64url) {
  const b64 = String(base64url).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
const sameKey = (a, b) => {
  if (!a || !b) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
};

/** Asks for permission, subscribes this browser with the workspace's VAPID key and tells the server. */
export async function enablePush(publicKey) {
  if (!pushSupported()) throw Error("Tu navegador no admite avisos.");
  if (!publicKey) throw Error("Los avisos no están configurados en el servidor.");
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission === "denied") throw Object.assign(Error("Bloqueados en el navegador: permítelos en los ajustes del sitio."), { state: "denied" });
  if (permission !== "granted") throw Error("No se activaron: el navegador no recibió permiso.");
  await navigator.serviceWorker.register(WORKER, { scope: "/" });
  const reg = await navigator.serviceWorker.ready;
  const key = keyBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another key (the server's keys changed) cannot receive: start over.
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) { await sub.unsubscribe().catch(() => {}); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  try {
    await chat.post("/push", { subscription: sub.toJSON() });
  } catch (error) {
    await sub.unsubscribe().catch(() => {});
    throw error;
  }
  return "on";
}

/** Tells the server again about this browser's subscription (it may have dropped it). Quiet. */
export async function refreshPush() {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const sub = await subscription();
  if (sub) await chat.post("/push", { subscription: sub.toJSON() }).catch(() => {});
}

/** Unsubscribes this browser and forgets it on the server. */
export async function disablePush() {
  const sub = await subscription();
  if (!sub) return "off";
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await chat.del("/push", { endpoint });
  return "off";
}

/** Sends a test notification to every device of yours: { sent }. */
export const testPush = () => chat.post("/push/test");

// A notification clicked while a tab is open: the worker asks that tab to go to its address.
if (typeof window !== "undefined" && isCloud() && "serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (e) => {
    const url = e.data?.type === "colmena:navigate" ? String(e.data.url || "") : "";
    if (url.startsWith("/") && !url.startsWith("//")) navigate(url);
  });
}
