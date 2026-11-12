import { isSnoozed } from "../snooze.mjs";
import { isYes, isNo } from "../appactions.mjs";
import { CHAT_PAGE, MAX_PAGE, ROOM_PAGE, conversationMap, historyPage, stepsForPage, withoutSaidText } from "../history.mjs";
import { referenceContext, refsInput } from "../mention-refs.mjs";
import { branchPoints, openBranch, switchTo, visibleMessages } from "../branches.mjs";
import { QUEUE_TEXT_MAX, deliverNext, editQueued, enqueue, moveQueued, queueOf, queueView, takeQueued } from "../queue.mjs";
import { undoLearned } from "../learned.mjs";
import { dropObservations } from "../verdicts.mjs";
import { QUEUE_MODES, roomSlug } from "../runtime.mjs";
import { forkRoom, snoozeUntil } from "../rooms.mjs";
import { reactionsOf, togglePersonReaction } from "../reactions.mjs";
import { DOWN_CODES, NOTE_MAX, reactionView, setDownFeedback } from "../feedback.mjs";
import { OUTSIDE_NOTE, restoreLine } from "../checkpoints.mjs";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { id, now } from "../store.mjs";
import { attachmentInput, writeMissionAttachments } from "../files.mjs";
import { context, missionSummary, artifactSummary, toolCalls } from "../state.mjs";
import { btwQuestion } from "../btw.mjs";
import { botThread } from "../threads.mjs";
import { HttpError, critiqueAbout, notFound, short, missionCreate, check, safe } from "./shared.mjs";

