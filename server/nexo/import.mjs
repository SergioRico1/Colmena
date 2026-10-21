// One-time import of the Composio account already set up in NEXO (same machine, same Windows
// user). NEXO keeps it in its DPAPI store bound to «nexo-composio-v1»; Colmena opens it with
// that binding and saves it again under its own («colmena-composio-v1»). The key never leaves
// these two encrypted files: nothing is shown, logged or sent anywhere. The Composio identity
// (userId) comes along, so the apps connected in NEXO show up in Colmena too.
import { readdirSync } from "node:fs";
import path from "node:path";
import { windowsVault } from "./credential-vault.mjs";

const bind = (profile, hostId) => ({ profile, hostId, clientId: "composio", subject: "profile:" + profile });
export const nexoDataDir = () => (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "NEXO", "data") : null);

/** {imported, reason}. Runs only when Colmena has no Composio key yet. */
export async function importNexoComposio({ store, directory, nexoBase = nexoDataDir(), vaultFor = windowsVault } = {}) {
  if (store.get("settings", "main")?.nexoComposioImport) return { imported: false, reason: "ya importado" };
  if (!nexoBase) return { imported: false, reason: "sin NEXO" };
  const target = vaultFor(path.join(directory, "connections"));
  if (!target) return { imported: false, reason: "sin almacén cifrado" };
  const mine = await target.load(bind("default", "colmena-composio-v1")).catch(() => null);
  if (mine?.apiKey) return { imported: false, reason: "ya configurado" };
  let profiles = [];
  try {
    profiles = readdirSync(path.join(nexoBase, "connections", "credentials")).filter((f) => /^[A-Za-z0-9_-]{1,100}\.dpapi$/.test(f)).map((f) => f.slice(0, -6));
  } catch {
    return { imported: false, reason: "sin NEXO" };
  }
  const source = vaultFor(path.join(nexoBase, "connections"));
  for (const profile of profiles) {
    const creds = await source.load(bind(profile, "nexo-composio-v1")).catch(() => null);
    if (!creds?.apiKey) continue;
    // A fresh tool session in Colmena; the account, identity and aliases stay.
    await target.save(bind("default", "colmena-composio-v1"), { ...creds, sessionId: null });
    store.patch("settings", "main", { nexoComposioImport: new Date().toISOString() });
    return { imported: true };
  }
  return { imported: false, reason: "NEXO no tiene Composio" };
}
