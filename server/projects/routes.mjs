// HTTP routes of the development servers (Terminal panel): list and stop. Register before the
// /api 404 handler: registerProjectRoutes(app, { store, projects }).
export function registerProjectRoutes(app, { store, projects }) {
  const mission = (req, res) => {
    const m = store.get("missions", String(req.params.id || ""));
    if (!m) res.status(404).json({ error: "No encuentro esa conversación." });
    return m;
  };
  app.get("/api/missions/:id/devservers", (req, res) => {
    if (!mission(req, res)) return;
    res.json({ servers: projects.servers.list(req.params.id) });
  });
  app.get("/api/missions/:id/devservers/:project", (req, res) => {
    if (!mission(req, res)) return;
    const view = projects.servers.view(projects.servers.get(req.params.id, String(req.params.project)), { lines: 200 });
    if (!view) return res.status(404).json({ error: "No hay servidor de ese proyecto." });
    res.json({ server: view });
  });
  app.post("/api/missions/:id/devservers/:project/stop", async (req, res, next) => {
    try {
      if (!mission(req, res)) return;
      res.json({ server: await projects.servers.stop(req.params.id, String(req.params.project)) });
    } catch (error) {
      next(error);
    }
  });
}
