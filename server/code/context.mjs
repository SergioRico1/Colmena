// What the «Código» composer can bring into a message (T3 Code composer): `@` files of the task
// folder (fuzzy), `$` skills (SKILL.md folders of the project, of Claude Code and of Codex,
// inlined into the message so either engine can follow them) and attachments (files and
// images saved by Colmena and handed to the engine by path).
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { git } from "./git.mjs";
import { walkFolder } from "../checkpoints.mjs";

const fileCache = new Map(); // folder → {at, files}

/** Every file of the folder (Git's view when it is a repository: tracked + untracked, not ignored). */
export async function listFiles(folder) {
  const hit = fileCache.get(folder);
  if (hit && Date.now() - hit.at < 15000) return hit.files;
  let files = [];
  try {
    const out = (await git(["ls-files", "-co", "--exclude-standard", "-z"], { cwd: folder, timeout: 20000 })).stdout;
    files = out.split("\0").filter(Boolean);
  } catch {
    const walk = await walkFolder(folder, { maxFileBytes: Infinity, maxFiles: 20000, maxTotalBytes: Infinity });
    files = walk.files.map((f) => f.rel);
  }
  fileCache.set(folder, { at: Date.now(), files });
  return files;
}

/** Fuzzy match (letters in order; the file name counts more than the folders). */
export function fuzzyFiles(files, query, limit = 30) {
  const q = String(query || "").toLowerCase().replace(/\\/g, "/");
  if (!q) return files.slice(0, limit);
  const scored = [];
  for (const f of files) {
    const low = f.toLowerCase();
    const name = low.slice(low.lastIndexOf("/") + 1);
    let score;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(q)) score = 1;
    else if (low.includes(q)) score = 2;
    else {
      let i = 0;
      for (const c of low) if (c === q[i]) i++;
      if (i < q.length) continue;
      score = 3;
    }
    scored.push([score, f.length, f]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, limit).map((s) => s[2]);
}

/** «---\nname: x\ndescription: y\n---» → {name, description}. */
export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ""));
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

/** Skill folders, nearest first: the project's, then Claude Code's and Codex's of this person. */
export function skillRoots(folder, home = os.homedir()) {
  return [
    { dir: path.join(folder, ".claude", "skills"), source: "proyecto" },
    { dir: path.join(folder, ".agents", "skills"), source: "proyecto" },
    { dir: path.join(home, ".claude", "skills"), source: "Claude Code" },
    { dir: path.join(home, ".codex", "skills"), source: "Codex" },
  ];
}

/** [{name, description, source, file}] (one per name; the nearest wins). */
export async function listSkills(folder, { home = os.homedir(), limit = 400 } = {}) {
  const seen = new Map();
  for (const root of skillRoots(folder, home)) {
    let entries = [];
    try { entries = await readdir(root.dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (seen.size >= limit) break;
      const file = path.join(root.dir, e.name, "SKILL.md");
      if (!existsSync(file)) continue;
      let meta = {};
      try { meta = frontmatter((await readFile(file, "utf8")).slice(0, 4000)); } catch {}
      const name = (meta.name || e.name).trim();
      if (!/^[\w.:-]{1,80}$/.test(name) || seen.has(name)) continue;
      seen.set(name, { name, description: String(meta.description || "").slice(0, 240), source: root.source, file });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** `$name` in a message → the message plus each skill's instructions (for any engine). */
export async function expandSkills(text, folder, opts = {}) {
  const names = [...new Set([...String(text).matchAll(/(?:^|\s)\$([\w.:-]{1,80})/g)].map((m) => m[1]))];
  if (!names.length) return { text, used: [] };
  const skills = await listSkills(folder, opts);
  const used = [];
  let extra = "";
  for (const n of names) {
    const s = skills.find((x) => x.name === n);
    if (!s) continue;
    let body = "";
    try { body = await readFile(s.file, "utf8"); } catch { continue; }
    used.push(n);
    extra += `\n\n<habilidad nombre="${n}" carpeta="${path.dirname(s.file)}">\n${body.slice(0, 40000)}\n</habilidad>`;
  }
  return { text: used.length ? text + "\n\nSigue estas habilidades (las rutas relativas son de su carpeta):" + extra : text, used };
}

const MAX_ATTACHMENT = 20 * 1024 * 1024;
/** Saves a file the person attached; returns its absolute path (the engine reads it from there). */
export async function saveAttachment(directory, { name, data }) {
  const clean = path.basename(String(name || "adjunto")).replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]/g, "_").slice(0, 120) || "adjunto";
  const buf = Buffer.from(String(data || ""), "base64");
  if (!buf.length) throw Object.assign(Error("El archivo está vacío."), { status: 400 });
  if (buf.length > MAX_ATTACHMENT) throw Object.assign(Error("El archivo es demasiado grande (máximo 20 MB)."), { status: 413 });
  const dir = path.join(directory, "code", "attachments", randomUUID().slice(0, 8));
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, clean);
  await writeFile(file, buf);
  return { path: file, name: clean, size: buf.length, image: /\.(png|jpe?g|gif|webp)$/i.test(clean) };
}
