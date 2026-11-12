// One run of one case: a fresh temporary data folder, a real Runtime and the real send guards
// (Connections) over a faked boundary, the case's turns, and what happened — as plain data
// the checks (checks.mjs) and the judge (judge.mjs) read.
import { mkdtemp, rm, mkdir, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store, id as newId, withBotDefaults } from "../../server/store.mjs";
import { Runtime } from "../../server/runtime.mjs";
import { Connections } from "../../server/connections.mjs";
import { AppTools } from "../../server/apptools.mjs";
import { Scheduler } from "../../server/scheduler.mjs";
import { wikiExtraTools } from "../../server/wiki-tools.mjs";
import { createPage, listPages, getPage, PERSON } from "../../server/wiki.mjs";
import { returnNoteText } from "../../server/computer/routes.mjs";
import { flushMemoryUse } from "../../server/memory.mjs";
import { EVAL_FAKE, FakeHub, fakeWeb } from "./fakes.mjs";
import { DryProvider, newMeter } from "./provider.mjs";

const iso = (agoSeconds = 0) => new Date(Date.now() - agoSeconds * 1000).toISOString();
const clip = (value, max = 4000) => { const text = typeof value === "string" ? value : JSON.stringify(value ?? null); return text.length > max ? text.slice(0, max) + "…" : text; };

/** The real data folder of the installed app: an eval never works inside it. */
export function realDataDir(env = process.env) {
  return path.resolve(env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "Colmena");
}
function assertOutsideRealData(directory) {
  const real = realDataDir().toLowerCase(), mine = path.resolve(directory).toLowerCase();
  if (mine === real || mine.startsWith(real + path.sep)) throw Object.assign(Error("Evaluación detenida por seguridad: no puede trabajar dentro de la carpeta de datos real de Colmena."), { code: "COLMENA_EVAL_UNSAFE" });
}

/**
 * Everything a case runs in. `makeProvider(store)` gives the model (the real provider layer,
 * or nothing for the scripted one). Throws before any model call when a boundary is not a
 * fake: that is the harness's own safety check, not something a case can switch off.
 */
