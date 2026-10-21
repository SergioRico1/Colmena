// A small Excel formula engine: enough to show the values in Colmena's preview, write them as
// the cached results of the .xlsx, and catch the errors a person would see on opening it
// (#DIV/0!, #REF!, #NAME?, #VALUE!, #N/A, circular references). Excel recalculates on open;
// a function this engine does not know is left for Excel (its value shows as unknown here).

export class XError {
  constructor(code, why = "") { this.code = code; this.why = why; }
  toString() { return this.code; }
}
export const isErr = (v) => v instanceof XError;
/** A value this engine cannot compute (a function it does not know): Excel will. */
export const UNKNOWN = Object.freeze({ unknown: true });
const isUnknown = (v) => v === UNKNOWN;

// ---- Spanish → English (the file always stores English names and commas) ----
const SPANISH = {
  SUMA: "SUM", PROMEDIO: "AVERAGE", CONTAR: "COUNT", CONTARA: "COUNTA", "CONTAR.BLANCO": "COUNTBLANK", MEDIANA: "MEDIAN", PRODUCTO: "PRODUCT",
  REDONDEAR: "ROUND", "REDONDEAR.MAS": "ROUNDUP", "REDONDEAR.MENOS": "ROUNDDOWN", ENTERO: "INT", RESIDUO: "MOD", POTENCIA: "POWER", RAIZ: "SQRT",
  SI: "IF", "SI.ERROR": "IFERROR", "SI.ND": "IFNA", Y: "AND", O: "OR", NO: "NOT", "SUMAR.SI": "SUMIF", "CONTAR.SI": "COUNTIF", "PROMEDIO.SI": "AVERAGEIF",
  "SUMAR.SI.CONJUNTO": "SUMIFS", "CONTAR.SI.CONJUNTO": "COUNTIFS", SUMAPRODUCTO: "SUMPRODUCT", BUSCARV: "VLOOKUP", BUSCARX: "XLOOKUP", COINCIDIR: "MATCH", INDICE: "INDEX",
  CONCATENAR: "CONCATENATE", IZQUIERDA: "LEFT", DERECHA: "RIGHT", EXTRAE: "MID", LARGO: "LEN", MAYUSC: "UPPER", MINUSC: "LOWER", ESPACIOS: "TRIM",
  HOY: "TODAY", AHORA: "NOW", "AÑO": "YEAR", MES: "MONTH", DIA: "DAY", "DÍA": "DAY", FECHA: "DATE", "MAX.SI.CONJUNTO": "MAXIFS", "MIN.SI.CONJUNTO": "MINIFS", TEXTO: "TEXT", ABS: "ABS",
  VERDADERO: "TRUE", FALSO: "FALSE",
};

/**
 * The formula as Excel stores it: no «=», English function names, commas between arguments and
 * a point for decimals. Bots used to Spanish Excel may write «=SUMA(B2:B9;C2)» or «0,21».
 */
export function normalizeFormula(src) {
  let f = String(src ?? "").trim().replace(/^=+/, "").replace(/^\+/, "");
  const parts = f.split(/("(?:[^"]|"")*")/);
  const semicolons = parts.some((p, i) => i % 2 === 0 && p.includes(";"));
  let depth = 0;
  return parts.map((p, i) => {
    if (i % 2) return p;
    let out = p.replace(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.]*)(?=\s*\()/g, (name) => SPANISH[name.toUpperCase()] || name.toUpperCase());
    out = out.replace(/\b(VERDADERO|FALSO)\b/gi, (w) => SPANISH[w.toUpperCase()]);
    if (semicolons) return out.replace(/(\d),(\d)/g, "$1.$2").replace(/;/g, ",");
    // Outside parentheses a comma cannot separate arguments: «=B2*1,21» is a decimal comma.
    return [...out].map((ch, k) => {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth <= 0 && /\d/.test(out[k - 1] || "") && /\d/.test(out[k + 1] || "")) return ".";
      return ch;
    }).join("");
  }).join("");
}

// ---- references ----
export const colLetter = (c) => { let s = ""; for (c += 1; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s; return s; };
export const colIndex = (letters) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const cellName = (r, c) => colLetter(c) + (r + 1);
/** «Hoja 1» → 'Hoja 1' when Excel needs the quotes. */
export const sheetRef = (name) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !/^[A-Z]{1,3}\d+$/i.test(name) ? name : `'${name.replace(/'/g, "''")}'`);

