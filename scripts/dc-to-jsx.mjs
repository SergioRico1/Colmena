// Converts the approved design artboards (design/*.dc.html) into React
// components that render the exact same markup, inline styles and logic.
// Output: src/design/<Name>.jsx  (generated — never edit by hand).
//
// Usage: node scripts/dc-to-jsx.mjs [Name ...]
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { load } from "cheerio";

const root = new URL("../", import.meta.url);
const designDir = new URL("design/", root);
const outDir = new URL("src/design/", root);

const RAW = { table: "sc-raw-table", tbody: "sc-raw-tbody", thead: "sc-raw-thead", tfoot: "sc-raw-tfoot", tr: "sc-raw-tr", td: "sc-raw-td", th: "sc-raw-th", caption: "sc-raw-caption", select: "sc-raw-select" };
const UNRAW = Object.fromEntries(Object.entries(RAW).map(([a, b]) => [b, a]));
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const BOOL = new Set(["allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls", "default", "defer", "disabled", "formnovalidate", "hidden", "loop", "multiple", "muted", "novalidate", "open", "playsinline", "readonly", "required", "reversed", "selected"]);
const RENAME = {
  class: "className", for: "htmlFor", tabindex: "tabIndex", readonly: "readOnly", maxlength: "maxLength", minlength: "minLength",
  contenteditable: "contentEditable", spellcheck: "spellCheck", autocomplete: "autoComplete", autofocus: "autoFocus",
  colspan: "colSpan", rowspan: "rowSpan", enterkeyhint: "enterKeyHint", inputmode: "inputMode", novalidate: "noValidate",
  datetime: "dateTime", crossorigin: "crossOrigin", srcset: "srcSet", accesskey: "accessKey", formnovalidate: "formNoValidate",
  allowfullscreen: "allowFullScreen", playsinline: "playsInline", autoplay: "autoPlay", "accept-charset": "acceptCharset",
  "http-equiv": "httpEquiv", "xlink:href": "xlinkHref", "xml:space": "xmlSpace", viewbox: "viewBox",
};
const EVENTS = { onclick: "onClick", onchange: "onChange", oninput: "onInput", onsubmit: "onSubmit", onkeydown: "onKeyDown", onkeyup: "onKeyUp", onfocus: "onFocus", onblur: "onBlur", onmouseenter: "onMouseEnter", onmouseleave: "onMouseLeave", onpointerdown: "onPointerDown", onpointerup: "onPointerUp", onpointerleave: "onPointerLeave", onpointercancel: "onPointerCancel", ondragstart: "onDragStart", ondragover: "onDragOver", ondrop: "onDrop", ondragend: "onDragEnd", ondragenter: "onDragEnter", ondragleave: "onDragLeave", ondoubleclick: "onDoubleClick", oncontextmenu: "onContextMenu", onmousedown: "onMouseDown", onmouseup: "onMouseUp" };
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const js = (s) => JSON.stringify(s);

