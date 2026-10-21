// Pure policy for computer use: who may do what without asking.
// 'free'     → runs now (and is announced when it changes something).
// 'approval' → waits in the Bandeja; «Permitir siempre» may create a scoped rule.
// 'redline'  → always waits in the Bandeja; never a permanent rule.
import path from "node:path";

export const BROWSER_TOOLS = ["browser_open", "browser_read", "browser_screenshot", "browser_act", "browser_fill", "browser_submit", "browser_download", "browser_sign_in"];
export const SYSTEM_TOOLS = ["open_file", "open_app", "run_command"];
export const COMPUTER_TOOL_NAMES = [...BROWSER_TOOLS, ...SYSTEM_TOOLS];
export const isComputerTool = (name) => COMPUTER_TOOL_NAMES.includes(name);

const AUTONOMIES = ["sugiere", "avisa", "solo"];
export const autonomyFor = (bot, override) =>
  AUTONOMIES.includes(override) ? override : AUTONOMIES.includes(bot?.autonomy) ? bot.autonomy : "avisa";

// ------------------------------------------------------------------ commands
const BASE_PROGRAM = (program) =>
  path.win32.basename(path.posix.basename(String(program || "").trim())).toLowerCase().replace(/\.(exe|com|cmd|bat|ps1)$/i, "");

/** Programs that install, delete, change the system or reach other machines: always a red line. */
const DANGEROUS_PROGRAMS = new Set([
  "winget", "choco", "chocolatey", "scoop", "msiexec", "del", "erase", "rmdir", "rd", "rm", "remove-item", "ri", "format",
  "reg", "regedit", "regedt32", "sc", "net", "net1", "netsh", "shutdown", "restart-computer", "stop-computer", "bcdedit",
  "diskpart", "takeown", "icacls", "cacls", "schtasks", "wmic", "cipher", "vssadmin", "sdelete", "mshta", "rundll32",
  "regsvr32", "certutil", "bitsadmin", "wscript", "cscript", "setx", "runas", "taskkill", "sfc", "dism", "fsutil",
  "mountvol", "wevtutil", "auditpol", "powercfg", "manage-bde", "wsl", "bash", "sh", "ssh", "scp", "sftp", "ftp",
  "telnet", "npx", "pnpx", "bunx", "msbuild", "installutil", "pnputil", "bitlocker", "move", "rename", "ren",
]);
const SHELLS = new Set(["cmd", "powershell", "pwsh", "powershell_ise"]);
const INLINE = {
  python: /^-(c|m)$/, python3: /^-(c|m)$/, py: /^-(c|m)$/, pythonw: /^-(c|m)$/,
  node: /^(-e|--eval|-p|--print|-r|--require|--import)$/, bun: /^(-e|--eval|-p|--print|x)$/, deno: /^(eval|run|-A)$/,
  ruby: /^-e$/, perl: /^-[eE]$/, php: /^-[rB]$/, rscript: /^-e$/, lua: /^-e$/, java: /^(-jar)$/, jshell: /./,
};
const PACKAGE_MANAGERS = {
  npm: /^(install|i|add|ci|uninstall|remove|rm|un|r|update|up|upgrade|exec|x|publish|link|rebuild)$/,
  pnpm: /^(install|i|add|remove|rm|uninstall|update|up|dlx|exec|publish|link)$/,
  yarn: /^(install|add|remove|upgrade|dlx|exec|publish|link)$/,
  pip: /^(install|uninstall|download)$/, pip3: /^(install|uninstall|download)$/, pipx: /./, uv: /^(pip|tool|add|remove|sync|run)$/,
  gem: /^(install|uninstall|update)$/, cargo: /^(install|uninstall|publish)$/, go: /^(install|get|run)$/,
  dotnet: /^(tool|add|remove|nuget|workload|run)$/, conda: /^(install|remove|uninstall|update|create)$/,
  composer: /^(install|require|remove|update|global|exec|run-script)$/, git: /^(push|clean|reset|rm|filter-branch|gc|prune|send-email|remote)$/,
  curl: null, wget: null,
};

