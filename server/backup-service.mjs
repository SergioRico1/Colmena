// Backups as Ajustes › Privacidad y datos shows them: where they go, whether they run on their
// own (daily or weekly, keeping the newest N), making one now, and restoring one (staged now,
// applied when Colmena starts again). The password is never stored: for automatic backups the
// key derived from it is kept in the system vault (Windows DPAPI; elsewhere a file only this
// user can read). Routes: /api/backup…
import { existsSync, readFileSync, writeFileSync, rmSync, chmodSync, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { now } from "./store.mjs";
import {
  BackupError, EXTENSION, KEY_BINDING, RESTORE_MARKER, backupName, createBackup, extractBackup, listBackups, loadIdentity,
  newMasterKey, pruneBackups, readHeader, stageIdentity, suggestedFolders,
} from "./backup.mjs";

const HOUR = 3600000;
export const SCHEDULES = { off: 0, daily: 24 * HOUR, weekly: 7 * 24 * HOUR };
export const BACKUP_DEFAULTS = Object.freeze({ id: "backup", folder: null, schedule: "off", keep: 7, lastAt: null, lastFile: null, lastBytes: null, lastError: null, lastAuto: null });

export class Backups {
  /** `vault(subdir)` gives the system vault for a folder of the data directory (null without one). */
  constructor({ store, vault = () => null, appVersion = null, clock = () => Date.now(), send = (m) => process.send?.(m) }) {
    Object.assign(this, { store, vault, appVersion, clock, send });
    this.directory = store.directory;
    this.running = null;
  }
  config() { return { ...BACKUP_DEFAULTS, ...(this.store.get("settings", "backup") || {}) }; }
  save(changes) { return this.store.put("settings", { ...this.config(), ...changes, id: "backup" }); }
  keyVault() { return this.vault(path.join(this.directory, "backup")); }
  identityVault() { return this.vault(path.join(this.directory, "peers")); }
  keyFile() { return path.join(this.directory, "backup", "key.json"); }

  async savedKey() {
    const vault = this.keyVault();
    const saved = vault ? await vault.load(KEY_BINDING).catch(() => null) : existsSync(this.keyFile()) ? JSON.parse(readFileSync(this.keyFile(), "utf8")) : null;
    return saved?.key && saved?.kdf ? { key: Buffer.from(saved.key, "base64"), kdf: saved.kdf } : null;
  }
  /** Keeps the key of `password` for automatic backups (the password itself goes nowhere). */
  async setPassword(password) {
    const { key, kdf } = await newMasterKey(password);
    const record = { key: key.toString("base64"), kdf };
    const vault = this.keyVault();
    if (vault) await vault.save(KEY_BINDING, record);
    else {
      const file = this.keyFile();
      await rm(file, { force: true });
      const { mkdirSync } = await import("node:fs");
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(record), { mode: 0o600 });
      try { chmodSync(file, 0o600); } catch {}
    }
    this.save({ keySetAt: now() });
    return { ok: true };
  }
  async forgetPassword() {
    const vault = this.keyVault();
    if (vault) await vault.remove(KEY_BINDING.profile).catch(() => {});
    rmSync(this.keyFile(), { force: true });
    this.save({ keySetAt: null, schedule: "off" });
    return { ok: true };
  }

  folder() {
    const chosen = this.config().folder;
    return chosen || suggestedFolders()[0]?.path || path.join(this.directory, "copias");
  }
  /** Makes a backup now: with `password` (its own salt) or the saved key. */
  async run({ password = null, auto = false } = {}) {
    if (this.running) throw new BackupError("Ya se está haciendo una copia.", 409);
    this.running = (async () => {
      const keys = password ? await newMasterKey(password) : await this.savedKey();
      if (!keys) throw new BackupError("Pon una contraseña para la copia.", 409);
      const folder = this.folder();
      const identity = await loadIdentity(this.directory, this.identityVault()).catch(() => null);
      const result = await createBackup({ store: this.store, target: path.join(folder, backupName(auto, new Date(this.clock()))), ...keys, identity, appVersion: this.appVersion });
      const removed = auto ? await pruneBackups(folder, this.config().keep) : [];
      this.save({ lastAt: new Date(this.clock()).toISOString(), lastFile: result.file, lastBytes: result.bytes, lastError: null, ...(auto ? { lastAuto: new Date(this.clock()).toISOString() } : {}) });
      return { ...result, removed };
    })();
    try { return await this.running; }
    catch (error) { this.save({ lastError: String(error?.message || error).slice(0, 300) }); throw error; }
    finally { this.running = null; }
  }
  /** Due automatic backup (checked every hour while Colmena is open). */
  due(time = this.clock()) {
    const c = this.config();
    const every = SCHEDULES[c.schedule] || 0;
    if (!every || !c.keySetAt) return false;
    return !c.lastAuto || time - Date.parse(c.lastAuto) >= every - 5 * 60000;
  }
  async tick() {
    if (!this.due() || this.running) return null;
    try { return await this.run({ auto: true }); } catch { return null; }
  }
  start() {
    this.timer = setInterval(() => void this.tick(), HOUR);
    this.timer.unref?.();
    this.first = setTimeout(() => void this.tick(), 5 * 60000);
    this.first.unref?.();
  }
  stop() { clearInterval(this.timer); clearTimeout(this.first); }

  markerFile() { return path.join(this.directory, RESTORE_MARKER); }
  pending() { try { return JSON.parse(readFileSync(this.markerFile(), "utf8")); } catch { return null; } }
  /** The last restore, for a week (then the note goes; the folder with the old data stays until you delete it). */
  lastRestore() {
    try {
      const done = JSON.parse(readFileSync(path.join(this.directory, "restore-done.json"), "utf8"));
      return this.clock() - Date.parse(done.at) < 7 * 24 * HOUR ? done : null;
    } catch { return null; }
  }
  /**
   * Prepares a restore from `file` (checked with `password`): applied at the next start. With
   * `identity`, your «Personas» address comes back too.
   */
  async stage({ file, password, identity = false }) {
    await this.cancel();
    const staging = path.join(this.directory, "restore-staging-" + this.clock());
    try {
      const out = await extractBackup(file, password, staging, { withIdentity: identity });
      if (identity && out.identity) await stageIdentity(this.directory, out.identity, this.identityVault());
      const marker = { staging: path.basename(staging), createdAt: out.manifest.createdAt, identity: !!(identity && out.identity), stagedAt: now(), files: out.manifest.files.length, rows: out.db.rows };
      writeFileSync(this.markerFile(), JSON.stringify(marker));
      return { ...marker, hasIdentity: out.hasIdentity };
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }
  async cancel() {
    const marker = this.pending();
    if (marker?.staging) await rm(path.join(this.directory, path.basename(marker.staging)), { recursive: true, force: true }).catch(() => {});
    rmSync(this.markerFile(), { force: true });
    rmSync(path.join(this.directory, "peers", "identity-restore.json"), { force: true });
    const vault = this.identityVault();
    if (marker?.identity && vault) await vault.remove("peer-identity-restore").catch(() => {});
    return { ok: true };
  }
  /** The desktop app starts again (its server applies the restore first); null when it cannot. */
  relaunch() {
    if (typeof process.send !== "function") return { relaunching: false };
    setTimeout(() => this.send({ type: "relaunch" }), 300);
    return { relaunching: true };
  }

  async view() {
    const c = this.config();
    const folder = this.folder();
    const identity = await loadIdentity(this.directory, this.identityVault()).catch(() => null);
    return {
      folder, chosen: c.folder, schedule: c.schedule, keep: c.keep, hasPassword: !!c.keySetAt, keySetAt: c.keySetAt || null,
      last: c.lastAt ? { at: c.lastAt, file: c.lastFile, bytes: c.lastBytes } : null, lastError: c.lastError, running: !!this.running,
      folders: suggestedFolders().map(({ kind, label, path: p }) => ({ kind, label, path: p })),
      backups: (await listBackups(folder)).slice(0, 20), pending: this.pending(), restored: this.lastRestore(), identity: !!identity,
      canRelaunch: typeof process.send === "function",
    };
  }
}

const inside = (folder, name) => {
  const file = path.resolve(folder, String(name || ""));
  if (path.dirname(file) !== path.resolve(folder) || !file.endsWith(EXTENSION)) throw new BackupError("Copia no encontrada.", 404);
  return file;
};

export function registerBackupRoutes(app, { backups, check, z }) {
  const password = z.string().min(8).max(500);
  app.get("/api/backup", async (_req, res) => res.json(await backups.view()));
  app.put("/api/backup/settings", async (req, res) => {
    const body = check(z.object({ folder: z.string().trim().min(3).max(1000).nullable().optional(), schedule: z.enum(Object.keys(SCHEDULES)).optional(), keep: z.number().int().min(1).max(60).optional() }).strict(), req.body);
    if (body.folder && !path.isAbsolute(body.folder)) throw new BackupError("Escribe la ruta completa de la carpeta.");
    if (body.schedule && body.schedule !== "off" && !backups.config().keySetAt) throw new BackupError("Para las copias automáticas, pon antes una contraseña.", 409);
    backups.save(body);
    res.json(await backups.view());
  });
  app.post("/api/backup/password", async (req, res) => {
    const { password: value } = check(z.object({ password }).strict(), req.body);
    await backups.setPassword(value);
    res.json(await backups.view());
  });
  app.delete("/api/backup/password", async (_req, res) => { await backups.forgetPassword(); res.json(await backups.view()); });
  app.post("/api/backup/run", async (req, res) => {
    const { password: value } = check(z.object({ password: password.optional() }).strict(), req.body || {});
    const result = await backups.run({ password: value || null });
    res.json({ ...result, view: await backups.view() });
  });
  // The file itself (to keep it wherever you want).
  app.get("/api/backup/file/:name", (req, res) => {
    const file = inside(backups.folder(), req.params.name);
    if (!existsSync(file)) throw new BackupError("Copia no encontrada.", 404);
    res.download(file, path.basename(file));
  });
  // A backup brought from elsewhere (another computer): streamed to the data folder, then restored like any other.
  app.post("/api/backup/upload", async (req, res) => {
    if (!/octet-stream/.test(String(req.headers["content-type"] || ""))) throw new BackupError("Envía el archivo tal cual (application/octet-stream).", 415);
    const target = path.join(backups.directory, "restore-upload" + EXTENSION);
    await pipeline(req, createWriteStream(target));
    const { header } = await readHeader(target).catch(async (e) => { await rm(target, { force: true }); throw e; });
    res.json({ path: target, createdAt: header.createdAt, identity: !!header.identity });
  });
  app.post("/api/backup/inspect", async (req, res) => {
    const { path: file } = check(z.object({ path: z.string().trim().min(3).max(1000) }).strict(), req.body);
    const { header } = await readHeader(file);
    res.json({ createdAt: header.createdAt, appVersion: header.appVersion || null, identity: !!header.identity });
  });
  app.post("/api/backup/restore", async (req, res) => {
    const body = check(z.object({ path: z.string().trim().min(3).max(1000), password, identity: z.boolean().default(false) }).strict(), req.body);
    res.json(await backups.stage({ file: body.path, password: body.password, identity: body.identity }));
  });
  app.delete("/api/backup/restore", async (_req, res) => res.json(await backups.cancel()));
  app.post("/api/backup/relaunch", (_req, res) => res.json(backups.relaunch()));
}
