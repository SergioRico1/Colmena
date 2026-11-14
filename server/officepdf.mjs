// Office files seen as they look: a .docx/.xlsx/.pptx (or the old .doc/.xls/.ppt) of the
// person's working folder becomes a PDF that the preview draws page by page. Colmena ships no
// converter of its own (no 100+ MB LibreOffice inside): it uses what this computer has —
// LibreOffice («soffice --headless --convert-to pdf») or, on Windows, Microsoft Office itself
// through COM automation (Word/Excel/PowerPoint ExportAsFixedFormat) — and without either the
// preview stays the extracted text with a short note.
//
// Conversions are cached by content (SHA-256 of the bytes + format + engine) under the app's
// cache folder, so a file opened again shows at once and a changed file converts again. Two
// requests for the same content share one conversion; a newer version of the same file
// cancels the conversion of the older one; every conversion has a deadline and runs one at a
// time (Office automation does not like company). Fonts the document asks for that this
// computer does not have are reported: the PDF then uses look-alikes.
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { zipEntries, zipRead } from "./documents.mjs";

export const OFFICE_FORMATS = Object.freeze({ doc: "word", docx: "word", xls: "excel", xlsx: "excel", ppt: "powerpoint", pptx: "powerpoint" });
export const OFFICE_LIMITS = Object.freeze({
  inputBytes: 50 * 1024 * 1024, // bigger files keep the text preview
  timeoutMs: 120000, // a conversion that takes longer is stopped
  cacheBytes: 400 * 1024 * 1024, // the cache keeps the newest PDFs up to this size…
  cacheEntries: 300, // …and this many
  detectMs: 10 * 60 * 1000, // what is installed is looked up again after this
});
const CACHE_VERSION = "1";

export const isOfficeFile = (name) => Object.hasOwn(OFFICE_FORMATS, extOf(name));
const extOf = (name) => path.extname(String(name || "")).slice(1).toLowerCase();
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const converterError = (code, message) => Object.assign(Error(message), { code });

/** Runs a program; kills it on timeout or abort. Resolves {code, stdout, stderr}. */
function run(command, args, { timeoutMs = OFFICE_LIMITS.timeoutMs, signal = null, env = process.env, input = null } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(converterError("ABORTED", "Conversión cancelada."));
    const child = spawn(command, args, { env, windowsHide: true, stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"] });
    const out = [], err = [];
    let reason = null;
    const stop = (why) => { reason ||= why; try { child.kill(); } catch {} };
    const timer = setTimeout(() => stop("TIMEOUT"), timeoutMs);
    const onAbort = () => stop("ABORTED");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (d) => out.length < 200 && out.push(d));
    child.stderr.on("data", (d) => err.length < 200 && err.push(d));
    child.on("error", (e) => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (reason === "TIMEOUT") return reject(converterError("TIMEOUT", "La conversión tardaba demasiado y se ha parado."));
      if (reason === "ABORTED") return reject(converterError("ABORTED", "Conversión cancelada."));
      resolve({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    });
    if (input != null) child.stdin.end(input);
  });
}

// ------------------------------------------------------------------ LibreOffice

/** soffice on this computer (COLMENA_SOFFICE, PATH, the usual install folders), or null. */
export function findSoffice(env = process.env, platform = process.platform) {
  const candidates = [];
  if (env.COLMENA_SOFFICE) candidates.push(env.COLMENA_SOFFICE);
  const names = platform === "win32" ? ["soffice.exe", "soffice.com"] : ["soffice", "libreoffice"];
  for (const dir of String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean)) for (const n of names) candidates.push(path.join(dir, n));
  if (platform === "win32") {
    for (const base of [env.ProgramFiles, env["ProgramFiles(x86)"], env.ProgramW6432, "C:\\Program Files", "C:\\Program Files (x86)"].filter(Boolean))
      candidates.push(path.join(base, "LibreOffice", "program", "soffice.exe"));
  } else if (platform === "darwin") {
    candidates.push("/Applications/LibreOffice.app/Contents/MacOS/soffice", path.join(os.homedir(), "Applications/LibreOffice.app/Contents/MacOS/soffice"));
  } else {
    candidates.push("/usr/bin/soffice", "/usr/bin/libreoffice", "/usr/local/bin/soffice", "/snap/bin/libreoffice", "/opt/libreoffice/program/soffice");
  }
  return candidates.find((c) => { try { return existsSync(c); } catch { return false; } }) || null;
}

