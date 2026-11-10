import { artifactSummary } from "../state.mjs";

/** Deliverables: reading and downloading them. */
export function registerArtifactRoutes(app, { mustGet, store }) {
  // -------------------------------------------------------- artifacts
  const MIME = { md: "text/markdown", csv: "text/csv", tsv: "text/tab-separated-values", svg: "image/svg+xml", html: "text/html", json: "application/json", py: "text/x-python", js: "text/javascript", ts: "text/plain", txt: "text/plain", xml: "application/xml", yaml: "text/yaml", yml: "text/yaml", sql: "text/plain" };
  app.get("/api/artifacts/:id", (req, res) => {
    const a = mustGet("artifacts", req.params.id, "Entregable");
    res.json({ ...artifactSummary(a, new Map([[a.missionId, store.get("missions", a.missionId)]])), content: a.content ?? "" });
  });
  app.get("/api/artifacts/:id/download", (req, res) => {
    const a = mustGet("artifacts", req.params.id, "Entregable");
    // Deliverables stored as files (images, filled PDFs) are served by the core routes.
    if (a.file) return res.redirect(302, "/api/artifacts/" + encodeURIComponent(a.id) + "/file?download=1");
    const summary = artifactSummary(a);
    const base = String(summary.title).replace(/\.[a-z0-9]{1,6}$/i, "").replace(/[\\/:*?"<>|\x00-\x1f]+/g, "-").trim().slice(0, 120) || "entregable";
    const name = base + "." + summary.format;
    res.set({
      "Content-Type": (MIME[summary.format] || "text/plain") + "; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"" + name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "") + "\"; filename*=UTF-8''" + encodeURIComponent(name),
      "Content-Security-Policy": "sandbox; default-src 'none'",
    });
    res.send(String(a.content ?? ""));
  });
}
