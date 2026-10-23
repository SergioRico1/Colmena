// Does what a bot learned help? (harness2's measured adaptation, without its grader in the
// loop). Every learned thing that was in play in a finished mission gets an observation of
// how that mission went, taken only from what Colmena already keeps: the person's reactions,
// corrections and stopped actions with their reason, failed tools and rounds, loop guards,
// whether the mission failed or was cancelled, and how long its tools took and how many
// tokens it spent. A verdict per skill version, memory and SOUL change compares those
// observations with how similar work went before:
//   «ayudo» · «empeoro» · «sin-efecto» (no change observed) · «dudoso» (default: attribution unclear)
// Each verdict carries its hint (when it applies) and its confidence. Only «ayudo» with
// medium or high confidence consolidates; «empeoro» with medium or high confidence proposes
// a revert in «Te necesitan». These signals are for measuring only: they never reach the
// reflection or a SOUL proposal (learning.mjs, assertNoApprovalSignals).
import { now } from "./store.mjs";
import { primaryBot, usedSkills, toolOutcomes, tokens, jaccard } from "./learning.mjs";
import { activateSkill } from "./skills.mjs";
import { writeSoul } from "./soul.mjs";
import { forget } from "./forgotten.mjs";

export const VERDICTS = ["ayudo", "empeoro", "sin-efecto", "dudoso"];
export const VERDICT_LABELS = Object.freeze({ ayudo: "Ayudó", empeoro: "Empeoró", "sin-efecto": "Sin efecto observado", dudoso: "Dudoso" });
export const CONFIDENCE_LABELS = Object.freeze({ baja: "confianza baja", media: "confianza media", alta: "confianza alta" });
const SCORE = { bien: 1, regular: 0.6, mal: 0 };
const POSITIVE = new Set(["👍", "✅", "🙌", "🙏", "❤️", "🎉", "🔥", "💯", "👏", "😍", "🥳", "⭐"]);
const NEGATIVE = new Set(["👎", "😕", "😞", "😠", "😡", "❌", "🙁", "☹️", "😬", "🤦"]);

/** The person pushing back: «no, así no», «mejor…», «demasiado largo», «te has equivocado». */
export const CORRECTION = /\b(?:no|mejor|prefiero|preferir[ií]a|demasiad[oa]s?|cambia|corrige|otra vez|as[ií] no|en vez de|en lugar de|m[aá]s (?:breve|corto|largo|claro|formal|cercano)|menos|sin|quita|evita|est[aá] mal|te has equivocado|no es eso)\b/i;
export const isCorrection = (text) => CORRECTION.test(String(text || ""));

const clip = (t, n) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const time = (v) => Date.parse(v || "") || 0;

/** How a mission ended: completada, fallida, cancelada, limitada (environment) or null while it runs. */
export function missionEnding(mission) {
  if (!mission) return null;
  if (mission.status === "completed") return "completada";
  if (mission.status === "cancelled") return "cancelada";
  if (mission.status === "blocked") return "fallida";
  if (mission.status === "paused" && (mission.limited || mission.error)) return "limitada";
  return null;
}

/**
 * Everything Colmena kept about how a mission went, as counts (never shown to a bot):
 * {ending, corrections, denials, reasons, positive, negative, toolFailures, stuckRounds,
 *  guards, providerRetries, toolMs, tokens, outcome: 'bien'|'regular'|'mal'|null}.
 */