/**
 * Classifies a command. Returns {redLine, reason}.
 * Red line: installs/removals, system changes, shells and interpreters with inline code, network senders.
 */
export function classifyCommand(program, args = []) {
  const name = BASE_PROGRAM(program);
  const list = (Array.isArray(args) ? args : []).map((a) => String(a));
  const lower = list.map((a) => a.toLowerCase());
  if (!name) return { redLine: true, reason: "Programa vacío." };
  if (/\.(bat|cmd|ps1|vbs|js|jse|wsf|hta)$/i.test(String(program))) return { redLine: true, reason: "Es un script: se ejecutaría con una consola." };
  if (DANGEROUS_PROGRAMS.has(name)) return { redLine: true, reason: "Instala, borra, cambia el sistema o conecta con otros equipos." };
  if (SHELLS.has(name)) return { redLine: true, reason: "Es una consola que puede ejecutar cualquier orden." };
  const inline = INLINE[name] || (/^python\d/.test(name) ? INLINE.python : null);
  if (inline && lower.some((a) => inline.test(a))) return { redLine: true, reason: "Ejecuta código escrito en la propia orden." };
  if (name in PACKAGE_MANAGERS) {
    if (name === "curl" || name === "wget") {
      if (lower.some((a) => /^(-o|-O|--output|--remote-name|-d|--data.*|-F|--form|-T|--upload-file|-X|--request|--post-data|--post-file)$/.test(a)))
        return { redLine: true, reason: "Descarga a disco o envía datos fuera." };
    } else {
      const sub = lower.find((a) => !a.startsWith("-")) || "";
      if (PACKAGE_MANAGERS[name].test(sub) || (name === "git" && lower.includes("--hard")))
        return { redLine: true, reason: name === "git" ? "Envía o borra cambios del repositorio." : "Instala o quita programas." };
    }
  }
  if ((name === "python" || name === "py" || /^python\d/.test(name)) && lower.includes("pip")) return { redLine: true, reason: "Instala o quita programas." };
  if (name === "robocopy" && lower.some((a) => /^\/(mir|purge|move|mov)$/.test(a))) return { redLine: true, reason: "Puede borrar archivos." };
  return { redLine: false, reason: null };
}

// --------------------------------------------------------------------- files
/** Never opened: programs, scripts, shortcuts, installers and macro documents. */
export const BLOCKED_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "com", "ps1", "psm1", "psd1", "ps1xml", "lnk", "msi", "msp", "mst", "vbs", "vbe", "js", "jse", "jar",
  "scr", "pif", "hta", "cpl", "msc", "reg", "inf", "wsf", "wsh", "ws", "scf", "url", "website", "application", "appref-ms",
  "gadget", "dll", "sys", "drv", "ocx", "appx", "msix", "appxbundle", "msixbundle", "xll", "xlam", "docm", "dotm", "xlsm",
  "xltm", "pptm", "potm", "ppam", "sldm", "iso", "img", "vhd", "vhdx", "settingcontent-ms", "search-ms", "library-ms", "chm",
  "sh", "py", "pyw", "rb", "pl", "php", "mjs", "cjs", "ts", "vb", "wsc", "sct", "diagcab", "mof", "job",
]);
export const DOCUMENT_EXTENSIONS = new Set([
  "pdf", "txt", "md", "csv", "tsv", "rtf", "doc", "docx", "odt", "xls", "xlsx", "ods", "ppt", "pptx", "odp", "pages", "numbers", "key",
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic", "svg", "ico", "mp3", "wav", "m4a", "ogg", "flac",
  "mp4", "mov", "avi", "mkv", "webm", "json", "xml", "yaml", "yml", "log", "html", "htm", "epub", "zip", "eml", "msg", "ics", "vcf",
]);

