"use strict";
// Turns a CDP Accessibility.getFullAXTree result into a compact, model-friendly
// text snapshot with per-call refs (e1, e2…). Pure: no Electron needed, so it is
// unit-tested in tests/computer-snapshot.test.mjs.

const INTERACTIVE = new Set([
  "button", "link", "textbox", "searchbox", "combobox", "listbox", "option", "checkbox", "radio",
  "switch", "slider", "spinbutton", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "treeitem",
  "comboboxmenubutton", "popupbutton", "textfield", "textarea", "togglebutton", "disclosuretriangle",
]);
const ROLE_ES = {
  button: "botón", togglebutton: "botón", link: "enlace", textbox: "campo", textfield: "campo", textarea: "campo",
  searchbox: "buscador", combobox: "desplegable", comboboxmenubutton: "desplegable", popupbutton: "desplegable",
  listbox: "lista", option: "opción", checkbox: "casilla", radio: "opción única", switch: "interruptor",
  slider: "deslizador", spinbutton: "número", menuitem: "menú", menuitemcheckbox: "menú", menuitemradio: "menú",
  tab: "pestaña", treeitem: "elemento", disclosuretriangle: "desplegar",
};
const MAX_CHARS = 12000;
const MAX_REFS = 1500;

const val = (x) => (x && typeof x === "object" && "value" in x ? x.value : x);
const clean = (s, max = 160) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
};
const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function propsOf(node) {
  const out = {};
  for (const p of node.properties || []) out[p.name] = val(p.value);
  return out;
}

/** Depth-first order over the AX tree (CDP does not guarantee array order). */
function ordered(nodes) {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const roots = nodes.filter((n) => !n.parentId || !byId.has(n.parentId));
  const out = [];
  const seen = new Set();
  const stack = [...roots].reverse().map((n) => [n, 0]);
  while (stack.length) {
    const [node, depth] = stack.pop();
    if (seen.has(node.nodeId)) continue;
    seen.add(node.nodeId);
    out.push([node, depth]);
    const kids = (node.childIds || []).map((id) => byId.get(id)).filter(Boolean);
    for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], depth + 1]);
  }
  return out;
}

function states(p, role) {
  const s = [];
  if (role === "checkbox" || role === "switch" || role === "menuitemcheckbox" || role === "radio") {
    if (p.checked === "true" || p.checked === true) s.push(role === "radio" ? "elegida" : "marcada");
    else if (p.checked === "mixed") s.push("a medias");
    else s.push(role === "radio" ? "sin elegir" : "sin marcar");
  }
  if (p.selected === true) s.push("seleccionada");
  if (p.expanded === true) s.push("desplegado");
  if (p.disabled === true) s.push("desactivado");
  if (p.required === true) s.push("obligatorio");
  if (p.invalid && p.invalid !== "false") s.push("no válido");
  if (p.readonly === true) s.push("solo lectura");
  if (p.focused === true) s.push("con el foco");
  return s;
}

/**
 * @param {object[]} nodes  CDP AXNode list.
 * @param {object} options  mode 'texto'|'elementos', query, maxChars, dom: Map(backendNodeId → {password, autocomplete, inputType}).
 * @returns {{text, refs: Map<string,{backendNodeId, role, name}>, count, truncated, matches, flags}}
 */
