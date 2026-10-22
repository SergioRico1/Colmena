import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call } from "./fixtures/runtime-fixture.mjs";

const page = (text) => async (url) => ({ url, finalUrl: url, title: "Página", text, truncated: false, untrusted: true });

test("before a long history is summarized, the bot saves what must outlive it; nothing reaches the room", async (t) => {
  let flushes = 0, summaries = 0, mains = 0;
  const { store, runtime } = await fixture(t, async (request) => {
    if (request.instructions.startsWith("Resume el trabajo")) {
      summaries += 1;
      return answer("## Objetivo\nX\n## Preferencias de la persona\n-\n## Hecho\n-\n## En curso\n-\n## Bloqueado\n-\n## Decisiones\n-\n## Siguiente paso\n-");
    }
    const last = request.input.at(-1);
    if (typeof last?.content === "string" && last.content.startsWith("[Colmena va a resumir")) {
      flushes += 1;
      assert.deepEqual(request.tools.map((x) => x.name), ["remember"], "only remember in the silent turn");
      return call("remember", { operations: [{ action: "add", target: "persona", text: "Prefiere los precios con IVA incluido.", old: "" }] }, "m1");
    }
    mains += 1;
    if (request.input.some((x) => /^\[Resumen/.test(x.content || "")) || mains > 30) return answer("Comparativa lista.");
    // Many short results (trimming cannot free them): only the summary makes room.
    return { text: "", output: Array.from({ length: 20 }, (_, k) => ({ type: "function_call", name: "web_fetch", arguments: JSON.stringify({ url: "https://example.com/" + mains + "-" + k }), call_id: "w" + mains + "-" + k })) };
  }, { web: page("precio ".repeat(100)) });
  const m = runtime.create({ prompt: "Compara precios", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  assert.equal(flushes, 1, "one silent turn before the one summary");
  assert.equal(summaries, 1);
  assert.ok(store.list("memories").some((x) => x.active !== false && /IVA incluido/.test(x.text)), "the fact was saved");
  const said = store.list("messages").filter((x) => x.missionId === m.id && x.role === "assistant").map((x) => x.text);
  assert.deepEqual(said, ["Comparativa lista."], "the silent turn writes nothing in the room");
  assert.ok(store.events(m.id).some((e) => e.type === "memory_flush"));
});
