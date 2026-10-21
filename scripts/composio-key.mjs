// Sets the Composio API key of this Colmena (Windows DPAPI store), typed by you with hidden
// input: it is never shown, written to a file in clear or sent anywhere but to Composio to
// check it. Usage: npm run composio-key
import os from "node:os";
import path from "node:path";
import { ComposioHub } from "../server/nexo/composio.mjs";
import { windowsVault } from "../server/nexo/credential-vault.mjs";

const directory = process.env.COLMENA_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "Colmena");

function hiddenInput(question) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY) return reject(Error("Ejecútalo en una terminal para escribir la clave de forma oculta."));
    process.stdout.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    let value = "";
    const done = (fn) => { input.setRawMode(false); input.pause(); input.removeListener("data", onData); process.stdout.write("\n"); fn(); };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(() => resolve(value.trim()));
        if (ch === "\u0003") return done(() => reject(Error("Cancelado.")));
        if (ch === "\u007f" || ch === "\b") { if (value) { value = value.slice(0, -1); process.stdout.write("\b \b"); } continue; }
        value += ch;
        process.stdout.write("•");
      }
    };
    input.on("data", onData);
  });
}

try {
  const vault = windowsVault(path.join(directory, "connections"));
  if (!vault) throw Error("El almacén cifrado de Windows no está disponible.");
  const key = await hiddenInput("Pega la clave de API de Composio (no se verá) y pulsa Intro: ");
  if (!/^ak_[A-Za-z0-9_-]{10,200}$/.test(key)) throw Error("Eso no parece una clave de Composio (empieza por ak_).");
  // configure validates the key against Composio before replacing the current one.
  await new ComposioHub({ vault }).dispatch("default", "configure", { key });
  console.log("Listo: Colmena usará esta clave de Composio. Reinicia la app si estaba abierta.");
} catch (error) {
  console.error("No se pudo guardar la clave: " + (error.message || "error"));
  process.exitCode = 1;
}
