// HTTP routes of «Código» (register before the /api 404 handler): projects, tasks, the
// timeline, answers to Bruno's questions, changes, restore points, preview ports and saving.
// GET /api/code/events streams the live part (text as it is written, new and changed items,
// task status) as SSE for the open screen.
import express from "express";
import { z } from "zod";
import { EFFORTS, ENGINES, CONTEXT_KINDS } from "./service.mjs";
import { ACCESS } from "./policy.mjs";
import { saveScript } from "./terminal.mjs";
import { listFiles, fuzzyFiles, listSkills, saveAttachment } from "./context.mjs";

const attachments = z.array(z.object({ path: z.string().min(1).max(1000) }).passthrough()).max(20);
/** Context chips (service.mjs cleanContexts keeps only what it knows). */
const contexts = z.array(z.object({ kind: z.enum(CONTEXT_KINDS), label: z.string().max(400).optional(), text: z.string().max(40000).optional(), note: z.string().max(8000).optional() }).passthrough()).max(20);

/** Attachments come as base64 JSON: their route gets a bigger body than the rest of the API. */
export const codeUploadParser = (() => {
  const parse = express.json({ limit: "28mb" });
  return (req, res, next) => (req.method === "POST" && req.path === "/api/code/attachments" ? parse(req, res, next) : next());
})();

