import { AddressBook, Archive, ArrowsClockwise, Bell, ChartColumn, Laptop, Lock, Plug, ShieldCheck, Sparkles, SquareTerminal, Stethoscope, UserRound } from "../../Icon.js";

// Ajustes by what people think about (Colmena 4): thirteen sections in six groups — «Tú», «Tu
// equipo y tus contactos», «Inteligencia y apps», «Privacidad y seguridad», «Este ordenador» and
// «Avanzado» — and a search box that finds any setting by its words or the words people use for
// it. Each section has an address (/ajustes/<id>) and each setting an anchor
// (/ajustes/<id>#<anchor>), so any screen can link straight to one setting and the Ctrl+K palette
// finds it. Old section addresses are aliases, and an anchor that moved to another section is
// followed there (`homeOf`), so every link written before still lands on its setting.

/** Each section's icon (Phosphor, src/components/Icon.js), drawn at 17 px by the section list. */
export const SECTION_ICONS = {
  general: UserRound, avisos: Bell, contactos: AddressBook, permisos: ShieldCheck, ia: Sparkles, apps: Plug, uso: ChartColumn,
  privacidad: Lock, copias: Archive, sistema: Laptop, actualizaciones: ArrowsClockwise, ayuda: Stethoscope, avanzado: SquareTerminal,
};