export async function buildWorld(kase, { makeProvider = null, model = "eval-dry" } = {}) {
  const setup = kase.setup || {};
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-eval-"));
  assertOutsideRealData(directory);
  const store = new Store(directory);
  store.patch("settings", "main", { model, learning: false, onboarded: true, userName: "Marina", ...(setup.settings || {}) });
  for (const [botId, patch] of Object.entries(setup.bots || {})) {
    if (store.get("bots", botId)) store.patch("bots", botId, (old) => ({ ...patch, ...(patch.tools ? { tools: { ...old.tools, ...patch.tools } } : {}) }));
    else store.put("bots", withBotDefaults({ id: botId, name: botId, role: "", instructions: "", builtin: false, createdAt: iso(), ...patch }));
  }
  const hub = new FakeHub(setup.apps || {});
  const connections = new Connections(store, hub);
  const web = fakeWeb(setup.web || {});
  const dry = !makeProvider;
  const provider = dry ? new DryProvider() : makeProvider(store);
  const runtime = new Runtime(store, provider, connections, {
    web, routing: true, seed: true, suggest: false, review: false, autoTitle: false, narrate: false, recaps: false, speech: false, checkpoints: false,
    ...(dry ? { retryDelays: [] } : {}),
  });
  // The tools a bot has in an eval: its built-ins, the notes, and the direct tools of the
  // (fake) connected apps. No computer, browser, desktop, MCP, projects, Código, secrets or people.
  const notes = wikiExtraTools(runtime);
  runtime.appTools = new AppTools(connections);
  await runtime.appTools.refresh();
  runtime.extraTools = (bot, mission) => [...notes(bot, mission), ...runtime.appTools.list(bot, mission, runtime)];
  connections.onDecided = (missionId) => { void Promise.resolve(runtime.missionJobs.get(missionId)).then(() => runtime.launch(missionId)); };
  const world = { kase, directory, store, hub, connections, web, provider, runtime, dry, timeline: [], tools: [], turnIndex: -1, missionId: null, rounds: 0, stopAt: 0, notes: [] };
  assertFakes(world);

  // Every tool call a bot makes, with what it got back (the hard assertions read this).
  const runTool = runtime.tool.bind(runtime);
  runtime.tool = async (mission, step, call, signal, usedModel) => {
    let args = null;
    try { args = JSON.parse(call.arguments || "{}"); } catch { args = { _raw: String(call.arguments || "") }; }
    const result = await runTool(mission, step, call, signal, usedModel);
    const entry = { turn: world.turnIndex, name: call.name, args, botId: step.botId, stepId: step.id, callId: call.call_id, result, error: typeof result?.error === "string" ? result.error : null };
    world.tools.push(entry);
    world.timeline.push({ type: "tool", ...entry });
    return result;
  };
  // What the bots say, as it is written (the transcript keeps the order).
  store.listeners.add((event) => {
    if (event?.type !== "record" || event.kind !== "messages" || event.op !== "insert") return;
    const m = event.data;
    if (m?.role === "assistant" && ["message", "question", "plan", undefined].includes(m.kind)) world.timeline.push({ type: "bot", id: m.id, botId: m.botId, kind: m.kind || "message", turn: world.turnIndex });
  });
  // The case can stop the bot at a given model round of a turn (stop reason, hand-back cases).
  const beforeRound = (params) => {
    world.rounds += 1;
    if (world.stopAt && world.rounds >= world.stopAt && world.missionId) {
      world.stopAt = 0;
      world.stopped = true;
      runtime.stop(world.missionId);
      throw params.signal?.reason || Error("Parado por la prueba.");
    }
  };
  provider.hook = beforeRound;

  for (const m of setup.memory || []) {
    store.put("memories", {
      id: m.id || "mem-" + newId().slice(0, 8), text: m.text, botId: m.bot || "nora", scope: m.target === "bot" ? "bot" : "equipo", target: m.target || "memory",
      source: m.source || "dijiste", review: m.review ?? false, active: true, tier: m.tier || "core", createdAt: iso(m.ago ?? 86400 * 30),
      ...(m.origin ? { origin: m.origin } : {}), ...(m.missionId ? { missionId: m.missionId } : {}), ...(m.doubt ? { doubt: true } : {}),
    });
  }
  for (const p of setup.wiki || []) {
    createPage(store, { title: p.title, body: p.body, tags: p.tags || [], folder: p.folder || "" }, {
      by: PERSON, external: p.external ? { by: PERSON, at: iso(3600), label: typeof p.external === "string" ? p.external : "Copiado de una página web" } : null,
    });
  }
  world.before = { memories: store.list("memories").map((m) => m.id), pages: listPages(store).map((p) => p.id) };
  return world;
}

/** The boundary is fake, or nothing runs. */
export function assertFakes(world) {
  const { runtime, connections, hub, web, provider, dry } = world;
  const problems = [];
  if (!(hub instanceof FakeHub) || hub[EVAL_FAKE] !== true || connections.hub !== hub) problems.push("las apps conectadas no son el doble de pruebas");
  if (runtime.connections !== connections) problems.push("el runtime usa otro servicio de conexiones");
  if (web[EVAL_FAKE] !== true || runtime.web !== web) problems.push("la web no es el doble de pruebas");
  for (const key of ["mcp", "code", "projects", "vault", "secrets", "sandbox", "peers"]) if (runtime[key]) problems.push("el runtime tiene «" + key + "» (no debe existir en una evaluación)");
  if (dry ? !(provider instanceof DryProvider) : !(provider.hub && provider.hub.session === null && provider.hub.fetch?.[EVAL_FAKE] === true)) problems.push("el proveedor del modelo no pasa por la red vigilada");
  if (!dry && globalThis.fetch?.[EVAL_FAKE] !== true) problems.push("la red de este proceso no está vigilada");
  assertOutsideRealData(world.directory);
  if (problems.length) throw Object.assign(Error("Evaluación detenida por seguridad: " + problems.join("; ") + "."), { code: "COLMENA_EVAL_UNSAFE" });
}