export function libreOfficeEngine(command = findSoffice()) {
  return {
    name: "libreoffice",
    label: "LibreOffice",
    available: async () => !!command,
    async convert({ input, outDir, signal, timeoutMs }) {
      // Its own profile: works while the person has LibreOffice open, and leaves theirs alone.
      const profile = path.join(outDir, "profile");
      const { code, stderr } = await run(command, [
        "-env:UserInstallation=" + "file:///" + profile.replace(/\\/g, "/").replace(/^\/+/, ""),
        "--headless", "--norestore", "--nolockcheck", "--nodefault", "--nologo", "--nofirststartwizard",
        "--convert-to", "pdf", "--outdir", outDir, input,
      ], { signal, timeoutMs });
      const pdf = path.join(outDir, path.basename(input, path.extname(input)) + ".pdf");
      if (!existsSync(pdf)) throw converterError("FAILED", "LibreOffice no pudo convertirlo" + (code ? " (código " + code + ")" : "") + (stderr.trim() ? ": " + stderr.trim().split(/\r?\n/)[0].slice(0, 160) : "."));
      return pdf;
    },
  };
}

// ------------------------------------------------------------------ Microsoft Office (COM)

// Read-only, no macros' prompts, no recent-files entry; a password-protected file fails at once
// (a wrong password is passed instead of asking). Office is only closed when Colmena opened it:
// a Word or PowerPoint the person has open keeps their documents.
const COM_SCRIPTS = {
  word: `
$app = New-Object -ComObject Word.Application
$had = $app.Documents.Count
try {
  $app.Visible = $false; $app.DisplayAlerts = 0
  try { $app.AutomationSecurity = 3 } catch {}
  $doc = $app.Documents.Open($env:COLMENA_IN, $false, $true, $false, 'colmena-sin-clave', 'colmena-sin-clave', $false, 'colmena-sin-clave', 'colmena-sin-clave', 0, [Type]::Missing, $false, $false, 0, $true)
  try { $doc.ExportAsFixedFormat($env:COLMENA_OUT, 17) } finally { $doc.Close(0) }
} finally { if ($had -eq 0) { $app.Quit() }; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }`,
  excel: `
$app = New-Object -ComObject Excel.Application
try {
  $app.Visible = $false; $app.DisplayAlerts = $false; $app.AskToUpdateLinks = $false; $app.EnableEvents = $false
  try { $app.AutomationSecurity = 3 } catch {}
  $wb = $app.Workbooks.Open($env:COLMENA_IN, 0, $true, [Type]::Missing, 'colmena-sin-clave', [Type]::Missing, $true)
  try { $wb.ExportAsFixedFormat(0, $env:COLMENA_OUT) } finally { $wb.Close($false) }
} finally { if ($app.Workbooks.Count -eq 0) { $app.Quit() }; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }`,
  powerpoint: `
$app = New-Object -ComObject PowerPoint.Application
$had = $app.Presentations.Count
try {
  try { $app.AutomationSecurity = 3 } catch {}
  $pres = $app.Presentations.Open($env:COLMENA_IN + '::colmena-sin-clave::', -1, 0, 0)
  try { $pres.SaveAs($env:COLMENA_OUT, 32) } finally { $pres.Close() }
} finally { if ($had -eq 0) { $app.Quit() }; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }`,
};
const COM_PROGIDS = { word: "Word.Application", excel: "Excel.Application", powerpoint: "PowerPoint.Application" };

