import {
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
  unlinkSync,
  closeSync,
} from "node:fs";
import path from "node:path";

/** How long a Colmena that has not said where it listens yet still counts as starting. */
const STARTING_MS = 10 * 60 * 1000;

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== "ESRCH"; // EPERM: it exists, it is someone else's
  }
}

/**
 * Is the Colmena that wrote this record still running? A live PID is not enough (Windows
 * hands a dead Colmena's PID to any other program): it must answer /api/health as that
 * very process, or still be starting. A record nobody can read is nobody's.
 */
async function running(file, probe) {
  let old, age;
  try {
    old = JSON.parse(readFileSync(file, "utf8"));
    age = Date.now() - statSync(file).mtimeMs;
  } catch {
    return null;
  }
  if (!Number.isSafeInteger(old?.pid) || old.pid < 1 || !pidAlive(old.pid)) return null;
  if (!old.origin) return age < STARTING_MS ? old : null;
  try {
    const url = new URL(old.origin);
    if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") return null;
    const health = await probe(url.origin + "/api/health");
    return health?.application === "Colmena" && health.pid === old.pid ? old : null;
  } catch {
    return null;
  }
}

const ask = async (url) => (await fetch(url, { signal: AbortSignal.timeout(2000) })).json();

export async function lockInstance(directory, { probe = ask } = {}) {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "instance.json");
  const write = () => {
    const fd = openSync(file, "wx");
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid }));
    } finally {
      closeSync(fd);
    }
  };
  try {
    write();
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const old = await running(file, probe);
    if (old)
      throw Error(
        "Colmena ya está abierta" +
          (old.origin ? " en " + old.origin : "") +
          ".",
      );
    try {
      unlinkSync(file);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    write();
  }
  return {
    ready(origin) {
      writeFileSync(file, JSON.stringify({ pid: process.pid, origin }));
    },
    release() {
      try {
        if (JSON.parse(readFileSync(file, "utf8")).pid === process.pid)
          unlinkSync(file);
      } catch {}
    },
  };
}
