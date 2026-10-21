// Fills an ISOLATED data directory with sample records modelled on the approved
// mockups, for visual QA only. Refuses to touch the real Colmena data folder.
// Usage: COLMENA_DATA_DIR=.local/qa-data node scripts/seed-qa.mjs
import path from "node:path";
import os from "node:os";
import { rmSync } from "node:fs";
import { Store } from "../server/store.mjs";

const dir = process.env.COLMENA_DATA_DIR;
const real = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "Colmena");
if (!dir || path.resolve(dir) === path.resolve(real)) throw Error("Usa COLMENA_DATA_DIR con una carpeta de QA aislada.");
rmSync(dir, { recursive: true, force: true });
const store = new Store(dir);
const at = (min) => new Date(Date.now() - min * 60000).toISOString();
const put = (kind, data) => store.put(kind, { createdAt: at(30), ...data });

store.patch("settings", "main", { onboarded: true, spaceName: "Equipo de operaciones", model: "gpt-5" });

// 1 · Equipo en marcha
put("missions", { id: "m-q3", title: "Informe del tercer trimestre para el comité", room: "informe-q3", prompt: "Necesito el informe del tercer trimestre para el comité del jueves: ventas por región, comparativa con la competencia y 8 diapositivas. Tono sobrio.", mode: "equipo", botIds: ["atlas", "tomas", "nora", "iris", "vera"], status: "awaiting_plan", safety: "preguntar", conversation: false, createdAt: at(120), dueAt: new Date(Date.now() + 3 * 3600e3).toISOString(), plan: { approved: true, assignments: [{ botId: "tomas", task: "ventas por región" }, { botId: "nora", task: "comparativa con la competencia" }, { botId: "iris", task: "8 diapositivas" }, { botId: "vera", task: "resumen de una página" }] }, threadSummary: "Acordaron usar los totales públicos de la competencia, marcados como estimación." });
const step = (missionId, key, botId, kind, status, extra = {}) => put("steps", { id: missionId + ":" + key, key, missionId, botId, kind, status, deps: [], text: "", history: [], pending: [], rounds: 0, ...extra });
step("m-q3", "plan", "atlas", "plan", "completed", { title: "Plan del equipo", startedAt: at(118), completedAt: at(117), text: "Reparto listo." });
step("m-q3", "work-tomas", "tomas", "work", "waiting", { title: "Ventas por región", startedAt: at(110) });
step("m-q3", "work-nora", "nora", "work", "completed", { title: "Comparativa con la competencia", startedAt: at(110), completedAt: at(60), text: "Comparativa lista.", reads: 3, seconds: 95 });
step("m-q3", "work-iris", "iris", "work", "running", { title: "Diapositivas", startedAt: at(55) });
step("m-q3", "work-vera", "vera", "work", "pending", { title: "Resumen de una página" });
step("m-q3", "synthesis", "atlas", "synthesis", "pending", { title: "Entrega final" });
put("messages", { id: "q3-1", missionId: "m-q3", role: "user", kind: "message", text: "Necesito el informe del tercer trimestre para el comité del jueves: ventas por región, comparativa con la competencia y 8 diapositivas. Tono sobrio.", attachments: [{ name: "ventas_q3.xlsx", size: 48211 }], at: at(120) });
put("messages", { id: "q3-2", missionId: "m-q3", role: "assistant", botId: "atlas", kind: "plan", text: "Lo reparto así. Tomás y Nora empiezan ya; Iris y Vera, en cuanto tengan material.", plan: { approved: false, assignments: [{ botId: "nora", title: "Investigar a la competencia", task: "Buscar los informes anuales públicos de los tres competidores principales y extraer **ventas por región**. Marcar como estimación lo que no esté publicado.", deliverable: "Tabla con cifras, fuente y fecha", after: [] }, { botId: "tomas", title: "Preparar las ventas por región", task: "Cruzar `ventas_q3.xlsx` con la tabla de Nora y calcular la variación trimestral.", deliverable: "Hoja comparativa del Q3", after: ["nora"] }, { botId: "iris", title: "Maquetar 8 diapositivas", task: "Diapositivas sobrias con los datos de Tomás.", deliverable: "Presentación de 8 diapositivas", after: ["tomas"] }, { botId: "vera", title: "Redactar el resumen", task: "Una página para el comité.", deliverable: "Resumen de una página", after: ["tomas"] }] }, stepId: "m-q3:plan", at: at(118) });
put("messages", { id: "q3-3", missionId: "m-q3", role: "assistant", botId: "tomas", kind: "question", text: "@Tú El Excel no trae las devoluciones de septiembre. ¿Cómo las trato?", approvalId: "ap-q", options: [{ id: "o1", label: "Te paso el archivo", primary: true }, { id: "o2", label: "Estímalas" }, { id: "o3", label: "Déjalas fuera" }], stepId: "m-q3:work-tomas", at: at(42) });
put("messages", { id: "q3-4", missionId: "m-q3", role: "assistant", botId: "nora", kind: "message", text: "Hecha la comparativa con la competencia. Las cifras estimadas van marcadas.", stepId: "m-q3:work-nora", summary: { reads: 3, seconds: 95 }, at: at(40) });
put("messages", { id: "q3-5", missionId: "m-q3", role: "assistant", botId: "nora", kind: "deliverable", text: "Comparativa con la competencia", artifactId: "art-comp", stepId: "m-q3:work-nora", at: at(40) });
for (const [i, [from, to, text, min]] of [["tomas", "nora", "¿Tienes ventas de la competencia por región o solo totales?", 59], ["nora", "tomas", "Solo totales anuales públicos. Te paso los tres informes y lo marco como estimación.", 58], ["tomas", "atlas", "Faltan las devoluciones de septiembre. ¿Pregunto en la sala?", 44], ["atlas", "tomas", "Sí. Pregunta y sigue con el resto mientras tanto.", 43], ["nora", "iris", "Comparativa lista. Empieza por la diapositiva 3.", 40]].entries())
  put("thread", { id: "th-" + i, missionId: "m-q3", from, to, text: i === 1 ? "**Solo totales anuales públicos.** Te paso los tres informes:\n- Uno por competidor\n- Marcados como *estimación*" : text, at: at(min) });