/** Which Office programs are registered for automation (Windows registry). */
async function officeApps() {
  const found = new Set();
  for (const [app, progId] of Object.entries(COM_PROGIDS)) {
    try {
      const r = await run("reg.exe", ["query", "HKCR\\" + progId + "\\CLSID"], { timeoutMs: 10000 });
      if (r.code === 0) found.add(app);
    } catch {}
  }
  return found;
}

export function msOfficeEngine({ platform = process.platform } = {}) {
  let apps = null;
  return {
    name: "msoffice",
    label: "Microsoft Office",
    async available() {
      if (platform !== "win32") return false;
      apps ||= officeApps();
      return (await apps).size > 0;
    },
    async supports(ext) {
      if (platform !== "win32") return false;
      apps ||= officeApps();
      return (await apps).has(OFFICE_FORMATS[ext]);
    },
    async convert({ input, outDir, ext, signal, timeoutMs }) {
      const out = path.join(outDir, "out.pdf");
      const script = "$ErrorActionPreference = 'Stop'\n" + COM_SCRIPTS[OFFICE_FORMATS[ext]];
      const { code, stderr } = await run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
        { signal, timeoutMs, env: { ...process.env, COLMENA_IN: input, COLMENA_OUT: out } });
      if (!existsSync(out)) {
        const why = /contrase|password/i.test(stderr) ? "está protegido con contraseña" : "Office no pudo convertirlo" + (code ? " (código " + code + ")" : "");
        throw converterError("FAILED", why.charAt(0).toUpperCase() + why.slice(1) + ".");
      }
      return out;
    },
  };
}

/** LibreOffice first (no window, no Office licence prompts), then Microsoft Office. */
export const defaultEngines = () => [libreOfficeEngine(), msOfficeEngine()];

// ------------------------------------------------------------------ fonts

