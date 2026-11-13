import { Bell, ChartColumn, CircleHelp, Lock, Plug, Settings2, ShieldCheck, Sparkles, SquareTerminal, AddressBook } from "../../Icon.js";

// Ajustes by what you want to do (Colmena 3, design/V3Ajustes.dc.html): eight sections and a
// search box, plus «Avanzado» only in expert mode. Each section has an address (/ajustes/<id>)
// and each setting an anchor (/ajustes/<id>#<anchor>), so any screen can link straight to one
// setting and the search box and the Ctrl+K palette find it by its name or by the words people
// use for it. Old section addresses (cuenta, inteligencia, autonomia, diagnostico, acerca…) are
// aliases of the new ones, so every link written before still lands on its setting.

/** Each section's icon (Phosphor, src/components/Icon.js), drawn at 17 px by the section list. */
export const SECTION_ICONS = { general: Settings2, ia: Sparkles, permisos: ShieldCheck, apps: Plug, avisos: Bell, privacidad: Lock, uso: ChartColumn, ayuda: CircleHelp, avanzado: SquareTerminal, contactos: AddressBook };

export const SECTIONS = [
  {
    id: "general", label: "General", icon: SECTION_ICONS.general,
    lead: "Tu nombre, tu espacio y cuánto detalle quieres ver.",
    items: [
      ["tu-nombre", "Tu nombre", "usuario perfil firma"],
      ["tu-rol", "Tu rol", "cargo puesto administrador"],
      ["nombre-espacio", "Nombre del espacio", "equipo empresa departamento"],
      ["tema", "Tema", "tema oscuro claro modo noche apariencia colores sistema"],
      ["modo-experto", "Modo experto", "experto avanzado herramientas tokens registros detalle técnico"],
      ["narracion", "Te cuentan en qué están", "narración qué está haciendo progreso"],
      ["sugerencias", "Respuestas sugeridas", "sugerencias botones respuesta rápida"],
      ["quien-responde", "Elegir solo quién responde en las salas", "enrutador quién responde sala atlas reparte mención"],
      ["quien-usa", "Quién usa este ordenador", "personas del espacio miembros firmar aprobar asignar rol"],
      ["personas", "Contactos y equipos", "personas contactos compañeros invitar equipo conectar"],
      ["atajos", "Atajos de teclado", "ctrl k teclado shortcuts paleta"],
    ],
  },
  {
    id: "ia", label: "Cuentas de IA", icon: SECTION_ICONS.ia,
    lead: "Con qué IA piensan tus bots, cuánto piensan y quién les cubre si una falla.",
    items: [
      ["chatgpt", "Tu cuenta de ChatGPT", "openai iniciar sesión gpt plan"],
      ["claude", "Claude", "anthropic claude code token suscripción setup-token clave"],
      ["opencode", "OpenCode Go", "opencode clave"],
      ["piensan-con", "Piensan con", "proveedor principal motor cerebro ia"],
      ["respaldo", "Si falla o llega al límite, usar", "respaldo fallback alternativa límite traspaso"],
      ["cuanto-piensan", "Cuánto piensan", "razonamiento esfuerzo rápido equilibrado a fondo profundo"],
      ["modelo", "Modelo que usan", "modelo gpt versión"],
      ["por-bot", "Qué usa cada bot", "modelo por bot cuenta piensa"],
    ],
  },
  {
    id: "permisos", label: "Permisos y autonomía", icon: SECTION_ICONS.permisos,
    lead: "Qué hacen solos tus bots, qué te preguntan siempre y qué pueden tocar.",
    items: [
      ["lineas-rojas", "Siempre te preguntan antes de…", "líneas rojas enviar dinero pagar publicar borrar instalar permiso"],
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
    id: "apps", label: "Apps y carpetas", icon: SECTION_ICONS.apps,
    lead: "Las apps, carpetas y webs con las que trabajan tus bots.",
    items: [
      ["apps-conectadas", "Apps conectadas", "gmail correo calendario drive slack notion composio"],
      ["conectar-app", "Conectar otra app", "añadir app catálogo buscar conectar"],
      ["carpetas", "Carpetas de este ordenador", "archivos carpeta disco documentos ordenador"],
      ["navegador", "Navegador propio para cada bot", "web chrome navegar"],
    ],
  },
  {
    id: "avisos", label: "Avisos", icon: SECTION_ICONS.avisos,
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
    id: "privacidad", label: "Privacidad y datos", icon: SECTION_ICONS.privacidad,
    lead: "Lo que recuerdan de ti, tus copias de seguridad, el cifrado y tus contraseñas.",
    items: [
      ["privado", "Dónde viven tus datos", "privacidad privado incógnito"],
      ["aprenden", "Aprenden de lo que hablas", "habilidades recuerdos aprendizaje aprender"],
      ["recuerdos", "Qué recuerda cada bot de ti", "memoria recuerdos datos personales"],
      ["perfil-historial", "Tu perfil y sus versiones", "user.md perfil historial versiones restaurar deshacer lo que saben de ti"],
      ["boveda", "Contraseñas de webs", "bóveda vault contraseña login usuario"],
      ["dictado", "Dictado por voz", "micrófono voz hablar dictar transcribir reconocimiento idioma español whisper"],
      ["registro", "Registro de acciones", "historial auditoría log aprobaciones", "/ajustes/seguridad"],
      ["olvidar", "Hacer que lo olviden todo", "borrar recuerdos olvidar memoria"],
      // Backups (Backup.jsx), after the rest so «contraseña» still finds the vault first.
      ["copias", "Copias de seguridad", "copia seguridad backup guardar exportar cifrada"],
      ["copia-contrasena", "Contraseña de las copias", "copia cifrado"],
      ["copia-donde", "Dónde se guardan las copias", "onedrive google drive nube carpeta disco"],
      ["copia-automatica", "Copias automáticas", "cada día semana programar automática conservar"],
      ["copia-ahora", "Hacer una copia ahora", "copia ahora backup manual exportar"],
      ["copia-restaurar", "Restaurar una copia", "restaurar recuperar ordenador nuevo migrar historial importar"],
      ["copia-que-protege", "Qué protege cada copia", "seguridad cifrado protege datos privacidad"],
      ["cifrado", "Cifrado de este ordenador", "cifrar base datos local disco carpeta proteger robo portátil"],
      ["cifrado-estado", "Cifrar la base de datos", "cifrar ahora encriptar aes clave dpapi llavero"],
      ["cifrado-que-protege", "Qué protege el cifrado y qué no", "efs bitlocker filevault archivos workspaces clave perdida"],
    ],
  },
  {
    id: "uso", label: "Uso y límites", icon: SECTION_ICONS.uso,
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
    id: "ayuda", label: "Ayuda y diagnóstico", icon: SECTION_ICONS.ayuda,
    lead: "Comprueba con un clic que todo funciona y te dice cómo arreglar lo que no.",
    items: [
      ["comprobar", "Comprueba que todo funciona", "diagnóstico doctor salud problema error lento falla comprobar"],
      ["diag-ia", "Cuentas de IA", "estado conectada límite"],
      ["diag-codigo", "Motores de código", "claude code codex opencode instalado"],
      ["diag-datos", "Base de datos y disco", "sqlite integridad espacio disco wal"],
      ["diag-servidor", "Servicio local", "lento parado congelado bloqueos servidor"],
      ["diag-apps", "Conexiones de apps", "gmail slack reconectar"],
      ["diag-actualizaciones", "Actualizaciones", "versión nueva"],
      ["version", "Versión de Colmena", "versión acerca de"],
      ["actualizaciones", "Buscar actualizaciones", "actualizar update nueva versión"],
      ["canal", "Canal de actualizaciones", "beta estable"],
      ["comentarios", "Enviar comentarios", "informe copiar ayuda soporte"],
    ],
  },
  {
    id: "avanzado", label: "Avanzado", icon: SECTION_ICONS.avanzado, expert: true, tag: "EXPERTO",
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
  // People now live in Equipo › Personas; until that screen lists them, /ajustes/contactos keeps
  // the editor. It is not in the list of sections, but the search and old links still reach it.
  {
    id: "contactos", label: "Contactos y equipos", icon: SECTION_ICONS.contactos, hidden: true,
    lead: "Con quién hablas desde Colmena, qué puede pedirte cada uno y por dónde os llegan los mensajes.",
    items: [
      ["tu-identidad", "Tú en otras Colmenas", "nombre identidad"],
      ["tu-estado", "Tu estado", "no molestar fuera vacaciones ausente disponible silencio hasta"],
      ["invitar", "Invitar a alguien", "invitación código compartir chatear persona amigo compañero"],
      ["contactos", "Personas conectadas", "contactos amigos hablar palabras de seguridad quitar"],
      ["encargos", "Encargos de otras personas", "encargos bots herramientas pedir otra persona aprobar incógnito"],
      ["buzon", "Cómo os llegan los mensajes", "buzón relé relay servidor cifrado conexión"],
      ["como-funciona", "Cómo funcionan los equipos y las salas", "ayuda guía explicación equipo sala de quién es cada bot qué ven los demás quién aprueba ordenador apagado invitar código palabras grupos bots menciones hilos responder editar borrar buscar encargos pedir otro bot archivos adjuntar compartir pdf word excel código compartir tarea plan pr estado no molestar fuera reuniones calendario buzón quitar", "/personas/como-funciona"],
    ],
  },
];

export const SECTION_OF = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));
export const DEFAULT_SECTION = "general";

