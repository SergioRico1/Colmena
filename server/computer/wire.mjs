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

export { isComputerTool };

export function computerExtraTools(runtime, { computer = defaultComputer } = {}) {
  return (bot) =>
    computerToolDefs(bot, { available: computer.available, settings: runtime.settings(), vault: runtime.vault?.available ? runtime.vault.list() : [] }).map(({ type: _type, ...def }) => ({
      ...def,
      run: (args, ctx) => runComputerTool(runtime, computer, def.name, args, ctx),
    }));
}

async function runComputerTool(runtime, computer, name, rawArgs, { mission, step, bot, call, signal }) {
  const store = runtime.store;
  const approvalId = step.id + ":" + call.call_id;
  const ctx = {
    missionId: mission.id, botId: bot.id, bot, autonomy: runtime.autonomy(mission, bot), missionRoot: runtime.root(mission.id),
    folders: accessibleFolders(store, bot.id), settings: runtime.settings(), computer, signal, vault: runtime.vault || null,
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
      // A screenshot goes to the model as an image (Runtime keeps it out of the receipt).
      return result;
    }
    const p = plan.approval;
    const grant = plan.policy === "approval" && !runtime.flagged?.(step) && findComputerGrant(store, { botId: bot.id, tool: plan.name, scope: p.grantScope });
    a = store.put("approvals", {
      id: approvalId, missionId: mission.id, botId: bot.id, stepId: step.id, callId: call.call_id,
      tool: plan.name, args: plan.args, kind: "permission", scope: p.grantScope, scopeLabel: p.scopeLabel,
      title: p.title, summary: p.summary, context: runtime.approvalContext(mission, bot), blocks: 1, options: [], email: null,
      canAlways: p.canAlways, redLine: p.redLine, grantDays: p.grantDays, computer: p.computer, external: !!p.redLine,
      status: grant ? "approved" : "pending", createdAt: now(), preparedAt: now(),
      decidedAt: grant ? now() : null, decidedBy: grant ? "regla" : null, resolution: grant ? "Aprobado por una regla" : null,
    });
    if (!grant) {
      store.event(mission.id, "approval_requested", { botId: bot.id, text: p.summary });
      return { waiting: true };
    }
  }
  if (a.status === "pending") return { waiting: true };
  if (["denied", "expired"].includes(a.status)) return deniedResult(a, { expired: a.status === "expired" });
  if (a.status === "executed") return a.result;
  const result = await executeComputerTool(a.tool, a.args, { ...ctx, approved: true, approval: a });
  store.patch("approvals", approvalId, { status: "executed", result: forReceipt(result) });
  return result;
}
