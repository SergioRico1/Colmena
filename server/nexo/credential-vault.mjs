import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const helper = fileURLToPath(
  new URL("../credential_vault.py", import.meta.url),
);
/** Uses installed Python and Windows DPAPI, never a shell or plaintext credential file. */
export function windowsVault(
  directory,
  {
    python = process.env.COLMENA_PYTHON ||
      (process.platform === "win32" ? "python" : null),
  } = {},
) {
  if (process.platform !== "win32" || !python) return null;
  const invoke = (request) =>
    new Promise((resolve, reject) => {
      const child = spawn(python, [helper, directory], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const chunks = [];
      let size = 0,
        settled = false;
      const fail = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          child.kill();
          reject(Error("No se pudo acceder al almacén cifrado de Colmena."));
        }
      };
      const timer = setTimeout(fail, 10000);
      child.stdout.on("data", (data) => {
        size += data.length;
        if (size > 128000) fail();
        else chunks.push(data);
      });
      child.stderr.on("data", () => {});
      child.on("error", fail);
      child.stdin.on("error", fail);
      child.on("close", (code) => {
        if (settled) return;
        if (code !== 0) {
          fail();
          return;
        }
        settled = true;
        clearTimeout(timer);
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(Error("Almacén cifrado no válido."));
        }
      });
      const encoded = JSON.stringify(request);
      if (Buffer.byteLength(encoded) > 128000) {
        fail();
        return;
      }
      child.stdin.end(encoded);
    });
  return {
    load: async (binding) =>
      (await invoke({ action: "load", profile: binding.profile, binding }))
        .credentials,
    save: async (binding, credentials) =>
      invoke({
        action: "save",
        profile: binding.profile,
        binding,
        credentials,
      }),
    remove: async (profile) =>
      invoke({ action: "delete", profile: profile || "default" }),
  };
}
