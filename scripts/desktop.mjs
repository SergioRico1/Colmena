// `npm run desktop`: starts Colmena with its own executable, not electron.exe.
//
// Windows draws a taskbar button (and Alt+Tab, pinned items, the notification area) with the
// icon embedded in the running .exe; an AppUserModelID shortcut only helps when Windows
// manages to match it, and its icon cache keeps electron.exe's otherwise. Packaged Electron
// apps (OpenClaw's installer included, via electron-builder) avoid this by writing the icon
// and the name into the executable with rcedit. We do the same for development: a copy of
// Electron's runtime in .local/runtime/ whose binary is Colmena.exe, branded once per
// Electron version and icon, then reused.
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronExe = require("electron"); // absolute path of electron's binary
const args = [path.join(root, "desktop", "main.cjs"), ...process.argv.slice(2)];

async function brandedRuntime() {
  const version = JSON.parse(readFileSync(path.join(root, "node_modules", "electron", "package.json"), "utf8")).version;
  const icon = path.join(root, "desktop", "icons", "colmena.ico");
  const stamp = version + ":" + createHash("sha256").update(readFileSync(icon)).digest("hex").slice(0, 16);
  const dir = path.join(root, ".local", "runtime", "colmena");
  const exe = path.join(dir, "Colmena.exe");
  const stampFile = path.join(dir, ".colmena-runtime");
  if (existsSync(exe) && existsSync(stampFile) && readFileSync(stampFile, "utf8") === stamp) return exe;

  console.log("Colmena: preparando su ejecutable propio (una vez por versión de Electron)…");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.dirname(dir), { recursive: true });
  cpSync(path.dirname(electronExe), dir, { recursive: true });
  renameSync(path.join(dir, path.basename(electronExe)), exe);
  const rcedit = (await import("rcedit")).default;
  await rcedit(exe, {
    icon,
    "version-string": {
      ProductName: "Colmena", FileDescription: "Colmena", CompanyName: "Colmena",
      InternalName: "Colmena", OriginalFilename: "Colmena.exe", LegalCopyright: "Colmena",
    },
    "product-version": version,
    "file-version": version,
  });
  writeFileSync(stampFile, stamp);
  return exe;
}

let binary = electronExe;
if (process.platform === "win32") {
  try {
    binary = await brandedRuntime();
  } catch (error) {
    // Never block the app: fall back to Electron's own binary (generic icon), and say why.
    console.error("Colmena: no se pudo preparar Colmena.exe; se usa electron.exe. " + (error?.message || error));
  }
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(binary, args, { cwd: root, stdio: "inherit", env, windowsHide: false });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
