import {
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  closeSync,
} from "node:fs";
import path from "node:path";
export function lockInstance(directory) {
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
    const old = JSON.parse(readFileSync(file, "utf8"));
    if (!Number.isSafeInteger(old.pid) || old.pid < 1)
      throw Error("El registro de instancia necesita revisión.");
    let alive = true;
    try {
      process.kill(old.pid, 0);
    } catch (e) {
      if (e.code === "ESRCH") alive = false;
      else throw e;
    }
    if (alive)
      throw Error(
        "Colmena ya está abierta" +
          (old.origin ? " en " + old.origin : "") +
          ".",
      );
    unlinkSync(file);
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