export function registerCodeRoutes(app, { code }) {
  // The composer: `@` files of the task, `$` skills, attachments and «Compactar».
  app.get("/api/code/tasks/:id/files", async (req, res) => {
    const task = code.mustTask(id.parse(req.params.id));
    const q = z.string().max(200).default("").parse(req.query.q || "");
    res.json({ files: fuzzyFiles(await listFiles(task.cwd), q) });
  });
  app.get("/api/code/projects/:id/files", async (req, res) => {
    const project = code.mustProject(id.parse(req.params.id));
    const q = z.string().max(200).default("").parse(req.query.q || "");
    res.json({ files: fuzzyFiles(await listFiles(project.root), q) });
  });
  app.get("/api/code/skills", async (req, res) => {
    const taskId = req.query.task ? id.parse(req.query.task) : null;
    const projectId = req.query.project ? id.parse(req.query.project) : null;
    const folder = taskId ? code.mustTask(taskId).cwd : projectId ? code.mustProject(projectId).root : null;
    res.json({ skills: folder ? (await listSkills(folder)).map(({ file, ...s }) => s) : [] });
  });
  app.post("/api/code/attachments", async (req, res) => {
    const body = z.object({ name: z.string().trim().min(1).max(200), data: z.string().min(1).max(28 * 1024 * 1024) }).strict().parse(req.body || {});
    res.json({ attachment: await saveAttachment(code.directory, body) });
  });
  // Keyboard shortcuts of «Código» (T3 Code keybindings): defaults, overridden per action.
  app.get("/api/code/keybindings", (_req, res) => res.json(code.keybindings()));
  app.put("/api/code/keybindings", (req, res) => {
    const combo = z.string().trim().max(40).regex(/^((mod|ctrl|alt|shift)\+)*([a-z0-9]|f\d{1,2}|[.,;/`\-=[\]']|enter|escape|space|arrow(up|down|left|right))$/);
    const body = z.object({ bindings: z.record(z.union([combo, z.literal("")])) }).strict().parse(req.body || {});
    res.json(code.setKeybindings(body.bindings));
  });
  app.post("/api/code/engines/opencode/install", async (_req, res) => res.json(await code.installOpenCode()));
  app.post("/api/code/tasks/:id/compact", async (req, res) => res.json(await code.compact(id.parse(req.params.id))));

  const id = z.string().trim().min(1).max(80);
  const text = z.string().trim().min(1).max(100000);
  const model = z.string().trim().min(1).max(80).regex(/^[\w.:/-]+$/);

  app.get("/api/code", async (_req, res) => {
    const engines = await code.catalog();
    res.json({ projects: code.projects(), engines, models: engines[0].models, efforts: EFFORTS, access: ACCESS });
  });
  app.post("/api/code/projects", async (req, res) => {
    const body = z.object({ folder: z.string().trim().min(1).max(1000).optional(), clone: z.string().trim().min(1).max(500).optional(), name: z.string().trim().min(1).max(80).optional() }).strict().parse(req.body || {});
    if (body.clone) return res.json({ project: await code.cloneProject({ url: body.clone }) });
    res.json({ project: body.folder ? await code.addProject({ folder: body.folder }) : await code.newProject({ name: body.name || "proyecto" }) });
  });
  app.delete("/api/code/projects/:id", (req, res) => res.json(code.removeProject(id.parse(req.params.id))));

  app.post("/api/code/tasks", async (req, res) => {
    const body = z.object({
      projectId: id, text: z.string().max(100000).default(""), engine: z.enum(ENGINES).optional(), model: model.optional(), effort: z.enum(EFFORTS).optional(),
      access: z.enum(ACCESS).optional(), isolated: z.boolean().optional(), mode: z.enum(["build", "plan"]).optional(), attachments: attachments.optional(), label: z.string().trim().max(60).optional(), group: z.string().regex(/^cg-[0-9a-f]{4,16}$/).optional(),
    }).strict().parse(req.body || {});
    res.json({ task: await code.createTask(body) });
  });
  app.get("/api/code/tasks/:id", (req, res) => res.json(code.detail(id.parse(req.params.id))));
  app.patch("/api/code/tasks/:id", (req, res) => {
    const body = z.object({ title: z.string().trim().min(1).max(120).optional(), model: model.optional(), effort: z.enum(EFFORTS).optional(), access: z.enum(ACCESS).optional() }).strict().parse(req.body || {});
    res.json({ task: code.patchTask(id.parse(req.params.id), body) });
  });
  app.delete("/api/code/tasks/:id", async (req, res) => res.json(await code.deleteTask(id.parse(req.params.id))));
  app.post("/api/code/tasks/:id/messages", async (req, res) => {
    const body = z.object({ text: z.string().trim().max(100000).default(""), when: z.enum(["queue", "steer"]).default("queue"), mode: z.enum(["build", "plan"]).default("build"), attachments: attachments.default([]), contexts: contexts.default([]) }).strict().parse(req.body || {});
    res.json(await code.send(id.parse(req.params.id), body));
  });
  // «/goal»: Bruno keeps going until he says it is done (or pause, resume, clear it).
  app.post("/api/code/tasks/:id/goal", async (req, res) => {
    const body = z.object({ action: z.enum(["set", "pause", "resume", "clear", "complete"]).default("set"), text: z.string().max(4000).optional() }).strict().parse(req.body || {});
    res.json(await code.setGoal(id.parse(req.params.id), body));
  });
  // Which task the person is looking at (no notice for what is already on screen).
  app.post("/api/code/watch", (req, res) => {
    const body = z.object({ task: z.string().trim().max(80).nullable().optional(), focused: z.boolean().default(false) }).strict().parse(req.body || {});
    res.json(code.setWatch(body));
  });
  app.delete("/api/code/tasks/:id/queue/:item", (req, res) => {
    const task = code.mustTask(id.parse(req.params.id));
    res.json({ task: code.taskView(code.setTask(task.id, { queue: (task.queue || []).filter((q) => q.id !== req.params.item) })) });
  });
  app.post("/api/code/tasks/:id/stop", async (req, res) => res.json(await code.stop(id.parse(req.params.id))));
  app.post("/api/code/tasks/:id/asks/:ask", (req, res) => {
    const body = z.object({ decision: z.enum(["allow", "always", "task", "here", "deny"]).optional(), answers: z.record(z.string().max(500)).optional() }).strict().parse(req.body || {});
    res.json(code.answer(id.parse(req.params.id), id.parse(req.params.ask), body));
  });
  app.get("/api/code/tasks/:id/diff", async (req, res) => {
    const turn = req.query.turn ? z.coerce.number().int().min(1).max(100000).parse(req.query.turn) : null;
    res.json(await code.diff(id.parse(req.params.id), { turn }));
  });
  app.post("/api/code/tasks/:id/restore", async (req, res) => {
    const body = z.object({ turn: z.number().int().min(0).max(100000).optional(), undo: z.string().regex(/^[0-9a-f]{40,64}$/).optional() }).strict().refine((b) => b.turn !== undefined || b.undo, "Falta el punto.").parse(req.body || {});
    res.json(await code.restore(id.parse(req.params.id), body));
  });
  app.post("/api/code/tasks/:id/edit-from", async (req, res) => {
    const body = z.object({ item: id }).strict().parse(req.body || {});
    res.json(await code.editFrom(id.parse(req.params.id), body));
  });
  app.get("/api/code/tasks/:id/ports", async (req, res) => res.json({ ports: await code.ports(id.parse(req.params.id)) }));
  app.post("/api/code/tasks/:id/save", async (req, res) => {
    const body = z.object({ to: z.enum(["branch", "base", "push", "pr"]).default("branch"), message: z.string().trim().max(2000).optional() }).strict().parse(req.body || {});
    const taskId = id.parse(req.params.id);
    if (body.to === "base") return res.json(await code.merge(taskId));
    if (body.to === "push") return res.json(await code.push(taskId));
    if (body.to === "pr") return res.json(await code.pullRequest(taskId));
    res.json(await code.commit(taskId, { message: body.message }));
  });
  // One file of the diff: undo it, or open it in the editor at that line.
  app.post("/api/code/tasks/:id/revert-file", async (req, res) => {
    const body = z.object({ path: z.string().trim().min(1).max(1000), turn: z.number().int().min(1).max(100000).nullable().optional() }).strict().parse(req.body || {});
    res.json(await code.revertFile(id.parse(req.params.id), body));
  });
  app.post("/api/code/tasks/:id/open-editor", async (req, res) => {
    const body = z.object({ path: z.string().trim().min(1).max(1000), line: z.number().int().min(1).max(10000000).default(1) }).strict().parse(req.body || {});
    res.json(await code.openInEditor(id.parse(req.params.id), body));
  });
  // Several engines at once: what each one did, and their tests.
  const group = z.string().regex(/^cg-[0-9a-f]{4,16}$/);
  app.get("/api/code/compare/:group", async (req, res) => res.json(await code.compare(group.parse(req.params.group))));
  app.post("/api/code/compare/:group/tests", async (req, res) => res.json(await code.compareTests(group.parse(req.params.group))));
  // Following the task's pull request with gh.
  app.post("/api/code/tasks/:id/pr", async (req, res) => {
    const body = z.object({ watch: z.boolean() }).strict().parse(req.body || {});
    res.json(await code.setPrWatch(id.parse(req.params.id), body.watch));
  });
  // Review before saving, «Ponerse al día» with the base, and Bruno's look at the preview.
  app.post("/api/code/tasks/:id/review", async (req, res) => res.json(await code.review(id.parse(req.params.id))));
  app.post("/api/code/tasks/:id/catch-up", async (req, res) => res.json(await code.catchUp(id.parse(req.params.id))));
  app.post("/api/code/tasks/:id/preview/check", async (req, res) => {
    const body = z.object({ path: z.string().max(400).optional(), port: z.number().int().min(1024).max(65535).optional() }).strict().parse(req.body || {});
    res.json(await code.previewCheck(id.parse(req.params.id), body));
  });
  app.post("/api/code/tasks/:id/preview/act", async (req, res) => {
    const body = z.object({ kind: z.enum(["click", "escribir", "tecla"]), ref: z.string().max(40).default(""), text: z.string().max(4000).default("") }).strict().parse(req.body || {});
    res.json(await code.previewAct(id.parse(req.params.id), body));
  });
  app.post("/api/code/tasks/:id/plans/:item", async (req, res) => {
    const body = z.object({ action: z.enum(["implement", "new", "refine"]), text: z.string().max(100000).optional() }).strict().parse(req.body || {});
    res.json(await code.planAction(id.parse(req.params.id), { item: id.parse(req.params.item), ...body }));
  });

  // Terminals (the person's own shells in the task folder) and the project's scripts.
  const term = z.string().regex(/^t[0-9a-f]{6}$/);
  app.get("/api/code/tasks/:id/terminals", async (req, res) => {
    const task = code.mustTask(id.parse(req.params.id));
    res.json({ terminals: await code.terminals.list(task.id), scripts: code.scriptsOf(task) });
  });
  app.post("/api/code/projects/:id/scripts", async (req, res) => {
    const project = code.mustProject(id.parse(req.params.id));
    const body = z.object({ name: z.string().trim().min(1).max(60), command: z.string().trim().min(1).max(1000), onCreate: z.boolean().default(false) }).strict().parse(req.body || {});
    res.json({ scripts: await saveScript(project.root, body) });
  });
  app.post("/api/code/tasks/:id/terminals", async (req, res) => {
    let task = code.mustTask(id.parse(req.params.id));
    if (task.saved) task = await code.recover(task.id); // a cleaned-up copy comes back first
    const body = z.object({ id: term.optional(), script: z.string().trim().min(1).max(60).optional(), cols: z.number().int().min(20).max(400).default(100), rows: z.number().int().min(5).max(200).default(30) }).strict().parse(req.body || {});
    const script = body.script ? code.scriptsOf(task).find((s) => s.name === body.script) : null;
    if (body.script && !script) throw Object.assign(Error("Ese script no está en colmena.json ni en package.json."), { status: 404 });
    res.json({ terminal: await code.terminals.open(task.id, { cwd: task.cwd, id: body.id || null, command: script?.command || null, title: script?.name || null, cols: body.cols, rows: body.rows }) });
  });
  app.post("/api/code/tasks/:id/terminals/:term/input", (req, res) => {
    const body = z.object({ data: z.string().max(65536) }).strict().parse(req.body || {});
    code.terminals.write(id.parse(req.params.id), term.parse(req.params.term), body.data);
    res.json({ ok: true });
  });
  app.post("/api/code/tasks/:id/terminals/:term/resize", (req, res) => {
    const body = z.object({ cols: z.number().int().min(20).max(400), rows: z.number().int().min(5).max(200) }).strict().parse(req.body || {});
    code.terminals.resize(id.parse(req.params.id), term.parse(req.params.term), body.cols, body.rows);
    res.json({ ok: true });
  });
  app.delete("/api/code/tasks/:id/terminals/:term", async (req, res) => res.json(await code.terminals.close(id.parse(req.params.id), term.parse(req.params.term))));
  app.get("/api/code/tasks/:id/terminals/:term/stream", (req, res) => {
    const taskId = id.parse(req.params.id), termId = term.parse(req.params.term);
    code.mustTask(taskId);
    res.set({ "Content-Type": "text/event-stream", Connection: "keep-alive", "Cache-Control": "no-store" });
    res.flushHeaders();
    // Output goes out in ~16 ms windows (a burst of a build log stays one frame).
    let pending = "", timer = null;
    const flush = () => { timer = null; if (pending) res.write("data: " + JSON.stringify({ type: "data", data: pending }) + "\n\n"); pending = ""; };
    const off = code.terminals.attach(taskId, termId, (frame) => {
      if (frame.type === "data") { pending += frame.data; timer ??= setTimeout(flush, 16); return; }
      flush();
      res.write("data: " + JSON.stringify(frame) + "\n\n");
    });
    const ping = setInterval(() => res.write(": ping\n\n"), 20000);
    req.on("close", () => { clearInterval(ping); clearTimeout(timer); off(); });
  });

  app.get("/api/code/events", (req, res) => {
    res.set({ "Content-Type": "text/event-stream", Connection: "keep-alive", "Cache-Control": "no-store" });
    res.flushHeaders();
    res.write("event: ready\ndata: {}\n\n");
    // Text deltas go out in ~50 ms windows; everything else at once.
    let pending = new Map(), timer = null;
    const flush = () => {
      timer = null;
      for (const [task, text] of pending) res.write("data: " + JSON.stringify({ type: "delta", task, text }) + "\n\n");
      pending = new Map();
    };
    const send = (event) => {
      if (event.type === "delta" && !event.reset) {
        pending.set(event.task, (pending.get(event.task) || "") + event.text);
        timer ??= setTimeout(flush, 50);
        return;
      }
      if (event.type === "delta" && event.reset) { pending.delete(event.task); }
      else if (timer) { clearTimeout(timer); flush(); }
      res.write("data: " + JSON.stringify(event) + "\n\n");
    };
    code.events.on("event", send);
    const ping = setInterval(() => res.write(": ping\n\n"), 20000);
    req.on("close", () => {
      clearInterval(ping);
      clearTimeout(timer);
      code.events.off("event", send);
    });
  });
}
