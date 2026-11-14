// What a cloud bot may do on its person's computer, through their local agent (docs/CLOUD.md ›
// Phase 5). The cloud keeps deciding: who may ask (only the person whose computer it is, in
// their own turn), red lines and approvals (the same cards and rules as the desktop). The agent
// keeps its own allowlist and refuses anything the person did not lend on that computer.
//
//   agentFolders(runtime, hub, …)    list_folder / read_folder_file on lent folders («pc.<device>.<id>»)
//   agentExtraTools(runtime, hub, …) browser, apps and commands, saved logins, Claude Code of this computer
import { currentPerson, isPerson } from "../identity.mjs";
import { now } from "../store.mjs";
import { computerToolDefs, findComputerGrant, forReceipt } from "../computer/tools.mjs";
import { deniedResult } from "../denial.mjs";
import { AgentError, capabilityOf } from "./protocol.mjs";
import { agentFolderId } from "./hub.mjs";

const text = { type: "string" };
const fn = (name, description, properties) => ({
  type: "function", name, description, strict: true,
  parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
});
const ON_COMPUTER = " Se hace en el ordenador de la persona, a través de Colmena en ese ordenador: si está apagado, te lo dirá.";

/**
 * The person this turn is for, when they may lend their computer to it: a member (not a guest)
 * in their own turn. Never a turn for someone else (a request in a shared conversation, an
 * errand between bots) and never background work for nobody.
 */
export function lender(mission, memberOf) {
  const p = currentPerson();
  if (!isPerson(p)) return null;
  const m = memberOf(p.id);
  if (!m || m.role === "guest") return null;
  if (mission?.peerErrand) return null;
  if (mission?.askedBy && mission.askedBy !== p.id) return null;
  return m;
}
const refusal = (error) => (error instanceof AgentError ? error.message : String(error?.message || error));

/** list_folder / read_folder_file on folders lent by the person's computers (Runtime#agentFolders). */
export function agentFolders(runtime, hub, { memberOf }) {
  return {
    owns: (folderId) => !!agentFolderId(folderId),
    list(bot, mission) {
      const p = lender(mission, memberOf);
      return p ? hub.folders(p.id, bot.id).map((f) => ({ id: f.id, label: f.label + " (en «" + f.computer + "»)", access: f.access, ...(f.online ? {} : { apagado: true }) })) : [];
    },
    async run(op, { bot, mission, step, args }) {
      const p = lender(mission, memberOf);
      if (!p) throw Error("Las carpetas de un ordenador solo las usa su dueño en sus propias peticiones.");
      const where = agentFolderId(args.folderId);
      const result = await hub.call({ personId: p.id, cap: "carpetas", op, args: { folderId: where.folderId, path: String(args.path || ""), page: args.page || 1 }, bot, mission, deviceId: where.deviceId, folderId: where.folderId });
      if (op === "read" && result?.name) runtime.setActivity(bot.id, mission.id, step.id, "leyendo", result.name + " · en tu ordenador");
      return result;
    },
  };
}

/**
 * Tools offered to a bot in a turn of a person whose computers lend them something: browser and
 * computer tools (planned on the computer, approved in the cloud, run on the computer) and
 * Claude Code of that computer. Nothing for anyone else.
 */
export function agentExtraTools(runtime, hub, { memberOf }) {
  return (bot, mission) => {
    const p = lender(mission, memberOf);
    if (!p || !bot?.id) return [];
    const lends = hub.lendsFor(p.id, bot.id);
    const defs = [];
    if (lends.navegador || lends.ordenador) {
      const all = computerToolDefs(bot, { available: true, settings: { computer: { commands: lends.ordenador } }, vault: lends.contrasenas.map((l) => ({ id: l.id, label: l.label, domain: l.domain, username: l.username })) });
      for (const def of all) {
        const cap = capabilityOf(def.name);
        if (cap === "navegador" && !lends.navegador) continue;
        if (cap === "ordenador" && !lends.ordenador) continue;
        if (cap === "contrasenas" && !lends.contrasenas.length) continue;
        defs.push({ ...def, description: def.description + ON_COMPUTER });
      }
      if (lends.ordenador && lends.apps.length && !defs.some((d) => d.name === "open_app")) {
        const apps = [...new Map(lends.apps.map((a) => [a.id, a])).values()];
        defs.push(fn("open_app", "Abre una aplicación de la lista que la persona permitió en su ordenador: " + apps.map((a) => a.label).join(", ") + "." + ON_COMPUTER, { app: { type: "string", enum: apps.map((a) => a.id) } }));
      }
    }
    if (lends.codigo?.folders?.length) {
      defs.push(fn("code_local", "Pide a Claude Code del ordenador de la persona (con su propia cuenta) una tarea de programación en una carpeta de proyecto que ella prestó. Puede leer y editar archivos de esa carpeta, no ejecutar órdenes. Siempre espera la aprobación de la persona. folderId: " + lends.codigo.folders.map((f) => f.id + " (" + f.label + ")").join(", ") + "." + ON_COMPUTER, {
        folderId: { type: "string", enum: lends.codigo.folders.map((f) => f.id) }, task: text,
      }));
    }
    return defs.map(({ type: _type, ...def }) => ({ ...def, run: (args, ctx) => (def.name === "code_local" ? runCode(runtime, hub, p, args, ctx) : runComputer(runtime, hub, p, def.name, args, ctx)) }));
  };
}

