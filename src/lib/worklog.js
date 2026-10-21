// The work of a bot in one plain line (T3 Code WorkLog groups): consecutive tool calls are
// summed up as a person would say it — «Ha leído 5 correos y 2 páginas web, buscado en la web
// y editado 2 archivos» — and the steps themselves show only when you unfold it.

// How the bot finds its way (which accounts, which tools, its own notes): not work for you.
export const PLUMBING = new Set(["apps_accounts", "apps_search", "apps_describe", "mcp_tools", "list_skills", "read_skill", "mission_brief", "recall", "react", "remember"]);
const HIDDEN = new Set(["question", "retry"]);

const n = (count, one, many) => (count === 1 ? `${one}` : `${count} ${many}`);
const units = (one, many) => (count) => n(count, one, many);

// What each app action is about: «leer correos» → correos; «consultar el calendario» → eventos.
const APP_THINGS = [
  [/correo|borrador/, ["un correo", "correos"]],
  [/calendario|evento/, ["un evento", "eventos"]],
  [/hoja de c[aá]lculo/, ["una hoja de cálculo", "hojas de cálculo"]],
  [/archivo/, ["un archivo", "archivos"]],
  [/mensaje|chat/, ["un mensaje", "mensajes"]],
  [/registro/, ["un registro", "registros"]],
];
const APP_VERBS = [
  [/^(leer|consultar|buscar|ver|revisar|listar|obtener|descargar)/, "leído"],
  [/^enviar/, "enviado"],
  [/^(preparar|crear|añadir|escribir)/, "creado"],
  [/^(cambiar|actualizar|editar|mover)/, "cambiado"],
  [/^borrar/, "borrado"],
  [/^mover dinero/, "movido dinero en"],
];

/**
 * One tool call as { verb, thing(count, calls), key?, once?, weight? }: calls with the same verb
 * and key add up; `once` counts the same document once; `weight` (5 mails read) adds more than
 * one. Null when it is not work for you.
 */
function classify(t) {
  const c = t.card || {};
  if (PLUMBING.has(t.name) || HIDDEN.has(c.type)) return null;
  switch (c.type) {
    case "web": return { verb: "leído", thing: units("una página web", "páginas web") };
    case "websearch":
      if (["open_page", "find", "find_in_page"].includes(c.action)) return { verb: "leído", thing: units("una página web", "páginas web") };
      return { verb: "buscado", thing: (k) => (k === 1 ? "en la web" : `${k} veces en la web`) };
    case "file": case "pdf_fields": return { verb: "leído", thing: units("un documento", "documentos"), once: c.name || c.path || null };
    case "folder": return { verb: "mirado", thing: units("una carpeta", "carpetas") };
    case "search": return { verb: "buscado", thing: () => (t.name === "recall" ? "en su memoria" : "en el historial") };
    case "deliverable": return { verb: "guardado", thing: (k, list) => (k === 1 && list[0]?.card?.title ? `«${list[0].card.title}»` : n(k, "un entregable", "entregables")) };
    case "bot": return { verb: "consultado", thing: (_k, list) => "a " + joinAnd([...new Set(list.map((x) => x.card?.botName || "otro bot"))]) };
    case "app": {
      const action = String(c.action || "").toLowerCase();
      const verb = APP_VERBS.find(([re]) => re.test(action))?.[1] || "usado";
      const things = APP_THINGS.find(([re]) => re.test(action))?.[1];
      const app = c.app || "una app";
      if (verb === "usado" || !things) return { verb: "usado", key: "app:" + app, thing: () => app, weight: 1 };
      // A read counts what it brought back (5 mails), and says so when there was nothing.
      const weight = verb === "leído" && Number.isFinite(c.count) ? c.count : 1;
      return { verb, key: verb + ":" + things[1], thing: (k) => (k === 0 ? `${things[1]}, pero no había ninguno` : n(k, things[0], things[1])), weight };
    }
    case "command": return { verb: "ejecutado", thing: (k, list) => (k === 1 && list[0]?.card?.program ? list[0].card.program : n(k, "un comando", "comandos")) };
    case "browser": return { verb: "navegado", thing: (_k, list) => { const d = [...new Set(list.map((x) => x.card?.domain).filter(Boolean))]; return d.length === 1 ? "por " + d[0] : d.length ? `por ${d.length} webs` : "por la web"; } };
    case "desktop": return { verb: "usado", key: "desktop", thing: (_k, list) => { const apps = [...new Set(list.map((x) => x.card?.app || x.card?.title).filter(Boolean))]; return apps.length === 1 ? apps[0] : "el ordenador"; } };
    case "image": return { verb: "creado", thing: units("una imagen", "imágenes") };
    case "fill_pdf": return { verb: "rellenado", thing: units("un PDF", "PDF") };
    case "memory": return { verb: "guardado", thing: units("un recuerdo", "recuerdos") };
    case "project": {
      if (c.step === "write") return { verb: "escrito", thing: units("un archivo", "archivos"), once: c.path || null };
      if (c.step === "edit") return { verb: "editado", thing: units("un archivo", "archivos"), once: c.path || null };
      if (c.step === "delete") return { verb: "movido a la papelera", thing: units("un archivo", "archivos") };
      if (c.step === "create") return { verb: "creado", thing: () => "el proyecto " + (c.project || "nuevo") };
      if (c.step === "preview") return { verb: "probado", thing: () => c.project || "el proyecto" };
      if (["start", "stop", "status", "logs"].includes(c.step)) return { verb: "arrancado", thing: () => "el servidor de " + (c.project || "el proyecto") };
      return { verb: "mirado", thing: () => "los archivos de " + (c.project || "el proyecto") };
    }
    default: return { verb: "dado", key: "other", thing: units("un paso más", "pasos más") };
  }
}