export const SECTIONS = [
  {
    id: "general", group: "tu", label: "Perfil y apariencia", icon: SECTION_ICONS.general,
    lead: "Cómo te llamas, cómo se ve Colmena y cuánto detalle técnico quieres ver.",
    items: [
      ["tu-nombre", "Tu nombre", "usuario perfil firma cómo me llaman"],
      ["tu-rol", "Tu rol", "cargo puesto administrador trabajo"],
      ["nombre-espacio", "Nombre del espacio", "equipo empresa departamento organización"],
      ["tema", "Tema", "tema oscuro claro modo noche apariencia colores sistema"],
      ["modo-experto", "Modo experto", "experto avanzado herramientas tokens registros detalle técnico desarrollador"],
      ["narracion", "Te cuentan en qué están", "narración qué está haciendo progreso"],
      ["sugerencias", "Respuestas sugeridas", "sugerencias botones respuesta rápida"],
      ["quien-responde", "Elegir solo quién responde en las salas", "enrutador quién responde sala atlas reparte mención"],
      ["atajos", "Atajos de teclado", "ctrl k teclado shortcuts paleta combinaciones"],
    ],
  },
  {
    id: "avisos", group: "tu", label: "Avisos", icon: SECTION_ICONS.avisos,
    lead: "Cuándo te avisan, de qué y cómo suena.",
    items: [
      ["avisame-de", "Avísame de", "nivel todo importante notificaciones"],
      ["como-avisa", "Notificaciones del sistema", "sonido notificación windows silencio aviso"],
      ["sonido-avisos", "Cómo suenan", "sonido escuchar zumbido"],
      ["horario", "Horario tranquilo", "no molestar noche fin de semana silencio"],
      ["resumenes", "Resumen al volver a una sala", "recaps resumen al volver"],
      ["te-avisa", "Te avisa de lo importante", "vigilar correo novedades resumen mirar"],
      ["revision-atlas", "Revisión periódica", "checkin revisar periódica atlas coordinador"],
    ],
  },
  {
    id: "contactos", group: "equipo", label: "Contactos y equipos", icon: SECTION_ICONS.contactos,
    lead: "Con quién hablas desde Colmena, qué puede pedirte cada uno y por dónde os llegan los mensajes.",
    items: [
      ["tu-identidad", "Tú en otras Colmenas", "nombre identidad"],
      ["tu-estado", "Tu estado", "no molestar fuera vacaciones ausente disponible silencio hasta"],
      ["invitar", "Invitar a alguien que aún no está", "invitar invitación código compartir chatear persona amigo compañero"],
      ["contactos", "Personas conectadas", "contactos amigos hablar palabras de seguridad quitar"],
      ["encargos", "Encargos de otras personas", "encargos bots herramientas pedir otra persona aprobar incógnito"],
      ["buzon", "Cómo os llegan los mensajes", "buzón relé relay servidor cifrado conexión"],
      ["quien-usa", "Quién usa este ordenador", "personas del espacio miembros firmar aprobar asignar rol"],
      ["como-funciona", "Cómo funcionan los equipos y las salas", "ayuda guía explicación equipo sala de quién es cada bot qué ven los demás quién aprueba ordenador apagado invitar código palabras grupos bots menciones hilos responder editar borrar buscar encargos pedir otro bot archivos adjuntar compartir pdf word excel código compartir tarea plan pr estado no molestar fuera reuniones calendario buzón quitar", "/personas/como-funciona"],
    ],
  },
  {
    id: "permisos", group: "equipo", label: "Autonomía y permisos", icon: SECTION_ICONS.permisos,
    lead: "Qué hacen solos tus bots, qué te preguntan siempre y qué pueden tocar.",
    items: [
      ["lineas-rojas", "Siempre te preguntan antes de…", "líneas rojas enviar dinero pagar comprar suscribir reservar publicar borrar instalar permiso"],
      ["pausa", "Pausar a todo el equipo", "parar detener todos pausa"],
      ["autonomia-bot", "Cuánto hace solo cada bot", "autonomía sugiere avisa solo"],
      ["que-app", "Qué app usa cada bot", "permisos lee escribe acceso matriz"],
      ["permisos", "Permisos que diste para siempre", "grants retirar revocar siempre"],
      ["revisor", "Revisor automático", "aprobar solo rutinario permisos revisión"],
      ["esperar-respuesta", "Cuánto espera un bot tu respuesta", "pregunta esperar minutos respuesta prudente"],
      ["sin-supervision", "Rutinas sin supervisión", "rutinas disparadores ausente líneas rojas pendientes bandeja"],
      ["codigo-archivar", "Tareas de Código: archivar las terminadas", "archivar código tareas inactivas días pr posponer guardar main"],
      ["capacidades", "Qué más puede hacer cada bot", "herramientas ficha bot", "/equipo"],
    ],
  },
  {
    id: "ia", group: "ia", label: "Cuentas de IA", icon: SECTION_ICONS.ia,
    lead: "Con qué IA piensan tus bots, cuánto piensan y quién les cubre si una falla.",
    items: [
      ["chatgpt", "Tu cuenta de ChatGPT", "openai iniciar sesión gpt plan"],
      ["claude", "Claude", "anthropic claude code token suscripción setup-token clave"],
      ["opencode", "OpenCode Go", "opencode clave"],
      ["otra-ia", "Conectar otra IA", "gemini google openrouter deepseek kimi moonshot servidor propio ollama lm studio vllm clave api"],
      ["piensan-con", "Piensan con", "proveedor principal motor cerebro ia"],
      ["respaldo", "Si falla o llega al límite, usar", "respaldo fallback alternativa límite traspaso"],
      ["cuanto-piensan", "Cuánto piensan", "razonamiento esfuerzo rápido equilibrado a fondo profundo"],
      ["modelo", "Modelo que usan", "modelo gpt versión"],
      ["por-bot", "Qué usa cada bot", "modelo por bot cuenta piensa"],
    ],
  },
  {
    id: "apps", group: "ia", label: "Apps y carpetas", icon: SECTION_ICONS.apps,
    lead: "Las apps y carpetas con las que trabajan tus bots.",
    items: [
      ["apps-conectadas", "Apps conectadas", "gmail correo calendario drive slack notion composio conexiones"],
      ["conectar-app", "Conectar otra app", "añadir app catálogo buscar conectar"],
      ["carpetas", "Carpetas de este ordenador", "archivos carpeta disco documentos ordenador"],
    ],
  },
  {
    id: "uso", group: "ia", label: "Uso y límites", icon: SECTION_ICONS.uso,
    lead: "Lo que gasta cada bot y cada chat, y hasta dónde dejas que lleguen.",
    items: [
      ["este-mes", "Este mes", "tokens gasto consumo páginas"],
      ["limites-plan", "Límites de tus planes", "chatgpt claude opencode 5 horas semanal renueva"],
      ["cache", "Caché aprovechada", "caché cached ahorro rápido"],
      ["por-bot-uso", "Por bot", "quién gasta más bot"],
      ["por-chat", "Lo que más ha gastado", "conversación sala chat gasto"],
      ["limite-mensual", "Límite al mes", "tope presupuesto máximo"],
      ["pausar-limite", "Pausar al llegar al límite", "parar tope"],
      ["aviso-80", "Avisarme al 80 %", "aviso límite"],
      ["pausa-plan", "Guardar el final del plan para chatear", "plan chatgpt queda poco pausa rutinas trabajo largo 95"],
      ["csv", "Descargar el uso en CSV", "exportar excel hoja"],
    ],
  },
  {
    id: "privacidad", group: "privacidad", label: "Memoria y privacidad", icon: SECTION_ICONS.privacidad,
    lead: "Qué sale de este ordenador, qué recuerdan tus bots de ti y tus contraseñas de webs.",
    items: [
      ["privado", "Dónde viven tus datos", "privacidad privado incógnito"],
      ["aprenden", "Aprenden de lo que hablas", "habilidades recuerdos aprendizaje aprender"],
      ["recuerdos", "Qué recuerda cada bot de ti", "memoria recuerdos datos personales"],
      ["perfil-historial", "Tu perfil y sus versiones", "user.md perfil historial versiones restaurar deshacer lo que saben de ti"],
      ["boveda", "Contraseñas de webs", "bóveda vault contraseña login usuario"],
      ["gestores", "Conectar un gestor de contraseñas", "1password bitwarden gestor de contraseñas llavero op bw iniciar sesión entrar sin verlas"],
      ["registro", "Registro de acciones", "historial auditoría log aprobaciones quién decidió", "/ajustes/seguridad"],
      ["olvidar", "Hacer que lo olviden todo", "borrar recuerdos olvidar memoria"],
    ],
  },
  {
    id: "copias", group: "privacidad", label: "Copias y cifrado", icon: SECTION_ICONS.copias,
    lead: "Una copia de todo lo tuyo, cerrada con tu contraseña, y tus datos cifrados en el disco.",
    items: [
      ["copias", "Copias de seguridad", "copia seguridad backup guardar exportar cifrada"],
      ["copia-ahora", "Hacer una copia ahora", "copia ahora backup manual exportar"],
      ["copia-automatica", "Copias automáticas", "cada día semana programar automática conservar"],
      ["copia-donde", "Dónde se guardan las copias", "onedrive google drive nube carpeta disco"],
      ["copia-contrasena", "Contraseña de las copias", "copia cifrado clave"],
      ["copia-restaurar", "Restaurar una copia", "restaurar recuperar ordenador nuevo migrar historial importar"],
      ["copia-que-protege", "Qué protege cada copia", "seguridad cifrado protege datos privacidad"],
      ["cifrado", "Cifrado de este ordenador", "cifrar base datos local disco carpeta proteger robo portátil"],
      ["cifrado-estado", "Cifrar la base de datos", "cifrar ahora encriptar aes clave dpapi llavero"],
      ["cifrado-que-protege", "Qué protege el cifrado y qué no", "efs bitlocker filevault archivos workspaces clave perdida"],
    ],
  },
  {
    id: "sistema", group: "ordenador", label: "Navegador y dictado", icon: SECTION_ICONS.sistema,
    lead: "El navegador propio de tus bots, sus sesiones y el dictado por voz de este ordenador.",
    items: [
      ["navegador", "Navegador propio para cada bot", "web chrome navegar navegador ventana"],
      ["sesiones", "Sesiones del navegador", "sesión perfil cookies iniciar sesión a mano trabajo personal cliente cerrar sesiones"],
      ["dictado", "Dictado por voz", "micrófono voz hablar dictar transcribir reconocimiento idioma español whisper"],
    ],
  },
  {
    // desktopOnly: the desktop app downloads and installs new versions; a browser has nothing to update.
    id: "actualizaciones", group: "ordenador", label: "Actualizaciones", icon: SECTION_ICONS.actualizaciones, desktopOnly: true,
    lead: "Qué versión de Colmena tienes y cómo llegan las nuevas.",
    items: [
      ["version", "Versión de Colmena", "versión acerca de"],
      ["actualizaciones", "Buscar actualizaciones", "actualizar update nueva versión reiniciar"],
      ["canal", "Canal de actualizaciones", "beta estable"],
    ],
  },
  {
    id: "ayuda", group: "avanzado", label: "Diagnóstico", icon: SECTION_ICONS.ayuda,
    lead: "Comprueba con un clic que todo funciona y te dice cómo arreglar lo que no.",
    items: [
      ["comprobar", "Comprueba que todo funciona", "diagnóstico doctor salud problema error lento falla comprobar ayuda"],
      ["diag-ia", "Estado de las cuentas de IA", "estado conectada límite"],
      ["diag-codigo", "Motores de código", "claude code codex opencode instalado"],
      ["diag-datos", "Base de datos y disco", "sqlite integridad espacio disco wal"],
      ["diag-servidor", "Servicio local", "lento parado congelado bloqueos servidor"],
      ["diag-apps", "Conexiones de apps", "gmail slack reconectar"],
      ["diag-actualizaciones", "Estado de las actualizaciones", "versión nueva"],
      ["comentarios", "Copiar el informe", "informe copiar ayuda soporte comentarios enviar"],
    ],
  },
  {
    id: "avanzado", group: "avanzado", label: "Servidores y claves", icon: SECTION_ICONS.avanzado, expert: true, tag: "EXPERTO",
    lead: "Para quien quiere tocar las tripas: servidores MCP, claves, modelos locales y datos.",
    items: [
      ["mcp", "Servidores MCP", "mcp servidor herramientas propia url"],
      ["modelo-local", "Modelo en este ordenador", "local ollama lm studio openai compatible"],
      ["clave-openai", "Clave de API de OpenAI", "api key openai clave"],
      ["claves", "Claves de API de tus bots", "api key token secretos"],
      ["familias", "Modelos por familia", "astra sol luna fijar modelo claude opencode"],
      ["carpeta-datos", "Carpeta de datos", "datos carpeta disco localappdata"],
      ["servicio-local", "Servicio local", "puerto servidor localhost 127.0.0.1"],
    ],
  },
];

