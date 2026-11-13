// Connects the computer tools (browser, files, apps, commands) to the runtime through
// Runtime#extraTools: definitions per bot + policy → approval → execution.
import { computer as defaultComputer } from "./bridge.mjs";
import {
  computerToolDefs, planComputerCall, executeComputerTool, findComputerGrant, forReceipt, isComputerTool,
} from "./tools.mjs";
import { accessibleFolders } from "../tools.mjs";
import { now } from "../store.mjs";
import { deniedResult } from "../denial.mjs";
import { commandOutput } from "../command-output.mjs";
import { sandboxKey } from "./sandbox.mjs";
import { deferredResult } from "../redlines.mjs";

export { isComputerTool };

/**
 * The browser session of a turn that answers ANOTHER person (a request in a shared room, an
 * errand between bots: `mission.peerErrand`): one of its own per step, empty and in memory,
 * never the bots' usual browser where your accounts are signed in. Null for your own turns.
 */
export const browserSessionOf = (mission, step) => (mission?.peerErrand && step?.id ? "req-" + String(step.id).replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 110) : null);
const ENDED = new Set(["completed", "failed", "stopped", "cancelled"]);

/** Closes (and so wipes) the separate browser session of a step when that step ends. */
function closeSessionsAtEnd(runtime, computer) {
  const store = runtime.store;
  if (!store?.listeners || store.browserSessionsWatched) return;
  store.browserSessionsWatched = true;
  const closed = new Set();
  store.listeners.add((change) => {
    const step = change?.type === "record" && change.kind === "steps" ? change.data : null;
    if (!step?.browserSession || !ENDED.has(step.status) || closed.has(step.browserSession)) return;
    closed.add(step.browserSession);
    if (closed.size > 500) closed.delete(closed.values().next().value);
    Promise.resolve()
      .then(() => computer.call("close", { missionId: step.missionId, botId: step.botId, session: step.browserSession }))
      .catch(() => {});
  });
}

export function computerExtraTools(runtime, { computer = defaultComputer } = {}) {
  closeSessionsAtEnd(runtime, computer);
  return (bot) =>
    computerToolDefs(bot, { available: computer.available, settings: runtime.settings(), vault: runtime.vault?.available ? runtime.vault.list() : [] }).map(({ type: _type, ...def }) => ({
      ...def,
      run: (args, ctx) => runComputerTool(runtime, computer, def.name, args, ctx),
    }));
}

/** step.sandboxBlocked[key]: 'blocked' after the sandbox blocked a command, 'asked' once a wider run was asked. */
export function noteSandbox(store, stepId, key, state) {
  const step = store.get("steps", stepId);
  if (!step) return;
  store.patch("steps", stepId, { sandboxBlocked: { ...(step.sandboxBlocked || {}), [key]: state } });
}

