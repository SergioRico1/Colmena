import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../../server/store.mjs";
import { Runtime } from "../../server/runtime.mjs";
import { unwrapExternal } from "../../server/external-content.mjs";

export const answer = (text, usage) => ({
  text,
  usage,
  output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
});
export const call = (name, args, call_id = "call-1") => ({
  text: "",
  output: [{ type: "function_call", name, arguments: JSON.stringify(args), call_id }],
});
/** Tool outputs already present in the input, oldest first. */
// An output with a screenshot is [input_text, input_image]: its text part is the JSON. Outside
// content arrives wrapped (external-content.mjs): the JSON is inside the marks.
const unwrapped = (text) => unwrapExternal(text) ?? text;
export const outputs = (input) => input.filter((x) => x.type === "function_call_output").map((x) => JSON.parse(unwrapped(Array.isArray(x.output) ? x.output.find((p) => p.type === "input_text")?.text || "{}" : x.output)));
export const settle = async (runtime) => {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setImmediate(r));
    if (!runtime.jobs.size) return;
    await Promise.all([...runtime.jobs]);
  }
};

export async function fixture(t, respond, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-test-"));
  const store = new Store(directory);
  store.patch("settings", "main", { model: "fixture", learning: false });
  const runtime = new Runtime(store, { respond }, null, options);
  t.after(async () => {
    await runtime.shutdown();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { store, runtime, directory };
}
