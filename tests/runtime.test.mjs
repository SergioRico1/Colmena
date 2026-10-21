import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, symlink, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Runtime, STUCK_ROUNDS } from "../server/runtime.mjs";
import { safePath, createMissionFile } from "../server/files.mjs";
import { importSkill, activateSkill } from "../server/skills.mjs";

const answer = (text) => ({
  text,
  output: [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }],
    },
  ],
});
const call = (name, args, call_id = "call-1") => ({
  text: "",
  output: [
    { type: "function_call", name, arguments: JSON.stringify(args), call_id },
  ],
});
async function fixture(t, respond) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-test-"));
  const store = new Store(directory);
  store.patch("settings", "main", { model: "fixture", learning: false });
  const runtime = new Runtime(store, { respond });
  t.after(async () => {
    await runtime.shutdown();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { store, runtime, directory };
}
test("single bot persists confirmed output and artifact", async (t) => {
  const { store, runtime } = await fixture(t, async () =>
    answer("Resultado comprobado"),
  );
  const m = runtime.create({ prompt: "Prueba local" });
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).status, "completed");
  assert.equal(store.list("artifacts")[0].content, "Resultado comprobado");
});

test('followup queues after an active turn and preserves the conversation without replaying it',async t=>{
  let release,started;const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);let calls=0;
  const {store,runtime}=await fixture(t,async ({input})=>{calls++;if(calls===1){started();await gate;return answer('First result');}assert.match(input[0].content,/Followup/);assert.match(input[0].content,/First result/);return answer('Second result');});
  const m=runtime.create({prompt:'Initial'}),job=runtime.launch(m.id);await ready;
  runtime.addMessage(m.id,'Followup');release();await job;
  assert.equal(store.get('missions',m.id).status,'completed');assert.equal(store.get('missions',m.id).result,'Second result');assert.equal(calls,2);
  assert.equal(store.list('messages').filter(x=>x.role==='user').length,2);
});

