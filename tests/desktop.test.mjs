import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, outputs, settle } from "./fixtures/runtime-fixture.mjs";
import { CuaDesktop, desktopExtraTools, blocked, RED_UI } from "../server/computer/desktop.mjs";

// Cua Driver stand-in: one Outlook window with a «Enviar» button and a password field.
class FakeDesktop extends CuaDesktop {
  constructor(log) { super({ command: "cua-driver.exe" }); this.log = log; }
  async call(name, args) {
    this.log.push(name);
    if (name === "list_windows")
      return { text: '- OUTLOOK.EXE (pid 10) "Bandeja de entrada - Outlook" [window_id: 77]\n- electron.exe (pid 20) "Colmena" [window_id: 88]', data: { windows: [] } };
    if (name === "get_window_state")
      return { text: 'window_id=77 pid=10 elements=3 snapshot_id=s00000001\n- [0] Button "Enviar"\n- [1] Edit "Contraseña"\n- [2] Edit "Asunto"', image: "data:image/png;base64,AAAA", data: {} };
    return { text: "ok", data: {} };
  }
}

test("the desktop red lines: Colmena and consoles are off limits; sending is spotted", () => {
  assert.equal(blocked({ app: "electron.exe", title: "Colmena" }), true);
  assert.equal(blocked({ app: "powershell.exe", title: "PowerShell" }), true);
  assert.equal(blocked({ app: "EXCEL.EXE", title: "Libro1 - Excel" }), false);
  for (const s of ["Enviar", "Pagar ahora", "Delete", "Publicar", "Eliminar"]) assert.ok(RED_UI.test(s), s);
  for (const s of ["Asunto", "Guardar", "Negrita"]) assert.ok(!RED_UI.test(s), s);
});

test("a bot uses an app without asking; «Enviar» is always reviewed and passwords are never typed", async (t) => {
  const log = [];
  let round = 0, seen = null;
  const { store, runtime } = await fixture(t, async ({ input }) => {
    round += 1;
    if (round === 1) return call("desktop_windows", {}, "w");
    if (round === 2) return call("desktop_look", { window_id: "77", query: "" }, "l");
    if (round === 3) return call("desktop_do", { window_id: "77", action: "type", element: "s00000001:1", x: null, y: null, text: "secreta" }, "p");
    if (round === 4) return call("desktop_do", { window_id: "77", action: "type", element: "s00000001:2", x: null, y: null, text: "Informe" }, "t");
    if (round === 5) return call("desktop_do", { window_id: "77", action: "click", element: "s00000001:0", x: null, y: null, text: "" }, "s");
    seen = outputs(input);
    return answer("Listo.");
  });
  const desktop = new FakeDesktop(log);
  runtime.extraTools = desktopExtraTools(runtime, desktop);
  store.patch("bots", "vera", { autonomy: "avisa" });
  const m = runtime.create({ prompt: "Escribe el informe en Outlook", mode: "solo", botIds: ["vera"] });
  await runtime.launch(m.id);
  await settle(runtime);
  // desktop_windows ran freely and did not list Colmena; looking and typing asked nothing.
  assert.equal(store.list("approvals").filter((x) => x.missionId === m.id && !x.redLine).length, 0);
  // The password field was refused, «Asunto» was typed, «Enviar» waits.
  const red = store.list("approvals").find((x) => x.missionId === m.id && x.redLine);
  assert.ok(red, "pressing «Enviar» is a red line");
  assert.match(red.summary, /pulsar «Enviar»/);
  assert.equal(red.canAlways, false);
  assert.ok(log.includes("type_text"));
  assert.equal(log.filter((x) => x === "type_text").length, 1, "only «Asunto», never the password");
  assert.ok(!log.includes("click"), "nothing sent before your review");
  runtime.approve(red.id, "approved");
  await settle(runtime);
  assert.ok(log.includes("click"));
  const [windows, look, secret] = seen;
  assert.deepEqual(windows.windows.map((w) => w.app), ["OUTLOOK.EXE"]);
  assert.ok(look.imageAttached || look.elements, "the look result reached the model");
  assert.match(secret.error, /contraseña o un dato de pago/);
});

test("a bot set to «Solo sugiere» asks once to use an app", async (t) => {
  let round = 0;
  const { store, runtime } = await fixture(t, async () => {
    round += 1;
    if (round === 1) return call("desktop_windows", {}, "w");
    if (round === 2) return call("desktop_look", { window_id: "77", query: "" }, "l");
    return answer("Listo.");
  });
  runtime.extraTools = desktopExtraTools(runtime, new FakeDesktop([]));
  store.patch("bots", "vera", { autonomy: "sugiere" });
  const m = runtime.create({ prompt: "Mira mi Outlook", mode: "solo", botIds: ["vera"] });
  await runtime.launch(m.id);
  await settle(runtime);
  const first = store.list("approvals").find((x) => x.missionId === m.id);
  assert.equal(first.tool, "desktop");
  assert.match(first.summary, /Vera quiere usar «Bandeja de entrada - Outlook» en tu ordenador/);
  assert.equal(first.canAlways, true);
});

test("a screenshot in the history counts as a small fixed cost, not as its base64 size", async () => {
  const { contextSize, CONTEXT } = await import("../server/runtime.mjs");
  const shot = "data:image/png;base64," + "A".repeat(600000);
  const history = [{ type: "function_call_output", call_id: "l", output: [{ type: "input_text", text: "{}" }, { type: "input_image", image_url: shot }] }];
  assert.ok(JSON.stringify(history).length > CONTEXT.hardLimit, "raw JSON would trip the limit");
  assert.ok(contextSize(history) < 10000);
});