/** Returns null when the file may be opened, or the reason in Spanish. */
export function fileOpenProblem(file) {
  const base = path.win32.basename(String(file || ""));
  if (!base || base.includes("\0")) return "Archivo no válido.";
  // Trailing dots/spaces and alternate data streams can hide the real type on Windows.
  if (/[. ]$/.test(base) || base.includes(":")) return "Nombre de archivo no permitido.";
  const ext = base.includes(".") ? base.split(".").pop().toLowerCase() : "";
  if (BLOCKED_EXTENSIONS.has(ext)) return "No se abren programas, scripts, accesos directos ni documentos con macros (." + ext + ").";
  if (!DOCUMENT_EXTENSIONS.has(ext)) return ext ? "No abro archivos de tipo ." + ext + ": ábrelo tú si es de confianza." : "No abro archivos sin extensión.";
  return null;
}

// -------------------------------------------------------------------- policy
const ALWAYS_FREE_ACTS = ["desplazar", "esperar"];

/**
 * Policy table by autonomy ('sugiere' | 'avisa' | 'solo').
 * @returns {'free'|'approval'|'redline'}
 */
export function computerPolicy(name, args = {}, bot = null, { autonomy } = {}) {
  const level = autonomyFor(bot, autonomy);
  switch (name) {
    case "browser_open":
    case "browser_read":
    case "browser_screenshot":
      return "free";
    // Browsing the web never asks: only sending, buying, publishing or paying (browser_submit) does.
    case "browser_act":
    case "browser_fill":
    case "browser_download":
      return "free";
    case "open_file":
      return level === "sugiere" ? "approval" : "free";
    case "browser_submit":
      return "redline";
    // Signing in with a vault account: you approve it once per bot and account.
    case "browser_sign_in":
      return "approval";
    // Opening an app and running ordinary commands stays on your computer (Codex/OpenClaw
    // auto mode): free unless the bot only suggests. Deleting, installing, shells, inline
    // code and network senders are red lines (classifyCommand).
    case "open_app":
      return level === "sugiere" ? "approval" : "free";
    case "run_command":
      return classifyCommand(args.program, args.args).redLine ? "redline" : level === "sugiere" ? "approval" : "free";
    default:
      return "redline";
  }
}

/** True when a free action changes something and must be announced in the room. */
export function announces(name, args = {}) {
  if (["browser_open", "browser_read", "browser_screenshot"].includes(name)) return false;
  if (name === "browser_act" && ALWAYS_FREE_ACTS.includes(args.kind)) return false;
  return true;
}

// --------------------------------------------------------------------- verbs
export const COMPUTER_VERBS = {
  browser_open: "navegando",
  browser_read: "navegando",
  browser_screenshot: "navegando",
  browser_act: "navegando",
  browser_fill: "rellenando un formulario",
  browser_submit: "navegando",
  browser_download: "navegando",
  browser_sign_in: "iniciando sesión",
  open_app: "usando el ordenador",
  open_file: "usando el ordenador",
  run_command: "ejecutando una tarea",
};

export function verbForComputer(name, args = {}) {
  if (name === "browser_act" && args.kind === "escribir") return "rellenando un formulario";
  return COMPUTER_VERBS[name] || "usando el ordenador";
}

const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
};

/** Short detail for the live activity line («Nora está navegando · elpais.com»). */
export function computerActivityDetail(name, args = {}, { domain = "", appLabel = "" } = {}) {
  if (name === "browser_open") return hostOf(args.url);
  if (BROWSER_TOOLS.includes(name)) return domain || "";
  if (name === "open_file") return path.win32.basename(String(args.path || ""));
  if (name === "open_app") return appLabel || String(args.app || "");
  if (name === "run_command") return BASE_PROGRAM(args.program);
  return "";
}

