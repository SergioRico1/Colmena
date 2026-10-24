let token = null;

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function csrf() {
  if (!token) token = (await (await fetch("/api/bootstrap")).json()).csrf;
  return token;
}

export async function api(path, method = "GET", body) {
  const headers = {};
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers["X-Colmena-Token"] = await csrf();
  }
  const response = await fetch("/api" + path, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    if (response.status === 403) token = null;
    throw new ApiError(data?.error || "No se pudo completar la operación.", response.status);
  }
  return data;
}

export const get = (path) => api(path);
export const post = (path, body = {}) => api(path, "POST", body);
export const patch = (path, body = {}) => api(path, "PATCH", body);
export const del = (path) => api(path, "DELETE", {});
export const put = (path, body = {}) => api(path, "PUT", body);
/** Sends a file as it is (application/octet-stream), for big ones like a backup. */
export async function postFile(path, file) {
  const response = await fetch("/api" + path, { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Colmena-Token": await csrf() }, body: file });
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    if (response.status === 403) token = null;
    throw new ApiError(data?.error || "No se pudo enviar el archivo.", response.status);
  }
  return data;
}

/** Reads small local files as text attachments (max 5 × 200 KB). */
export function pickTextFiles({ multiple = true, accept = ".txt,.md,.csv,.json,.html,.js,.css,.xml,.yaml,.yml,.py,.ts,.tsx,.jsx,.sql,.log" } = {}) {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.accept = accept;
    input.onchange = async () => {
      try {
        const files = [...input.files];
        if (files.length > 5) throw Error("Máximo cinco archivos.");
        const out = [];
        for (const file of files) {
          if (file.size > 200000) throw Error(`«${file.name}» supera 200 KB.`);
          out.push({ name: file.name, content: await file.text(), size: file.size });
        }
        resolve(out);
      } catch (error) {
        reject(error);
      }
    };
    input.click();
  });
}


const TEXT_EXT = /\.(txt|md|markdown|csv|json|html?|js|css|xml|ya?ml|py|tsx?|jsx|sql|log)$/i;
const DOC_ACCEPT = ".pdf,.docx,.xlsx,.pptx,.csv,.png,.jpg,.jpeg,.webp,.txt,.md,.json,.html,.xml,.yaml,.yml,.py,.js,.ts,.sql,.log";

/**
 * Mission attachments: documents (PDF, Word, Excel, PowerPoint), images and text, up
 * to 5 files of 10 MB. Text goes as text; the rest as base64 (the bots read it).
 */
export function pickFiles({ multiple = true, accept = DOC_ACCEPT } = {}) {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.accept = accept;
    input.onchange = () => readFiles([...input.files]).then(resolve, reject);
    input.click();
  });
}

/** Files from a picker, a drop or the clipboard → attachments (same limits as pickFiles). */
export async function readFiles(files) {
  if (files.length > 5) throw Error("Máximo cinco archivos.");
  const out = [];
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) throw Error(`«${file.name}» supera 10 MB.`);
    // A pasted screenshot arrives as «image.png»: give it a name you will recognise.
    const name = /^image\.(png|jpe?g|gif|webp)$/i.test(file.name) ? `captura-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${file.name.split(".").pop()}` : file.name;
    if (TEXT_EXT.test(name) && file.size <= 200000) out.push({ name, content: await file.text(), size: file.size, encoding: "utf8" });
    else {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      out.push({ name, content: btoa(binary), size: file.size, encoding: "base64" });
    }
  }
  return out;
}

export function download(name, content, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content ?? ""], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name || "entregable.txt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