// 2 · Debate esperando elección
put("missions", { id: "m-camp", title: "Nueva portada de la campaña de primavera", room: "campaña-primavera", prompt: "Propuestas para la portada de la campaña de primavera.", mode: "debate", botIds: ["iris", "vera", "bruno"], status: "awaiting_choice", safety: "preguntar", conversation: false, createdAt: at(300) });
for (const [i, b, t] of [[0, "iris", "Imagen a sangre con mucho aire y un titular corto en blanco: «Nuevo. Ligero. Tuyo.»"], [1, "vera", "Titular grande sobre fondo liso y foto pequeña del producto; prioriza el texto."], [2, "bruno", "Portada interactiva ligera: carga en menos de 1 s y anima la imagen al hacer scroll."]]) {
  step("m-camp", "proposal-" + b, b, "proposal", "completed", { text: t, startedAt: at(290 - i), completedAt: at(250 - i) });
  step("m-camp", "critique-" + b, b, "critique", "completed", { text: b === "iris" ? "La de Vera se lee mejor en móvil; la de Bruno pesa más de lo que dice." : b === "vera" ? "La de Iris es la más bonita, pero el titular necesita más contraste." : "Iris y Vera son compatibles: imagen de Iris con el titular de Vera.", startedAt: at(240), completedAt: at(230) });
}

// 3 · Un bot en este ordenador
put("missions", { id: "m-fact", title: "Pasar las macros de facturación a un script", room: "facturación", prompt: "Pasa las macros de facturación a un script.", mode: "solo", botIds: ["bruno"], status: "running", safety: "avisar", conversation: false, createdAt: at(90) });
step("m-fact", "answer", "bruno", "solo", "running", { title: "Script de facturación", startedAt: at(80) });