const joinAnd = (parts) => (parts.length <= 1 ? parts[0] || "" : parts.slice(0, -1).join(", ") + " y " + parts.at(-1));

/**
 * The finished work of `tools` (steps[].tools) as one sentence, or null when there is none.
 * { text: «Ha leído 5 correos y editado 2 archivos», steps: how many calls, failed: how many
 * did not work }. Calls that are still running or wait for you are left out.
 */
export function workSummary(tools = []) {
  const groups = new Map(); // verb → Map(key → { thing, count, list })
  let steps = 0;
  let failed = 0;
  for (const t of tools) {
    if (t.status === "error") { if (classify(t)) failed++; continue; }
    if (t.status !== "done" && t.status !== "uncertain") continue;
    const k = classify(t);
    if (!k) continue;
    steps++;
    const key = k.key || k.verb + ":" + (t.card?.type || "");
    if (!groups.has(k.verb)) groups.set(k.verb, new Map());
    const byThing = groups.get(k.verb);
    const g = byThing.get(key) || { thing: k.thing, count: 0, list: [], seen: new Set() };
    // The same document read page by page, or a file edited twice, counts once.
    if (!k.once || !g.seen.has(k.once)) g.count += k.weight ?? 1;
    if (k.once) g.seen.add(k.once);
    g.list.push(t);
    byThing.set(key, g);
  }
  if (!steps && !failed) return null;
  const clauses = [...groups].map(([verb, byThing]) => `${verb} ${joinAnd([...byThing.values()].map((g) => g.thing(g.count, g.list)))}`);
  let text = clauses.length ? "Ha " + joinAnd(clauses) : "";
  if (failed) text += (text ? " · " : "") + (failed === 1 ? "un paso no salió" : `${failed} pasos no salieron`);
  return { text: text.charAt(0).toUpperCase() + text.slice(1), steps, failed };
}

/** The steps you can unfold: the calls that are work for you, in order. */
export function workSteps(tools = []) {
  return tools.filter((t) => classify(t) !== null);
}
