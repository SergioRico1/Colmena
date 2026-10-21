// Adds a very long 1:1 chat with Nora («m-larga») to an ISOLATED QA data directory, to
// measure how a chat of hundreds of messages opens and scrolls. Keeps the rest of the data.
// Usage: COLMENA_DATA_DIR=.local/qa-data node scripts/seed-long-chat.mjs [turns=400]
import path from "node:path";
import os from "node:os";
import { Store } from "../server/store.mjs";

const dir = process.env.COLMENA_DATA_DIR;
const real = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "Colmena");
if (!dir || path.resolve(dir) === path.resolve(real)) throw Error("Usa COLMENA_DATA_DIR con una carpeta de QA aislada.");
const turns = Math.max(10, Number(process.argv[2]) || 400);
const store = new Store(dir);
const ID = "m-larga";
for (const kind of ["messages", "steps"]) for (const r of store.where(kind, "missionId", ID)) store.remove(kind, r.id);
const start = Date.now() - turns * 20 * 60000;
const at = (min) => new Date(start + min * 60000).toISOString();

const ASKS = [
  "¿Qué correos de proveedores han llegado esta semana?",
  "Resume el contrato de mantenimiento en cinco puntos",
  "Compara las dos ofertas de limpieza y dime cuál elegirías",
  "Busca qué ha cambiado en la normativa de facturación electrónica",
  "Revisa el Excel de gastos y dime qué no cuadra",
  "Prepara un borrador para el cliente que se retrasa en el pago",
];
const ANSWER = (i) => `Hecho. Esto es lo que he encontrado (${i + 1}):\n\n- **Proveedor A** subió la tarifa un 3,2 % desde enero.\n- **Proveedor B** mantiene el precio, pero cobra el transporte aparte.\n- La factura de septiembre **no cuadra**: faltan 418,20 € de devoluciones.\n\n| Concepto | Ahora | Propuesta |\n|---|---|---|\n| Precio | 1.250 € | 1.290 € |\n| Permanencia | 1 año | 3 años |\n\nSi quieres, preparo el correo para pedir la corrección.`;
const TOOLS = [
  ["web_fetch", { url: "https://www.agenciatributaria.es/factura-electronica" }, { ok: true, title: "Factura electrónica", text: "…" }],
  ["read_file", { path: "gastos_q3.xlsx" }, { ok: true, name: "gastos_q3.xlsx", pages: 3, text: "…" }],
  ["gmail_fetch_emails", { query: "from:proveedor newer_than:7d" }, { ok: true, messages: [{ subject: "Tarifa 2027" }, { subject: "Pedido 4411" }] }],
  ["run_command", { command: "python resumen.py gastos_q3.xlsx" }, { ok: true, exitCode: 0, output: "Total: 12.418,20 €\nDiferencia: 418,20 €" }],
];

let minute = 0;
for (let i = 0; i < turns; i++) {
  const stepId = `${ID}:turn-${i}`;
  const history = [];
  const calls = (i % 3) + 1;
  for (let k = 0; k < calls; k++) {
    const [name, args, out] = TOOLS[(i + k) % TOOLS.length];
    const call_id = `call-${i}-${k}`;
    history.push({ type: "function_call", call_id, name, arguments: JSON.stringify(args) }, { type: "function_call_output", call_id, output: JSON.stringify(out) });
  }
  store.put("messages", { id: `${ID}-u${i}`, missionId: ID, role: "user", kind: "message", text: ASKS[i % ASKS.length] + (i % 7 === 0 ? "\n\nY dime también si hay algo urgente." : ""), attachments: [], at: at(minute) });
  store.put("steps", { id: stepId, key: `turn-${i}`, missionId: ID, botId: "nora", kind: i ? "followup" : "solo", status: "completed", deps: [], text: ANSWER(i), history, pending: [], rounds: 1, startedAt: at(minute), completedAt: at(minute + 1), createdAt: at(minute) });
  if (i % 4 === 0) store.put("messages", { id: `${ID}-p${i}`, missionId: ID, role: "assistant", botId: "nora", kind: "progress", text: "Primero miro los correos de esta semana y luego cruzo las cifras.", stepId, callIds: history.filter((x) => x.type === "function_call").map((x) => x.call_id), at: at(minute + 0.5) });
  store.put("messages", { id: `${ID}-a${i}`, missionId: ID, role: "assistant", botId: "nora", kind: "message", text: ANSWER(i), stepId, at: at(minute + 1) });
  minute += i % 5 === 4 ? 60 : 6;
}
store.put("missions", { id: ID, title: "Proveedores y facturas", room: "proveedores", prompt: ASKS[0], mode: "solo", botIds: ["nora"], status: "completed", conversation: true, thread: true, createdAt: at(0), updatedAt: at(minute), completedAt: at(minute) });
store.close();
console.log(`Chat largo «${ID}»: ${turns * 2} mensajes en ${dir}`);
