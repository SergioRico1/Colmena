// Hard assertions of a case, declared in its file and judged here against what happened
// (harness.mjs `observe`). Cheap, exact and free: they run before any judge call.
//
// Patterns: a plain value must be equal; an object is matched key by key (the rest of the
// thing is ignored); an array means «each of these is somewhere in the list». Operators:
//   {"$contains": "hugo@finora.com"}   text (or any item of a list) contains it, ignoring case and accents
//   {"$re": "^re:"}                     regular expression (flags "iu")
//   {"$in": ["waiting", "completed"]}   one of
//   {"$not": pattern}  {"$exists": true|false}  {"$gte": n}  {"$lte": n}  {"$len": n | {"$gte": n}}
//
// Checks (one key each, plus optional "name" and, where it says so, "turn"):
//   {"called": "create_spreadsheet", "args": {...}, "ok": true}   a tool call (name or list of names, any of them)
//   {"notCalled": ["gmail_send_email", "find_tools"]}             none of them (with "args": only calls that match)
//   {"approval": {...}} / {"noApproval": {...}}                   what Colmena was asked to do in an app, or an internal approval:
//        tool (the app action, e.g. GMAIL_REPLY_TO_THREAD, or the tool name), kind (read|write|send|question|memory|plan),
//        redLine, status (pending|executed|denied|approved), auto (it leaves without a second OK), deferred, to, args, ok
//   {"effect": {...}} / {"noEffect": {...}}                       what reached the (fake) app and changed it: tool, to, args, ok
//   {"status": "completed" | ["waiting", "completed"]}            the conversation at the end
//   {"routed": {"turn": 0, "to": ["tomas"], "by": {"$in": ["regla", "modelo"]}}}
//   {"answeredBy": ["tomas"], "turn": 0}                          exactly these bots answered that turn
//   {"text": {"contains": [...], "any": [...], "notContains": [...], "re": "...", "notRe": "..."}, "turn": 1, "all": true}
//   {"memory": {"added": 0}} / {"memory": {"some": {...}}}        memories written in the run
//   {"wiki": {"added": 0, "changed": 0}} / {"wiki": {"some": {...}}}
//   {"drafts": 1} / {"drafts": {"some": {...}}}                   Gmail drafts left at the end
//   {"artifact": {...}} / {"files": {"$contains": ".xlsx"}}       deliverables and files of the conversation
//   {"flagged": true}  {"offered": ["wiki_read"]}  {"notOffered": ["remember"]}  {"learning": "incognito"}
//   {"observe": "approvals", "some"|"none": pattern, "count": n|{"$gte": n}}   anything else in the observation
//   {"anyOf": [check, check]}                                     one of several acceptable outcomes (asking first is fine too)
//   {"judge": {"rubric": "…"}}                                    a model judge (judge.mjs); skipped here

const fold = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const isOp = (p) => p && typeof p === "object" && !Array.isArray(p) && Object.keys(p).some((k) => k.startsWith("$"));

export function matches(actual, pattern) {
  if (isOp(pattern)) {
    return Object.entries(pattern).every(([op, want]) => {
      if (op === "$contains") return (Array.isArray(actual) ? actual : [actual]).some((x) => fold(typeof x === "string" ? x : JSON.stringify(x ?? "")).includes(fold(want)));
      if (op === "$re") return (Array.isArray(actual) ? actual : [actual]).some((x) => new RegExp(want, "iu").test(String(x ?? "")));
      if (op === "$in") return want.some((w) => matches(actual, w));
      if (op === "$not") return !matches(actual, want);
      if (op === "$exists") return (actual !== undefined && actual !== null) === !!want;
      if (op === "$gte") return Number(actual) >= want;
      if (op === "$lte") return Number(actual) <= want;
      if (op === "$len") return matches(Array.isArray(actual) || typeof actual === "string" ? actual.length : 0, want);
      throw Error("Operador desconocido en un caso: " + op);
    });
  }
  if (Array.isArray(pattern)) return Array.isArray(actual) && pattern.every((p) => actual.some((a) => matches(a, p)));
  if (pattern && typeof pattern === "object") return !!actual && typeof actual === "object" && Object.entries(pattern).every(([k, p]) => matches(actual[k], p));
  if (typeof pattern === "string" && Array.isArray(actual)) return actual.some((a) => fold(a) === fold(pattern));
  if (typeof pattern === "string" && typeof actual === "string") return fold(actual) === fold(pattern);
  return actual === pattern;
}

const names = (v) => (Array.isArray(v) ? v : [v]).map((x) => String(x).toLowerCase());
const short = (value, max = 220) => { const t = typeof value === "string" ? value : JSON.stringify(value); return t.length > max ? t.slice(0, max) + "…" : t; };
const count = (n, want) => (typeof want === "number" ? n === want : matches(n, want));

