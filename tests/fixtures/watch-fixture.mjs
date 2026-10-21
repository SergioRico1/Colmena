// Shared pieces of the «Te avisa de lo importante» tests (server/watch.mjs).
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../../server/store.mjs";
import { Watcher } from "../../server/watch.mjs";

export async function temp(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-watch-"));
  const store = new Store(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  store.patch("bots", "vera", (b) => ({ tools: { ...(b.tools || {}), correo: "escribe", calendario: "escribe" } }));
  store.patch("settings", "main", { userName: "Marina" });
  return store;
}

export const NOW = Date.parse("2026-10-19T08:40:00Z");
export const mail = (id, over = {}) => ({
  messageId: id, threadId: "t-" + id, sender: "Oriol Vidal <oriol@orvalia.es>", to: "marina@lumbre.es", subject: "Revisión de costes de septiembre",
  messageTimestamp: "2026-10-19T08:10:00Z", labelIds: ["INBOX", "IMPORTANT"], preview: { body: "¿Puedes confirmar antes del lunes 19 las partidas que te corresponden?" }, ...over,
});

/** A connections service without readNow (prepare → commit); `inbox` may be a function (it changes between looks). */
export function fakeConnections({ inbox = [], sent = [], events = [], readScope = true } = {}) {
  const log = [];
  const proposals = new Map();
  const box = () => (typeof inbox === "function" ? inbox() : inbox);
  let n = 0;
  return {
    log,
    async call(op, args = {}) {
      log.push({ op, args });
      if (op === "accounts") return { items: [{ id: "ca_gmail", toolkit: "gmail", alias: "Gmail trabajo", status: "ACTIVE" }, { id: "ca_cal", toolkit: "googlecalendar", alias: "Calendario", status: "ACTIVE" }] };
      if (op === "prepare") {
        const id = "p" + ++n;
        proposals.set(id, args);
        return { proposal: id, tool: args.tool, read_scope: readScope ? "read" : null, arguments: JSON.parse(args.arguments_json) };
      }
      if (op === "discard") return { ok: true };
      if (op === "commit") {
        const p = proposals.get(args.proposal);
        const a = JSON.parse(p.arguments_json);
        if (p.tool === "GMAIL_FETCH_EMAILS") return { ok: true, data: { messages: /in:sent/.test(a.query) ? sent : box() } };
        if (p.tool === "GOOGLECALENDAR_EVENTS_LIST") return { ok: true, data: { items: events } };
        if (p.tool === "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID") { const m = box().find((x) => x.messageId === a.message_id); return { ok: true, data: { ...m, messageText: "<p>" + (m?.preview?.body || "") + " (texto completo)</p>" } }; }
        return { ok: false, error: "no" };
      }
      return {};
    },
  };
}

/** A connections service with readNow (as the real one): any app, and a describe that knows only `apps`. */
export function appsConnections({ accounts, apps }) {
  const log = [];
  return {
    log,
    async call(op, args = {}) {
      log.push({ op, args });
      if (op === "accounts") return { items: accounts };
      if (op === "describe") return apps[args.tool] ? { tool: args.tool, input_schema: { type: "object", properties: Object.fromEntries((apps[args.tool].props || []).map((p) => [p, { type: "string" }])) } } : null;
      return {};
    },
    async readNow(mission, step, args) {
      log.push({ op: "readNow", mission, step, args });
      const app = apps[args.tool];
      return { ok: true, data: typeof app.data === "function" ? app.data(JSON.parse(args.arguments_json)) : app.data };
    },
  };
}

/** A watcher whose model answers come from `answers`, in order. */
export function watcherFor(store, connections, answers) {
  const calls = [], notices = [], said = [];
  const infer = async (params) => {
    calls.push(params);
    const next = answers.shift();
    return { text: typeof next === "string" ? next : JSON.stringify(next) };
  };
  const w = new Watcher({
    store, connections, infer, clock: () => NOW,
    models: () => [{ slug: "gpt-6-luna" }, { slug: "gpt-6.1-sol" }], modelFor: () => "gpt-6.1-sol",
    notifier: { notify: (x) => notices.push(x) },
    addMessage: async (missionId, text) => { said.push({ missionId, text }); return store.put("messages", { id: "u" + said.length, missionId, role: "user", text, kind: "message", at: new Date(NOW).toISOString() }); },
  });
  return { w, calls, notices, said };
}
