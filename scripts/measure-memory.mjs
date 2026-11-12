// Measures the memory archive (server/memory.mjs) on temporary data: how big the prompt is
// with everything injected (as it would be without tiers), with the core alone and with the
// core plus what retrieval brings; and how long retrieval takes.
//
//   node scripts/measure-memory.mjs [entries=300] [queries=200]
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Store } from "../server/store.mjs";
import { flushMemoryUse, memoryEntries, memoryUsage, relatedMemories, RELATED } from "../server/memory.mjs";
import { composeInstructions, useDataDirectory } from "../server/soul.mjs";
import { estimateTokens } from "../server/context.mjs";

const ENTRIES = Number(process.argv[2]) || 300, QUERIES = Number(process.argv[3]) || 200;

// Deterministic Spanish facts: subject × detail, so requests have a known answer.
const SUBJECTS = ["La gestoría", "El proveedor de papel", "La imprenta", "El banco", "El comité de dirección", "La asesoría laboral", "El equipo de ventas", "El almacén de Valencia", "La agencia de viajes", "El cliente Ferrovial", "La tienda online", "El taller mecánico", "La aseguradora", "El despacho de abogados", "La cooperativa"];
const DETAILS = [
  "presenta el IVA trimestral el día 20", "cobra las facturas a 30 días", "cierra en agosto dos semanas", "pide los pedidos antes del jueves", "prefiere las reuniones por la mañana",
  "envía el extracto el primer lunes del mes", "revisa los contratos cada enero", "necesita los informes en PDF", "trabaja con precios en euros sin IVA", "responde a los correos en un día",
  "entrega los envíos en 48 horas", "renueva la póliza en marzo", "factura por horas", "usa una hoja de cálculo compartida", "quiere un resumen semanal los viernes",
  "no admite devoluciones pasados 15 días", "paga las nóminas el día 28", "pide dos presupuestos para cada compra", "guarda las copias en la carpeta Administración", "atiende por teléfono solo por la tarde",
];
const CORE = [
  ["user", "dijiste", "Se llama Sergio y dirige una empresa de artes gráficas en Valencia"],
  ["user", "dijiste", "Prefiere respuestas cortas, en español y sin tecnicismos"],
  ["user", "dijiste", "Los viernes sale a las 15:00 y no quiere reuniones esa tarde"],
  ["user", "dijiste", "Nunca se envía un presupuesto sin que él lo vea antes"],
  ["memory", "dijiste", "El año fiscal cierra el 31 de diciembre"],
  ["memory", "dijiste", "Las cifras van en miles de euros, con un decimal"],
  ["bot", "dedujo", "Los informes de ventas están en la carpeta Ventas, una hoja por trimestre"],
];
const REQUESTS = [
  "¿Qué día presenta la gestoría el IVA de este trimestre?", "Prepara el pedido de papel para el proveedor", "¿Cuándo renueva la póliza la aseguradora?",
  "Escribe a la imprenta para pedir un presupuesto", "¿A cuántos días cobra el banco las facturas?", "Organiza una reunión con el comité de dirección",
  "¿Cómo quiere los informes el cliente Ferrovial?", "Resume las ventas de la tienda online de esta semana", "Hola, ¿qué tal?", "Hazme un poema sobre el otoño",
];

