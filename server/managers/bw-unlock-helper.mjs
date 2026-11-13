// Runs in a console window of its own (server/managers/bw-window.mjs): `bw unlock --raw` asks
// for the master password in this window, with its own prompt. Colmena never sees it; only the
// session key bw prints goes back, through the local pipe named in argv.
//   node bw-unlock-helper.mjs <bw program> <pipe or socket>
import { spawn } from "node:child_process";
import net from "node:net";

const [bw, address] = process.argv.slice(2);
const script = /\.(m|c)?js$/i.test(bw || "");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

process.stderr.write("\nColmena · Desbloquear Bitwarden\nEscribe tu contraseña maestra cuando Bitwarden te la pida y pulsa Enter. Colmena no la ve.\n\n");
const chunks = [];
const child = spawn(script ? process.execPath : bw, [...(script ? [bw] : []), "unlock", "--raw"], { stdio: ["inherit", "pipe", "inherit"], shell: false });
child.stdout.on("data", (d) => chunks.push(d));
child.on("error", async () => {
  process.stderr.write("No se pudo abrir Bitwarden.\n");
  await pause(4000);
  process.exit(1);
});
child.on("close", async (code) => {
  const buf = Buffer.concat(chunks);
  for (const c of chunks) c.fill(0);
  const key = buf.toString("utf8").trim();
  buf.fill(0);
  if (code !== 0 || !key) {
    process.stderr.write("\nBitwarden sigue bloqueado. Puedes cerrar esta ventana.\n");
    await pause(4000);
    process.exit(1);
  }
  const socket = net.connect(address, () => socket.end(key + "\n"));
  socket.on("close", async () => {
    process.stderr.write("\nListo: Colmena ya puede usar Bitwarden. Esta ventana se cierra sola.\n");
    await pause(1500);
    process.exit(0);
  });
  socket.on("error", async () => {
    process.stderr.write("\nNo se pudo avisar a Colmena. Vuelve a intentarlo desde Ajustes.\n");
    await pause(4000);
    process.exit(1);
  });
});