// ---- tokenizer ----
const SHEET = String.raw`(?:'((?:[^']|'')+)'|([A-Za-z_À-ÿ][\wÀ-ÿ.]*))!`;
const CELL = String.raw`\$?([A-Za-z]{1,3})\$?(\d+)`;
const RE = {
  space: /\s+/y,
  number: /(\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y,
  string: /"((?:[^"]|"")*)"/y,
  error: /#(?:DIV\/0!|REF!|NAME\?|VALUE!|N\/A|NUM!|NULL!)/y,
  range: new RegExp(`(?:${SHEET})?${CELL}(?::${CELL})?(?![\\w(])`, "y"),
  cols: new RegExp(`(?:${SHEET})?\\$?([A-Za-z]{1,3}):\\$?([A-Za-z]{1,3})(?![\\w(])`, "y"),
  name: /[A-Za-z_À-ÿ][\wÀ-ÿ.]*/y,
  op: /<>|<=|>=|[-+*/^&=<>%(),:]/y,
};

function tokenize(src) {
  const out = [];
  let i = 0;
  const at = (re) => { re.lastIndex = i; const m = re.exec(src); if (m) i = re.lastIndex; return m; };
  while (i < src.length) {
    let m;
    if (at(RE.space)) continue;
    if ((m = at(RE.string))) { out.push({ t: "str", v: m[1].replace(/""/g, '"') }); continue; }
    if ((m = at(RE.error))) { out.push({ t: "err", v: m[0] }); continue; }
    if ((m = at(RE.cols))) { out.push({ t: "ref", sheet: (m[1] ?? m[2])?.replace(/''/g, "'") ?? null, r1: 0, c1: colIndex(m[3]), r2: Infinity, c2: colIndex(m[4]) }); continue; }
    if ((m = at(RE.range))) {
      const r1 = Number(m[4]) - 1, c1 = colIndex(m[3]);
      const r2 = m[6] ? Number(m[6]) - 1 : r1, c2 = m[5] ? colIndex(m[5]) : c1;
      out.push({ t: "ref", sheet: (m[1] ?? m[2])?.replace(/''/g, "'") ?? null, r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2), single: !m[6] });
      continue;
    }
    if ((m = at(RE.number))) { out.push({ t: "num", v: Number(m[0]) }); continue; }
    if ((m = at(RE.name))) {
      const name = m[0].toUpperCase();
      if (src[i] === "(") out.push({ t: "fn", v: name });
      else if (name === "TRUE" || name === "FALSE") out.push({ t: "bool", v: name === "TRUE" });
      else out.push({ t: "name", v: m[0] });
      continue;
    }
    if ((m = at(RE.op))) { out.push({ t: "op", v: m[0] }); continue; }
    throw new XError("#VALUE!", `no entiendo «${src.slice(i, i + 12)}»`);
  }
  return out;
}

// ---- parser (Excel precedence: comparison < & < + - < * / < ^ < unary - < %) ----
export function parseFormula(text) {
  const tokens = tokenize(text);
  let k = 0;
  const peek = () => tokens[k], next = () => tokens[k++];
  const isOp = (...ops) => peek()?.t === "op" && ops.includes(peek().v);
  const expect = (v) => { if (!isOp(v)) throw new XError("#VALUE!", `falta «${v}»`); next(); };
  const binary = (sub, ops) => () => {
    let left = sub();
    while (isOp(...ops)) { const op = next().v; left = { k: "bin", op, a: left, b: sub() }; }
    return left;
  };
  const primary = () => {
    const tok = next();
    if (!tok) throw new XError("#VALUE!", "la fórmula está incompleta");
    if (tok.t === "num") return { k: "lit", v: tok.v };
    if (tok.t === "str") return { k: "lit", v: tok.v };
    if (tok.t === "bool") return { k: "lit", v: tok.v };
    if (tok.t === "err") return { k: "lit", v: new XError(tok.v) };
    if (tok.t === "ref") return { k: "ref", ...tok };
    if (tok.t === "name") return { k: "lit", v: new XError("#NAME?", `«${tok.v}» no es una celda ni una función`) };
    if (tok.t === "fn") {
      expect("(");
      const args = [];
      if (!isOp(")")) {
        for (;;) {
          args.push(isOp(",", ")") ? { k: "lit", v: null } : comparison());
          if (isOp(",")) { next(); continue; }
          break;
        }
      }
      expect(")");
      return { k: "fn", name: tok.v, args };
    }
    if (tok.t === "op" && tok.v === "(") { const e = comparison(); expect(")"); return e; }
    throw new XError("#VALUE!", `«${tok.v}» fuera de lugar`);
  };
  const postfix = () => { let e = primary(); while (isOp("%")) { next(); e = { k: "pct", a: e }; } return e; };
  const unary = () => (isOp("-", "+") ? { k: "neg", sign: next().v, a: unary() } : postfix());
  const power = binary(unary, ["^"]);
  const product = binary(power, ["*", "/"]);
  const sum = binary(product, ["+", "-"]);
  const concat = binary(sum, ["&"]);
  const comparison = binary(concat, ["=", "<>", "<", ">", "<=", ">="]);
  const ast = comparison();
  if (k < tokens.length) throw new XError("#VALUE!", `sobra «${tokens[k].v ?? ""}»`);
  return ast;
}