/** Font families an OOXML document asks for (theme placeholders like «+mn-lt» left out). */
export function documentFonts(bytes, ext) {
  const out = new Set();
  let entries;
  try { entries = zipEntries(bytes); } catch { return []; }
  const read = (name) => { try { return zipRead(bytes, entries, name)?.toString("utf8") || ""; } catch { return ""; } };
  const add = (name) => { const n = String(name || "").trim(); if (n && !n.startsWith("+") && n.length < 64) out.add(n); };
  if (ext === "docx") {
    for (const m of read("word/fontTable.xml").matchAll(/<w:font\s[^>]*w:name="([^"]+)"/g)) add(m[1]);
    // Fonts set on runs and styles directly (not always listed in the font table).
    for (const part of ["word/document.xml", "word/styles.xml"]) for (const m of read(part).matchAll(/<w:rFonts\s[^>]*w:ascii="([^"]+)"/g)) add(m[1]);
  }
  if (ext === "xlsx") for (const m of read("xl/styles.xml").matchAll(/<name\s+val="([^"]+)"/g)) add(m[1]);
  if (ext === "pptx" || ext === "xlsx" || ext === "docx") {
    const themes = [...entries.keys()].filter((n) => /^(ppt|xl|word)\/theme\/theme\d*\.xml$/.test(n));
    const slides = ext === "pptx" ? [...entries.keys()].filter((n) => /^ppt\/(slides|slideMasters|slideLayouts)\/[^/]+\.xml$/.test(n)).slice(0, 200) : [];
    for (const name of [...themes.slice(0, 1), ...slides]) for (const m of read(name).matchAll(/<a:(?:latin|ea|cs)\s+typeface="([^"]*)"/g)) add(m[1]);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

const STYLE_WORDS = /\s+(bold|italic|oblique|light|semilight|semibold|demibold|black|heavy|medium|thin|extralight|ultralight|extrabold|ultrabold|condensed|narrow|regular|book|roman)\b.*$/i;
/** Families installed on this computer (lower case), or null when it cannot be known. */
export async function installedFonts(platform = process.platform) {
  const names = new Set();
  const addFamily = (raw) => {
    for (const part of String(raw).split(/\s*[&,]\s*/)) {
      const clean = part.replace(/\s*\((truetype|opentype|type 1|all res)\)\s*$/i, "").trim().toLowerCase();
      if (!clean) continue;
      names.add(clean);
      names.add(clean.replace(STYLE_WORDS, ""));
    }
  };
  try {
    if (platform === "win32") {
      for (const key of ["HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts", "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts"]) {
        const r = await run("reg.exe", ["query", key], { timeoutMs: 15000 }).catch(() => null);
        for (const line of String(r?.stdout || "").split(/\r?\n/)) {
          const m = /^\s{4}(.+?)\s{4}REG_\w+\s{4}/.exec(line);
          if (m) addFamily(m[1]);
        }
      }
    } else {
      const r = await run("fc-list", [":", "family"], { timeoutMs: 15000 }).catch(() => null);
      for (const line of String(r?.stdout || "").split(/\r?\n/)) if (line.trim()) addFamily(line);
    }
  } catch {}
  return names.size ? names : null;
}

/** The families of `wanted` not in `installed` (null installed: none reported). */
export function missingFrom(wanted, installed) {
  if (!installed) return [];
  return wanted.filter((f) => {
    const n = f.toLowerCase();
    return !installed.has(n) && !installed.has(n.replace(STYLE_WORDS, ""));
  });
}

// ------------------------------------------------------------------ the converter

/**
 * createOfficeConverter({cacheDir, engines?, fonts?, limits?}) →
 *   engine(ext) → the engine that would convert it ({name, label}) or null
 *   convert(bytes, ext, {source, signal}) → {pdf: Buffer, missingFonts, engine, cached}
 * `engines`: [{name, label, available(), supports?(ext), convert({input, outDir, ext, bytes, signal, timeoutMs}) → pdf path | {pdf, missingFonts?}}]
 * `fonts`: () → Set of installed families (lower case) or null; false turns the check off.
 * `source` names the file (missionId + path): a newer version of it cancels the older one's conversion.
 */
/**
 * The converter's surface without a disk (the cloud: server/machine/seam.mjs): conversions run
 * elsewhere (`convert(bytes, ext, {source, signal})` → {pdf, missingFonts, engine, cached}) and the
 * newest few PDFs are kept in memory, keyed by content like the disk cache.
 */
export function remoteOfficeConverter({ convert, label = "LibreOffice", limits = {}, keep = 12 } = {}) {
  const L = { ...OFFICE_LIMITS, ...limits };
  const cache = new Map(); // key → result, newest last
  const inflight = new Map();
  return {
    limits: L,
    isOffice: (name) => isOfficeFile(name),
    async engine(ext) { return OFFICE_FORMATS[String(ext || "").toLowerCase()] ? { name: "remote", label } : null; },
    async convert(bytes, ext, { source = null, signal = null } = {}) {
      ext = String(ext || "").toLowerCase();
      if (!OFFICE_FORMATS[ext]) throw converterError("UNSUPPORTED", "Ese formato no se convierte.");
      if (bytes.length > L.inputBytes) throw converterError("TOO_BIG", "Es demasiado grande para verlo con su formato.");
      const key = sha256(Buffer.concat([Buffer.from(CACHE_VERSION + ":remote:" + ext + ":"), bytes]));
      const hit = cache.get(key);
      if (hit) { cache.delete(key); cache.set(key, hit); return { ...hit, cached: true }; }
      let job = inflight.get(key);
      if (!job) {
        job = Promise.resolve(convert(bytes, ext, { source, signal })).then((out) => {
          if (!Buffer.isBuffer(out?.pdf) || out.pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw converterError("FAILED", "La conversión no dio un PDF válido.");
          const result = { pdf: out.pdf, missingFonts: out.missingFonts || [], engine: out.engine || label };
          cache.set(key, result);
          while (cache.size > keep) cache.delete(cache.keys().next().value);
          return result;
        }).finally(() => inflight.delete(key));
        inflight.set(key, job);
      }
      return { ...(await job), cached: false };
    },
    pending: () => inflight.size,
  };
}

export function createOfficeConverter({ cacheDir, engines = defaultEngines(), fonts = installedFonts, limits = {} } = {}) {
  if (!cacheDir) throw Error("createOfficeConverter necesita una carpeta de caché.");
  const L = { ...OFFICE_LIMITS, ...limits };
  const inflight = new Map(); // key → {promise, controller, users}
  const bySource = new Map(); // source → key of its latest request
  let detected = null; // {at, list: [{engine, ok}]}
  let fontList = null; // {at, promise}
  let tail = Promise.resolve(); // one conversion at a time

  const usable = async () => {
    if (!detected || Date.now() - detected.at > L.detectMs) {
      const list = [];
      for (const engine of engines) list.push({ engine, ok: await Promise.resolve(engine.available?.() ?? true).catch(() => false) });
      detected = { at: Date.now(), list };
    }
    return detected.list.filter((x) => x.ok).map((x) => x.engine);
  };
  const engineFor = async (ext) => {
    if (!OFFICE_FORMATS[ext]) return null;
    for (const engine of await usable()) if (!engine.supports || (await Promise.resolve(engine.supports(ext)).catch(() => false))) return engine;
    return null;
  };
  const missingFonts = async (bytes, ext) => {
    if (fonts === false || !["docx", "xlsx", "pptx"].includes(ext)) return [];
    if (!fontList || Date.now() - fontList.at > L.detectMs) fontList = { at: Date.now(), promise: Promise.resolve().then(() => fonts()).catch(() => null) };
    return missingFrom(documentFonts(bytes, ext), await fontList.promise).slice(0, 12);
  };
  const files = (key) => ({ pdf: path.join(cacheDir, key + ".pdf"), meta: path.join(cacheDir, key + ".json") });
  const fromCache = async (key) => {
    const f = files(key);
    try {
      const [pdf, meta] = await Promise.all([readFile(f.pdf), readFile(f.meta, "utf8").then(JSON.parse)]);
      const t = new Date();
      await Promise.all([utimes(f.pdf, t, t), utimes(f.meta, t, t)]).catch(() => {});
      return { pdf, meta };
    } catch { return null; }
  };
  const prune = async () => {
    let names;
    try { names = (await readdir(cacheDir)).filter((n) => n.endsWith(".pdf")); } catch { return; }
    const list = [];
    for (const n of names) { const s = await stat(path.join(cacheDir, n)).catch(() => null); if (s) list.push({ key: n.slice(0, -4), size: s.size, at: s.mtimeMs }); }
    list.sort((a, b) => b.at - a.at);
    let total = 0;
    for (const [i, e] of list.entries()) {
      total += e.size;
      if (i >= L.cacheEntries || total > L.cacheBytes) { const f = files(e.key); await rm(f.pdf, { force: true }); await rm(f.meta, { force: true }); }
    }
  };
  const queued = (fn, signal) => {
    const job = tail.then(() => { if (signal.aborted) throw converterError("ABORTED", "Conversión cancelada."); return fn(); });
    tail = job.catch(() => {});
    return job;
  };
  const work = async (engine, key, bytes, ext, controller) => {
    const { signal } = controller;
    const scratch = path.join(os.tmpdir(), "colmena-office-" + randomUUID());
    // The deadline holds whatever the engine does: past it the conversion is given up.
    let late = false;
    const deadline = setTimeout(() => { late = true; controller.abort(); }, L.timeoutMs);
    const stopped = new Promise((_, reject) => signal.addEventListener("abort", () => reject(late ? converterError("TIMEOUT", "La conversión tardaba demasiado y se ha parado.") : converterError("ABORTED", "Conversión cancelada.")), { once: true }));
    stopped.catch(() => {});
    await mkdir(scratch, { recursive: true });
    try {
      const input = path.join(scratch, "documento." + ext);
      await writeFile(input, bytes);
      const result = await Promise.race([engine.convert({ input, outDir: scratch, ext, bytes, signal, timeoutMs: L.timeoutMs }), stopped])
        .catch((error) => { throw late ? converterError("TIMEOUT", "La conversión tardaba demasiado y se ha parado.") : error; });
      if (signal.aborted) await stopped;
      const pdf = Buffer.isBuffer(result?.pdf) ? result.pdf : await readFile(typeof result === "string" ? result : result?.path);
      if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw converterError("FAILED", "La conversión no dio un PDF válido.");
      const missing = [...new Set([...(result?.missingFonts || []), ...(await missingFonts(bytes, ext))])];
      const meta = { engine: engine.name, label: engine.label || engine.name, missingFonts: missing, at: new Date().toISOString(), bytes: pdf.length };
      await mkdir(cacheDir, { recursive: true });
      const f = files(key);
      const tmp = f.pdf + "." + randomUUID() + ".tmp";
      await writeFile(tmp, pdf);
      await rename(tmp, f.pdf);
      await writeFile(f.meta, JSON.stringify(meta));
      prune().catch(() => {});
      return { pdf, meta };
    } finally {
      clearTimeout(deadline);
      await rm(scratch, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    }
  };

  return {
    limits: L,
    isOffice: (name) => isOfficeFile(name),
    async engine(ext) {
      const e = await engineFor(String(ext || "").toLowerCase());
      return e ? { name: e.name, label: e.label || e.name } : null;
    },
    async convert(bytes, ext, { source = null, signal = null } = {}) {
      ext = String(ext || "").toLowerCase();
      if (!OFFICE_FORMATS[ext]) throw converterError("UNSUPPORTED", "Ese formato no se convierte.");
      if (bytes.length > L.inputBytes) throw converterError("TOO_BIG", "Es demasiado grande para verlo con su formato.");
      const engine = await engineFor(ext);
      if (!engine) throw converterError("NO_CONVERTER", "No hay Microsoft Office ni LibreOffice en este equipo.");
      const key = sha256(Buffer.concat([Buffer.from(CACHE_VERSION + ":" + engine.name + ":" + ext + ":"), bytes]));
      // A newer version of the same file: the older conversion is no longer wanted.
      if (source) {
        const previous = bySource.get(source);
        bySource.set(source, key);
        const old = previous && previous !== key ? inflight.get(previous) : null;
        if (old && ![...bySource.values()].includes(previous)) old.controller.abort();
      }
      const hit = await fromCache(key);
      if (hit) return { pdf: hit.pdf, missingFonts: hit.meta.missingFonts || [], engine: hit.meta.label || hit.meta.engine, cached: true };
      let job = inflight.get(key);
      if (!job) {
        const controller = new AbortController();
        job = { controller, users: 0, promise: null };
        job.promise = queued(() => work(engine, key, bytes, ext, controller), controller.signal)
          .finally(() => { if (inflight.get(key) === job) inflight.delete(key); });
        job.promise.catch(() => {});
        inflight.set(key, job);
      }
      job.users++;
      const { pdf, meta } = await new Promise((resolve, reject) => {
        // The caller went away: when nobody else waits for it, the conversion stops.
        const leave = () => {
          job.users--;
          if (job.users <= 0) job.controller.abort();
          reject(converterError("ABORTED", "Conversión cancelada."));
        };
        if (signal?.aborted) return leave();
        signal?.addEventListener("abort", leave, { once: true });
        const done = (fn) => (value) => { signal?.removeEventListener("abort", leave); job.users--; fn(value); };
        job.promise.then(done(resolve), done(reject));
      });
      return { pdf, missingFonts: meta.missingFonts || [], engine: meta.label || meta.engine, cached: false };
    },
    /** Conversions in progress (for tests and diagnostics). */
    pending: () => inflight.size,
  };
}