// 4 · Chat 1:1 con Nora
put("missions", { id: "m-chat", title: "Oferta de limpieza 2027", room: "oferta-limpieza", prompt: "¿Qué cambia en esta oferta respecto al contrato de limpieza que tenemos ahora?", mode: "solo", botIds: ["nora"], status: "completed", conversation: true, createdAt: at(200), completedAt: at(190) });
step("m-chat", "answer", "nora", "solo", "completed", { title: "Comparativa", startedAt: at(199), completedAt: at(190), reads: 2, seconds: 40, text: "He comparado la oferta con el contrato actual." });
put("messages", { id: "c-1", missionId: "m-chat", role: "user", kind: "message", text: "¿Qué cambia en esta oferta respecto al contrato de limpieza que tenemos ahora?", attachments: [{ name: "oferta_limpieza_2027.pdf", size: 812000 }], at: at(200) });
put("messages", { id: "c-2", missionId: "m-chat", role: "assistant", botId: "nora", kind: "message", text: "He comparado la oferta con el contrato actual. Hay tres cambios que importan:\n\n- **El precio deja de ser fijo.** Se revisaría cada enero según el IPC.\n- **Incluye los cristales exteriores,** que ahora pagamos aparte.\n- **La permanencia sube de 1 a 3 años** y el preaviso, de 30 a 90 días.\n\nTe dejo la comparativa completa en una tabla.", stepId: "m-chat:answer", summary: { reads: 2, seconds: 40 }, at: at(190) });
put("messages", { id: "c-3", missionId: "m-chat", role: "assistant", botId: "nora", kind: "deliverable", text: "Contrato actual vs. oferta", artifactId: "art-tabla", stepId: "m-chat:answer", at: at(190) });

// Bandeja
put("approvals", { id: "ap-plan", missionId: "m-q3", botId: "atlas", tool: "propose_plan", kind: "plan", status: "pending", title: "Plan para el informe", summary: "Plan del equipo", context: "Atlas · #informe-q3", createdAt: at(117) });
put("approvals", { id: "ap-send", missionId: "m-q3", botId: "vera", tool: "qa_send", kind: "send", status: "pending", title: "Enviar el resumen semanal", summary: "Enviar el resumen semanal por correo a 3 personas de dirección.", context: "Vera · rutina de los jueves · hace 12 min", canAlways: true, email: { to: ["direccion1@ejemplo.com", "direccion2@ejemplo.com", "direccion3@ejemplo.com"], cc: [], cco: [], subject: "Resumen semanal de operaciones · semana 42", body: "Hola a todos:\n\nLo más importante de esta semana:\n\n- El informe del tercer trimestre estará listo el jueves para el comité.\n- Hemos recibido una oferta nueva de limpieza; la estamos comparando con el contrato actual.\n- La facturación automática entra en pruebas la semana que viene.\n\nUn saludo,\nTu nombre", attachments: [] }, createdAt: at(12) });
put("approvals", { id: "ap-q", missionId: "m-q3", botId: "tomas", tool: "ask_user", kind: "question", status: "pending", title: "El Excel no trae las devoluciones de septiembre. ¿Cómo las trato?", summary: "El Excel no trae las devoluciones de septiembre. ¿Cómo las trato?", context: "Tomás · #informe-q3", blocks: 2, options: [{ id: "o1", label: "Te paso el archivo", primary: true }, { id: "o2", label: "Estímalas" }, { id: "o3", label: "Déjalas fuera" }], stepId: "m-q3:work-tomas", createdAt: at(42) });
put("approvals", { id: "ap-perm", missionId: "m-fact", botId: "bruno", tool: "qa_install", kind: "permission", status: "pending", title: "Instalar una librería", summary: "Instalar una librería para leer hojas de cálculo. Sin ella no puede pasar las pruebas que faltan.", context: "Bruno · #facturación · en este ordenador", canAlways: true, createdAt: at(20) });
put("approvals", { id: "ap-old1", missionId: "m-chat", botId: "nora", tool: "qa_read", kind: "permission", status: "approved", title: "Leer la carpeta de Contratos", summary: "Nora pudo leer la carpeta de Contratos", decidedAt: at(60), decidedBy: "tú", createdAt: at(65) });