/** Every reference of a formula (to check them before computing). */
export function references(ast, out = []) {
  if (!ast) return out;
  if (ast.k === "ref") out.push(ast);
  for (const key of ["a", "b"]) if (ast[key]) references(ast[key], out);
  if (ast.args) ast.args.forEach((x) => references(x, out));
  return out;
}

// ---- values ----
class Range {
  constructor(rows) { this.rows = rows; }
  get flat() { return this.rows.flat(); }
}
const num = (v) => {
  if (isErr(v) || isUnknown(v)) return v;
  if (v == null || v === "") return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  const n = Number(String(v).trim());
  return String(v).trim() !== "" && Number.isFinite(n) ? n : new XError("#VALUE!", `«${v}» no es un número`);
};
const text = (v) => (v == null ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : typeof v === "number" ? String(+v.toPrecision(15)) : String(v));
const bool = (v) => (isErr(v) || isUnknown(v) ? v : typeof v === "string" ? (v.toUpperCase() === "TRUE" ? true : v.toUpperCase() === "FALSE" ? false : new XError("#VALUE!")) : !!num(v));
const firstBad = (list) => list.find((v) => isErr(v) || isUnknown(v));

function compare(a, b) {
  const rank = (v) => (typeof v === "number" || v == null ? 0 : typeof v === "string" ? 1 : 2);
  if (a == null && typeof b === "string") a = "";
  if (b == null && typeof a === "string") b = "";
  if (a == null) a = 0;
  if (b == null) b = 0;
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a === "string") { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
  return a < b ? -1 : a > b ? 1 : 0;
}

/** «>100», «<>x», «=5», «Ma*»: the predicate of SUMIF/COUNTIF. */
function criteria(c) {
  if (typeof c === "number" || typeof c === "boolean") return (v) => compare(v, c) === 0 && v != null;
  const m = /^(<=|>=|<>|=|<|>)?(.*)$/s.exec(String(c ?? ""));
  const op = m[1] || "=", raw = m[2];
  const n = raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw) : null;
  if (n != null) return (v) => typeof v === "number" && { "=": v === n, "<>": v !== n, "<": v < n, ">": v > n, "<=": v <= n, ">=": v >= n }[op];
  if (op === "=" || op === "<>") {
    const re = new RegExp("^" + raw.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
    return op === "=" ? (v) => (raw === "" ? v == null || v === "" : re.test(text(v))) : (v) => !(raw === "" ? v == null || v === "" : re.test(text(v)));
  }
  return (v) => typeof v === "string" && { "<": compare(v, raw) < 0, ">": compare(v, raw) > 0, "<=": compare(v, raw) <= 0, ">=": compare(v, raw) >= 0 }[op];
}

