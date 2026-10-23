import { Bell, Bot, ChartColumn, Info, Lock, Plug, Sparkles, Stethoscope, UserRound } from "lucide-react";

// Ajustes by what you want to do (design/V2AjustesSecciones.dc.html), not by how Colmena is
// built inside. Each section has an address (/ajustes/<id>) and each setting an anchor
// (/ajustes/<id>#<anchor>), so any screen can link straight to one setting and the search
// box and the Ctrl+K palette find it by its name or by the words people use for it.
export const SECTIONS = [
  {
    id: "cuenta", label: "Tu cuenta", icon: UserRound,
    lead: "Tu nombre, tu espacio y las personas que trabajan en él.",
    items: [
      ["tu-nombre", "Tu nombre", "usuario perfil firma"],
      ["tu-rol", "Tu rol", "cargo puesto administrador"],
      ["nombre-espacio", "Nombre del espacio", "equipo empresa departamento"],
      ["personas", "Personas del espacio", "miembros compañeros invitar equipo"],
    ],
  },
  {
    id: "inteligencia", label: "Inteligencia", icon: Sparkles,
    lead: "Con qué IA piensan tus bots, qué modelo usan y quién les cubre si una falla.",
    items: [
      ["chatgpt", "Tu cuenta de ChatGPT", "openai iniciar sesión gpt plan"],
      ["claude", "Claude", "anthropic claude code token suscripción clave"],
      ["opencode", "OpenCode Go", "opencode clave"],
      ["piensan-con", "Piensan con", "proveedor principal motor cerebro ia"],
      ["respaldo", "Si falla, usar", "respaldo fallback alternativa límite"],
      ["modelo", "Modelo que usan", "modelo gpt versión"],
      ["por-bot", "Qué usa cada bot", "modelo por bot familias astra sol luna", "/ajustes/ia"],
      ["avanzado", "Clave de OpenAI y modelo de este ordenador", "api key local ollama lm studio", "/ajustes/ia-v1"],
    ],
  },
  {
    id: "autonomia", label: "Bots y autonomía", icon: Bot,
    lead: "Qué hacen solos, qué te preguntan siempre y cómo aprenden.",
    items: [
      ["lineas-rojas", "Siempre te preguntan antes de…", "líneas rojas enviar dinero borrar instalar permiso"],
      ["revisor", "Revisor automático", "aprobar solo rutinario permisos revisión"],
      ["aprenden", "Aprenden de su trabajo", "habilidades recuerdos aprendizaje"],
      ["narracion", "Te cuentan en qué están", "narración qué está haciendo progreso"],
      ["sugerencias", "Respuestas sugeridas", "sugerencias botones respuesta rápida"],
      ["resumenes", "Resúmenes de sala", "recaps resumen al volver"],
      ["revision-atlas", "Revisión de Atlas", "checkin revisar periódica atlas"],
      ["pausa", "Pausar a todo el equipo", "parar detener todos pausa"],
      ["permisos", "Permisos que diste para siempre", "grants retirar revocar siempre"],
      ["capacidades", "Qué más puede hacer cada bot", "herramientas ficha bot", "/colmena"],
    ],
  },
  {
    id: "apps", label: "Apps y conexiones", icon: Plug,
    lead: "Las apps, carpetas y webs con las que trabajan tus bots.",
    items: [
      ["apps-conectadas", "Apps conectadas", "gmail correo calendario drive slack notion conectar mcp composio"],
      ["que-app", "Qué app usa cada bot", "permisos lee escribe acceso matriz", "/ajustes/permisos"],
      ["carpetas", "Carpetas de este ordenador", "archivos carpeta disco documentos ordenador"],
      ["navegador", "Navegador propio para cada bot", "web chrome navegar"],
    ],
  },
  {
    id: "avisos", label: "Avisos", icon: Bell,
    lead: "Cuándo te avisan, de qué y cómo suena.",
    items: [
      ["te-avisa", "Te avisa de lo importante", "vigilar correo novedades resumen mirar"],
      ["como-avisa", "Cómo te avisa", "sonido notificación windows silencio"],
      ["horario", "Horario tranquilo", "no molestar noche fin de semana silencio"],
      ["avisame-de", "Avísame de", "nivel todo importante notificaciones"],
    ],
  },
  {
    id: "privacidad", label: "Privacidad y seguridad", icon: Lock,
    lead: "Lo que recuerdan de ti, tus contraseñas y el registro de todo lo que hacen.",
    items: [
      ["privado", "Lo que hablas en privado con un bot", "privacidad privado"],
      ["recuerdos", "Qué recuerda cada bot de ti", "memoria recuerdos datos personales"],
      ["olvidar", "Hacer que los bots lo olviden todo", "borrar recuerdos olvidar memoria"],
      ["boveda", "Contraseñas de webs", "bóveda vault contraseña login usuario"],
      ["claves", "Claves de API", "api key token secretos"],
      ["registro", "Registro de acciones", "historial auditoría log aprobaciones", "/ajustes/seguridad"],
    ],
  },
  {
    id: "uso", label: "Uso", icon: ChartColumn,
    lead: "Lo que gasta cada bot y cada chat, cuánto ahorra la caché y los límites de tu plan.",
    items: [
      ["este-mes", "Este mes", "tokens gasto consumo"],
      ["limites-plan", "Límites de tu plan", "chatgpt claude opencode 5 horas semanal renueva"],
      ["cache", "Aprovechamiento de la caché", "caché cached ahorro rápido"],
      ["por-bot-uso", "Por bot", "quién gasta más bot"],
      ["por-chat", "Por chat y sala", "conversación sala gasto"],
      ["limite-mensual", "Límite al mes", "tope presupuesto máximo"],
      ["pausar-limite", "Pausar al llegar al límite", "parar tope"],
      ["aviso-80", "Avisarme al 80 %", "aviso límite"],
      ["csv", "Descargar el uso en CSV", "exportar excel hoja"],
    ],
  },
  {
    id: "diagnostico", label: "Diagnóstico", icon: Stethoscope,
    lead: "Comprueba con un clic que todo funciona y te dice cómo arreglar lo que no.",
    items: [
      ["comprobar", "Comprobar ahora", "doctor salud problema error lento falla"],
      ["diag-ia", "Cuentas de IA", "estado conectada límite"],
      ["diag-codigo", "Motores de código", "claude code codex opencode instalado"],
      ["diag-datos", "Base de datos y disco", "sqlite integridad espacio disco wal"],
      ["diag-servidor", "Bloqueos del servidor", "lento parado congelado"],
      ["diag-apps", "Conexiones de apps", "gmail slack reconectar"],
      ["diag-actualizaciones", "Actualizaciones", "versión nueva"],
    ],
  },
  {
    id: "acerca", label: "Acerca de", icon: Info,
    lead: "Tu versión de Colmena, sus actualizaciones y los atajos de teclado.",
    items: [
      ["version", "Versión de Colmena", "versión"],
      ["actualizaciones", "Buscar actualizaciones", "actualizar update nueva versión"],
      ["canal", "Canal de actualizaciones", "beta estable"],
      ["atajos", "Atajos de teclado", "ctrl k teclado shortcuts paleta"],
    ],
  },
];

export const SECTION_OF = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));
export const DEFAULT_SECTION = "cuenta";

// Detail pages (one click below a section) and old addresses: which section they belong to.
export const PARENT = { ia: "inteligencia", "ia-v1": "inteligencia", permisos: "apps", conexiones: "apps", conectores: "apps", ordenador: "apps", personas: "cuenta", seguridad: "privacidad" };
// Old section addresses whose content now lives in a section.
export const ALIAS = { limites: "uso", espacio: "cuenta" };

/** Every setting as one searchable entry: {key, section, label, words, href}. */
export const SETTINGS_INDEX = SECTIONS.flatMap((s) => [
  { key: s.id, section: s.id, label: s.label, words: s.lead, href: "/ajustes/" + s.id, isSection: true },
  ...s.items.map(([anchor, label, words = "", to = null]) => ({ key: s.id + "#" + anchor, section: s.id, label, words, href: to || `/ajustes/${s.id}#${anchor}`, anchor })),
]);

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
