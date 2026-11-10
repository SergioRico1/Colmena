import { DENY_REASON_MAX } from "../denial.mjs";
import { z } from "zod";
import { short, email, check } from "./shared.mjs";

/** Connected apps (Composio): the catalogue, connecting and disconnecting, and what the approvals need of them. */
export function registerConnectionRoutes(app, { connections, runtime, connectorCache, store }) {
  // ------------------------------------------------ connections (09b/09c)
  const connection = () => {
    if (!connections) throw Error("Conexiones no disponibles.");
    return connections;
  };
  app.get("/api/connections/status", async (_req, res) => {
    const { configured } = await connection().call("status");
    res.json({ available: configured });
  });
  app.get("/api/connections/accounts", async (req, res) => {
    const page = await connection().call("accounts", { cursor: check(z.string().max(2000), req.query.cursor || "") });
    // A new account (just authorized) gets its direct tools without waiting for the cache.
    runtime.appTools?.refreshSoon?.();
    res.json(page);
  });
  app.get("/api/connections/catalogue", async (req, res) =>
    res.json(
      await connection().call(
        "catalogue",
        check(
          z.object({ query: z.string().max(200).default(""), category: z.enum(["", "mail", "documents", "team", "development"]).default(""), cursor: z.string().max(12000).default("") }).strict(),
          req.query,
        ),
      ),
    ),
  );
  const management = {
    link: z.object({ toolkit: short }).strict(),
    rename: z.object({ account: short, alias: z.string().trim().min(1).max(80) }).strict(),
    disconnect: z.object({ account: short }).strict(),
  };
  for (const [op, schema] of Object.entries(management))
    app.post("/api/connections/" + op, async (req, res) => {
      const result = await connection().manage(op, check(schema, req.body));
      void connectorCache.refresh();
      runtime.appTools?.refreshSoon?.();
      res.json(result);
    });
  app.get("/api/connections/review/:id", async (req, res) => res.json(await connection().review(req.params.id)));
  const emailEdit = z.object({ to: z.array(email).min(1).max(30), cc: z.array(email).max(30).default([]), cco: z.array(email).max(30).default([]), subject: z.string().max(998), body: z.string().max(18000) });
  app.patch("/api/connections/review/:id", async (req, res) => {
    const data = check(emailEdit.extend({ revision: short }).strict(), req.body);
    res.json(await connection().edit(req.params.id, data));
  });
  app.post("/api/connections/review/:id", async (req, res) => {
    const { reason, ...data } = check(z.object({ decision: z.enum(["approved", "denied"]), revision: z.string().max(100).default(""), remember: z.boolean().default(false), reason: z.string().trim().max(DENY_REASON_MAX).default("") }).strict(), req.body);
    if (data.decision === "denied" && reason && store.get("approvals", req.params.id)) store.patch("approvals", req.params.id, { denyReason: reason });
    const result = await connection().decide(req.params.id, data);
    const a = store.get("approvals", req.params.id);
    if (a && typeof runtime.launch === "function") {
      const prior = runtime.missionJobs?.get?.(a.missionId);
      void Promise.resolve(prior).then(() => runtime.launch(a.missionId));
    }
    res.json(result);
  });
  return { connection, emailEdit };
}