/** Rooms and chats: creating them, messages, the queue, branches, restore points, plans and what the page reads of them. */
export function registerMissionRoutes(app, { rootOf, store, mustGet, need, runtime, connection, connections, sendQueued }) {
  // --------------------------------------------------------- missions
  // Text or base64 files (PDF, Word, Excel, images…) of up to 10 MB each.
  const writeAttachments = (missionId, files) => writeMissionAttachments(rootOf(missionId), files);
  const enabledBot = (botId) => {
    const bot = store.get("bots", botId);
    if (!bot?.enabled) throw Error("Ese bot no está disponible.");
    return bot;
  };
  app.post("/api/missions", async (req, res) => {
    const { attachments, refs, ...data } = check(missionCreate, req.body);
    // conversationOf = previous mission of a 1:1 chat; the new turn continues it.
    const previous = data.conversationOf ? mustGet("missions", data.conversationOf, "Conversación") : null;
    if (previous) Object.assign(data, { mode: "solo", conversation: true });
    const botIds = [...new Set(data.botIds.length ? data.botIds : previous?.botIds || [])];
    botIds.forEach(enabledBot);
    if (data.mode === "solo" && botIds.length !== 1) throw Error("Elige un bot para este encargo.");
    if (data.mode === "debate" && botIds.length < 2) throw Error("El debate necesita al menos dos bots.");
    // A chat with one bot continues that bot's single thread (threads.mjs), wherever you
    // write from; only a private chat starts apart.
    if (data.conversation && data.mode === "solo" && botIds.length === 1 && !data.incognito && !previous) {
      const thread = botThread(store, botIds[0]);
      if (thread) {
        const picked = await referenceContext(store, { missionId: thread.id, refs, rootOf });
        const written = await writeAttachments(thread.id, attachments);
        await need("addMessage")(thread.id, data.prompt, written, { ...(data.use?.length ? { use: data.use } : {}), ...(data.deep ? { deep: true } : {}), ...(picked.refs.length ? { refs: picked.refs, context: picked.note } : {}) });
        return res.status(200).json({ ...store.get("missions", thread.id), continued: true });
      }
    }
    const files = attachments.map((f) => ({ name: f.name, size: f.size ?? (f.encoding === "base64" ? Math.floor(f.content.length * 3 / 4) : Buffer.byteLength(f.content)) }));
    const picked = await referenceContext(store, { refs: refs?.filter((r) => r.kind === "chat") });
    const mission = need("create")({ ...data, botIds, conversation: !!data.conversation, attachments: files, ...(data.conversation && data.mode === "solo" && !data.incognito ? { thread: true } : {}), ...(picked.note ? { context: picked.note } : {}) });
    try {
      await writeAttachments(mission.id, attachments);
    } catch (error) {
      store.patch("missions", mission.id, { status: "blocked", error: error.message });
      throw error;
    }
    res.status(201).json(mission);
    safe(() => runtime.launch(mission.id));
  });
  const stepView = (s, bots) => ({
    tools: safe(() => toolCalls(s, { bots, receipt: (callId) => store.get("receipts", s.id + ":" + callId) }), []),
    id: s.id, key: s.key ?? s.id, botId: s.botId ?? null, kind: s.kind, status: s.status, text: s.text || "",
    title: s.title || { plan: "Plan del equipo", synthesis: "Entrega final", proposal: "Propuesta", critique: "Crítica", followup: "Respuesta" }[s.kind] || bots.get(s.botId)?.role || "Trabajo",
    startedAt: s.startedAt ?? null, completedAt: s.completedAt ?? null,
    words: s.words ?? (String(s.text || "").trim() ? String(s.text).trim().split(/\s+/).length : 0), activity: s.activity || [], replyTo: s.replyTo ?? null,
    // The retry under way, for «Reintentando en 4 s…» (null when none).
    retrying: (s.recovery || []).at(-1)?.status === "waiting" ? (({ attempt, max, wait, at }) => ({ attempt, max, wait, at }))(s.recovery.at(-1)) : null,
    // «Ya tengo dos tarifas; me falta la de Iberdrola» (only while it works).
    narration: s.status === "running" && s.narration?.text ? { text: s.narration.text, at: s.narration.at } : null,
    round: s.round ?? 1, quietReply: !!s.quietReply,
    // The messages of the person this turn answers (their receipts: src/lib/receipts.js).
    ...(s.ackOn || s.ackExtra?.length ? { acks: [s.ackOn, ...(s.ackExtra || [])].filter(Boolean), ...(s.skipped ? { skipped: true } : {}) } : {}),
  });
  // A message as the client gets it. Its optional links (artifact, approval, plan, step, reply…)
  // only travel when set: an 800-message chat pages in without a wall of «null» (T3 Code payload
  // budgets, tests/perf-budget.test.mjs). The client replaces records whole, never merges them.
  const MESSAGE_OPTIONAL = ["artifactId", "approvalId", "plan", "summary", "stepId", "options", "replyTo", "part", "to", "learned"];
  const messageView = (m) => {
    const view = {
      // Another person's request to one of your bots (server/room-work.mjs) is kept as the bot read
      // it (`text`, wrapped as outside content); the screen shows what they wrote (`said`).
      id: m.id, role: m.role, botId: m.botId ?? null, text: (m.author?.address && typeof m.said === "string" ? m.said : m.text) || "", at: m.at ?? null,
      ...(m.author?.address ? { author: { address: m.author.address, name: m.author.name || "Alguien" } } : {}),
      kind: m.kind || (m.phase === "plan" ? "plan" : "message"),
      attachments: (m.attachments || []).map((a) => ({ name: a.name, size: a.size ?? null })),
      artifactId: m.artifactId ?? null, approvalId: m.approvalId ?? null, plan: m.plan ?? null, summary: m.summary ?? null,
      stepId: m.stepId ?? null, options: m.options ?? null, replyTo: m.replyTo ?? null, part: m.part ?? null, to: m.to ?? null,
      ...(m.kind === "progress" ? { callIds: m.callIds || [] } : {}),
      // What a notice is about (watch.mjs): the mails, events or messages, for its «Fuentes».
      ...(Array.isArray(m.sources) && m.sources.length ? { sources: m.sources.slice(0, 6).map((s) => ({ id: s.id ?? null, hilo: s.hilo ?? null, fuente: s.fuente ?? null, de: s.de ?? null, titulo: s.titulo ?? null, asunto: s.asunto ?? null, fecha: s.fecha ?? null, cuenta: s.cuenta ?? null, url: s.url ?? null })) } : {}),
      ...(m.use?.length ? { use: m.use } : {}), ...(m.deep ? { deep: true } : {}), ...(m.voice ? { voice: true } : {}),
      // «@» picks of files and conversations (mention-refs.mjs): chips under your message.
      ...(Array.isArray(m.refs) && m.refs.length ? { refs: m.refs.slice(0, 6).map((r) => ({ kind: r.kind, id: r.id ?? null, path: r.path ?? null, label: r.label ?? null })) } : {}),
      // Who the router gave your message to (router.mjs), or that it is still choosing — a
      // choice cut by a close is not shown as «choosing» for ever.
      ...(Array.isArray(m.routed?.to) && m.routed.to.length ? { routed: { to: m.routed.to.slice(0, 3), by: m.routed.by, why: m.routed.why || "" } }
        : m.routing === true && Date.now() - Date.parse(m.at || "") < 30_000 ? { routing: true } : {}),
      reactions: reactionsOf(m).map(reactionView),
      learned: m.learned ? {
        type: m.learned.type, undone: !!m.learned.undone, count: (m.learned.changes || []).length || 1,
        // «Por qué»: the messages or receipts that justify it (learning.mjs whyOf).
        ...(m.learned.why?.length ? { why: m.learned.why.map((w) => ({ type: w.type, quote: w.quote, missionId: w.missionId ?? null, auto: !!w.auto })) } : {}),
      } : null,
    };
    for (const key of MESSAGE_OPTIONAL) if (view[key] === null) delete view[key];
    return view;
  };
  app.get("/api/missions/:id", async (req, res) => {
    const m = mustGet("missions", req.params.id, "Misión");
    const ctx = context(store, runtime);
    // Long chats open with their latest 75 messages and only the steps those need (T3 Code
    // history paging); rooms with their latest 120 and every step (the plan, the team's work).
    // Older pages: GET /api/missions/:id/history; ?mensajes=todos brings everything (exports).
    // The active branch of the conversation only (branches.mjs), with its «1/3» spots.
    const every = store.where("messages", "missionId", m.id);
    const all = visibleMessages(m, every);
    const page = req.query.mensajes === "todos" ? null : historyPage(all, { limit: m.conversation ? CHAT_PAGE : ROOM_PAGE });
    const records = store.where("steps", "missionId", m.id);
    // A chat page leaves out the answer text its messages already carry (history.mjs).
    const views = (m.conversation && page ? stepsForPage(records, page) : records).map((s) => stepView(s, ctx.bots));
    const steps = m.conversation && page ? withoutSaidText(views, page.messages) : views;
    const letters = "ABCDEFGH";
    const proposals =
      m.proposals ||
      (m.mode === "debate"
        ? steps
            .filter((s) => s.kind === "proposal")
            .map((s, i) => ({
              botId: s.botId, label: "Propuesta " + letters[i], text: s.text, summary: s.text.slice(0, 280),
              critiques: steps.filter((c) => c.kind === "critique" && c.botId !== s.botId && c.text).map((c) => ({ botId: c.botId, text: critiqueAbout(c.text, ctx.bots.get(s.botId)?.name) })),
            }))
        : []);
    let files = [];
    try {
      const root = rootOf(m.id);
      const entries = (await readdir(root, { withFileTypes: true })).filter((e) => e.isFile());
      files = await Promise.all(entries.map(async (e) => ({ name: e.name, size: (await stat(path.join(root, e.name)).catch(() => null))?.size ?? null })));
    } catch {}
    res.json({
      ...missionSummary(m, ctx),
      prompt: m.prompt,
      steps,
      messages: (page ? page.messages : all).map(messageView),
      olderCount: page?.olderCount || 0,
      branches: branchPoints(m, every),
      cursor: page?.cursor ?? null,
      thread: store.where("thread", "missionId", m.id).map((t) => ({ id: t.id, from: t.from, to: t.to ?? null, text: t.text, at: t.at ?? t.createdAt ?? null })),
      threadSummary: m.threadSummary ?? null,
      debateSummary: steps.find((s) => s.kind === "debate_summary" && s.text)?.text ?? null,
      proposals,
      files,
      artifacts: store.where("artifacts", "missionId", m.id).map((a) => artifactSummary(a, ctx.missions)),
      approvals: ctx.approvals.filter((a) => a.missionId === m.id),
      checkpoints: runtime.checkpoints ? runtime.checkpoints.views(m.id) : [],
    });
  });
  // The map of the whole conversation (the version you see), every page: one entry per
  // message of yours, with the start of the answer (ConversationMap.jsx).
  app.get("/api/missions/:id/map", (req, res) => {
    const m = mustGet("missions", req.params.id, "Misión");
    res.json({ turns: conversationMap(visibleMessages(m, store.where("messages", "missionId", m.id))) });
  });
  // The page of messages before `antes` (the oldest one the conversation shows), with the
  // steps those messages need. `cursor` asks for the next page up; null at the very start.
  app.get("/api/missions/:id/history", (req, res) => {
    const { antes, limite } = check(z.object({ antes: z.string().trim().min(1).max(200), limite: z.coerce.number().int().min(1).max(MAX_PAGE).optional() }), { ...req.query });
    const m = mustGet("missions", req.params.id, "Misión");
    const page = historyPage(visibleMessages(m, store.where("messages", "missionId", m.id)), { before: antes, limit: limite ?? (m.conversation ? CHAT_PAGE : ROOM_PAGE) });
    if (!page) throw notFound("Mensaje");
    // Only the bots: the whole context (every mission, approval…) is not needed for a page.
    const bots = new Map(store.list("bots").map((b) => [b.id, b]));
    const views = stepsForPage(store.where("steps", "missionId", m.id), page).map((s) => stepView(s, bots));
    res.json({
      messages: page.messages.map(messageView),
      steps: m.conversation ? withoutSaidText(views, page.messages) : views,
      olderCount: page.olderCount,
      cursor: page.cursor,
    });
  });
  // A short «sí» / «no» in the chat decides the one request waiting there (like answering a
  // colleague who asked). A send also needs the send verb («sí, envíalo»); other red lines
  // (share, delete, pay…) are only decided with the buttons.
  const typedDecision = async (missionId, text) => {
    const decision = isYes(text) ? "approved" : isNo(text) ? "denied" : null;
    if (!decision) return null;
    // One put off with «Recordar después» is not what the person is answering: it waits for its
    // time (or for its card), and a «sí» in the chat goes to the bot as an ordinary message.
    const open = store.where("approvals", "missionId", missionId).filter((a) => a.status === "pending" && !isSnoozed(a) && (a.tool === "apps_execute" || ["permission", "write", "memory"].includes(a.kind)));
    if (open.length !== 1) return null;
    const a = open[0];
    if (decision === "approved" && a.kind === "send" && !/env[ií]a|manda|m[aá]ndal|env[ií]al/i.test(text)) return null;
    if (decision === "approved" && a.redLine && a.kind !== "send") return null;
    const message = store.put("messages", { id: id(), missionId, role: "user", kind: "message", text, approvalId: a.id, attachments: [], at: now() });
    if (a.tool === "apps_execute") {
      const { revision } = await connection().review(a.id);
      await connection().decide(a.id, { decision, revision });
      const prior = runtime.missionJobs?.get(missionId);
      void Promise.resolve(prior).then(() => runtime.launch(missionId));
    } else await need("approve")(a.id, decision, {});
    return message;
  };
  if (connections) connections.onDecided = (missionId) => {
    const prior = runtime.missionJobs?.get?.(missionId);
    void Promise.resolve(prior).then(() => runtime.launch(missionId));
  };
  // You are typing here: warm the answering bot's connection (fire and forget).
  app.post("/api/missions/:id/warm", (req, res) => {
    check(z.object({}).strict(), req.body);
    void Promise.resolve(typeof runtime.warm === "function" ? runtime.warm(req.params.id) : null).catch(() => {});
    res.json({ ok: true });
  });
  // «/btw …» never becomes a message nor waits in the queue: it has its own route (btw.mjs).
  const notAside = (text) => {
    if (btwQuestion(text) !== null) throw new HttpError(400, "«/btw» es una pregunta al margen: no entra en la conversación. Envíala con POST /api/missions/:id/btw.");
  };
  // What a message of yours may carry; a room adds whom it is for (routes/rooms.mjs).
  const messageFields = { text: z.string().trim().min(1).max(20000), attachments: z.array(attachmentInput).max(5).default([]), replyTo: z.string().trim().min(1).max(200).optional(), mode: z.enum(QUEUE_MODES).optional(), use: z.array(z.string().trim().min(2).max(40)).max(8).optional(), deep: z.boolean().optional(), refs: refsInput.optional() };
  /** Your message in a sala or a chat, and the turn that answers it. `to`: the bots it is for, when the sender says so. */
  const sendMessage = async (missionId, { text, attachments = [], replyTo, mode, use, deep, refs, to }) => {
    mustGet("missions", missionId, "Misión");
    notAside(text);
    const add = need("addMessage");
    // «@» picks: files or folders of this conversation, other conversations (mention-refs.mjs).
    const picked = await referenceContext(store, { missionId, refs, rootOf });
    if (!attachments.length && !replyTo && !use?.length && !deep && !picked.refs.length && !to?.length) {
      const decided = await typedDecision(missionId, text);
      if (decided) return decided;
    }
    const files = await writeAttachments(missionId, attachments);
    return add(missionId, text, files, { ...(replyTo ? { replyTo } : {}), ...(mode ? { mode } : {}), ...(use?.length ? { use } : {}), ...(deep ? { deep } : {}), ...(picked.refs.length ? { refs: picked.refs, context: picked.note } : {}), ...(to?.length ? { to } : {}) });
  };
  app.post("/api/missions/:id/messages", async (req, res) => {
    res.json(await sendMessage(req.params.id, check(z.object(messageFields).strict(), req.body)));
  });
  // The queue of a conversation (server/queue.mjs): messages written while the bot works,
  // sent one by one when it finishes; «Pasárselo ya» gives one to it at its next step.
  const queueText = z.string().trim().min(1).max(QUEUE_TEXT_MAX);
  const queued = (req) => { const m = mustGet("missions", req.params.id, "Misión"); return m; };
  const queueReply = (res, missionId) => res.json(queueView(store.get("missions", missionId)));
  app.post("/api/missions/:id/queue", (req, res) => {
    const { text } = check(z.object({ text: queueText }).strict(), req.body);
    notAside(text);
    const m = queued(req);
    enqueue(store, m, text);
    void deliverNext(store, runtime, m.id, sendQueued).catch(() => {});
    queueReply(res, m.id);
  });
  app.patch("/api/missions/:id/queue/:item", (req, res) => {
    const { text, before } = check(z.object({ text: queueText.optional(), before: z.string().trim().min(1).max(200).nullable().optional() }).strict(), req.body);
    const m = queued(req);
    if (text !== undefined) editQueued(store, m, req.params.item, text);
    if (before !== undefined) moveQueued(store, store.get("missions", m.id), req.params.item, before);
    queueReply(res, m.id);
  });
  app.delete("/api/missions/:id/queue/:item", (req, res) => {
    check(z.object({}).strict(), req.body || {});
    const m = queued(req);
    takeQueued(store, m, req.params.item);
    queueReply(res, m.id);
  });
  app.post("/api/missions/:id/queue/:item/now", async (req, res) => {
    check(z.object({}).strict(), req.body);
    const m = queued(req);
    const item = takeQueued(store, m, req.params.item);
    try {
      await need("addMessage")(m.id, item.text, [], { mode: "steer" });
    } catch (error) {
      const fresh = store.get("missions", m.id);
      store.patch("missions", m.id, { queue: [item, ...queueOf(fresh)] });
      throw error;
    }
    queueReply(res, m.id);
  });
  // «Deshacer cambios» (server/checkpoints.mjs): the files a turn changed, and putting them
  // back — that turn alone, or «Volver a este punto» with every later turn. Never while a bot
  // works in this chat, nor while another chat works in a shared folder it would touch.
  const restoreMode = (value) => (value === "punto" || value === "point" ? "point" : "turn");
  const restoreBusy = (missionId, plan) => {
    const m = store.get("missions", missionId);
    if (runtime.active?.has?.(missionId) || ["running", "queued", "planning"].includes(m?.status)) {
      const who = runtime.bot?.(store.where("steps", "missionId", missionId).find((s) => s.status === "running")?.botId || m?.botIds?.[0])?.name;
      return (who || "El bot") + " está trabajando en este chat. Espera a que acabe para deshacer cambios.";
    }
    for (const g of plan.groups.filter((x) => x.entry.kind === "folder")) {
      const folder = store.get("folders", g.entry.folderId);
      const others = [...(runtime.active?.keys?.() || [])].filter((x) => x !== missionId).map((x) => store.get("missions", x)).filter(Boolean);
      if (others.some((o) => (o.botIds || []).some((b) => folder?.botIds?.includes(b))))
        return "Otro chat está trabajando con la carpeta «" + g.entry.label + "». Espera a que acabe para deshacer cambios.";
    }
    return null;
  };
  const checkpointsOf = () => {
    if (!runtime.checkpoints) throw new HttpError(404, "Los puntos de restauración no están disponibles.");
    return runtime.checkpoints;
  };
  // Deliverables whose only file goes away with the restore leave the Biblioteca too.
  const goneDeliverables = (missionId, plan) => {
    const removed = new Set(plan.groups.filter((g) => g.entry.kind === "mission").flatMap((g) => g.remove));
    if (!removed.size) return [];
    const steps = new Set(plan.records.map((r) => r.stepId));
    return store.where("artifacts", "missionId", missionId).filter((a) => {
      if (!steps.has(a.stepId)) return false;
      const file = a.file || a.workFile || (store.get("receipts", a.id)?.tool === "write_file" ? a.title : null);
      return typeof file === "string" && removed.has(file);
    });
  };
  app.get("/api/missions/:id/checkpoints/:cp", async (req, res) => {
    const m = mustGet("missions", req.params.id, "Misión");
    const points = checkpointsOf();
    await points.idle(m.id);
    const plan = await points.plan(m.id, req.params.cp, restoreMode(req.query.modo));
    const all = points.views(m.id);
    const index = all.findIndex((x) => x.id === req.params.cp);
    res.json({
      mode: plan.mode, files: plan.files.filter((f) => !f.hidden), skipped: plan.skipped, later: Math.max(0, all.length - index - 1),
      turns: plan.records.length, busy: restoreBusy(m.id, plan), deliverables: goneDeliverables(m.id, plan).map((a) => a.title),
      outside: OUTSIDE_NOTE,
    });
  });
  app.post("/api/missions/:id/checkpoints/:cp/restore", async (req, res) => {
    const { mode } = check(z.object({ mode: z.enum(["turn", "point"]).default("turn") }).strict(), req.body);
    const m = mustGet("missions", req.params.id, "Misión");
    const points = checkpointsOf();
    await points.idle(m.id);
    let gone = [];
    const result = await points.restore(m.id, req.params.cp, mode, { busy: (plan) => { gone = goneDeliverables(m.id, plan); return restoreBusy(m.id, plan); } });
    store.tx(() => {
      for (const a of gone) { store.remove("artifacts", a.id); store.remove("messages", "deliverable:" + a.id); }
      const record = store.get("checkpoints", req.params.cp);
      store.put("messages", { id: id(), missionId: m.id, role: "system", kind: "activity", checkpointId: req.params.cp, restore: mode, at: now(), botId: record?.botId || null,
        text: restoreLine(result, runtime.bot?.(record?.botId)?.name || "el bot", record?.at) });
    });
    store.event(m.id, "files_restored", { text: "Archivos restaurados", checkpointId: req.params.cp, mode });
    const failed = new Set(result.failed.map((f) => f.path));
    res.json({ ok: true, mode, restored: result.files.filter((f) => !f.hidden && !failed.has(f.path)).length, failed: result.failed, deliverables: gone.map((a) => a.title) });
  });
  // After a refused send the queue waits for you: «Enviar la cola» sends it again.
  app.post("/api/missions/:id/queue/resume", (req, res) => {
    check(z.object({}).strict(), req.body);
    const m = queued(req);
    store.patch("missions", m.id, { queuePaused: null });
    void deliverNext(store, runtime, m.id, sendQueued).catch(() => {});
    queueReply(res, m.id);
  });
  // Versions of a conversation (branches.mjs, after assistant-ui's branch picker). None of them
  // while the bot answers: a version changes what it is answering to.
  const branchable = (req) => {
    const m = mustGet("missions", req.params.id, "Misión");
    if (runtime.active?.has?.(m.id) || ["running", "queued", "planning"].includes(m.status)) throw new HttpError(409, "Espera a que termine de responder.");
    return { m, every: store.where("messages", "missionId", m.id) };
  };
  // «Editar»: your message, written again, opens a new version from there; with `restore`
  // the files the bot changed since then go back as they were (checkpoints «Volver a este punto»).
  app.post("/api/missions/:id/edit", async (req, res) => {
    const { messageId, text, restore } = check(z.object({ messageId: z.string().trim().min(1).max(200), text: z.string().trim().min(1).max(20000), restore: z.boolean().optional() }).strict(), req.body);
    const { m, every } = branchable(req);
    const target = visibleMessages(m, every).find((x) => x.id === messageId);
    if (!target || target.role !== "user") throw notFound("Mensaje");
    let restored = null;
    if (restore) {
      const points = checkpointsOf();
      await points.idle(m.id);
      const first = points.views(m.id).find((cp) => String(cp.at || "") >= String(target.at || ""));
      if (first) restored = await points.restore(m.id, first.id, "point", { busy: (plan) => restoreBusy(m.id, plan) });
    }
    const opened = openBranch(m, every, messageId, now());
    store.patch("missions", m.id, opened.changes);
    const message = await need("addMessage")(m.id, text, []);
    res.json({ ok: true, branch: opened.branch.id, messageId: message?.id ?? null, restored: !!restored });
  });
  // «Otra respuesta»: the bot answers the same message again; the old answer stays as a version.
  app.post("/api/missions/:id/regenerate", (req, res) => {
    const { messageId } = check(z.object({ messageId: z.string().trim().min(1).max(200) }).strict(), req.body);
    const { m, every } = branchable(req);
    const path = visibleMessages(m, every);
    const at = path.findIndex((x) => x.id === messageId);
    if (at < 0 || path[at].role !== "assistant") throw notFound("Respuesta");
    let u = at - 1;
    while (u >= 0 && path[u].role !== "user") u--;
    if (u < 0) throw new HttpError(422, "No hay un mensaje tuyo al que volver a responder.");
    const opened = openBranch(m, every, path[u + 1].id, now());
    store.patch("missions", m.id, opened.changes);
    need("rerun")(m.id, path[u], path[at].botId || null);
    res.json({ ok: true, branch: opened.branch.id });
  });
  // «‹ 1/3 ›»: shows another version of one spot (and what followed it).
  app.post("/api/missions/:id/branch", (req, res) => {
    const { messageId } = check(z.object({ messageId: z.string().trim().min(1).max(200) }).strict(), req.body);
    const { m, every } = branchable(req);
    const changes = switchTo(m, every, messageId, now());
    if (!changes) throw notFound("Versión");
    if (Object.keys(changes).length) store.patch("missions", m.id, changes);
    res.json({ ok: true, branch: store.get("missions", m.id).branch || "main" });
  });
  // «Deshacer» on an «Aprendido: …» line in the room.
  app.post("/api/messages/:id/undo", (req, res) => {
    const m = undoLearned(store, req.params.id);
    res.json({ id: m.id, text: m.text, undone: !!m.learned?.undone });
  });
  // A reaction is silent: it never starts a turn; the bots see it on their next one.
  app.post("/api/messages/:id/reactions", (req, res) => {
    const { emoji } = check(z.object({ emoji: z.string().trim().min(1).max(16) }).strict(), req.body);
    const updated = togglePersonReaction(store, req.params.id, emoji);
    res.json({ id: updated.id, reactions: reactionsOf(updated).map(reactionView) });
  });
  // «No me sirve» and why: reason chips and a note on the person's 👎 (feedback.mjs), editable later.
  app.put("/api/messages/:id/feedback", (req, res) => {
    const data = check(z.object({ reasons: z.array(z.enum(DOWN_CODES)).max(DOWN_CODES.length).default([]), note: z.string().max(NOTE_MAX).default("") }).strict(), req.body);
    const updated = setDownFeedback(store, req.params.id, data);
    res.json({ id: updated.id, reactions: reactionsOf(updated).map(reactionView) });
  });
  app.post("/api/missions/:id/control", async (req, res) => {
    const { action, reason } = check(z.object({ action: z.enum(["pause", "resume", "cancel", "retry", "discard"]), reason: z.string().trim().max(600).optional() }).strict(), req.body);
    mustGet("missions", req.params.id, "Misión");
    // «Dile por qué lo has parado», typed before «Continuar» or «Descartar»: it goes along.
    if (reason && ["resume", "retry", "discard"].includes(action)) need("stopWhy")(req.params.id, reason);
    // «Descartar» on the «Se paró» card: what was left half done goes; the chat is ready again.
    if (action === "discard") need("discardStopped")(req.params.id);
    else if (action === "retry") need("retry")(req.params.id);
    else if (action === "resume") {
      if (runtime.active?.has?.(req.params.id)) throw Error("Espera a que termine la pausa en curso.");
      if (typeof runtime.resume === "function") await runtime.resume(req.params.id);
      else need("launch")(req.params.id);
    } else await need("stop")(req.params.id, action === "cancel");
    res.json({ ok: true });
  });
  // Deletes a room (or a chat conversation) and everything that only lives inside it:
  // messages, steps, plan thread, asides, pending approvals, reminders, notifications,
  // events and its working folder. Deliverables stay in the Biblioteca (with their files:
  // the folder is kept while a deliverable still points at a file inside it).
  // Rename a room (its #slug) and/or its title. The slug is normalised and kept unique.
  app.patch("/api/missions/:id", (req, res) => {
    const data = check(z.object({
      room: z.string().trim().min(1).max(60).optional(), title: z.string().trim().min(1).max(200).optional(), queueMode: z.enum(QUEUE_MODES).optional(),
      // «Posponer» (a preset or a time; null brings it back) and «Archivar».
      snooze: z.enum(["tarde", "manana", "lunes"]).optional(), snoozedUntil: z.string().datetime({ offset: true }).nullable().optional(), archived: z.boolean().optional(),
    }).strict(), req.body);
    const mission = mustGet("missions", req.params.id, "Sala");
    const changes = {};
    if (data.snooze) changes.snoozedUntil = snoozeUntil(data.snooze);
    if (data.snoozedUntil !== undefined) changes.snoozedUntil = data.snoozedUntil;
    if (data.archived !== undefined) {
      if (data.archived && ["running", "queued", "planning"].includes(mission.status)) throw Error("Espera a que terminen o páralos antes de archivar la sala.");
      changes.archived = data.archived;
      if (data.archived) changes.snoozedUntil = null;
    }
    if (data.title) Object.assign(changes, { title: data.title, titled: true }); // your name wins over the automatic one
    if (data.queueMode) changes.queueMode = data.queueMode;
    if (data.room) {
      const base = data.room.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^#+/, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
      if (!base) throw Error("Escribe un nombre con letras o números.");
      const taken = new Set(store.list("missions").filter((m) => m.id !== mission.id).map((m) => m.room).filter(Boolean));
      let slug = base;
      for (let n = 2; taken.has(slug); n++) slug = base + "-" + n;
      changes.room = slug;
    }
    res.json(Object.keys(changes).length ? store.patch("missions", mission.id, changes) : mission);
  });
  // «Duplicar desde aquí»: a new room with the conversation up to a message.
  app.post("/api/missions/:id/fork", (req, res) => {
    const { messageId } = check(z.object({ messageId: z.string().min(1).max(200).nullable().default(null) }).strict(), req.body || {});
    res.status(201).json(forkRoom(store, req.params.id, messageId, { slug: roomSlug }));
  });
  app.delete("/api/missions/:id", async (req, res) => {
    const mission = mustGet("missions", req.params.id, "Sala");
    await purgeMission(mission.id);
    res.json({ ok: true });
  });
  // Incognito chats past their 24 h go away with everything they had, deliverables included.
  const sweepIncognito = async () => {
    for (const m of store.list("missions"))
      if (m.incognito && m.expiresAt && Date.parse(m.expiresAt) <= Date.now()) await purgeMission(m.id, { everything: true }).catch(() => {});
  };
  const sweepSafely = () => sweepIncognito().catch(() => {});
  const incognitoTimer = setInterval(sweepSafely, 5 * 60 * 1000);
  incognitoTimer.unref?.();
  setTimeout(sweepSafely, 3000).unref?.();
  async function purgeMission(missionId, { everything = false } = {}) {
    // Development servers first: a running one keeps the project's files open on Windows.
    await Promise.resolve(runtime.projects?.servers?.stopMission?.(missionId)).catch(() => {});
    if (runtime.active?.has?.(missionId)) {
      try { need("stop")(missionId, true); } catch {}
      const job = runtime.missionJobs?.get?.(missionId);
      await Promise.race([Promise.resolve(job).catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
    }
    store.tx(() => {
      for (const kind of ["messages", "steps", "histories", "thread", "asides", "approvals", "intents", "notifications", "receipts", "relays", "codeJobs"])
        for (const rec of store.where(kind, "missionId", missionId)) {
          // Skill and personality proposals born here are about the bot, not the room: kept.
          if (kind === "approvals" && ["skill", "soul"].includes(rec.kind)) continue;
          store.remove(kind, rec.id);
        }
      for (const g of store.list("goals")) {
        if (!(g.milestones || []).some((m) => (m.missionIds || []).includes(missionId))) continue;
        store.put("goals", { ...g, milestones: g.milestones.map((m) => ({ ...m, missionIds: (m.missionIds || []).filter((x) => x !== missionId) })) });
      }
      store.sql("DELETE FROM events WHERE mission=?").run(missionId);
      // What this room measured stops counting in the verdicts (verdicts.mjs).
      dropObservations(store, missionId);
      store.remove("missions", missionId);
    });
    await runtime.checkpoints?.idle?.(missionId);
    await Promise.resolve(runtime.checkpoints?.purgeMission?.(missionId)).catch(() => {});
    if (everything) for (const a of store.where("artifacts", "missionId", missionId)) store.remove("artifacts", a.id);
    const root = rootOf(missionId);
    const keepFiles = store.where("artifacts", "missionId", missionId).some((a) => typeof a.file === "string" && a.file);
    if (root && !keepFiles && path.resolve(root).startsWith(path.resolve(store.directory, "workspaces") + path.sep))
      await rm(root, { recursive: true, force: true }).catch(() => {});
  }
  const missionAction = (route, schema, run) =>
    app.post("/api/missions/:id/" + route, async (req, res) => {
      const data = check(schema, req.body);
      mustGet("missions", req.params.id, "Misión");
      res.json((await run(req.params.id, data)) ?? { ok: true });
    });
  missionAction("plan", z.object({ decision: z.enum(["approved", "changes"]), note: z.string().trim().max(4000).optional() }).strict(), (missionId, d) => need("planDecision")(missionId, d.decision, d.note));
  // «Dile por qué lo has parado» on its own (the «Se paró» card): kept for the bot's next turn.
  missionAction("stop-reason", z.object({ text: z.string().trim().min(1).max(600) }).strict(), (missionId, d) => ({ ok: true, why: need("stopWhy")(missionId, d.text) }));
  missionAction("thread", z.object({ text: z.string().trim().min(1).max(4000) }).strict(), (missionId, d) => need("threadHint")(missionId, d.text));
  missionAction("choose", z.object({ botIds: z.array(short).min(1).max(2) }).strict(), (missionId, d) => need("choose")(missionId, [...new Set(d.botIds)]));
  missionAction("members", z.object({ botId: short }).strict(), (missionId, d) => {
    enabledBot(d.botId);
    return need("addMember")(missionId, d.botId);
  });
  return { messageView, stepView, enabledBot, sendMessage, messageFields };
}