const excelDate = (serial) => new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
const serialOf = (date) => (date.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
const round = (x, d, mode = Math.round) => { const f = 10 ** d; return mode(Math.abs(x) * f + 1e-9) / f * Math.sign(x); };

// The functions this engine computes. Each gets its arguments evaluated, ranges as Range.
const numbersOf = (args, { strict = true } = {}) => {
  const out = [];
  for (const a of args) {
    if (a instanceof Range) { for (const v of a.flat) { if (isErr(v) || isUnknown(v)) return v; if (typeof v === "number") out.push(v); } }
    else { const n = strict ? num(a) : a; if (isErr(n) || isUnknown(n)) return n; if (typeof n === "number") out.push(n); }
  }
  return out;
};
const agg = (fn) => (args) => { const list = numbersOf(args); return Array.isArray(list) ? fn(list) : list; };
const pairs = (args, name) => {
  const out = [];
  for (let i = 0; i < args.length; i += 2) {
    if (!(args[i] instanceof Range)) return new XError("#VALUE!", `${name} necesita rangos`);
    out.push({ range: args[i].flat, test: criteria(args[i + 1]) });
  }
  return out;
};
const ifs = (target, conds, name) => {
  if (!(target instanceof Range)) return new XError("#VALUE!", `${name} necesita un rango`);
  const t = target.flat, list = pairs(conds, name);
  if (isErr(list)) return list;
  if (list.some((c) => c.range.length !== t.length)) return new XError("#VALUE!", `los rangos de ${name} no tienen el mismo tamaño`);
  return t.filter((_, i) => list.every((c) => c.test(c.range[i])));
};
const strArg = (fn) => (args) => { const bad = firstBad(args.map((a) => (a instanceof Range ? a.flat[0] : a))); return bad || fn(...args.map((a) => text(a instanceof Range ? a.flat[0] : a)), args); };

const FUNCTIONS = {
  SUM: agg((l) => l.reduce((a, b) => a + b, 0)),
  AVERAGE: agg((l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : new XError("#DIV/0!", "no hay números que promediar"))),
  MIN: agg((l) => (l.length ? Math.min(...l) : 0)),
  MAX: agg((l) => (l.length ? Math.max(...l) : 0)),
  MEDIAN: agg((l) => { if (!l.length) return new XError("#NUM!"); const s = [...l].sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; }),
  PRODUCT: agg((l) => l.reduce((a, b) => a * b, 1)),
  COUNT: (args) => args.reduce((n, a) => n + (a instanceof Range ? a.flat.filter((v) => typeof v === "number").length : typeof a === "number" ? 1 : 0), 0),
  COUNTA: (args) => args.reduce((n, a) => n + (a instanceof Range ? a.flat.filter((v) => v != null && v !== "").length : 1), 0),
  COUNTBLANK: (args) => (args[0] instanceof Range ? args[0].flat.filter((v) => v == null || v === "").length : new XError("#VALUE!")),
  ROUND: ([x, d = 0]) => firstBad([num(x), num(d)]) || round(num(x), num(d)),
  ROUNDUP: ([x, d = 0]) => firstBad([num(x), num(d)]) || round(num(x), num(d), Math.ceil),
  ROUNDDOWN: ([x, d = 0]) => firstBad([num(x), num(d)]) || round(num(x), num(d), Math.floor),
  INT: ([x]) => firstBad([num(x)]) || Math.floor(num(x)),
  ABS: ([x]) => firstBad([num(x)]) || Math.abs(num(x)),
  MOD: ([x, y]) => firstBad([num(x), num(y)]) || (num(y) === 0 ? new XError("#DIV/0!") : num(x) - num(y) * Math.floor(num(x) / num(y))),
  POWER: ([x, y]) => firstBad([num(x), num(y)]) || num(x) ** num(y),
  SQRT: ([x]) => firstBad([num(x)]) || (num(x) < 0 ? new XError("#NUM!") : Math.sqrt(num(x))),
  NOT: ([x]) => { const b = bool(x); return isErr(b) || isUnknown(b) ? b : !b; },
  AND: (args) => { const l = args.flatMap((a) => (a instanceof Range ? a.flat.filter((v) => v != null) : [a])).map(bool); return firstBad(l) ?? l.every(Boolean); },
  OR: (args) => { const l = args.flatMap((a) => (a instanceof Range ? a.flat.filter((v) => v != null) : [a])).map(bool); return firstBad(l) ?? l.some(Boolean); },
  SUMIF: ([range, crit, sumRange]) => {
    if (!(range instanceof Range)) return new XError("#VALUE!", "SUMIF necesita un rango");
    const r = range.flat, s = (sumRange instanceof Range ? sumRange : range).flat, test = criteria(crit);
    return r.reduce((t, v, i) => t + (test(v) && typeof s[i] === "number" ? s[i] : 0), 0);
  },
  COUNTIF: ([range, crit]) => (range instanceof Range ? range.flat.filter(criteria(crit)).length : new XError("#VALUE!", "COUNTIF necesita un rango")),
  AVERAGEIF: ([range, crit, avgRange]) => {
    if (!(range instanceof Range)) return new XError("#VALUE!");
    const r = range.flat, s = (avgRange instanceof Range ? avgRange : range).flat, test = criteria(crit);
    const l = r.map((v, i) => (test(v) && typeof s[i] === "number" ? s[i] : null)).filter((v) => v != null);
    return l.length ? l.reduce((a, b) => a + b, 0) / l.length : new XError("#DIV/0!", "ninguna fila cumple la condición");
  },
  SUMIFS: ([target, ...conds]) => { const l = ifs(target, conds, "SUMIFS"); return isErr(l) ? l : l.filter((v) => typeof v === "number").reduce((a, b) => a + b, 0); },
  COUNTIFS: (conds) => { const list = pairs(conds, "COUNTIFS"); if (isErr(list)) return list; const n = list[0]?.range.length || 0; let c = 0; for (let i = 0; i < n; i++) if (list.every((x) => x.test(x.range[i]))) c++; return c; },
  MAXIFS: ([target, ...conds]) => { const l = ifs(target, conds, "MAXIFS"); return isErr(l) ? l : Math.max(0, ...l.filter((v) => typeof v === "number")); },
  MINIFS: ([target, ...conds]) => { const l = ifs(target, conds, "MINIFS"); if (isErr(l)) return l; const n = l.filter((v) => typeof v === "number"); return n.length ? Math.min(...n) : 0; },
  SUMPRODUCT: (args) => {
    if (!args.every((a) => a instanceof Range)) return new XError("#VALUE!");
    const lists = args.map((a) => a.flat);
    if (lists.some((l) => l.length !== lists[0].length)) return new XError("#VALUE!", "los rangos de SUMPRODUCT no tienen el mismo tamaño");
    return lists[0].reduce((t, _, i) => t + lists.reduce((p, l) => p * (typeof l[i] === "number" ? l[i] : 0), 1), 0);
  },
  VLOOKUP: ([key, table, col, approx = true]) => {
    if (!(table instanceof Range)) return new XError("#VALUE!");
    const c = num(col);
    if (isErr(c)) return c;
    if (c < 1 || c > (table.rows[0]?.length || 0)) return new XError("#REF!", "VLOOKUP pide una columna fuera de la tabla");
    let hit = -1;
    if (bool(approx) === false) hit = table.rows.findIndex((r) => compare(r[0], key) === 0);
    else table.rows.forEach((r, i) => { if (r[0] != null && compare(r[0], key) <= 0) hit = i; });
    return hit < 0 ? new XError("#N/A", `no encuentro «${text(key)}»`) : table.rows[hit][c - 1] ?? 0;
  },
  MATCH: ([key, range, type = 1]) => {
    if (!(range instanceof Range)) return new XError("#N/A");
    const l = range.flat, t = num(type);
    let hit = -1;
    if (t === 0) hit = l.findIndex((v) => criteria(typeof key === "string" ? "=" + key : key)(v));
    else l.forEach((v, i) => { if (v != null && (t > 0 ? compare(v, key) <= 0 : compare(v, key) >= 0)) hit = i; });
    return hit < 0 ? new XError("#N/A", `no encuentro «${text(key)}»`) : hit + 1;
  },
  INDEX: ([range, r, c]) => {
    if (!(range instanceof Range)) return new XError("#VALUE!");
    let row = num(r ?? 1), col = num(c ?? 1);
    if (range.rows.length === 1 && c == null) { col = row; row = 1; }
    const v = range.rows[row - 1]?.[col - 1];
    return row < 1 || col < 1 || row > range.rows.length || col > (range.rows[0]?.length || 0) ? new XError("#REF!", "INDEX fuera del rango") : v ?? 0;
  },
  CONCATENATE: (args) => { const l = args.map((a) => (a instanceof Range ? a.flat[0] : a)); return firstBad(l) || l.map(text).join(""); },
  CONCAT: (args) => { const l = args.flatMap((a) => (a instanceof Range ? a.flat : [a])); return firstBad(l) || l.map(text).join(""); },
  LEFT: strArg((s, n = "1") => s.slice(0, Number(n))),
  RIGHT: strArg((s, n = "1") => (Number(n) ? s.slice(-Number(n)) : "")),
  MID: strArg((s, a, n) => s.substr(Number(a) - 1, Number(n))),
  LEN: strArg((s) => s.length),
  UPPER: strArg((s) => s.toUpperCase()),
  LOWER: strArg((s) => s.toLowerCase()),
  TRIM: strArg((s) => s.trim().replace(/\s+/g, " ")),
  TODAY: () => Math.floor(serialOf(new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())))),
  NOW: () => serialOf(new Date()),
  DATE: ([y, m, d]) => firstBad([num(y), num(m), num(d)]) || Math.round(serialOf(new Date(Date.UTC(num(y), num(m) - 1, num(d))))),
  YEAR: ([x]) => firstBad([num(x)]) || excelDate(num(x)).getUTCFullYear(),
  MONTH: ([x]) => firstBad([num(x)]) || excelDate(num(x)).getUTCMonth() + 1,
  DAY: ([x]) => firstBad([num(x)]) || excelDate(num(x)).getUTCDate(),
};
// Lazy: only the branch taken is computed (as Excel does).
const LAZY = {
  IF: (args, ev) => { const c = bool(ev(args[0])); if (isErr(c) || isUnknown(c)) return c; return c ? (args[1] ? ev(args[1]) : true) : (args[2] ? ev(args[2]) : false); },
  IFERROR: (args, ev) => { const v = ev(args[0]); return isErr(v) ? ev(args[1]) : v; },
  IFNA: (args, ev) => { const v = ev(args[0]); return isErr(v) && v.code === "#N/A" ? ev(args[1]) : v; },
};
export const KNOWN = new Set([...Object.keys(FUNCTIONS), ...Object.keys(LAZY)]);