function buildSnapshot(nodes, { mode = "elementos", query = "", maxChars = MAX_CHARS, dom = new Map() } = {}) {
  const refs = new Map();
  const lines = [];
  const flags = { password: false, oneTimeCode: false, payment: false };
  const interactiveDepth = [];
  for (const [node, depth] of ordered(nodes || [])) {
    while (interactiveDepth.length && interactiveDepth.at(-1) >= depth) interactiveDepth.pop();
    if (node.ignored) continue;
    const rawRole = String(val(node.role) || "");
    const role = rawRole.toLowerCase();
    const name = clean(val(node.name));
    const p = propsOf(node);
    if (INTERACTIVE.has(role)) {
      interactiveDepth.push(depth);
      if (refs.size >= MAX_REFS) continue;
      const info = dom.get(node.backendDOMNodeId) || {};
      const ref = "e" + (refs.size + 1);
      refs.set(ref, { backendNodeId: node.backendDOMNodeId, role, name });
      let line = "- " + (ROLE_ES[role] || role) + (name ? ' "' + name + '"' : "");
      const tags = states(p, role);
      if (info.password) {
        flags.password = true;
        tags.push("contraseña: no la escribas, pide que tomen el control");
      } else if (info.oneTimeCode) {
        flags.oneTimeCode = true;
        tags.push("código de verificación");
      } else {
        const value = clean(val(node.value), 120);
        if (value && ["textbox", "searchbox", "combobox", "textfield", "textarea", "spinbutton", "slider", "comboboxmenubutton", "popupbutton"].includes(role))
          line += ' = "' + value + '"';
      }
      if (/(n[uú]mero de (la )?tarjeta|card number|\bcvv\b|\bcvc\b|c[oó]digo de seguridad|caducidad|expir|\biban\b)/i.test(name) || info.payment)
        flags.payment = true;
      line += " [" + ref + "]" + (tags.length ? " (" + tags.join(", ") + ")" : "");
      lines.push(line);
      continue;
    }
    if (role === "heading") {
      interactiveDepth.push(depth); // its StaticText children repeat the name
      if (name) lines.push("#".repeat(Math.min(6, Number(p.level) || 2)) + " " + name);
      continue;
    }
    if (role === "alert" || role === "alertdialog" || role === "dialog") {
      lines.push("[" + (role === "alert" ? "aviso" : "diálogo") + (name ? ': "' + name + '"' : "") + "]");
      continue;
    }
    if (mode !== "texto" || interactiveDepth.length) continue;
    if (role === "statictext" && name.length >= 2) lines.push(clean(val(node.name), 300));
    else if ((role === "img" || role === "image") && name) lines.push("[imagen: " + name + "]");
  }
  // Collapse consecutive duplicate text lines (common with nested StaticText).
  const deduped = lines.filter((l, i) => l !== lines[i - 1]);
  let shown = deduped, matches = null;
  const tokens = fold(query || "").split(/\s+/).filter(Boolean);
  if (tokens.length) {
    shown = deduped.filter((l) => tokens.every((t) => fold(l).includes(t)));
    matches = shown.length;
  }
  let text = "", truncated = false;
  for (const line of shown) {
    if (text.length + line.length + 1 > maxChars) {
      truncated = true;
      break;
    }
    text += line + "\n";
  }
  if (truncated) text += "… (página recortada: usa query para buscar lo que necesitas)\n";
  if (!text) text = tokens.length ? "(ninguna línea coincide con «" + query + "»)\n" : "(la página no tiene contenido legible)\n";
  return { text, refs, count: refs.size, truncated, matches, flags };
}

const CAPTCHA_FRAMES = /(recaptcha|hcaptcha|challenges\.cloudflare\.com|turnstile|arkoselabs|funcaptcha|geetest|captcha)/i;
const CAPTCHA_TEXT = /(captcha|no soy un robot|i'?m not a robot|verify (that )?you are (a )?human|verifica(r)? que eres (un )?humano|comprueba que eres (un )?humano|confirma que eres (un )?humano|unusual traffic|tr[aá]fico inusual|press (and|&) hold)/i;
const TWO_FA_TEXT = /(c[oó]digo de verificaci[oó]n|verification code|two[- ]factor|\b2fa\b|autenticaci[oó]n en dos (pasos|factores)|verificaci[oó]n en dos pasos|doble factor|one[- ]time (code|password)|c[oó]digo de un solo uso|te hemos enviado un c[oó]digo|enter the code we sent|authenticator app|aplicaci[oó]n de autenticaci[oó]n)/i;

/**
 * Heuristic blockers the bot must not try to solve.
 * Returns {tipo:'captcha'|'2fa'|'contraseña'|'pago', mensaje} or null.
 */
function detectBlocker({ text = "", frameUrls = [], flags = {} } = {}) {
  const take = " Para aquí y pide a la persona que pulse «Tomar el control» en la vista en vivo.";
  if (frameUrls.some((u) => CAPTCHA_FRAMES.test(String(u))) || CAPTCHA_TEXT.test(text))
    return { tipo: "captcha", mensaje: "La página pide demostrar que eres humano (captcha)." + take };
  if (flags.oneTimeCode || TWO_FA_TEXT.test(text))
    return { tipo: "2fa", mensaje: "La página pide un código de verificación (doble factor)." + take };
  if (flags.password)
    return { tipo: "contraseña", mensaje: "Hay un campo de contraseña. Nunca la escribas tú: si hace falta iniciar sesión, para y pide a la persona que pulse «Tomar el control» en la vista en vivo." };
  if (flags.payment)
    return { tipo: "pago", mensaje: "La página tiene datos de pago. No rellenes tarjetas ni cuentas: pide a la persona que tome el control; enviar o pagar siempre necesita su permiso." };
  return null;
}

module.exports = { buildSnapshot, detectBlocker, MAX_CHARS, INTERACTIVE };
