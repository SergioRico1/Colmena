// The process seam (docs/CLOUD.md › Phase 4): «run a program / have a filesystem» as one small
// interface. On the desktop it is this computer (`localMachine`: node:child_process, unchanged);
// in the cloud it is the workspace's container, reached over HTTP (`machineClient`: the machine
// server of server/machine/serve.mjs, behind the Machine Durable Object).
//
//   machine.spawn(file, args, {cwd, env})  → a ChildProcess-like object (stdout/stderr 'data',
//                                            'close' with the exit code, 'error', kill())
//   machine.run({file, args, cwd, …})       → {exitCode, stdout, stderr, truncated, timedOut, seconds}
//   machine.resolve(program)                → the program to run (validated, not looked up here)
//   machine.folderFor(missionId)            → where a mission's commands run
//   machine.request(path, init)             → a raw HTTP call to the machine («Código», previews)
//   machine.office()                        → an Office→PDF converter (officepdf.mjs's surface)
import { spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { remoteOfficeConverter } from "../officepdf.mjs";

/** This computer: what the desktop always did. */
export const localMachine = Object.freeze({
  kind: "local",
  spawn: nodeSpawn,
});

const PROGRAM = /^[A-Za-z0-9._+-]{1,80}$/;
const ABSOLUTE = /^\/(usr|bin|opt)\/[A-Za-z0-9._+/-]{1,200}$/;

/**
 * A container's machine over `fetch(url, init)` (the Machine DO's stub, or a local server in
 * tests). `headers()`: what every call carries (the machine token, who asks).
 */
export function machineClient({ fetch: doFetch, base = "http://machine", headers = () => ({}) }) {
  const request = (p, init = {}) => doFetch(base + p, { ...init, headers: { ...headers(), ...(init.headers || {}) } });

  /** A program in the container, no shell: its output arrives as NDJSON from /machine/run. */
  function spawn(file, args = [], { cwd = null, env = null, timeoutMs } = {}) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = null;
    child.exitCode = null;
    const controller = new AbortController();
    let closed = false;
    const close = (code) => { if (closed) return; closed = true; child.exitCode = code; child.emit("close", code); };
    child.kill = () => { controller.abort(); setTimeout(() => close(null), 0); return true; };
    (async () => {
      let res;
      try {
        res = await request("/machine/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file, args, cwd, env: env && typeof env === "object" ? onlyPlain(env) : null, ...(timeoutMs ? { timeoutMs } : {}) }), signal: controller.signal });
      } catch (error) {
        if (!closed) { closed = true; child.emit("error", error); }
        return;
      }
      if (!res.ok) {
        let message = "La máquina no ha podido ejecutarlo.";
        try { message = (await res.json()).error || message; } catch {}
        if (!closed) { closed = true; child.emit("error", Error(message)); }
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", exit = null;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const text = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            let m;
            try { m = JSON.parse(text); } catch { continue; }
            if (m.out) child.stdout.emit("data", Buffer.from(m.out, "base64"));
            if (m.err) child.stderr.emit("data", Buffer.from(m.err, "base64"));
            if (m.error && !closed) { closed = true; child.emit("error", Error(m.error)); return; }
            if ("exit" in m) exit = m.exit;
          }
        }
      } catch {
        // aborted (kill) or the connection dropped: closed below with what we know
      }
      close(exit);
    })();
    return child;
  }

  return {
    kind: "remote",
    request,
    spawn,
    /** run_command's program: a bare name (looked up on the container's PATH) or an absolute /usr, /bin, /opt path. */
    resolve(program) {
      const raw = String(program || "").trim();
      if (/^(npm|npx|pnpm|yarn)$/i.test(raw)) throw Error("npm no se ejecuta con run_command: usa «Código» o los proyectos.");
      if (!PROGRAM.test(raw) && !ABSOLUTE.test(raw)) throw Error("Indica el nombre del programa (por ejemplo git o python3) o su ruta completa.");
      if (/\.(sh|bash|bat|cmd|ps1)$/i.test(raw)) throw Error("Los scripts necesitan una consola: no se ejecutan.");
      return raw;
    },
    /** A mission's folder in the container (relative to its work folder). */
    folderFor: (missionId) => "missions/" + String(missionId || "tmp").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80),
    /** Runs to the end: the same result shape as server/computer/system.mjs › runProgram. */
    run({ file, args = [], cwd = null, env = null, timeoutMs, onOutput = null, signal = null, maxBytes = 200 * 1024 }) {
      return new Promise((resolve, reject) => {
        const started = Date.now();
        const child = spawn(file, args, { cwd, env, timeoutMs });
        const out = [], err = [];
        let used = 0, truncated = false;
        const take = (bucket) => (chunk) => {
          if (used >= maxBytes) { truncated = true; return; }
          const piece = chunk.subarray(0, maxBytes - used);
          if (piece.length < chunk.length) truncated = true;
          used += piece.length;
          bucket.push(piece);
          if (onOutput) try { onOutput(piece.toString("utf8")); } catch {}
        };
        child.stdout.on("data", take(out));
        child.stderr.on("data", take(err));
        signal?.addEventListener?.("abort", () => child.kill(), { once: true });
        child.on("error", (e) => reject(Error("No se pudo ejecutar: " + e.message)));
        child.on("close", (code) => resolve({ exitCode: code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), truncated, timedOut: code === null && !signal?.aborted, seconds: Math.round((Date.now() - started) / 100) / 10 }));
      });
    },
    /** Office → PDF with the container's LibreOffice. */
    office() {
      const pdfCall = async (p, pdf) => {
        const res = await request(p, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: pdf });
        if (!res.ok) { let b = {}; try { b = await res.json(); } catch {} throw Object.assign(Error(b.error || "No se pudo dibujar la página."), { code: b.code || "NO_PREVIEW", status: res.status === 404 ? 404 : undefined }); }
        return res;
      };
      return Object.assign(remoteOfficeConverter({
        label: "LibreOffice (nube)",
        convert: async (bytes, ext, { source = null, signal = null } = {}) => {
          const res = await request("/machine/office/pdf?ext=" + encodeURIComponent(ext) + (source ? "&source=" + encodeURIComponent(String(source).slice(0, 200)) : ""), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes, signal });
          if (!res.ok) {
            let body = {};
            try { body = await res.json(); } catch {}
            throw Object.assign(Error(body.error || "La conversión ha fallado."), { code: body.code || (res.status === 429 ? "QUOTA" : "FAILED") });
          }
          let missing = [];
          try { missing = JSON.parse(decodeURIComponent(res.headers.get("X-Office-Missing-Fonts") || "%5B%5D")); } catch {}
          return { pdf: Buffer.from(await res.arrayBuffer()), missingFonts: missing, engine: decodeURIComponent(res.headers.get("X-Office-Engine") || "") || "LibreOffice (nube)", cached: res.headers.get("X-Office-Cached") === "1" };
        },
      }), {
        // The preview's pages are counted and drawn in the machine too (pdfjs and a canvas are there).
        pages: async (pdf) => (await (await pdfCall("/machine/pdf/pages", pdf)).json()).pages || 0,
        renderPage: async (pdf, n, { width = 900 } = {}) => {
          const res = await pdfCall("/machine/pdf/page?n=" + Number(n) + "&width=" + Number(width), pdf);
          return { png: Buffer.from(await res.arrayBuffer()), pages: Number(res.headers.get("X-Pdf-Pages")) || 0 };
        },
      });
    },
  };
}

const onlyPlain = (env) => Object.fromEntries(Object.entries(env).filter(([k, v]) => /^[A-Z_][A-Z0-9_]{0,63}$/i.test(k) && typeof v === "string" && v.length < 4096).slice(0, 40));