const quoteArg = (a) => (/[\s"]/.test(a) ? '"' + String(a).replace(/"/g, '\\"') + '"' : String(a));
export const commandLine = (program, args = []) => [program, ...(args || [])].map((a) => quoteArg(String(a))).join(" ");

/**
 * Card text for the Bandeja.
 * info: {botName, domain, fields:[{label,value}], folderLabel, appLabel, reason, shot}
 * @returns {{title, summary, scope, image?}}
 */
export function describeForApproval(name, args = {}, info = {}) {
  const who = info.botName || "El bot";
  const domain = info.domain || hostOf(args.url) || "una página web";
  const image = info.shot ? { image: info.shot } : {};
  switch (name) {
    case "browser_submit": {
      const count = info.fields?.length || 0;
      return {
        title: "Enviar formulario en " + domain,
        summary: who + " quiere pulsar «" + (info.button || "Enviar") + "» en " + domain + (args.summary ? ": " + args.summary : "") +
          ". " + (count ? "Revisa los " + count + " campos y la captura antes de aprobar." : "Revisa la captura antes de aprobar."),
        scope: "Dominio externo · " + domain,
        ...image,
      };
    }
    case "browser_act":
      return {
        title: args.kind === "escribir" ? "Escribir en " + domain : args.kind === "elegir" ? "Elegir una opción en " + domain : args.kind === "tecla" ? "Pulsar una tecla en " + domain : "Pulsar en " + domain,
        summary: who + " quiere " + (args.kind === "escribir" ? "escribir «" + String(args.text || "").slice(0, 120) + "»" : args.kind === "elegir" ? "elegir «" + String(args.text || "").slice(0, 120) + "»" : args.kind === "tecla" ? "pulsar la tecla " + args.text : "pulsar «" + (info.target || args.ref) + "»") + " en " + domain + ".",
        scope: "Navegador · " + domain,
        ...image,
      };
    case "browser_fill":
      return {
        title: "Rellenar un formulario en " + domain,
        summary: who + " quiere rellenar " + (args.fields?.length || 0) + " campo(s) en " + domain + ". No se enviará nada sin tu permiso.",
        scope: "Navegador · " + domain,
        ...image,
      };
    case "browser_sign_in":
      return {
        title: "Iniciar sesión en " + domain,
        summary: who + " quiere entrar en " + domain + " con tu cuenta «" + (info.username || "de la bóveda") + "». Colmena rellena el usuario y la contraseña en su navegador solo si la página es de " + domain + "; " + who + " nunca ve la contraseña.",
        scope: "Bóveda · " + domain,
        ...image,
      };
    case "browser_download":
      return {
        title: "Descargar un archivo de " + domain,
        summary: who + " quiere descargar un archivo de " + domain + " a la carpeta de la misión. Nunca se abrirá ni ejecutará solo.",
        scope: "Navegador · " + domain,
        ...image,
      };
    case "open_file":
      return {
        title: "Abrir «" + path.win32.basename(String(args.path || "")) + "»",
        summary: who + " quiere abrir «" + args.path + "» de " + (info.folderLabel || "la carpeta de la misión") + " con su programa habitual.",
        scope: "Este ordenador · " + (info.folderLabel || "carpeta de la misión"),
      };
    case "open_app":
      return {
        title: "Abrir " + (info.appLabel || args.app),
        summary: who + " quiere abrir " + (info.appLabel || args.app) + " en este ordenador.",
        scope: "Este ordenador · aplicación",
      };
    case "run_command": {
      const line = commandLine(args.program, args.args);
      const danger = classifyCommand(args.program, args.args);
      return {
        title: "Ejecutar «" + line.slice(0, 80) + (line.length > 80 ? "…" : "") + "»",
        summary: who + " quiere ejecutar «" + line.slice(0, 400) + "» en " + (info.folderLabel || "la carpeta de la misión") + ". Motivo: " +
          (args.reason || "sin motivo") + ". En Windows no hay un entorno aislado: el programa tendría tus mismos permisos." +
          (danger.redLine ? " Atención: " + danger.reason : ""),
        scope: "Este ordenador · " + (info.folderLabel || "carpeta de la misión"),
      };
    }
    default:
      return { title: "Usar el ordenador", summary: who + " quiere usar el ordenador.", scope: "Este ordenador" };
  }
}