/**
 * The groups of the section list, in order, each with why it holds what it holds:
 *  · Tú — what is about you: your name, how Colmena looks and how it reaches you.
 *  · Tu equipo y tus contactos — the people you work with and how much your bots may do.
 *  · Inteligencia y apps — what your bots think with and work with, and what it costs.
 *  · Privacidad y seguridad — what is kept, what is remembered, and how it is protected.
 *  · Este ordenador — what belongs to this machine: its browser, its voice, its version.
 *  · Avanzado — when something fails, and the expert's own tools.
 */
export const GROUPS = [
  { id: "tu", label: "Tú" },
  { id: "equipo", label: "Tu equipo y tus contactos" },
  { id: "ia", label: "Inteligencia y apps" },
  { id: "privacidad", label: "Privacidad y seguridad" },
  { id: "ordenador", label: "Este ordenador" },
  { id: "avanzado", label: "Avanzado" },
];

export const SECTION_OF = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));
export const DEFAULT_SECTION = "general";

/** The sections a person sees in the list, by group (Servidores y claves only in expert mode;
 *  Actualizaciones only in the desktop app: pass desktop false in a browser). */
export function groupedSections(expert = false, { desktop = true } = {}) {
  return GROUPS.map((g) => ({ ...g, sections: SECTIONS.filter((s) => s.group === g.id && (!s.expert || expert) && (!s.desktopOnly || desktop)) })).filter((g) => g.sections.length);
}