test('a completed chat can continue; private bots cannot join teams and disabled AI cannot infer',async t=>{
  const {store,runtime}=await fixture(t,async()=>answer('Result'));
  const m=runtime.create({prompt:'Initial'});await runtime.launch(m.id);runtime.addMessage(m.id,'Continue');await Promise.all([...runtime.jobs]);
  assert.equal(runtime.steps(m.id).length,2);assert.equal(store.get('missions',m.id).status,'completed');
  store.patch('bots','nora',{audience:'yo'});assert.throws(()=>runtime.create({prompt:'Team',mode:'equipo',botIds:['nora']}),/personales/);
  store.patch('bots','nora',{usesChatGPT:false});const blocked=runtime.create({prompt:'No inference'});await runtime.launch(blocked.id);assert.equal(store.get('missions',blocked.id).status,'blocked');
});
test("approval gates creation, denial does not write or repeat the call", async (t) => {
  let count = 0;
  const { store, runtime } = await fixture(t, async ({ input }) => {
    count++;
    return input.some((x) => x.type === "function_call_output")
      ? answer("He respetado la decision.")
      : call("write_file", { path: "test.txt", content: "fixture" });
  });
  store.patch("bots", "nora", { autonomy: "sugiere" });
  const m = runtime.create({ prompt: "Crear archivo" });
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).status, "waiting");
  await assert.rejects(readFile(path.join(runtime.root(m.id), "test.txt")));
  const a = store.list("approvals")[0];
  runtime.approve(a.id, "denied");
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.all([...runtime.jobs]);
  assert.equal(store.get("missions", m.id).status, "completed");
  await assert.rejects(readFile(path.join(runtime.root(m.id), "test.txt")));
  assert.equal(count, 2);
});
test("approval resumes once and preserves exact reviewed payload", async (t) => {
  const { store, runtime } = await fixture(t, async ({ input }) =>
    input.some((x) => x.type === "function_call_output")
      ? answer("Archivo creado")
      : call("write_file", {
          path: "folder/result.txt",
          content: "exact-content",
        }),
  );
  store.patch("bots", "nora", { autonomy: "sugiere" });
  const m = runtime.create({ prompt: "Escribe" });
  await runtime.launch(m.id);
  const a = store.list("approvals")[0];
  runtime.approve(a.id, "approved");
  assert.throws(() => runtime.approve(a.id, "approved"));
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.all([...runtime.jobs]);
  assert.equal(
    await readFile(path.join(runtime.root(m.id), "folder/result.txt"), "utf8"),
    "exact-content",
  );
  assert.equal(store.get("approvals", a.id).status, "executed");
  assert.equal(store.list("receipts").length, 1);
});
test("parallel team starts its plan on its own and synthesizes specialist output", async (t) => {
  const seen = [];
  let active = 0,
    peak = 0;
  const { store, runtime } = await fixture(
    t,
    async ({ instructions, input, tools }) => {
      if (tools.some((x) => x.name === "propose_plan"))
        return input.some((x) => x.type === "function_call_output")
          ? answer("Reparto listo")
          : call("propose_plan", { assignments: [{ botId: "nora", task: "Investiga" }, { botId: "vera", task: "Redacta" }], summary: "Nora investiga y Vera redacta" });
      active++;
      peak = Math.max(peak, active);
      seen.push({ instructions, input });
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return answer("Aportacion " + seen.length);
    },
  );
  const m = runtime.create({
    prompt: "Trabajo conjunto",
    mode: "equipo",
    botIds: ["nora", "vera"],
  });
  await runtime.launch(m.id);
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.all([...runtime.jobs]);
  assert.equal(peak, 2);
  assert.equal(seen.length, 3);
  assert.match(seen.at(-1).input.at(-1).content, /Aportacion/);
  assert.equal(store.get("missions", m.id).status, "completed");
});
test("debate requires proposals and critiques then human selection", async (t) => {
  const { store, runtime } = await fixture(t, async () =>
    answer("Propuesta de prueba"),
  );
  const m = runtime.create({
    prompt: "Compara",
    mode: "debate",
    botIds: ["nora", "iris"],
  });
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).status, "awaiting_choice");
  assert.equal(store.list("artifacts").length, 0);
  assert.throws(() => runtime.choose(m.id, "bruno"));
  runtime.choose(m.id, "iris");
  await Promise.all([...runtime.jobs]);
  assert.equal(store.get("missions", m.id).chosenBotId, "iris");
  assert.equal(store.get("missions", m.id).status, "completed");
});
test("pause aborts request, preserves checkpoint and can resume", async (t) => {
  let started;
  const ready = new Promise((r) => (started = r));
  let calls = 0;
  const { store, runtime } = await fixture(t, async ({ signal }) => {
    calls++;
    if (calls > 1) return answer("Continuado");
    started();
    return new Promise((_, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      }),
    );
  });
  const m = runtime.create({ prompt: "Largo" });
  const run = runtime.launch(m.id);
  await ready;
  runtime.stop(m.id);
  await run;
  assert.equal(store.get("missions", m.id).status, "paused");
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).status, "completed");
});
test("restart does not repeat writes or silently resume running missions", async (t) => {
  const { store, runtime } = await fixture(t, async () => answer("ok"));
  const m = runtime.create({ prompt: "test" });
  store.patch("missions", m.id, { status: "running" });
  const restarted = new Runtime(store, { respond: async () => answer("ok") });
  assert.equal(store.get("missions", m.id).status, "paused");
  await restarted.launch(m.id);
  assert.equal(store.get("missions", m.id).status, "completed");
});
test("cancel denies pending approvals and prevents restart", async (t) => {
  const { store, runtime } = await fixture(t, async () =>
    call("remember", { text: "una preferencia" }),
  );
  store.patch("bots", "nora", { autonomy: "sugiere" });
  const m = runtime.create({ prompt: "Recuerda" });
  await runtime.launch(m.id);
  runtime.stop(m.id, true);
  assert.equal(store.list("approvals")[0].status, "denied");
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).status, "cancelled");
  assert.equal(store.list("memories").length, 0);
});
test("unknown tools are refused and a bot that only fails stops until the person says «continúa»", async (t) => {
  let counter = 0;
  const { store, runtime } = await fixture(t, async () =>
    call("shell", { command: "ignored " + counter }, "call-" + counter++),
  );
  const m = runtime.create({ prompt: "loop" });
  await runtime.launch(m.id);
  assert.equal(counter, STUCK_ROUNDS);
  assert.equal(store.get("missions", m.id).status, "waiting");
  assert.ok(store.list("messages").some((x) => x.missionId === m.id && /Me he atascado.*continúa/.test(x.text)));
  assert.ok(store.list("receipts").every((r) => r.result.error));
});
test("skill deduplication, activation and rollback retain history", async (t) => {
  const { store } = await fixture(t, async () => answer("x"));
  const one = importSkill(store, {
    content: "---\nname: same\n---\n# Metodo\nPaso 1",
  });
  assert.equal(importSkill(store, { content: one.content }).id, one.id);
  activateSkill(store, one.id, "active");
  const two = importSkill(store, {
    content: "---\nname: same\n---\n# Metodo\nPaso 2",
  });
  activateSkill(store, two.id, "active");
  assert.equal(two.version, 2);
  assert.equal(store.get("skills", one.id).status, "disabled");
  activateSkill(store, one.id, "active");
  assert.equal(store.get("skills", two.id).status, "disabled");
  assert.throws(() =>
    importSkill(store, {
      content:
        "---\nname: !!js/function >\n  function() { return 1; }\n---\n# Unsafe",
    }),
  );
});
test("paths reject traversal, Windows aliases and symlinks", async (t) => {
  const { directory } = await fixture(t, async () => answer("x"));
  for (const name of [
    "../secret",
    "/etc/passwd",
    "C:\\secret",
    "foo\\bar",
    "a/../b",
    "file:stream",
    "CON.txt",
    "path./x",
    "a//b",
  ])
    await assert.rejects(safePath(directory, name));
  const outside = path.join(directory, "outside"),
    work = path.join(directory, "work");
  await mkdir(outside);
  await mkdir(work);
  await symlink(outside, path.join(work, "linked"), "junction");
  await assert.rejects(createMissionFile(work, "linked/no.txt", "blocked"));
});
test("file creation reconciles same content but never overwrites different data", async (t) => {
  const { directory } = await fixture(t, async () => answer("x"));
  await createMissionFile(directory, "file.txt", "one");
  await createMissionFile(directory, "file.txt", "one");
  await assert.rejects(createMissionFile(directory, "file.txt", "two"));
  assert.equal(await readFile(path.join(directory, "file.txt"), "utf8"), "one");
});