export async function destroyWorld(world) {
  try { for (const timer of world.connections.timers?.values() || []) clearTimeout(timer); } catch {}
  try { await world.runtime.shutdown(); } catch {}
  try { world.provider.hub?.close?.(); } catch {}
  try { flushMemoryUse(world.store); } catch {}
  try { world.store.close(); } catch {}
  await rm(world.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
}

/** Waits until nothing is working: no mission job, no message still being routed. */
async function settle(world, deadline) {
  const { runtime } = world;
  for (let i = 0; i < 400; i++) {
    await new Promise((r) => setImmediate(r));
    if (!runtime.jobs.size && !runtime.routes.size) return;
    const left = deadline - Date.now();
    if (left <= 0) throw Object.assign(Error("La prueba tardó demasiado y se ha cortado."), { code: "COLMENA_EVAL_TIMEOUT" });
    let timer;
    await Promise.race([Promise.allSettled([...runtime.jobs]), new Promise((r) => { timer = setTimeout(r, Math.min(left, 30000)); })]);
    clearTimeout(timer);
  }
}

const matchesApproval = (a, match = {}) => Object.entries(match).every(([k, v]) => {
  const view = approvalView(a);
  return Array.isArray(v) ? v.includes(view[k]) : view[k] === v;
});

/**
 * After a turn settles, what the person (or Colmena's own timer) does next:
 *  - a send Colmena would let go on its own (asked for in so many words) goes now instead of
 *    in ten seconds (`autoSend: "fire"`, the default), is cancelled by the person («cancel»)
 *    or is left waiting («wait»);
 *  - `decide: [{match, decision}]` approves or denies other pending approvals, once each;
 *  - `answer` answers a pending question of the bot.
 */
async function afterTurn(world, turn, deadline) {
  const { store, connections, runtime } = world;
  const decisions = [...(turn.decide || [])];
  let answer = turn.answer;
  for (let i = 0; i < 8; i++) {
    await settle(world, deadline);
    const pending = store.list("approvals").filter((a) => a.status === "pending" && !a.deferred);
    let acted = false;
    for (const a of pending) {
      if (a.tool === "apps_execute" && a.autoSendAt && (turn.autoSend || "fire") !== "wait") {
        const cancel = turn.autoSend === "cancel";
        if (cancel) await connections.decide(a.id, { decision: "denied" });
        else { const { revision } = await connections.review(a.id); await connections.decide(a.id, { decision: "approved", revision, auto: true }); }
        world.timeline.push({ type: "harness", turn: world.turnIndex, text: cancel ? "La persona canceló el envío antes de que saliera." : "Colmena dejó salir el envío sin un segundo OK (la persona lo había pedido con sus palabras)." });
        connections.onDecided(a.missionId);
        acted = true;
        continue;
      }
      const at = decisions.findIndex((d) => matchesApproval(a, d.match));
      if (at >= 0 && a.kind !== "question") {
        const [{ decision }] = decisions.splice(at, 1);
        if (a.tool === "apps_execute") {
          if (decision === "denied") await connections.decide(a.id, { decision: "denied" });
          else { const { revision } = await connections.review(a.id); await connections.decide(a.id, { decision: "approved", revision }); }
          connections.onDecided(a.missionId);
        } else runtime.approve(a.id, decision);
        world.timeline.push({ type: "harness", turn: world.turnIndex, text: decision === "approved" ? "La persona aprobó: " + (a.title || a.review?.name || a.tool) : "La persona denegó: " + (a.title || a.review?.name || a.tool) });
        acted = true;
        continue;
      }
      if (a.kind === "question" && answer) {
        runtime.answer(a.id, { text: answer });
        world.timeline.push({ type: "person", turn: world.turnIndex, text: answer, note: "respuesta a la pregunta del bot" });
        answer = null;
        acted = true;
      }
    }
    if (!acted) return;
  }
}

function seedHistory(world, missionId, history = []) {
  const { store } = world;
  for (const h of history) {
    if (h.role === "user") world.timeline.push({ type: "person", turn: -1, text: h.text, note: "antes de la prueba" });
    store.put("messages", {
      id: newId(), missionId, role: h.role === "user" ? "user" : "assistant", ...(h.role === "user" ? { attachments: [] } : { botId: h.bot }), text: h.text, kind: "message", at: iso(h.ago ?? 60),
      ...(h.to ? { to: h.to } : {}),
    });
  }
}

/** A conversation at rest with something already said in it (a chat or a team room). */
function openConversation(world) {
  const { runtime, store, kase } = world;
  const setup = kase.setup || {};
  const room = setup.room || null;
  const history = setup.history || [];
  const first = history.find((h) => h.role === "user");
  const mission = room
    ? runtime.create({ prompt: room.prompt || "Preparad el trabajo de esta semana", mode: "equipo", botIds: room.bots, title: room.title || "Equipo" })
    : runtime.create({ prompt: first.text, mode: "solo", botIds: [setup.chat || "vera"], conversation: true, title: setup.title || undefined });
  const oldest = Math.max(600, ...history.map((h) => (h.ago ?? 60) + 60));
  for (const s of runtime.steps(mission.id)) store.patch("steps", s.id, { status: "completed", text: room ? "Plan hecho." : "", completedAt: iso(oldest) });
  store.patch("missions", mission.id, { status: "completed", completedAt: iso(oldest) });
  const opening = store.where("messages", "missionId", mission.id).find((m) => m.role === "user");
  store.patch("messages", opening.id, { at: iso(room ? oldest : first.ago ?? oldest) });
  world.timeline.push(room
    ? { type: "harness", turn: -1, text: "Sala de equipo «" + mission.title + "» en reposo, con " + room.bots.map((b) => store.get("bots", b)?.name || b).join(", ") + " y Atlas, que coordina." }
    : { type: "person", turn: -1, text: first.text, note: "antes de la prueba" });
  seedHistory(world, mission.id, room ? history : history.filter((h) => h !== first));
  return mission;
}

async function seedFiles(world, missionId) {
  const files = world.kase.setup?.files || {};
  const root = world.runtime.root(missionId);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, String(content), "utf8");
  }
}