/** The desktop's computer-tool flow (server/computer/wire.mjs) with planning and running on the person's computer. */
async function runComputer(runtime, hub, person, name, rawArgs, { mission, step, bot, call }) {
  const store = runtime.store;
  const approvalId = step.id + ":" + call.call_id;
  const cap = capabilityOf(name);
  const autonomy = runtime.autonomy(mission, bot);
  const loginId = name === "browser_sign_in" ? String(rawArgs?.entry || "") : null;
  const ask = (op, args, timeout) => hub.call({ personId: person.id, cap, op, args, bot, mission, loginId, ...(timeout ? { timeout } : {}) });
  try {
    let a = store.get("approvals", approvalId);
    if (!a) {
      const plan = await ask("plan", { name, args: rawArgs, autonomy, missionId: mission.id });
      runtime.setActivity(bot.id, mission.id, step.id, plan.verb || "usando el ordenador", (plan.detail || "") + " · en tu ordenador");
      if (plan.policy === "free") {
        const result = await ask("execute", { name: plan.name, args: plan.args, autonomy, missionId: mission.id }, 120_000);
        if (plan.announce) runtime.announce(mission.id, bot, plan.announce, approvalId);
        return result;
      }
      const p = plan.approval || {};
      const grant = plan.policy === "approval" && !runtime.flagged?.(step) && p.grantScope ? findComputerGrant(store, { botId: bot.id, tool: plan.name, scope: p.grantScope }) : null;
      a = store.put("approvals", {
        id: approvalId, missionId: mission.id, botId: bot.id, stepId: step.id, callId: call.call_id,
        tool: plan.name, args: plan.args, kind: "permission", scope: p.grantScope || null, scopeLabel: p.scopeLabel || null,
        title: p.title || "Usar tu ordenador", summary: (p.summary || "") + " (en tu ordenador)", context: runtime.approvalContext(mission, bot), blocks: 1, options: [], email: null,
        canAlways: !!p.canAlways, redLine: !!p.redLine, grantDays: p.grantDays || null, computer: p.computer || {}, external: !!p.redLine, agent: true,
        status: grant ? "approved" : "pending", createdAt: now(), preparedAt: now(),
        decidedAt: grant ? now() : null, decidedBy: grant ? "regla" : null, resolution: grant ? "Aprobado por una regla" : null,
      });
      if (!grant) {
        store.event(mission.id, "approval_requested", { botId: bot.id, text: a.summary });
        return { waiting: true };
      }
    }
    if (a.status === "pending") return { waiting: true };
    if (["denied", "expired"].includes(a.status)) return deniedResult(a, { expired: a.status === "expired" });
    if (a.status === "executed") return a.result;
    const result = await ask("execute", { name: a.tool, args: a.args, autonomy, approved: true, approval: { computer: a.computer || {} }, missionId: mission.id }, 320_000);
    store.patch("approvals", approvalId, { status: "executed", result: forReceipt(result) });
    return result;
  } catch (error) {
    return { error: refusal(error) };
  }
}

/** Claude Code of the person's computer: always their OK first, then the task runs there. */
async function runCode(runtime, hub, person, rawArgs, { mission, step, bot, call }) {
  const store = runtime.store;
  const approvalId = step.id + ":" + call.call_id;
  let args = rawArgs;
  try { if (typeof rawArgs === "string") args = JSON.parse(rawArgs); } catch {}
  const task = String(args?.task || "").trim().slice(0, 8000);
  const folderId = String(args?.folderId || "");
  if (!task) return { error: "Escribe la tarea." };
  let a = store.get("approvals", approvalId);
  if (!a) {
    a = store.put("approvals", {
      id: approvalId, missionId: mission.id, botId: bot.id, stepId: step.id, callId: call.call_id, tool: "code_local", args: { folderId, task }, kind: "permission",
      scope: null, scopeLabel: null, title: "Claude Code en tu ordenador", summary: bot.name + " quiere que Claude Code de tu ordenador haga esto en la carpeta «" + folderId + "»: " + task.slice(0, 300),
      context: runtime.approvalContext(mission, bot), blocks: 1, options: [], email: null, canAlways: false, redLine: false, computer: { folder: folderId }, agent: true,
      status: "pending", createdAt: now(), preparedAt: now(),
    });
    store.event(mission.id, "approval_requested", { botId: bot.id, text: a.summary });
    return { waiting: true };
  }
  if (a.status === "pending") return { waiting: true };
  if (["denied", "expired"].includes(a.status)) return deniedResult(a, { expired: a.status === "expired" });
  if (a.status === "executed") return a.result;
  try {
    runtime.setActivity(bot.id, mission.id, step.id, "programando", "Claude Code en tu ordenador");
    const result = await hub.call({ personId: person.id, cap: "codigo", op: "run", args: { folderId, task }, bot, mission, timeout: 600_000 });
    store.patch("approvals", approvalId, { status: "executed", result });
    return result;
  } catch (error) {
    return { error: refusal(error) };
  }
}