/**
 * Evaluates a parsed formula. ctx: {sheet, cell(sheet, r, c) → value, size(sheet) → {rows, cols} | null}.
 * Ranges stay ranges for the functions that take them; anywhere else a range is its first cell.
 */
export function evaluate(ast, ctx) {
  const ev = (node) => {
    switch (node.k) {
      case "lit": return node.v;
      case "ref": {
        const sheet = node.sheet ?? ctx.sheet;
        const size = ctx.size(sheet);
        if (!size) return new XError("#REF!", `no hay ninguna hoja «${sheet}»`);
        const r2 = node.r2 === Infinity ? Math.max(0, size.rows - 1) : node.r2;
        if (node.single) return ctx.cell(sheet, node.r1, node.c1);
        const rows = [];
        for (let r = node.r1; r <= Math.min(r2, node.r1 + 20000); r++) { const row = []; for (let c = node.c1; c <= Math.min(node.c2, node.c1 + 200); c++) row.push(ctx.cell(sheet, r, c)); rows.push(row); }
        return new Range(rows);
      }
      case "neg": { const v = num(scalar(ev(node.a))); return isErr(v) || isUnknown(v) ? v : node.sign === "-" ? -v : v; }
      case "pct": { const v = num(scalar(ev(node.a))); return isErr(v) || isUnknown(v) ? v : v / 100; }
      case "bin": {
        const a = scalar(ev(node.a)), b = scalar(ev(node.b));
        const bad = firstBad([a, b]);
        if (bad) return bad;
        if (node.op === "&") return text(a) + text(b);
        if (["=", "<>", "<", ">", "<=", ">="].includes(node.op)) {
          const c = compare(a, b);
          return { "=": c === 0, "<>": c !== 0, "<": c < 0, ">": c > 0, "<=": c <= 0, ">=": c >= 0 }[node.op];
        }
        const x = num(a), y = num(b);
        const bad2 = firstBad([x, y]);
        if (bad2) return bad2;
        if (node.op === "/" && y === 0) return new XError("#DIV/0!", "divide entre cero o una celda vacía");
        return { "+": x + y, "-": x - y, "*": x * y, "/": x / y, "^": x ** y }[node.op];
      }
      case "fn": {
        if (LAZY[node.name]) return scalar(LAZY[node.name](node.args, (n) => scalar(ev(n))));
        const fn = FUNCTIONS[node.name];
        if (!fn) return UNKNOWN;
        const args = node.args.map(ev);
        const v = fn(args);
        return v instanceof Range ? v : Number.isNaN(v) ? new XError("#NUM!") : v;
      }
    }
    return new XError("#VALUE!");
  };
  return scalar(ev(ast));
}
const scalar = (v) => (v instanceof Range ? v.rows[0]?.[0] ?? null : v);

export { excelDate, serialOf };