export function missionSignals(store, missionId) {
  const mission = store.get("missions", missionId);
  const ending = missionEnding(mission);
  const messages = store.where("messages", "missionId", missionId);
  const own = messages.filter((m) => m.role === "user" && typeof m.text === "string");
  const corrections = own.slice(1).filter((m) => !mission?.conversation || isCorrection(m.text)).length;
  const approvals = store.where("approvals", "missionId", missionId).filter((a) => !["skill", "soul", "revert", "plan"].includes(a.kind));
  const denied = approvals.filter((a) => a.status === "denied" && a.decidedBy === "tú" && a.resolution !== "Misión cancelada");
  const approved = approvals.filter((a) => ["approved", "executed"].includes(a.status) && a.decidedBy === "tú" && !a.editedAt).length;
  let positive = 0, negative = 0;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const r of Array.isArray(m.reactions) ? m.reactions : []) {
      if (r?.by !== "user") continue;
      if (POSITIVE.has(r.emoji)) positive++;
      else if (NEGATIVE.has(r.emoji)) negative++;
    }
  }
  const steps = store.where("steps", "missionId", missionId);
  const toolFailures = toolOutcomes(store, missionId).reduce((n, o) => n + o.fallos, 0) - denied.length;
  const stuckRounds = steps.reduce((n, s) => n + (s.failedRounds || 0) + (s.stalled ? 1 : 0), 0);
  const guards = messages.filter((m) => m.kind === "guard").length;
  const providerRetries = steps.reduce((n, s) => n + (s.recovery || []).length, 0);
  let toolMs = 0;
  for (const step of steps)
    for (const call of (step.history || []).filter((x) => x.type === "function_call"))
      toolMs += store.get("receipts", step.id + ":" + call.call_id)?.ms || 0;
  const spent = store.where("usage", "missionId", missionId).filter((u) => u.stepId).reduce((n, u) => n + (u.tokens || 0), 0);
  const signals = {
    ending, corrections, denials: denied.length, reasons: denied.filter((a) => String(a.denyReason || "").trim()).length, approved,
    positive, negative, toolFailures: Math.max(0, toolFailures), stuckRounds, guards, providerRetries, toolMs, tokens: spent,
  };
  signals.outcome = outcomeOf(signals);
  return signals;
}

/** bien · regular · mal, or null for endings that say nothing about the bot (limits). */
export function outcomeOf(s) {
  if (!s.ending || s.ending === "limitada") return null;
  if (["fallida", "cancelada"].includes(s.ending)) return "mal";
  if (s.corrections || s.denials || s.guards || s.toolFailures >= 3 || s.stuckRounds >= 2 || (s.negative && !s.positive)) return "mal";
  if (s.positive || s.approved) return "bien";
  return "regular";
}