// Detail pages (one click below a section): which section they belong to.
export const PARENT = { ordenador: "apps", "quien-usa": "contactos", seguridad: "privacidad" };
// «Personas» means the people you talk to from Colmena (Equipo). The page that lists who signs
// on this computer was called so too: its old address still opens it.
export const DETAIL_ALIAS = { personas: "quien-usa" };
// Old section addresses whose content now lives in a section (Colmena 2 and 3, and the words
// people may type in the address).
export const ALIAS = {
  cuenta: "general", espacio: "general", perfil: "general", apariencia: "general",
  inteligencia: "ia", autonomia: "permisos", conexiones: "apps", conectores: "apps", limites: "uso",
  diagnostico: "ayuda", acerca: "actualizaciones", version: "actualizaciones",
  backup: "copias", cifrado: "copias", navegador: "sistema", dictado: "sistema", experto: "avanzado",
};
/** The section an address shows: /ajustes/<raw> → a section id (or the raw id when unknown). */
export const sectionId = (raw) => (raw ? ALIAS[raw] || raw : DEFAULT_SECTION);

/** Anchors that are gone, and the setting that took their place (general#personas was a link to Contactos). */
export const ANCHOR_ALIAS = { personas: "contactos#contactos" };
/** Where each anchor lives now: anchor → section id. */
export const ANCHOR_HOME = Object.fromEntries(SECTIONS.flatMap((s) => s.items.filter((i) => !i[3]).map(([anchor]) => [anchor, s.id])));
/**
 * The address an old link should land on, or null when it is already right: /ajustes/privacidad#copias
 * moved to /ajustes/copias#copias; /ajustes/ayuda#version to /ajustes/actualizaciones#version.
 */
export function homeOf(section, anchor) {
  if (anchor && ANCHOR_ALIAS[anchor] && !SECTION_OF[section]?.items.some((i) => i[0] === anchor)) return "/ajustes/" + ANCHOR_ALIAS[anchor];
  const home = anchor ? ANCHOR_HOME[anchor] : null;
  return home && home !== section ? `/ajustes/${home}#${anchor}` : null;
}

