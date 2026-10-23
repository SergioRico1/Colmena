// Synthetic "big user" data for the performance budgets (tests/perf-budget.test.mjs): a year
// of chats, rooms and automations with long tool histories, all in a throwaway directory.
const day = Date.UTC(2026, 0, 1);
const at = (i) => new Date(day + i * 60000).toISOString();
const words = "presupuesto factura cliente reunión entrega informe revisión proveedor contrato pedido calendario correo".split(" ");
const prose = (n, seed = 0) => Array.from({ length: n }, (_, i) => words[(i * 7 + seed) % words.length]).join(" ");

export const SIZES = Object.freeze({ chats: 40, rooms: 20, automationRuns: 30, messagesPerMission: 60, longChat: 800 });

/**
 * Fills `store` and returns { longChatId }. Every mission has messages, steps with real-looking
 * histories (big tool outputs), receipts, deliverables and decided approvals; there are also
 * memories, automations, notes and goals.
 */
export function seedBigUser(store, sizes = SIZES) {
  return store.tx(() => seed(store, sizes));
}
function seed(store, sizes) {
  const bots = store.list("bots").map((b) => b.id);
  let n = 0;
  const mission = (kind, i) => {
    const id = kind + "-" + i;
    const botIds = kind === "room" ? bots.slice(0, 3 + (i % 3)) : [bots[i % bots.length]];
    store.put("missions", {
      id, title: (kind === "room" ? "Sala " : "Chat ") + prose(4, i), prompt: prose(i % 4 ? 18 : 60, i), mode: kind === "room" ? "equipo" : "solo", botIds,
      status: i % 9 === 0 ? "running" : "completed", conversation: kind === "chat", room: kind === "room" ? "sala-" + i : null,
      automationId: kind === "auto" ? "auto-" + (i % 20) : null, createdAt: at(n), updatedAt: at(n + 500), completedAt: at(n + 500),
      plan: kind === "room" ? { summary: prose(30, i), approved: true, assignments: botIds.map((b) => ({ botId: b, task: prose(20, i), title: prose(5, i) })) } : null,
      ...(kind === "chat" ? { suggestions: { list: ["Sigue con el informe", "Pásaselo a Nora"], at: at(n) } } : {}),
    });
    return id;
  };
  const fill = (id, count, botId) => {
    for (let k = 0; k < count; k++) {
      const stepId = id + ":s" + Math.floor(k / 2);
      store.put("messages", {
        id: id + ":m" + k, missionId: id, role: k % 2 ? "assistant" : "user", botId: k % 2 ? botId : undefined, kind: "message",
        text: prose(k % 2 ? 55 : 15, k), stepId: k % 2 ? stepId : undefined, at: at(n++),
        ...(k % 2 ? { summary: { reads: 3, seconds: 12, tokens: 4200 } } : {}),
      });
      if (k % 2) {
        const calls = Array.from({ length: 3 }, (_, c) => ({ type: "function_call", name: "web_fetch", call_id: "c" + c, arguments: JSON.stringify({ url: "https://example.com/" + c }) }));
        const outs = calls.map((c) => ({ type: "function_call_output", call_id: c.call_id, output: JSON.stringify({ text: prose(400, k) }) }));
        store.put("steps", {
          id: stepId, missionId: id, botId, kind: "followup", status: "completed", title: prose(5, k), text: prose(55, k),
          history: [{ role: "user", content: prose(25, k) }, ...calls, ...outs], pending: [], rounds: 3, startedAt: at(n - 2), completedAt: at(n),
          activity: calls.map((c) => ({ verb: "leyendo", detail: "example.com", tool: "web_fetch", callId: c.call_id, status: "done", at: at(n) })),
        });
        for (const c of calls) store.put("receipts", { id: stepId + ":" + c.call_id, tool: "web_fetch", result: { text: prose(400, k) }, at: at(n) });
      }
    }
  };
  for (let i = 0; i < sizes.chats; i++) fill(mission("chat", i), sizes.messagesPerMission, bots[i % bots.length]);
  for (let i = 0; i < sizes.rooms; i++) {
    const id = mission("room", i);
    fill(id, sizes.messagesPerMission, bots[i % bots.length]);
    for (let a = 0; a < 4; a++) store.put("artifacts", { id: id + ":art" + a, missionId: id, botId: bots[a % bots.length], title: "Informe " + a, kind: "document", format: "md", content: prose(2500, a), status: "final", version: 1, createdAt: at(n++) });
    for (let a = 0; a < 6; a++) store.put("approvals", { id: id + ":ap" + a, missionId: id, botId: bots[a % bots.length], tool: "write_file", kind: "write", title: "Crear archivo", summary: prose(40, a), args: { path: "x.md", content: prose(800, a) }, status: "executed", result: { saved: true, text: prose(400, a) }, createdAt: at(n++), decidedAt: at(n), decidedBy: "tú" });
    for (let a = 0; a < 8; a++) store.put("thread", { id: id + ":th" + a, missionId: id, from: bots[a % bots.length], to: bots[(a + 1) % bots.length], text: prose(80, a), at: at(n++) });
  }
  for (let i = 0; i < sizes.automationRuns; i++) fill(mission("auto", i), 6, bots[i % bots.length]);
  for (let i = 0; i < 20; i++) store.put("automations", { id: "auto-" + i, name: "Rutina " + i, botId: bots[i % bots.length], prompt: prose(18, i), enabled: true, trigger: { type: "dia", config: { hora: "09:00" } }, queue: [], lastRun: at(n), lastStatus: "completed", createdAt: at(n) });
  // Memories are capped per space (memory.mjs MEMORY_LIMITS: ~15 000 characters in all), plus those waiting for review.
  for (let i = 0; i < 120; i++) store.put("memories", { id: "mem-" + i, botId: bots[i % bots.length], scope: i % 3 ? "bot" : "team", target: i % 2 ? "user" : "memory", text: prose(14, i), source: "dedujo", review: i % 10 === 0, active: true, createdAt: at(n++) });
  for (let i = 0; i < 6; i++) store.put("approvals", { id: "pending-" + i, missionId: "room-" + i, botId: bots[0], tool: "write_file", kind: "write", title: "Crear archivo " + i, summary: prose(30, i), args: { path: "y.md", content: prose(300, i) }, status: "pending", createdAt: at(n++) });

  // One chat that has grown for months: SIZES.longChat messages.
  const longChatId = mission("chat", 999);
  fill(longChatId, sizes.longChat, bots[0]);
  return { longChatId };
}