async function playTurn(world, turn, deadline) {
  const { runtime, store, kase } = world;
  const setup = kase.setup || {};
  world.turnIndex += 1;
  world.rounds = 0;
  world.stopAt = turn.stopAtRound || 0;
  world.stopped = false;
  if (typeof turn.say === "string") {
    world.timeline.push({ type: "person", turn: world.turnIndex, text: turn.say });
    if (!world.missionId) {
      const m = runtime.create({ prompt: turn.say, mode: "solo", botIds: [setup.chat || "vera"], conversation: true, ...(setup.incognito ? { incognito: true } : {}) });
      world.missionId = m.id;
      world.personMessages.push(store.where("messages", "missionId", m.id).find((x) => x.role === "user").id);
      await seedFiles(world, m.id);
      void runtime.launch(m.id);
    } else {
      const message = runtime.addMessage(world.missionId, turn.say);
      world.personMessages.push(message.id);
    }
  } else if (turn.fire) {
    // A routine or a trigger firing, through the real scheduler (never started: no clock, no polling).
    const a = setup.automation;
    const rule = store.put("automations", {
      id: "auto-eval", name: a.name, prompt: a.prompt, botId: a.bot || "vera", enabled: true, state: "scheduled", createdAt: iso(86400),
      trigger: a.event ? { type: a.event.kind || "correo", config: {} } : { type: "dia", config: { time: "09:00" } },
    });
    const scheduler = new Scheduler(store, runtime, () => true, { connections: world.connections, notifier: { notify() {} } });
    world.timeline.push({ type: "harness", turn: world.turnIndex, text: "Se dispara la rutina «" + a.name + "» (la persona no está delante)" + (a.event ? " con un aviso de fuera." : ".") });
    const mission = scheduler.fire(rule, a.event ? { event: { id: "ev-eval", kind: a.event.kind || "correo", summary: a.event.summary || "", data: a.event.data || {} } } : {});
    world.missionId = mission.id;
    world.personMessages.push(null);
  } else if (turn.returnNote) {
    // «Deja un recado» on handing the browser back: a thread note, as server/computer/routes.mjs writes it.
    runtime.threadHint(world.missionId, "He tomado el control del navegador y ya te lo he devuelto. " + returnNoteText(turn.returnNote));
    world.timeline.push({ type: "harness", turn: world.turnIndex, text: "La persona devolvió el navegador con un recado (nota del hilo, no un mensaje): «" + turn.returnNote + "»" });
    world.personMessages.push(null);
    return;
  } else if (turn.resume) {
    world.timeline.push({ type: "harness", turn: world.turnIndex, text: "La persona pulsa «Continuar»." });
    world.personMessages.push(null);
    void runtime.resume(world.missionId);
  } else throw Error("Turno no válido en el caso «" + kase.id + "».");
  await afterTurn(world, turn, deadline);
  if (turn.stopAtRound) {
    if (!world.stopped) world.notes.push("El bot terminó antes de la ronda " + turn.stopAtRound + ": no se le llegó a parar.");
    else if (turn.why) {
      runtime.stopWhy(world.missionId, turn.why);
      world.timeline.push({ type: "harness", turn: world.turnIndex, text: "La persona paró al bot y le dijo por qué (nota del hilo, no un mensaje): «" + turn.why + "»" });
    }
  }
}

