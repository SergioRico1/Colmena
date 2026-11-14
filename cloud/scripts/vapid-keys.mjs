// Creates a VAPID key pair for Web Push and writes it as an env file:
//   node cloud/scripts/vapid-keys.mjs --out <file> [--force]
// The keys are never printed. An existing file is kept unless --force is given.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { generateVapidKeys } from "../../server/cloud/webpush.mjs";

const args = process.argv.slice(2);
const force = args.includes("--force");
const outIndex = args.indexOf("--out");
const out = outIndex >= 0 ? args[outIndex + 1] : null;

if (!out || out.startsWith("--")) {
  console.error("usage: node cloud/scripts/vapid-keys.mjs --out <file> [--force]");
  process.exit(2);
}

const file = resolve(out);
if (existsSync(file) && !force) {
  console.error(`${file} already exists; pass --force to replace it`);
  process.exit(1);
}

const { publicKey, privateKey } = await generateVapidKeys();
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, `VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\n`, { mode: 0o600 });
console.log(`written to ${file}`);