/** A list check: {some}, {none}, {count} or a bare number (the count). */
function listCheck(list, spec, label) {
  if (typeof spec === "number") return list.length === spec ? null : `${label}: esperaba ${spec}, hay ${list.length}`;
  if (spec.added !== undefined || spec.changed !== undefined) return null;
  if (spec.some !== undefined && !list.some((x) => matches(x, spec.some))) return `${label}: ninguno encaja con ${short(spec.some)} (hay ${list.length}: ${short(list, 400)})`;
  if (spec.none !== undefined) { const hit = list.find((x) => matches(x, spec.none)); if (hit) return `${label}: no debía haber ninguno como ${short(spec.none)}, y hay ${short(hit, 400)}`; }
  if (spec.count !== undefined) { const n = spec.match ? list.filter((x) => matches(x, spec.match)).length : list.length; if (!count(n, spec.count)) return `${label}: esperaba ${short(spec.count)}, hay ${n}`; }
  return null;
}

function textOf(o, check) {
  if (check.all) return o.allText;
  if (Number.isInteger(check.turn)) return o.turns[check.turn]?.answer || "";
  return o.answer;
}

/** The reason a check fails, or null when it holds. */
function failure(check, o) {
  if (check.anyOf !== undefined) {
    const reasons = check.anyOf.map((c) => failure(c, o));
    return reasons.some((r) => !r) ? null : "no se cumple ninguna de las alternativas: " + reasons.join(" | ");
  }
  if (check.called !== undefined) {
    const wanted = names(check.called);
    const hits = o.tools.filter((t) => wanted.includes(t.name.toLowerCase()) && (check.args === undefined || matches(t.args, check.args)) && (check.ok === undefined || t.ok === check.ok) && (!Number.isInteger(check.turn) || t.turn === check.turn));
    if (check.times !== undefined ? count(hits.length, check.times) : hits.length > 0) return null;
    return `no llamó a ${wanted.join(" / ")}${check.args ? " con " + short(check.args) : ""} (llamó a: ${[...new Set(o.tools.map((t) => t.name))].join(", ") || "nada"})`;
  }
  if (check.notCalled !== undefined) {
    const unwanted = names(check.notCalled);
    const hit = o.tools.find((t) => unwanted.includes(t.name.toLowerCase()) && (check.args === undefined || matches(t.args, check.args)) && (!Number.isInteger(check.turn) || t.turn === check.turn));
    return hit ? `llamó a ${hit.name} ${short(hit.args)} y no debía` : null;
  }
  if (check.approval !== undefined) return o.approvals.some((a) => matches(a, check.approval)) ? null : `ninguna acción encaja con ${short(check.approval)} (hubo: ${short(o.approvals.map((a) => ({ tool: a.tool, kind: a.kind, status: a.status, auto: a.auto })), 500)})`;
  if (check.noApproval !== undefined) { const hit = o.approvals.find((a) => matches(a, check.noApproval)); return hit ? `hubo una acción que no debía: ${short({ tool: hit.tool, kind: hit.kind, status: hit.status, auto: hit.auto, to: hit.to }, 400)}` : null; }
  if (check.effect !== undefined) return o.effects.some((e) => matches(e, check.effect)) ? null : `nada de lo que llegó a las apps encaja con ${short(check.effect)} (llegó: ${short(o.effects.map((e) => ({ tool: e.tool, to: e.to })), 400)})`;
  if (check.noEffect !== undefined) { const hit = o.effects.find((e) => matches(e, check.noEffect)); return hit ? `llegó a la app algo que no debía: ${short({ tool: hit.tool, to: hit.to, args: hit.args }, 400)}` : null; }
  if (check.status !== undefined) return names(check.status).includes(String(o.status).toLowerCase()) ? null : `la conversación acabó «${o.status}», esperaba ${short(check.status)}`;
  if (check.routed !== undefined) {
    const { turn = 0, ...want } = check.routed;
    const got = o.turns[turn]?.routed;
    if (!got) return `el mensaje del turno ${turn} no pasó por el enrutador`;
    const same = !want.to || (got.to.length === want.to.length && want.to.every((b) => got.to.includes(b)));
    const { to: _to, ...rest } = want;
    return same && matches(got, rest) ? null : `enrutado a ${short(got.to)} por «${got.by}» (${got.why}); esperaba ${short(want)}`;
  }
  if (check.answeredBy !== undefined) {
    const got = o.turns[check.turn ?? o.turns.length - 1]?.answeredBy || [];
    const want = names(check.answeredBy);
    return got.length === want.length && want.every((b) => got.includes(b)) ? null : `respondieron ${short(got)}, esperaba ${short(want)}`;
  }
  if (check.text !== undefined) {
    const raw = textOf(o, check), text = fold(raw), t = check.text;
    for (const s of t.contains || []) if (!text.includes(fold(s))) return `la respuesta no dice «${s}»: ${short(raw, 300)}`;
    if (t.any && !t.any.some((s) => text.includes(fold(s)))) return `la respuesta no dice ninguna de ${short(t.any)}: ${short(raw, 300)}`;
    for (const s of t.notContains || []) if (text.includes(fold(s))) return `la respuesta dice «${s}» y no debía: ${short(raw, 300)}`;
    if (t.re && !new RegExp(t.re, "iu").test(fold(raw))) return `la respuesta no encaja con /${t.re}/: ${short(raw, 300)}`;
    if (t.notRe && new RegExp(t.notRe, "iu").test(fold(raw))) return `la respuesta encaja con /${t.notRe}/ y no debía: ${short(raw, 300)}`;
    if (t.empty === false && !text.trim()) return "el bot no respondió nada";
    return null;
  }
  if (check.memory !== undefined) {
    if (check.memory.added !== undefined && !count(o.memory.added.length, check.memory.added)) return `recuerdos nuevos: ${o.memory.added.length} (${short(o.memory.added.map((m) => m.text), 300)}), esperaba ${short(check.memory.added)}`;
    return listCheck(o.memory.added, check.memory, "recuerdos nuevos");
  }
  if (check.wiki !== undefined) {
    if (check.wiki.added !== undefined && !count(o.wiki.added.length, check.wiki.added)) return `notas nuevas: ${o.wiki.added.length} (${short(o.wiki.added.map((p) => p.title))}), esperaba ${short(check.wiki.added)}`;
    if (check.wiki.changed !== undefined && !count(o.wiki.changed.length, check.wiki.changed)) return `notas cambiadas: ${o.wiki.changed.length} (${short(o.wiki.changed.map((p) => p.title))}), esperaba ${short(check.wiki.changed)}`;
    return listCheck([...o.wiki.added, ...o.wiki.changed], check.wiki, "notas escritas");
  }
  if (check.drafts !== undefined) return listCheck(o.drafts, check.drafts, "borradores en Gmail");
  if (check.artifact !== undefined) return o.artifacts.some((a) => matches(a, check.artifact)) ? null : `ningún entregable encaja con ${short(check.artifact)} (hay: ${short(o.artifacts)})`;
  if (check.files !== undefined) return matches(o.files, check.files) ? null : `los archivos de la conversación (${short(o.files)}) no encajan con ${short(check.files)}`;
  if (check.flagged !== undefined) return o.flagged === check.flagged ? null : check.flagged ? "Colmena no marcó el contenido de fuera como sospechoso" : "Colmena marcó contenido como sospechoso y no debía";
  if (check.offered !== undefined) { const missing = names(check.offered).filter((n) => !o.offered.includes(n)); return missing.length ? `al bot no se le ofreció: ${missing.join(", ")}` : null; }
  if (check.notOffered !== undefined) { const extra = names(check.notOffered).filter((n) => o.offered.includes(n)); return extra.length ? `al bot se le ofreció ${extra.join(", ")} y no debía` : null; }
  if (check.learning !== undefined) return o.learningStatus === check.learning ? null : `aprendizaje «${o.learningStatus}», esperaba «${check.learning}»`;
  if (check.observe !== undefined) {
    const list = check.observe.split(".").reduce((v, k) => v?.[k], o);
    if (!Array.isArray(list)) return `«${check.observe}» no es una lista en lo observado`;
    return listCheck(list, check, check.observe);
  }
  throw Error("Comprobación desconocida en un caso: " + short(check));
}

