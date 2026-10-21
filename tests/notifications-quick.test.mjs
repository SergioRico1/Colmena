import test from "node:test";
import assert from "node:assert/strict";

test("desktop notices offer quick buttons only for what stays inside Colmena", async () => {
  const { quickActions } = await import("../server/notifications.mjs");
  assert.deepEqual(quickActions({ id: "a1", status: "pending", kind: "permission", tool: "write_file" }), { approvalId: "a1", kind: "permission" });
  assert.deepEqual(quickActions({ id: "q", status: "pending", kind: "question", options: [{ id: "o1", label: "Sí" }, { id: "o2", label: "No" }] }).options.map((o) => o.label), ["Sí", "No"]);
  assert.equal(quickActions({ id: "p", status: "pending", kind: "plan", missionId: "m" }).kind, "plan");
  for (const outside of [{ kind: "send" }, { kind: "permission", redLine: true }, { kind: "permission", tool: "apps_execute" }, { kind: "skill" }]) {
    assert.equal(quickActions({ id: "x", status: "pending", ...outside }), null, JSON.stringify(outside));
  }
  assert.equal(quickActions({ id: "d", status: "approved", kind: "permission" }), null);
});