async function runComputerTool(runtime, computer, name, rawArgs, { mission, step, bot, call, signal }) {
  const store = runtime.store;
  const approvalId = step.id + ":" + call.call_id;
  let parsed = rawArgs;
  try { if (typeof rawArgs === "string") parsed = JSON.parse(rawArgs); } catch {}
  const key = name === "run_command" ? sandboxKey(name, { program: parsed?.program, args: parsed?.args, folderId: parsed?.folderId ?? null }) : null;
  const session = browserSessionOf(mission, step);
  const stored = session && name.startsWith("browser_") ? store.get("steps", step.id) : null;
  if (stored && stored.browserSession !== session) store.patch("steps", step.id, { browserSession: session });
  const ctx = {
    ...(session ? { session } : {}),
    missionId: mission.id, botId: bot.id, bot, autonomy: runtime.autonomy(mission, bot), missionRoot: runtime.root(mission.id),
    folders: accessibleFolders(store, bot.id), settings: runtime.settings(), computer, signal, vault: runtime.vault || null,
    // Commands run confined when the server has a sandbox (undefined: not configured, as before).
    ...(runtime.sandbox !== undefined ? { sandbox: runtime.sandbox } : {}),
    // The same command the sandbox just blocked, asked again: a wider run waits for the person (once).
    sandboxWide: !!key && store.get("steps", step.id)?.sandboxBlocked?.[key] === "blocked",
    // What a command prints, live, for the chat row that is unfolded (server/command-output.mjs).
    output: { start: () => commandOutput.start(approvalId), write: (text) => commandOutput.write(approvalId, text), finish: (r) => commandOutput.finish(approvalId, { exitCode: r?.exitCode ?? null }) },
  };
  let a = store.get("approvals", approvalId);
  if (!a) {
    const plan = await planComputerCall(name, rawArgs, ctx);
    runtime.setActivity(bot.id, mission.id, step.id, plan.verb, plan.detail || "");
    if (plan.policy === "free") {
      const result = await executeComputerTool(plan.name, plan.args, ctx);
      if (plan.announce) runtime.announce(mission.id, bot, plan.announce, approvalId);
      // Once per command and step: after a wider run was asked, a new block just says so.
      if (key && result?.sandboxBlocked) {
        if (store.get("steps", step.id)?.sandboxBlocked?.[key] === "asked") return { ...result, note: "El entorno aislado lo ha vuelto a bloquear y ya pediste ejecutarlo sin aislamiento: no insistas, cambia de enfoque o explica a la persona qué falta." };
        noteSandbox(store, step.id, key, "blocked");
      }
      // A screenshot goes to the model as an image (Runtime keeps it out of the receipt).
      return result;
    }
    if (ctx.sandboxWide) noteSandbox(store, step.id, key, "asked");
    const p = plan.approval;
    const grant = plan.policy === "approval" && !runtime.flagged?.(step) && findComputerGrant(store, { botId: bot.id, tool: plan.name, scope: p.grantScope });
    // Unattended missions (routines with nobody around) or a person's explicit OK in this turn.
    const decided = !grant && p.redLine ? runtime.redLineShortcut?.(mission, step, bot, { tool: plan.name, args: plan.args, approvalId, title: p.title, summary: p.summary }) : null;
    a = store.put("approvals", {
      ...(decided?.deferred ? { deferred: true, deferredAt: now() } : {}),
      id: approvalId, missionId: mission.id, botId: bot.id, stepId: step.id, callId: call.call_id,
      tool: plan.name, args: plan.args, kind: "permission", scope: p.grantScope, scopeLabel: p.scopeLabel,
      title: p.title, summary: p.summary, context: runtime.approvalContext(mission, bot), blocks: 1, options: [], email: null,
      canAlways: p.canAlways, redLine: p.redLine, grantDays: p.grantDays, computer: p.computer, external: !!p.redLine,
      status: grant || decided?.approved ? "approved" : "pending", createdAt: now(), preparedAt: now(),
      decidedAt: grant || decided?.approved ? now() : null, decidedBy: grant ? "regla" : decided?.approved ? decided.by : null,
      resolution: grant ? "Aprobado por una regla" : decided?.approved ? decided.resolution : null,
    });
    if (!grant && !decided?.approved) {
      store.event(mission.id, "approval_requested", { botId: bot.id, text: p.summary });
      return decided?.deferred ? deferredResult(p.title) : { waiting: true };
    }
  }
  if (a.status === "pending") return a.deferred ? deferredResult(a.title) : { waiting: true };
  if (["denied", "expired"].includes(a.status)) return deniedResult(a, { expired: a.status === "expired" });
  if (a.status === "executed") return a.result;
  const { sandboxWide: _wide, ...approvedCtx } = ctx;
  const result = await executeComputerTool(a.tool, a.args, { ...approvedCtx, approved: true, approval: a });
  store.patch("approvals", approvalId, { status: "executed", result: forReceipt(result) });
  return result;
}