// Biblioteca
put("artifacts", { id: "art-comp", missionId: "m-q3", botId: "nora", title: "Comparativa con la competencia", kind: "document", format: "md", status: "final", version: 1, room: "informe-q3", content: "# Comparativa\n\nTotales públicos de la competencia (estimación).", createdAt: at(40) });
put("artifacts", { id: "art-tabla", missionId: "m-chat", botId: "nora", title: "Contrato actual vs. oferta", kind: "table", format: "csv", status: "final", version: 1, content: "Punto,Ahora,Oferta\nPrecio mensual,Pendiente de Tomás,[PRECIO OFERTA]\nRevisión de precio,Fijo,IPC cada enero\nCristales exteriores,Aparte,Incluidos\nPermanencia,1 año,3 años\nPreaviso,30 días,90 días", createdAt: at(190) });
put("artifacts", { id: "art-py", missionId: "m-fact", botId: "bruno", title: "facturacion.py", kind: "code", format: "py", status: "en curso", version: 3, room: "facturación", content: "def facturar():\n    pass\n", createdAt: at(30) });

// Habilidades, memoria, automatizaciones, sugerencias
put("skills", { id: "sk-conc", name: "Conciliación bancaria mensual", description: "Cruza el extracto con la contabilidad y marca diferencias.", botId: "tomas", status: "pending", origin: "learned", version: 1, steps: 7, uses: 0, learnedFrom: "tras 4 tareas parecidas", content: "---\nname: Conciliación bancaria mensual\ndescription: Cruza el extracto con la contabilidad\n---\n\n1. Descarga el extracto.\n2. Cruza movimientos.\n3. Marca diferencias.", hash: "a1" });
put("skills", { id: "sk-hojas", name: "Análisis de hojas de cálculo", description: "Instalada", botId: "tomas", status: "active", origin: "imported", version: 1, steps: 5, uses: 31, content: "# Análisis", hash: "a2" });
put("memories", { id: "mem-1", text: "Prefieres las cifras en miles de euros, con un decimal.", botId: "tomas", scope: "bot", source: "dijiste", sourceLabel: "Se lo dijiste · 3 oct", review: false, active: true });
put("memories", { id: "mem-2", text: "El comité pide como máximo 8 diapositivas.", botId: null, scope: "equipo", source: "dijiste", sourceLabel: "Lo dijiste en #informe-q3", review: false, active: true });
put("memories", { id: "mem-3", text: "El año fiscal cierra el 31 de diciembre.", botId: "tomas", scope: "bot", source: "dedujo", sourceLabel: "Lo dedujo · revisar", review: true, active: true });
const rule = (id, name, botId, trigger, extra = {}) => put("automations", { id, name, botId, prompt: name, enabled: true, trigger, notify: "resultado", needs: [], state: "scheduled", ...extra });
rule("au-1", "Resumen del correo", "vera", { type: "dia", config: { hora: "08:00", dias: [1, 2, 3, 4, 5], festivo: "saltar", zona: "Madrid" }, sentence: "sean las 08:00 de lunes a viernes" }, { lastRun: at(400), lastStatus: "completed" });
rule("au-2", "Vigilar precios de la competencia", "nora", { type: "dia", config: { hora: "13:00", dias: [0, 1, 2, 3, 4, 5, 6], festivo: "igual", zona: "Madrid" }, sentence: "sean las 13:00 todos los días" });
rule("au-3", "Cierre de caja del día", "tomas", { type: "dia", config: { hora: "18:30", dias: [0, 1, 2, 3, 4, 5, 6], festivo: "igual", zona: "Madrid" }, sentence: "sean las 18:30 todos los días" });
rule("au-4", "Avisar de contratos que vencen", "nora", { type: "semana", config: { semDia: 1, semHora: "09:00", semCada: "1" }, sentence: "sea lunes a las 09:00" }, { enabled: false, state: "paused" });
put("suggestions", { id: "sug-1", kind: "automation", status: "pending", botId: "atlas", text: "Atlas ha notado que cada lunes pides «resumen de ventas de la semana». ¿Lo automatizamos?", cta: "Sí, cada lunes a las 9:00", payload: { name: "Resumen de ventas de la semana", prompt: "Prepara el resumen de ventas de la semana.", botId: "tomas", trigger: { type: "semana", config: { semDia: 1, semHora: "09:00", semCada: "1" } } } });
store.close();
console.log("Datos de QA en", dir);