const upper = (s) => String(s || "").toUpperCase();
const addressList = (...values) => values.flatMap((v) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;]/) : [])).map((x) => String(x).trim().toLowerCase()).filter(Boolean);

/** An approval as the checks see it. */
export function approvalView(a) {
  const app = a.tool === "apps_execute";
  const args = app ? a.review?.arguments || {} : a.args || {};
  return {
    id: a.id, tool: app ? upper(a.review?.tool || a.args?.tool) : a.tool, app, kind: a.kind || null, redLine: !!a.redLine, status: a.status,
    // «auto»: Colmena lets it go without a second OK because the person asked for it in so many words.
    auto: !!a.askedByYou || a.resolution === "Lo pediste tú en tu mensaje", deferred: !!a.deferred, decidedBy: a.decidedBy || null, botId: a.botId || null,
    to: app ? addressList(a.review?.draft?.to, a.review?.draft?.cc, args.recipient_email, args.extra_recipients, args.cc, args.bcc, args.attendees) : [],
    args, ok: a.result?.ok ?? null, title: a.title || a.review?.name || null,
  };
}

async function listFiles(root) {
  try { return (await readdir(root, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).map((e) => path.relative(root, path.join(e.parentPath || e.path, e.name)).replace(/\\/g, "/")); } catch { return []; }
}

/** What happened in the run, as data. */
async function observe(world) {
  const { store, runtime, hub, web, provider, kase } = world;
  const missionId = world.missionId;
  const mission = missionId ? store.get("missions", missionId) : null;
  const all = missionId ? store.where("messages", "missionId", missionId).sort((a, b) => String(a.at).localeCompare(String(b.at))) : [];
  const said = all.filter((m) => m.role === "assistant" && (!m.kind || ["message", "question", "plan"].includes(m.kind)) && String(m.text || "").trim());
  const turnOf = new Map(world.timeline.filter((x) => x.type === "bot").map((x) => [x.id, x.turn]));
  const messages = said.map((m) => ({ turn: turnOf.get(m.id) ?? -1, botId: m.botId, kind: m.kind || "message", text: m.text }));
  const turns = world.personMessages.map((messageId, turn) => {
    const person = messageId ? store.get("messages", messageId) : null;
    const mine = messages.filter((m) => m.turn === turn);
    return { turn, said: person?.text ?? null, routed: person?.routed || null, answeredBy: [...new Set(mine.map((m) => m.botId))], answer: mine.map((m) => m.text).join("\n\n") };
  });
  const lastSpoken = [...turns].reverse().find((t) => t.answer) || { answer: "" };
  const memories = store.list("memories");
  const pages = listPages(store).map((p) => getPage(store, p.id)).filter(Boolean);
  const steps = missionId ? runtime.steps(missionId) : [];
  const events = missionId ? (store.events?.(missionId) || []) : [];
  const offered = [...new Set((provider.offered || []).flat())];
  return {
    case: kase.id,
    status: mission?.status || null,
    stopped: mission?.stopped?.reason || null,
    learningStatus: mission?.learningStatus || null,
    tools: world.tools.map(({ result, ...t }) => ({ ...t, ok: !t.error && result?.ok !== false, waiting: result?.waiting === true, result: clip(result, 3000) })),
    approvals: store.list("approvals").map(approvalView),
    // What reached the (fake) apps and changed something there: the outward effects.
    effects: hub.effects.map((e) => ({ tool: e.tool, toolkit: e.toolkit, ok: e.ok, args: e.arguments, to: addressList(e.arguments?.recipient_email, e.arguments?.extra_recipients, e.arguments?.cc, e.arguments?.bcc, e.arguments?.attendees) })),
    reads: hub.log.filter((e) => e.read).map((e) => ({ tool: e.tool, args: e.arguments })),
    drafts: (hub.apps.gmail?.drafts || []).map((d) => ({ id: d.id, to: d.to, subject: d.subject, body: d.body, threadId: d.threadId })),
    messages, turns, answer: lastSpoken.answer, allText: messages.map((m) => m.text).join("\n\n"),
    memory: {
      added: memories.filter((m) => !world.before.memories.includes(m.id)).map((m) => ({ text: m.text, doubt: !!m.doubt, review: !!m.review, origin: m.origin || null, tier: m.tier || "core", target: m.target || null })),
      all: memories.filter((m) => m.active !== false).map((m) => ({ text: m.text, doubt: !!m.doubt })),
    },
    wiki: {
      added: pages.filter((p) => !world.before.pages.includes(p.id)).map((p) => ({ title: p.title, body: p.body, outside: !!p.external })),
      changed: pages.filter((p) => world.before.pages.includes(p.id) && p.revision > 1).map((p) => ({ title: p.title, body: p.body, outside: !!p.external })),
    },
    files: missionId ? await listFiles(runtime.root(missionId)) : [],
    artifacts: (missionId ? store.where("artifacts", "missionId", missionId) : []).map((a) => ({ title: a.title, kind: a.kind || null, format: a.format || null, file: a.file || a.workFile || null })),
    flagged: steps.some((s) => s.suspicious?.length) || !!mission?.suspicious?.length || events.some((e) => e.type === "injection_suspected"),
    nudged: steps.some((s) => s.finishNudges > 0),
    offered, web: [...web.calls],
    usage: { ...world.meter },
    notes: world.notes,
    dry: world.dry ? { exhausted: world.script.exhausted, left: world.script.script.length } : null,
  };
}

/** The transcript the judge reads: the person's words, each tool call with its result, the bots' answers. No secrets ever enter it (the case is fiction, the provider's keys never touch the store). */
export function transcriptOf(world) {
  const { store } = world;
  const name = (botId) => store.get("bots", botId)?.name || botId || "Bot";
  const lines = [];
  for (const e of world.timeline) {
    if (e.type === "person") lines.push("PERSONA" + (e.note ? " (" + e.note + ")" : "") + ": " + e.text);
    else if (e.type === "harness") lines.push("[Colmena] " + e.text);
    else if (e.type === "tool") lines.push("HERRAMIENTA de " + name(e.botId) + ": " + e.name + " " + clip(e.args, 1500) + "\n  → " + clip(e.result, 1800));
    else if (e.type === "bot") {
      const m = store.get("messages", e.id);
      if (m && String(m.text || "").trim()) lines.push(name(e.botId).toUpperCase() + (e.kind === "question" ? " (pregunta a la persona)" : "") + ": " + m.text);
    }
  }
  const waiting = store.list("approvals").filter((a) => a.status === "pending").map(approvalView);
  if (waiting.length) lines.push("[Colmena] Queda esperando el OK de la persona: " + waiting.map((a) => (a.title || a.tool) + (a.to.length ? " → " + a.to.join(", ") : "")).join("; "));
  return lines.join("\n\n");
}

/**
 * Runs a case once. Returns {observation, transcript, error}. `error` is a harness or
 * infrastructure failure (a timeout, a provider that refused): the run then counts as
 * failed, with that reason.
 */
export async function runOnce(kase, { makeProvider = null, model = "eval-dry", timeoutMs = null, afterRun = null, measure = null } = {}) {
  const dry = !makeProvider;
  const deadline = Date.now() + (timeoutMs || (dry ? 30000 : (kase.timeoutSeconds || 420) * 1000));
  let world = null;
  try {
    world = await buildWorld(kase, { makeProvider, model });
    world.meter = newMeter();
    world.provider.meter = world.meter;
    world.personMessages = [];
    if (dry) {
      world.script = world.provider.play({ script: kase.dry?.script || [], route: kase.dry?.route || null });
      world.provider.measure = measure;
      world.provider.resolve = (text) => text.replace(/\{\{draft:(\d+)\}\}/g, (_all, i) => world.hub.apps.gmail?.drafts?.[Number(i)]?.id || "sin-borrador");
    }
    else world.provider.offered = [];
    const setup = kase.setup || {};
    if (setup.room || setup.history?.length) world.missionId = openConversation(world).id;
    if (world.missionId) await seedFiles(world, world.missionId);
    for (const turn of kase.turns) await playTurn(world, turn, deadline);
    await settle(world, deadline);
    const observation = await observe(world);
    const transcript = transcriptOf(world);
    // Checks and the judge run while the provider of this run is still open.
    if (afterRun) await afterRun({ observation, transcript, respond: dry ? null : (params) => world.provider.hub.respond(params) });
    return { observation, transcript, error: null };
  } catch (error) {
    let observation = null, transcript = "";
    try { if (world?.personMessages) { observation = await observe(world); transcript = transcriptOf(world); } } catch {}
    return { observation, transcript, error: String(error?.message || error) };
  } finally {
    if (world) await destroyWorld(world);
  }
}