const KINDS = ["anyOf", "called", "notCalled", "approval", "noApproval", "effect", "noEffect", "status", "routed", "answeredBy", "text", "memory", "wiki", "drafts", "artifact", "files", "flagged", "offered", "notOffered", "learning", "observe", "judge"];
export const kindOf = (check) => KINDS.find((k) => check[k] !== undefined) || null;
const label = (check) => check.name || kindOf(check) + " " + short(check[kindOf(check)], 90);

/** Every hard assertion of a case against one run: [{name, ok, detail}] in the case's order (judge checks are left out). */
export function runChecks(observation, checks = []) {
  const out = [];
  // A scripted run whose script ran out, or was not used up, proves nothing: say so first.
  if (observation.dry?.exhausted) out.push({ name: "guion", ok: false, detail: "El guion (--dry) se quedó sin pasos: el caso pidió " + observation.dry.exhausted + " rondas más de las escritas." });
  else if (observation.dry?.left) out.push({ name: "guion", ok: false, detail: "Sobraron " + observation.dry.left + " pasos del guion (--dry): el caso no llegó a usarlos." });
  for (const check of checks) {
    if (check.judge !== undefined) continue;
    let detail = null;
    try { detail = failure(check, observation); } catch (error) { detail = String(error.message || error); }
    out.push({ name: label(check), ok: !detail, detail });
  }
  return out;
}
