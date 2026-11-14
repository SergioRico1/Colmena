// Unlocking Bitwarden without Colmena ever seeing the master password: a console window of its
// own runs `bw unlock --raw` (server/managers/bw-unlock-helper.mjs); the person types the
// master password into bw's own prompt there. Only the session key bw prints comes back,
// through a local pipe with a random name, into this process's memory.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { modulePath } from "../bundled.mjs";
import { rmSync } from "node:fs";

const HELPER = modulePath("./bw-unlock-helper.mjs", import.meta.url) || "bw-unlock-helper.mjs"; // desktop only
const WAIT_MS = 3 * 60000;
const SESSION_KEY = /^[A-Za-z0-9+/=_-]{16,400}$/;

/** A local channel only this user can reach, closed after one key or WAIT_MS. */
function listenOnce(address, timeout = WAIT_MS) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      if (process.platform !== "win32") try { rmSync(address, { force: true }); } catch {}
      resolve(value);
    };
    const server = net.createServer((socket) => {
      const chunks = [];
      socket.on("data", (d) => { if (chunks.length < 8) chunks.push(d); });
      socket.on("end", () => {
        const buf = Buffer.concat(chunks);
        const key = buf.toString("utf8").trim();
        buf.fill(0);
        for (const c of chunks) c.fill(0);
        finish(SESSION_KEY.test(key) ? key : null);
      });
      socket.on("error", () => finish(null));
    });
    const timer = setTimeout(() => finish(null), timeout);
    timer.unref?.();
    server.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    server.listen(address);
  });
}

const safePath = (p) => typeof p === "string" && p.length > 0 && !/["%\r\n]/.test(p);
const shQuote = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

/**
 * Opens the window and resolves the session key, or null if the person closed it or the
 * password was wrong. Windows: a new console (cmd's `start`). macOS: a Terminal window. Other
 * systems: refused (the person unlocks in their own terminal and starts Colmena with BW_SESSION).
 */
export async function unlockInWindow(bwPath, { env = process.env, timeout = WAIT_MS } = {}) {
  if (![process.execPath, HELPER, bwPath].every(safePath)) throw Error("No puedo abrir Bitwarden desde esta carpeta.");
  const tag = randomBytes(12).toString("hex");
  if (process.platform === "win32") {
    const pipe = "\\\\.\\pipe\\colmena-bw-" + tag;
    const waiting = listenOnce(pipe, timeout);
    const line = `/d /c start "Colmena - Desbloquear Bitwarden" "${process.execPath}" "${HELPER}" "${bwPath}" "${pipe}"`;
    const child = spawn(process.env.ComSpec || "cmd.exe", [line], { env, windowsVerbatimArguments: true, windowsHide: true, stdio: "ignore", detached: false });
    child.on("error", () => {});
    return waiting;
  }
  if (process.platform === "darwin") {
    const sock = path.join(os.tmpdir(), "colmena-bw-" + tag + ".sock");
    const waiting = listenOnce(sock, timeout);
    const command = [process.execPath, HELPER, bwPath, sock].map(shQuote).join(" ") + "; exit";
    const script = `tell application "Terminal" to do script ${JSON.stringify(command)}\ntell application "Terminal" to activate`;
    const child = spawn("/usr/bin/osascript", ["-e", script], { env, stdio: "ignore" });
    child.on("error", () => {});
    return waiting;
  }
  throw Error("En este sistema, desbloquea Bitwarden en tu terminal («bw unlock») y abre Colmena desde ella.");
}

export { listenOnce as _listenOnce, HELPER as BW_UNLOCK_HELPER };
