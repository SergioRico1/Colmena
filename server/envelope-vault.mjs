// Envelope encryption for the secrets of a hosted workspace (docs/CLOUD.md › Phase 1 › Secrets),
// where there is no DPAPI: a master secret (a Worker secret) wraps one random key per workspace,
// and that key wraps one random data key per secret. The vault it returns has the shape of the
// desktop's (server/nexo/credential-vault.mjs › windowsVault): load / save / remove by profile,
// so SiteVault, SecretStore, McpHub and the provider take it as they take DPAPI.
//
// Rotation: the master has an id (`kid`); a workspace key wrapped under an older master is
// rewrapped the first time it is opened with the new one listed (`masters`), and its secrets
// never change. A workspace key is replaced only by re-sealing that workspace's data keys.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const VERSION = "v1";
const b64 = (buf) => Buffer.from(buf).toString("base64url");
const unb64 = (text) => Buffer.from(String(text), "base64url");

/** AES-256-GCM of `plain` under `key`, bound to `aad`: "v1.<iv>.<ciphertext>.<tag>". */
export function seal(key, plain, aad) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw Error("Clave de cifrado no válida.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const data = Buffer.concat([cipher.update(Buffer.isBuffer(plain) ? plain : Buffer.from(String(plain), "utf8")), cipher.final()]);
  return [VERSION, b64(iv), b64(data), b64(cipher.getAuthTag())].join(".");
}

/** The bytes `seal` sealed, or an error when the key, the data or its binding do not match. */
export function open(key, sealed, aad) {
  const [version, iv, data, tag] = String(sealed || "").split(".");
  if (version !== VERSION || !iv || !tag) throw Error("Secreto cifrado no válido.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, unb64(iv));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(unb64(tag));
    return Buffer.concat([decipher.update(unb64(data)), decipher.final()]);
  } catch {
    throw Error("No se pudo abrir un secreto cifrado de este espacio.");
  }
}

/** The 32-byte key-encryption key of a master secret (64 hex chars, or any text of 32+ characters). */
export function masterKey(secret) {
  const text = String(secret || "");
  if (text.length < 32) throw Error("La clave maestra de los secretos no está configurada.");
  const raw = /^[0-9a-f]{64}$/i.test(text) ? Buffer.from(text, "hex") : Buffer.from(text, "utf8");
  return createHmac("sha256", raw).update("colmena-vault-master-v1").digest();
}

/**
 * One workspace's key. `masters`: [{kid, secret}], the first one current (older ones only open);
 * `load()` / `save(record)`: where the wrapped key lives (the workspace's own store).
 */
export class WorkspaceKeyring {
  constructor({ workspace, masters, load, save }) {
    if (!workspace) throw Error("Espacio no válido.");
    if (!Array.isArray(masters) || !masters.length) throw Error("La clave maestra de los secretos no está configurada.");
    this.workspace = workspace;
    this.masters = masters.map((m) => ({ kid: String(m.kid || "m1"), key: masterKey(m.secret) }));
    this.load = load;
    this.save = save;
    this.cached = null;
  }
  aad(kid) {
    return "colmena-vault-workspace-key|" + this.workspace + "|" + kid;
  }
  /** The workspace key: unwrapped once, made the first time it is needed. */
  key() {
    if (this.cached) return this.cached;
    const current = this.masters[0];
    const stored = this.load();
    if (!stored) {
      const fresh = randomBytes(32);
      this.save({ kid: current.kid, wrapped: seal(current.key, fresh, this.aad(current.kid)), createdAt: new Date().toISOString() });
      return (this.cached = fresh);
    }
    const master = this.masters.find((m) => m.kid === stored.kid);
    if (!master) throw Error("Este espacio se cifró con una clave maestra que ya no está configurada.");
    const key = open(master.key, stored.wrapped, this.aad(master.kid));
    // Wrapped under an older master: rewrapped under the current one, the key itself unchanged.
    if (master.kid !== current.kid) this.save({ ...stored, kid: current.kid, wrapped: seal(current.key, key, this.aad(current.kid)), rotatedAt: new Date().toISOString() });
    return (this.cached = key);
  }
}

/**
 * A vault (windowsVault's shape) over `records` {get(id), put(record), remove(id)} for one
 * `namespace` ("vault", "secrets", "mcp", "provider"…). Each secret: a random data key that
 * seals the credentials, itself sealed by the workspace key; both bound to namespace and profile.
 */
export function envelopeVault({ keyring, records, namespace }) {
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(namespace || "")) throw Error("Espacio de secretos no válido.");
  const idOf = (profile) => namespace + ":" + String(profile || "default");
  const bind = (profile, what) => ["colmena-vault", what, keyring.workspace, namespace, String(profile || "default")].join("|");
  return {
    async load(binding) {
      const record = records.get(idOf(binding?.profile));
      if (!record) return null;
      const dataKey = open(keyring.key(), record.key, bind(binding?.profile, "data-key"));
      return JSON.parse(open(dataKey, record.data, bind(binding?.profile, "data")).toString("utf8"));
    },
    async save(binding, credentials) {
      const dataKey = randomBytes(32);
      records.put({
        id: idOf(binding?.profile), namespace, v: 1,
        key: seal(keyring.key(), dataKey, bind(binding?.profile, "data-key")),
        data: seal(dataKey, JSON.stringify(credentials ?? null), bind(binding?.profile, "data")),
        at: new Date().toISOString(),
      });
      return { ok: true };
    },
    async remove(profile) {
      records.remove(idOf(profile));
      return { ok: true };
    },
  };
}
