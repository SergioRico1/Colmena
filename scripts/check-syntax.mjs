// `npm run check`: every server module, every Electron main-process file and the eval harness parse
// (node --check). A syntax error in a file no test imports would otherwise ship.
import { readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TARGETS = [["server", ".mjs"], ["desktop", ".cjs"], ["eval", ".mjs"]];

async function walk(dir, ext, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, ext, out);
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

const files = (await Promise.all(TARGETS.map(([dir, ext]) => walk(path.join(ROOT, dir), ext)))).flat().sort();
const failures = [];
let next = 0;
const worker = async () => {
  while (next < files.length) {
    const file = files[next++];
    await new Promise((resolve) => execFile(process.execPath, ["--check", file], (error, _out, stderr) => {
      if (error) failures.push(path.relative(ROOT, file) + "\n" + String(stderr || error.message).trim());
      resolve();
    }));
  }
};
await Promise.all(Array.from({ length: Math.max(2, os.availableParallelism()) }, worker));

if (failures.length) {
  console.error(failures.join("\n\n"));
  console.error(`\n${failures.length} of ${files.length} files do not parse.`);
  process.exit(1);
}
console.log(`${files.length} files parse.`);
