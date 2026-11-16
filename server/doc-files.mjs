// The small Markdown documents of a workspace: the bots' SOUL.md (and the files next to it), each
// person's USER.md and the company's COMPANY.md. The desktop keeps them as files in its data
// folder, as always. A hosted workspace has no disk (workerd refuses the write: «operation not
// permitted»), so its folder is mounted on its own store (server/cloud/host.mjs › mountDocs): the
// same paths become encrypted records of kind "docs", keyed by the path inside the folder.
//
// The functions below have the names and the behaviour node:fs gives these callers (soul.mjs,
// memory.mjs, company-doc.mjs): outside a mounted folder they are node:fs itself.
import * as fs from "node:fs";
import path from "node:path";

const mounts = new Map(); // folder (posix, no trailing slash) → store
const posix = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "");
/** Documents under `folder` live in `store` from now on (a hosted workspace, once per object). */
export function mountDocs(folder, store) { if (folder && store) mounts.set(posix(folder), store); }
export function unmountDocs(folder) { mounts.delete(posix(folder)); }
function mounted(file) {
  const f = posix(file);
  for (const [base, store] of mounts) if (f === base || f.startsWith(base + "/")) return { store, key: f.slice(base.length + 1) };
  return null;
}
const missing = (file) => Object.assign(Error("ENOENT: no such file, " + file), { code: "ENOENT" });
const get = (m) => (m.key ? m.store.get("docs", m.key) : null);

export function readFileSync(file, encoding) {
  const m = mounted(file);
  if (!m) return fs.readFileSync(file, encoding);
  const doc = get(m);
  if (!doc) throw missing(file);
  return encoding ? String(doc.content) : Buffer.from(String(doc.content), "utf8");
}
export function writeFileSync(file, data, encoding) {
  const m = mounted(file);
  if (!m) return fs.writeFileSync(file, data, encoding);
  m.store.put("docs", { id: m.key, content: Buffer.isBuffer(data) ? data.toString("utf8") : String(data), updatedAt: new Date().toISOString() });
}
export function existsSync(file) {
  const m = mounted(file);
  return m ? !m.key || !!get(m) : fs.existsSync(file);
}
export function mkdirSync(dir, options) {
  if (mounted(dir)) return undefined;
  return fs.mkdirSync(dir, options);
}
export function renameSync(from, to) {
  const a = mounted(from), b = mounted(to);
  if (!a && !b) return fs.renameSync(from, to);
  const content = readFileSync(from, "utf8");
  writeFileSync(to, content, "utf8");
  if (a) a.store.remove("docs", a.key);
  else fs.rmSync(from, { force: true });
}
export function lstatSync(file) {
  const m = mounted(file);
  if (!m) return fs.lstatSync(file);
  if (m.key && !get(m)) throw missing(file);
  return { isSymbolicLink: () => false, isFile: () => !!m.key, isDirectory: () => !m.key };
}
export function rmSync(file, options) {
  const m = mounted(file);
  if (!m) return fs.rmSync(file, options);
  if (m.key && get(m)) m.store.remove("docs", m.key);
}
/** For tests: where a path would go. */
export const docKeyOf = (file) => mounted(file)?.key ?? null;
export { path };
