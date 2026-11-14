// Team messaging in the browser (docs/CLOUD.md › Phase 2): calls to /api/chat/*. JSON goes through
// lib/api.js (CSRF token, sign-in redirects); bytes (files, the parts of a Slack export) go with
// XMLHttpRequest so the screens can show progress.
import { api } from "../lib/api.js";

export const chat = {
  get: (path) => api("/chat" + path),
  post: (path, body = {}) => api("/chat" + path, "POST", body),
  patch: (path, body = {}) => api("/chat" + path, "PATCH", body),
  put: (path, body = {}) => api("/chat" + path, "PUT", body),
  del: (path, body = {}) => api("/chat" + path, "DELETE", body),
};

let csrf = null;
async function token(fresh = false) {
  if (!csrf || fresh) csrf = (await (await fetch("/api/bootstrap", { credentials: "same-origin" })).json()).csrf;
  return csrf;
}

/** PUTs bytes to `/api` + path; `onProgress(0..1)`. Resolves with the JSON answer. */
export async function putBytes(path, body, { type = "application/octet-stream", onProgress = null, signal = null } = {}) {
  const send = (t) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", "/api" + path);
    xhr.setRequestHeader("Content-Type", type || "application/octet-stream");
    xhr.setRequestHeader("X-Colmena-Token", t);
    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(Object.assign(Error(data?.error || "No se pudo subir."), { status: xhr.status }));
    };
    xhr.onerror = () => reject(Error("Se cortó la conexión al subir."));
    xhr.onabort = () => reject(Object.assign(Error("Subida cancelada."), { aborted: true }));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(body);
  });
  try { return await send(await token()); }
  catch (error) { if (error.status === 403) return send(await token(true)); throw error; }
}

/** Width and height of an image file (for its preview's box), or null. */
export function imageSize(file) {
  if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

/** Uploads a file to a channel; it waits there until a message carries it. */
export async function uploadFile(channel, file, { onProgress, signal } = {}) {
  const size = await imageSize(file);
  const q = new URLSearchParams({ channel, name: file.name || "archivo" });
  if (size) { q.set("w", size.w); q.set("h", size.h); }
  return putBytes("/chat/files?" + q, file, { type: file.type || "application/octet-stream", onProgress, signal });
}

export const fileUrl = (id, { download = false } = {}) => "/api/chat/files/" + encodeURIComponent(id) + (download ? "?download=1" : "");