/** Every setting as one searchable entry: {key, section, label, words, href, expert}. */
export const SETTINGS_INDEX = SECTIONS.flatMap((s) => [
  { key: s.id, section: s.id, label: s.label, words: s.lead, href: "/ajustes/" + s.id, isSection: true, expert: !!s.expert },
  ...s.items.map(([anchor, label, words = "", to = null]) => ({ key: s.id + "#" + anchor, section: s.id, label, words, href: to || `/ajustes/${s.id}#${anchor}`, anchor, expert: !!s.expert })),
]);
/** The index without the expert section when expert mode is off. */
export const settingsIndex = (expert) => (expert ? SETTINGS_INDEX : SETTINGS_INDEX.filter((i) => !i.expert));

/** The address of one setting: settingHref("avisos", "horario") → /ajustes/avisos#horario. */
export const settingHref = (section, anchor = null) => "/ajustes/" + section + (anchor ? "#" + anchor : "");

export const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Words people type for a setting that its own words do not say (folded, without accents). Each
 * typed word also matches any of its synonyms: «notificaciones» finds Avisos, «backup» the copies.
 */
export const SYNONYMS = {
  notificaciones: ["avisos", "aviso"], notificacion: ["avisos", "aviso"], alertas: ["avisos", "aviso"], molestar: ["tranquilo", "silencio"],
  oscuro: ["tema"], noche: ["tema", "tranquilo"], claro: ["tema"], apariencia: ["tema"], colores: ["tema"],
  nombre: ["nombre", "identidad"], perfil: ["nombre", "perfil"], cuenta: ["cuenta", "nombre"],
  ia: ["ia", "chatgpt", "claude"], gpt: ["chatgpt"], openai: ["chatgpt", "openai"], anthropic: ["claude"], modelo: ["modelo", "piensan"],
  gasto: ["uso", "gasta"], coste: ["uso", "limite"], dinero: ["uso", "limite", "pagar"], tokens: ["uso", "tokens"], consumo: ["uso"],
  backup: ["copia", "copias"], respaldo: ["respaldo", "copia"], exportar: ["copia", "csv", "exportar"], restaurar: ["restaurar"],
  privacidad: ["privacidad", "datos"], seguridad: ["seguridad", "cifrado", "copias", "lineas rojas"], cifrar: ["cifrado", "cifrar"], encriptar: ["cifrado", "cifrar"],
  contrasenas: ["contrasenas", "contrasena"], password: ["contrasena"], clave: ["clave", "contrasena"],
  permisos: ["permisos", "lineas rojas", "autonomia"], aprobar: ["permisos", "revisor", "aprobar"], autonomia: ["autonomia", "solo"],
  apps: ["apps", "conectadas"], conectar: ["conectar", "conectada"], integraciones: ["apps", "mcp"], gmail: ["apps"], correo: ["apps", "correo"],
  voz: ["dictado", "voz"], microfono: ["dictado"], navegador: ["navegador"], chrome: ["navegador"],
  version: ["version", "actualizaciones"], actualizar: ["actualizaciones"], update: ["actualizaciones"],
  error: ["diagnostico", "comprobar"], falla: ["diagnostico", "comprobar"], problema: ["diagnostico", "comprobar"], ayuda: ["diagnostico", "comprobar", "como funcionan"],
  contactos: ["contactos", "personas"], personas: ["contactos", "personas", "quien usa"], invitar: ["invitar"], equipo: ["equipo", "contactos"],
  memoria: ["recuerda", "recuerdos", "memoria"], olvidar: ["olvid"], borrar: ["olvid", "borrar"],
};
const expand = (w) => [w, ...(SYNONYMS[w] || []).map(fold)];

/**
 * T3 Code's settings ranking: exact title 5 > title prefix 4 > title contains 3 > every word
 * in the title 2 > the words people use for it 1 > a synonym of them 0.75. Sections win a tie.
 */
export function searchSettings(query, index = SETTINGS_INDEX, limit = 12) {
  const q = fold(query);
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const item of index) {
    const title = fold(item.label);
    const rest = fold(item.words + " " + (SECTION_OF[item.section]?.label || ""));
    const has = (w) => expand(w).some((x) => title.includes(x) || rest.includes(x));
    let score = 0;
    if (title === q) score = 5;
    else if (title.startsWith(q)) score = 4;
    else if (title.includes(q)) score = 3;
    else if (words.every((w) => title.includes(w))) score = 2;
    else if (words.every((w) => title.includes(w) || rest.includes(w))) score = 1;
    else if (words.every(has)) score = 0.75;
    if (score) scored.push({ item, score: score + (item.isSection ? (score >= 1 ? 0.5 : 0.1) : 0) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.item);
}