// ---------- observations: what was in play in a mission ----------
/** Learned things a bot carried into a mission: loaded skill versions, related learned memories, its SOUL change. */
export function inPlay(store, mission, bot) {
  const out = [];
  for (const s of usedSkills(store, mission.id)) out.push({ kind: "skill", targetId: s.id, attribution: "clara" });
  const started = time(mission.createdAt) || Date.now();
  const topic = tokens([mission.prompt, ...store.where("messages", "missionId", mission.id).filter((m) => m.role === "user").map((m) => m.text)].join(" "));
  const memories = store.list("memories")
    .filter((m) => m.active !== false && m.source !== "dijiste" && m.botId === bot.id && m.missionId !== mission.id && time(m.createdAt) < started)
    .map((m) => ({ m, score: jaccard(topic, tokens(m.text)) }))
    .filter((x) => x.score >= 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  for (const { m } of memories) out.push({ kind: "memory", targetId: m.id, attribution: "debil" });
  const soul = store.list("approvals")
    .filter((a) => a.kind === "soul" && a.botId === bot.id && a.status === "executed" && time(a.decidedAt) && time(a.decidedAt) < started)
    .sort((a, b) => time(b.decidedAt) - time(a.decidedAt))[0];
  if (soul) out.push({ kind: "soul", targetId: soul.id, attribution: "debil" });
  return out;
}

/**
 * Records (or refreshes) one observation per learned thing in play in a finished mission and
 * recomputes their verdicts. Running missions and limits (environment) are not observed.
 * Returns the verdicts touched.
 */
export function observeMission(store, missionId) {
  const mission = store.get("missions", missionId);
  if (!mission || mission.incognito || !missionEnding(mission)) return [];
  const bot = store.get("bots", primaryBot(mission));
  if (!bot) return [];
  const signals = missionSignals(store, missionId);
  if (!signals.outcome) return [];
  const touched = [];
  for (const t of inPlay(store, mission, bot)) {
    store.put("learningObservations", {
      id: `${t.kind}:${t.targetId}:${missionId}`, kind: t.kind, targetId: t.targetId, botId: bot.id, missionId,
      at: mission.createdAt || now(), attribution: t.attribution, outcome: signals.outcome, score: SCORE[signals.outcome],
      signals, observedAt: now(),
    });
    touched.push(computeVerdict(store, t.kind, t.targetId));
  }
  return touched.filter(Boolean);
}

/** Missions finished in the last `days` days are observed again: reactions and corrections arrive late. */
export function refreshObservations(store, { at = Date.now(), days = 3 } = {}) {
  let n = 0;
  for (const m of store.list("missions")) {
    if (!missionEnding(m) || at - time(m.completedAt || m.createdAt) > days * 86400000) continue;
    n += observeMission(store, m.id).length;
  }
  return n;
}

// ---------- baselines: how similar work went before ----------
function pastOutcomes(store, botId, before, like, limit = 10) {
  const out = [];
  const missions = store.list("missions")
    .filter((m) => primaryBot(m) === botId && time(m.createdAt) < before && missionEnding(m) && !m.incognito)
    .filter((m) => !like || jaccard(like, tokens(m.prompt)) >= 0.3)
    .sort((a, b) => time(b.createdAt) - time(a.createdAt));
  for (const m of missions) {
    const s = missionSignals(store, m.id);
    if (s.outcome) out.push({ score: SCORE[s.outcome], toolMs: s.toolMs, tokens: s.tokens });
    if (out.length >= limit) break;
  }
  return out;
}

function baselineOf(store, kind, target, obs) {
  if (kind === "skill") {
    // Earlier versions of the same skill, measured the same way; else the same bot's similar work before it existed.
    const versions = store.list("skills").filter((s) => s.name === target.name && (s.botId ?? null) === (target.botId ?? null) && (s.version || 1) < (target.version || 1));
    const prior = versions.flatMap((v) => store.where("learningObservations", "targetId", v.id)).filter((o) => o.kind === "skill");
    if (prior.length) return prior.map((o) => ({ score: o.score, toolMs: o.signals?.toolMs || 0, tokens: o.signals?.tokens || 0 }));
    const like = tokens(target.name + " " + target.description + " " + obs.map((o) => store.get("missions", o.missionId)?.prompt || "").join(" "));
    return pastOutcomes(store, target.botId || obs[0]?.botId, time(target.createdAt), like);
  }
  const botId = obs[0]?.botId || target.botId;
  if (kind === "memory") {
    const like = tokens(target.text + " " + obs.map((o) => store.get("missions", o.missionId)?.prompt || "").join(" "));
    return pastOutcomes(store, botId, time(target.createdAt), like);
  }
  return pastOutcomes(store, botId, time(target.decidedAt), null);
}

function targetOf(store, kind, targetId) {
  if (kind === "skill") return store.get("skills", targetId);
  if (kind === "memory") return store.get("memories", targetId);
  if (kind === "soul") return store.get("approvals", targetId);
  return null;
}

/** When the verdict applies, in plain words. */
function hintOf(store, kind, target, obs) {
  const rooms = obs.map((o) => store.get("missions", o.missionId)).filter(Boolean);
  const named = rooms.map((m) => clip(m.title || m.prompt, 50)).filter(Boolean);
  const where = named.length ? `«${named[0]}»` + (named.length > 1 ? ` y ${named.length - 1} ${named.length === 2 ? "tarea más" : "tareas más"}` : "") : "sus tareas";
  if (kind === "skill") {
    const when = String(target.description || "").replace(/^\s*Úsala\s+cuando\s*/i, "").replace(/[.\s]+$/, "");
    return (when ? "Cuando " + clip(when, 90) : "Cuando la carga") + " · medido en " + where;
  }
  if (kind === "memory") {
    const shared = [...tokens(target.text)].filter((t) => rooms.some((m) => tokens(m.prompt).has(t))).slice(0, 3);
    return (shared.length ? "Cuando la tarea trata de " + shared.join(", ") : "En tareas parecidas") + " · medido en " + where;
  }
  return "En su trabajo desde el cambio · medido en " + where;
}

/**
 * Verdict of one learned thing from its observations against its baseline:
 * {id, kind, targetId, botId, value, confidence, hint, n, baseline, summary, updatedAt}.
 */
export function computeVerdict(store, kind, targetId) {
  const target = targetOf(store, kind, targetId);
  if (!target) return null;
  const obs = store.where("learningObservations", "targetId", targetId).filter((o) => o.kind === kind && o.outcome);
  if (!obs.length) return null;
  const clear = obs.every((o) => o.attribution === "clara");
  const base = baselineOf(store, kind, target, obs);
  const n = obs.length, bn = base.length;
  const score = mean(obs.map((o) => o.score));
  let delta = bn ? score - mean(base.map((b) => b.score)) : null;
  // Cost as a tiebreaker: the same result with clearly less tool time or tokens counts a little.
  const cost = (list, key) => median(list.map((x) => x[key] || 0).filter((x) => x > 0));
  const faster = (key) => { const a = cost(obs.map((o) => o.signals || {}), key), b = cost(base, key); return a && b ? (b - a) / b : 0; };
  const saving = Math.max(faster("toolMs"), faster("tokens"));
  if (delta !== null && Math.abs(delta) < 0.25) delta += saving >= 0.3 ? 0.1 : saving <= -0.5 ? -0.1 : 0;
  let value = "dudoso";
  if (n >= 2) {
    if (delta === null) {
      if (clear && obs.every((o) => o.outcome === "mal")) value = "empeoro";
      else if (clear && n >= 4 && score >= 0.9) value = "ayudo";
    } else if (delta >= 0.25) value = "ayudo";
    else if (delta <= -0.25) value = "empeoro";
    else if (n >= 3) value = "sin-efecto";
  }
  let confidence = "baja";
  if (value !== "dudoso") {
    if (clear) {
      if (n >= 6 && bn >= 4 && (value === "sin-efecto" || Math.abs(delta ?? 0) >= 0.35)) confidence = "alta";
      else if (n >= 3 || (n >= 2 && value === "empeoro")) confidence = "media";
    } else if (n >= 5 && bn >= 3) confidence = "media";
  }
  const bad = obs.filter((o) => o.outcome === "mal").length, good = obs.filter((o) => o.outcome === "bien").length;
  const summary = `${n} ${n === 1 ? "tarea medida" : "tareas medidas"}: ${good} bien, ${n - good - bad} sin quejas, ${bad} con problemas` +
    (bn ? ` · antes, ${Math.round(mean(base.map((b) => b.score)) * 100)} % de acierto en ${bn}` : " · sin referencia de antes") +
    (Math.abs(saving) >= 0.3 ? (saving > 0 ? " · más rápido" : " · más lento") : "");
  const record = {
    id: kind + ":" + targetId, kind, targetId, botId: obs[0].botId, value, confidence, hint: hintOf(store, kind, target, obs),
    n, baseline: bn, delta: delta === null ? null : Math.round(delta * 100) / 100, summary, updatedAt: now(),
  };
  const previous = store.get("verdicts", record.id);
  store.put("verdicts", { ...record, history: [...(previous?.history || []), ...(previous && previous.value !== value ? [{ value: previous.value, confidence: previous.confidence, at: previous.updatedAt }] : [])].slice(-10) });
  const consolidated = value === "ayudo" && ["media", "alta"].includes(confidence);
  const view = { value, confidence, hint: record.hint, summary, n, at: record.updatedAt };
  const kindOf = { skill: "skills", memory: "memories", soul: "approvals" }[kind];
  store.patch(kindOf, targetId, { verdict: view, consolidated, ...(consolidated && !target.consolidatedAt ? { consolidatedAt: now() } : {}) });
  if (value === "empeoro" && confidence !== "baja") proposeRevert(store, kind, store.get(kindOf, targetId), record);
  return record;
}

/** Verdicts of a bot (or all), newest first, with labels for the UI. */
export function listVerdicts(store, { botId = null } = {}) {
  return store.list("verdicts")
    .filter((v) => !botId || v.botId === botId)
    .sort((a, b) => time(b.updatedAt) - time(a.updatedAt))
    .map((v) => ({ ...v, label: VERDICT_LABELS[v.value], confidenceLabel: CONFIDENCE_LABELS[v.confidence], title: titleOf(store, v) }));
}
function titleOf(store, v) {
  const t = targetOf(store, v.kind, v.targetId);
  if (!t) return null;
  if (v.kind === "skill") return `«${t.name}» v${t.version || 1}`;
  if (v.kind === "memory") return `«${clip(t.text, 80)}»`;
  return "Cambio de carácter del " + new Date(t.decidedAt || t.createdAt || Date.now()).toLocaleDateString("es-ES", { day: "numeric", month: "long" });
}

// ---------- «Lo que empeoró se propone revertir» ----------
function proposeRevert(store, kind, target, verdict) {
  if (!target) return null;
  const key = "revert:" + kind + ":" + target.id;
  if (store.get("approvals", key)) return null; // asked once: the person's answer stands
  if (kind === "skill" && target.status !== "active") return null;
  if (kind === "memory" && target.active === false) return null;
  const bot = store.get("bots", verdict.botId);
  const who = bot?.name || "Un bot";
  let title, summary, revert;
  if (kind === "skill") {
    const prior = target.previous ? store.get("skills", target.previous) : null;
    title = prior ? `Volver a la versión ${prior.version || 1} de «${target.name}»` : `Dejar de usar «${target.name}»`;
    summary = `Desde que ${who} usa la versión ${target.version || 1}, el trabajo va peor (${verdict.summary}).`;
    revert = { kind, targetId: target.id, previousId: prior?.id || null };
  } else if (kind === "memory") {
    title = `Olvidar «${clip(target.text, 80)}»`;
    summary = `Desde que ${who} lo recuerda, el trabajo parecido va peor (${verdict.summary}).`;
    revert = { kind, targetId: target.id };
  } else {
    title = `Deshacer el último cambio de carácter de ${who}`;
    summary = `Desde ese cambio, su trabajo va peor (${verdict.summary}).`;
    revert = { kind, targetId: target.id };
  }
  const approval = store.put("approvals", {
    id: key, missionId: null, botId: verdict.botId, kind: "revert", title, summary, context: `${who} · ${verdict.hint}`,
    blocks: 0, options: [], email: null, canAlways: false, revert, status: "pending", createdAt: now(), decidedAt: null, decidedBy: null, resolution: null,
  });
  return approval;
}

/** The person's answer to a revert proposal. Approved: put it back as it was and never learn it again. */
export function decideRevert(store, approval, decision) {
  if (decision !== "approved") {
    return store.patch("approvals", approval.id, { status: "denied", decidedAt: now(), decidedBy: "tú", resolution: "Se queda como está" });
  }
  const { kind, targetId, previousId } = approval.revert || {};
  if (kind === "skill") {
    const skill = store.get("skills", targetId);
    if (skill) {
      if (previousId && store.get("skills", previousId)) activateSkill(store, previousId, "active");
      else activateSkill(store, targetId, "disabled");
      forget(store, skill.version > 1 ? "skill-patch" : "skill", skill.version > 1 ? skill.content : skill.name, skill.botId ?? null, { reason: "revert" });
    }
  } else if (kind === "memory") {
    const memory = store.get("memories", targetId);
    if (memory) {
      store.patch("memories", targetId, { active: false, removedAt: now(), removedBy: "tú", reverted: true });
      forget(store, "memory", memory.text, null, { reason: "revert" });
    }
  } else if (kind === "soul") {
    const change = store.get("approvals", targetId);
    if (change?.current) {
      writeSoul(change.botId, change.current, { source: "restaurado", reason: "Deshecho porque el trabajo iba peor" });
      forget(store, "soul", change.proposal, change.botId, { reason: "revert" });
    }
  }
  return store.patch("approvals", approval.id, { status: "executed", decidedAt: now(), decidedBy: "tú", resolution: "Vuelto atrás" });
}