const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-measure-memory-"));
const store = new Store(directory);
try {
  useDataDirectory(directory, store);
  const bot = store.get("bots", "nora");
  const at = (i) => new Date(Date.UTC(2026, 0, 1) + i * 3600000).toISOString();
  CORE.forEach(([target, source, text], i) => store.put("memories", {
    id: "core-" + i, text, target, scope: target === "bot" ? "bot" : "equipo", botId: target === "bot" ? bot.id : null, source, review: false, active: true, tier: "core", createdAt: at(i),
  }));
  for (let i = 0; i < ENTRIES; i++) {
    const text = `${SUBJECTS[i % SUBJECTS.length]} ${DETAILS[Math.floor(i / SUBJECTS.length) % DETAILS.length]}`;
    store.put("memories", { id: "arch-" + i, text, target: "memory", scope: "equipo", botId: bot.id, source: "dedujo", review: false, missionId: "seed", active: true, tier: "archive", createdAt: at(i) });
  }
  const archive = memoryEntries(store, "memory", null, { tier: "archive" });
  const archiveChars = archive.reduce((n, m) => n + m.text.length + 3, 0);

  const system = composeInstructions(store, bot, { directory });
  const everything = system + "\n" + archive.map((m) => "- " + m.text).join("\n");

  // Cold: the first search builds the index. Warm: the index is reused until a memory changes.
  let t = performance.now();
  relatedMemories(store, bot, REQUESTS[0], { record: false });
  const cold = performance.now() - t;
  const times = [], sizes = [], counts = [];
  for (let i = 0; i < QUERIES; i++) {
    const request = REQUESTS[i % REQUESTS.length];
    t = performance.now();
    const found = relatedMemories(store, bot, request);
    times.push(performance.now() - t);
    sizes.push(found.text.length);
    counts.push(found.entries.length);
  }
  t = performance.now();
  const written = flushMemoryUse(store);
  const flush = performance.now() - t;
  times.sort((a, b) => a - b);
  const mean = (list) => list.reduce((n, x) => n + x, 0) / list.length;
  const ms = (x) => x.toFixed(2) + " ms";
  const size = (text) => `${String(text.length).padStart(6)} caracteres · ~${String(estimateTokens(text)).padStart(5)} tokens`;
  const withRetrieval = system.length + Math.round(mean(sizes));

  console.log(`Memoria: ${CORE.length} recuerdos siempre presentes, ${archive.length} en el archivo (${archiveChars} caracteres).`);
  console.log(`Núcleo: persona ${memoryUsage(store, "user").label} · equipo ${memoryUsage(store, "memory").label} · bot ${memoryUsage(store, "bot", bot.id).label}`);
  console.log("");
  console.log("Tamaño del prompt de un paso");
  console.log(`  todo inyectado (sin archivo):       ${size(everything)}`);
  console.log(`  solo el núcleo (sin recuperación):  ${size(system)}`);
  console.log(`  núcleo + recuerdos relacionados:    ${String(withRetrieval).padStart(6)} caracteres · ~${String(estimateTokens(system) + Math.round(mean(sizes) / 4)).padStart(5)} tokens  (media de ${QUERIES} peticiones)`);
  console.log(`  sección «Recuerdos relacionados»:   media ${Math.round(mean(sizes))}, máximo ${Math.max(...sizes)} caracteres (presupuesto ${RELATED.chars} + cabecera); ${mean(counts).toFixed(1)} recuerdos de media, ${counts.filter((n) => !n).length} peticiones sin ninguno`);
  console.log("");
  console.log("Tiempo de recuperación");
  console.log(`  primera búsqueda (construye el índice): ${ms(cold)}`);
  console.log(`  siguientes: media ${ms(mean(times))} · p50 ${ms(times[Math.floor(times.length / 2)])} · p95 ${ms(times[Math.floor(times.length * 0.95)])} · máximo ${ms(times.at(-1))}`);
  console.log(`  usos anotados: ${written} registros escritos de una vez en ${ms(flush)} (${counts.reduce((n, x) => n + x, 0)} usos en ${QUERIES} peticiones)`);
  console.log("");
  console.log("Ejemplo");
  for (const request of REQUESTS.slice(0, 2).concat(REQUESTS.slice(-1))) {
    const found = relatedMemories(store, bot, request, { record: false });
    console.log(`  «${request}»`);
    for (const m of found.entries) console.log("      - " + m.text);
    if (!found.entries.length) console.log("      (nada del archivo)");
  }
} finally {
  store.close();
  await rm(directory, { recursive: true, force: true });
}
