// Where the database key lives (db-crypto.mjs): never next to the data in clear.
//   Windows → DPAPI through the credential vault (nexo/credential-vault.mjs): only your Windows
//             account on this computer can open it.
//   macOS   → the login Keychain (`security`), service «Colmena».
//   others  → a file only this user can read (tests, Linux; it does not protect a copied folder).
// Named slots: "db-key" (the one in use), "db-key-restore" (from a backup being restored) and
// "db-key-before" (the previous one, kept when a restore brings a different key).
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { windowsVault } from "./nexo/credential-vault.mjs";

const binding = (name) => ({ profile: name, hostId: "colmena-db-v1", clientId: "database", subject: name });
const run = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, { timeout: 15000, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(String(stdout)))));
const asKey = (hex) => (typeof hex === "string" && /^[0-9a-f]{64}$/i.test(hex.trim()) ? Buffer.from(hex.trim(), "hex") : null);

/** A new random 32-byte key. */
export const newDatabaseKey = () => randomBytes(32);

/**
 * The key slots of a data directory: {kind: "dpapi"|"keychain"|"file", load(name), save(name, key), remove(name)}.
 * Loading a missing slot gives null.
 */
export function databaseKeys(directory, { platform = process.platform, vault = undefined, security = "security" } = {}) {
  const folder = path.join(directory, "dbkey");
  const dpapi = vault !== undefined ? vault : platform === "win32" ? windowsVault(folder) : null;
  if (dpapi) return {
    kind: "dpapi",
    load: async (name = "db-key") => asKey((await dpapi.load(binding(name)).catch(() => null))?.key),
    save: async (name, key) => { await dpapi.save(binding(name), { key: key.toString("hex") }); },
    remove: async (name) => { await dpapi.remove(name).catch(() => {}); },
  };
  if (platform === "darwin") {
    const account = (name) => name + ":" + createHash("sha256").update(path.resolve(directory)).digest("hex").slice(0, 16);
    return {
      kind: "keychain",
      load: async (name = "db-key") => asKey(await run(security, ["find-generic-password", "-s", "Colmena", "-a", account(name), "-w"]).catch(() => null)),
      save: async (name, key) => { await run(security, ["add-generic-password", "-U", "-s", "Colmena", "-a", account(name), "-l", "Colmena: clave de la base de datos", "-w", key.toString("hex")]); },
      remove: async (name) => { await run(security, ["delete-generic-password", "-s", "Colmena", "-a", account(name)]).catch(() => {}); },
    };
  }
  const file = (name) => path.join(folder, name + ".key");
  return {
    kind: "file",
    load: async (name = "db-key") => (existsSync(file(name)) ? asKey(readFileSync(file(name), "utf8")) : null),
    save: async (name, key) => {
      mkdirSync(folder, { recursive: true });
      writeFileSync(file(name), key.toString("hex"), { mode: 0o600 });
      try { chmodSync(file(name), 0o600); } catch {}
    },
    remove: async (name) => { rmSync(file(name), { force: true }); },
  };
}