// Translate a {{ mustache }} expression (paths, !, ===/!==, literals) into JS.
function expr(source, scope) {
  const e = source.trim();
  return e.replace(/("[^"]*"|'[^']*')|([A-Za-z_$][\w$]*(?:\.[\w$]+|\[\d+\])*)/g, (m, str, path) => {
    if (str) return str;
    if (["true", "false", "null", "undefined"].includes(path)) return path;
    const parts = path.split(/(?=\.|\[)/);
    const head = parts[0];
    const tail = parts.slice(1).map((p) => "?" + (p.startsWith(".") ? p : "." + p)).join("");
    return (scope.has(head) ? head : "v." + head) + tail;
  });
}
const isWhole = (value) => /^\s*\{\{([\s\S]+?)\}\}\s*$/.exec(value);
function template(value, scope) {
  const whole = isWhole(value);
  if (whole) return expr(whole[1], scope);
  const parts = value.split(/\{\{([\s\S]+?)\}\}/g);
  return "`" + parts.map((p, i) => (i % 2 ? "${" + expr(p, scope) + " ?? ''}" : p.replace(/[`\\$]/g, (c) => "\\" + c))).join("") + "`";
}
function styleObject(value, scope) {
  const entries = [];
  for (const chunk of value.split(";")) {
    const i = chunk.indexOf(":");
    if (i < 0) continue;
    const prop = chunk.slice(0, i).trim();
    const val = chunk.slice(i + 1).trim();
    if (!prop) continue;
    const key = prop.startsWith("--") ? js(prop) : /^-(webkit|moz|ms)-/.test(prop) ? camel(prop.slice(1)).replace(/^./, (c) => c.toUpperCase()) : camel(prop);
    entries.push(key + ": " + (val.includes("{{") ? template(val, scope) : js(val)));
  }
  return "{{" + entries.join(", ") + "}}";
}

function attributes(el, scope, mode) {
  const out = [];
  const tag = el.name;
  for (let [name, value] of Object.entries(el.attribs || {})) {
    if (name.startsWith("hint-") || name === "sc-name") continue;
    if (name === "style") { out.push("style=" + styleObject(value, scope)); continue; }
    let prop;
    if (EVENTS[name] || name.startsWith("on")) prop = EVENTS[name] || "on" + name[2].toUpperCase() + camel(name.slice(3));
    else if (mode === "import") prop = name.startsWith("aria-") || name.startsWith("data-") ? name : camel(name);
    else if (RENAME[name]) prop = RENAME[name];
    else if (name.startsWith("aria-") || name.startsWith("data-")) prop = name;
    else prop = camel(name);
    if (name.startsWith("on") && name.length > 2 && name.includes("-")) prop = camel(name);
    const dynamic = value.includes("{{");
    if (!dynamic) {
      if (BOOL.has(name) && (value === "" || value === name)) {
        if (name === "checked" && tag === "input") out.push("defaultChecked");
        else out.push(prop);
        continue;
      }
      if (name === "value" && (tag === "input" || tag === "textarea") && mode !== "import") { out.push("defaultValue=" + js(value)); continue; }
      out.push(prop + "=" + (/["{}\\]/.test(value) || value.includes("\n") ? "{" + js(value) + "}" : js(value)));
      continue;
    }
    out.push(prop + "={" + template(value, scope) + "}");
  }
  if ((el.attribs || {}).contenteditable !== undefined) out.push("suppressContentEditableWarning");
  return out;
}

function text(data, scope) {
  if (!data.includes("{{")) {
    if (!data.trim() && !data.includes(" ")) return "";
    return "{" + js(data) + "}";
  }
  return data.split(/\{\{([\s\S]+?)\}\}/g).map((p, i) => (i % 2 ? "{" + expr(p, scope) + "}" : p ? "{" + js(p) + "}" : "")).join("");
}

let imports;
function node(n, scope, depth) {
  const pad = "  ".repeat(depth);
  if (n.type === "text") { const t = text(n.data, scope); return t ? pad + t : ""; }
  if (n.type !== "tag" && n.type !== "script" && n.type !== "style") return "";
  const tag = UNRAW[n.name] || n.name;
  const kids = (s, d) => (n.children || []).map((c) => node(c, s, d)).filter(Boolean).join("\n");
  if (tag === "sc-for") {
    const list = template(n.attribs.list || "[]", scope);
    const as = n.attribs.as || "item";
    const inner = new Set([...scope, as, "$index"]);
    return `${pad}{(${list} || []).map((${as}, $index) => (\n${pad}  <React.Fragment key={$index}>\n${kids(inner, depth + 2)}\n${pad}  </React.Fragment>\n${pad}))}`;
  }
  if (tag === "sc-if") {
    return `${pad}{${template(n.attribs.value || "false", scope)} ? (\n${pad}  <>\n${kids(scope, depth + 2)}\n${pad}  </>\n${pad}) : null}`;
  }
  if (tag === "dc-import") {
    const name = n.attribs.name || n.attribs.component;
    imports.add(name);
    const attrs = { ...n.attribs }; delete attrs.name; delete attrs.component;
    const style = attrs.style; delete attrs.style;
    return `${pad}<${name}Design ${attributes({ name: tag, attribs: attrs }, scope, "import").join(" ")} />`;
  }
  const attrs = attributes({ ...n, name: tag }, scope, "dom");
  const open = `<${tag}${attrs.length ? " " + attrs.join(" ") : ""}`;
  if (VOID.has(tag) || !(n.children || []).length) return `${pad}${open} />`;
  if (tag === "textarea") {
    const value = (n.children || []).map((c) => c.data || "").join("");
    return `${pad}${open}${value ? " defaultValue=" + js(value) : ""} />`;
  }
  return `${pad}${open}>\n${kids(scope, depth + 1)}\n${pad}</${tag}>`;
}

export async function convert(name) {
  let source = await readFile(new URL(name + ".dc.html", designDir), "utf8");
  source = source.replace(/<(dc-import|x-import)((?:[^>"']|"[^"]*"|'[^']*')*)\/>/gi, "<$1$2></$1>");
  for (const [tag, raw] of Object.entries(RAW)) source = source.replace(new RegExp("(</?)" + tag + "(?=[\\s>])", "gi"), "$1" + raw);
  const $ = load(source);
  const css = $("x-dc helmet style").map((_, e) => $(e).html()).get().join("\n").trim();
  const script = $("script[data-dc-script]");
  const meta = JSON.parse(script.attr("data-props") || "{}");
  const logic = (script.html() || "class Component extends DCLogic { renderVals() { return {}; } }").replace(/class\s+Component\s+extends\s+DCLogic/, "export class Logic extends DCLogic").trim();
  imports = new Set();
  const body = $("x-dc").contents().filter((_, c) => !(c.type === "tag" && c.name === "helmet")).get().map((c) => node(c, new Set(), 3)).filter(Boolean).join("\n");
  const importLines = [...imports].map((i) => `import ${i}Design from "./${i}.jsx";`).join("\n");
  const out = `// GENERATED by scripts/dc-to-jsx.mjs from design/${name}.dc.html — do not edit.
/* eslint-disable */
import React from "react";
import { DCLogic, useDCLogic, withDefaults } from "./dc.js";
${importLines}

export const css = ${js(css)};
export const meta = ${JSON.stringify(meta)};

${logic}

export function View({ v }) {
  return (
    <>
${body}
    </>
  );
}

export default function ${name}Design(props) {
  const v = useDCLogic(Logic, withDefaults(meta, props));
  return (
    <>
      <style>{css}</style>
      <View v={v} />
    </>
  );
}
`;
  await writeFile(new URL(name + ".jsx", outDir), out);
  // Live screens only need the stylesheet: keep it apart from the mockup content.
  await writeFile(new URL("css/" + name + ".js", outDir), `// GENERATED by scripts/dc-to-jsx.mjs — do not edit.\nexport const css = ${js(css)};\n`);
  return name;
}

await mkdir(new URL("css/", outDir), { recursive: true });
const requested = process.argv.slice(2);
const names = requested.length ? requested : (await readdir(designDir)).filter((f) => f.endsWith(".dc.html")).map((f) => f.replace(/\.dc\.html$/, ""));
for (const name of names) console.log("converted", await convert(name));