// Detail pages (one click below a section): which section they belong to.
export const PARENT = { ordenador: "apps", "quien-usa": "general", seguridad: "privacidad" };
// «Personas» means the people you talk to from Colmena (Equipo). The page that lists who signs
// on this computer was called so too: its old address still opens it.
export const DETAIL_ALIAS = { personas: "quien-usa" };
// Old section addresses (Colmena 2 and before) whose content now lives in a section.
export const ALIAS = {
  cuenta: "general", espacio: "general", inteligencia: "ia", autonomia: "permisos",
  conexiones: "apps", conectores: "apps", limites: "uso", diagnostico: "ayuda", acerca: "ayuda",
};
/** The section an address shows: /ajustes/<raw> → a section id (or null). */
export const sectionId = (raw) => (raw ? ALIAS[raw] || raw : DEFAULT_SECTION);

/** Every setting as one searchable entry: {key, section, label, words, href, expert}. */
export const SETTINGS_INDEX = SECTIONS.flatMap((s) => [
  { key: s.id, section: s.id, label: s.label, words: s.lead, href: "/ajustes/" + s.id, isSection: true, expert: !!s.expert },
  ...s.items.map(([anchor, label, words = "", to = null]) => ({ key: s.id + "#" + anchor, section: s.id, label, words, href: to || `/ajustes/${s.id}#${anchor}`, anchor, expert: !!s.expert })),
]);
/** The index without «Avanzado» when expert mode is off. */
export const settingsIndex = (expert) => (expert ? SETTINGS_INDEX : SETTINGS_INDEX.filter((i) => !i.expert));

/** The address of one setting: settingHref("avisos", "horario") → /ajustes/avisos#horario. */
export const settingHref = (section, anchor = null) => "/ajustes/" + section + (anchor ? "#" + anchor : "");

export const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * T3 Code's settings ranking: exact title 5 > title prefix 4 > title contains 3 > every word
 * in the title 2 > the words people use for it 1. Sections win a tie over their settings.
 */
export function searchSettings(query, index = SETTINGS_INDEX, limit = 12) {
  const q = fold(query);
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const item of index) {
    const title = fold(item.label);
    const rest = fold(item.words + " " + (SECTION_OF[item.section]?.label || ""));
    let score = 0;
    if (title === q) score = 5;
    else if (title.startsWith(q)) score = 4;
    else if (title.includes(q)) score = 3;
    else if (words.every((w) => title.includes(w))) score = 2;
    else if (words.every((w) => title.includes(w) || rest.includes(w))) score = 1;
    if (score) scored.push({ item, score: score + (item.isSection ? 0.5 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.item);
}
