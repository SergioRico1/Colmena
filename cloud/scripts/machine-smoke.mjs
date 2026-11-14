// The machine image, checked on this computer before a deploy (docs/CLOUD.md › Phase 4):
//
//   docker buildx build --load -f cloud/container/Dockerfile -t colmena-machine:dev .
//   docker run -d --name colmena-machine-smoke -p 127.0.0.1:18080:8080 \
//     -e MACHINE_TOKEN=<random> -e MACHINE_STORE_KEY=<64 hex> colmena-machine:dev
//   node cloud/scripts/machine-smoke.mjs --url http://127.0.0.1:18080 --token <random>
//
// It opens the machine, imports a fixture repository (a git bundle with a local bare «origin»),
// lets the fake Claude Code fix it and run its tests, reads the diff, opens a terminal, runs a
// program, previews a dev server through the port proxy and converts a .docx with LibreOffice.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { machineClient } from "../../server/machine/seam.mjs";

const arg = (name, fallback = null) => { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : fallback; };
const base = arg("url", "http://127.0.0.1:18080");
const token = arg("token");
if (!token) { console.error("--token is required"); process.exit(2); }
const person = { id: "smoke-person", name: "Prueba", role: "owner" };
const m = machineClient({ fetch: (u, i) => fetch(u, i), base, headers: () => ({ "X-Machine-Token": token, "X-Colmena-Person": JSON.stringify(person), "X-Colmena-Fake-Engine": "1" }) });
let ok = 0, failed = 0;
const check = (name, cond, extra = "") => { if (cond) { ok++; console.log("ok   " + name + (extra ? " · " + extra : "")); } else { failed++; console.log("FAIL " + name + (extra ? " · " + extra : "")); } };
const j = async (p, init = {}) => { const r = await m.request(p, init); let d = null; try { d = await r.json(); } catch {} return { status: r.status, data: d }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const t0 = Date.now();
const begun = await m.request("/machine/begin", { method: "POST" });
check("machine opens", begun.ok || begun.status === 503 || begun.status === 200, "status " + begun.status);
const health = await j("/machine/health");
check("health", health.data?.ok === true, JSON.stringify(health.data));

// A fixture repository with a bug and a test.
const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-smoke-"));
await mkdir(path.join(dir, "src")); await mkdir(path.join(dir, "test"));
await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "suma", type: "module", scripts: { test: "node --test", dev: "node server.mjs" } }));
await writeFile(path.join(dir, "src", "suma.js"), "export const suma = (a, b) => a - b;\n");
await writeFile(path.join(dir, "test", "suma.test.mjs"), 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { suma } from "../src/suma.js";\ntest("suma", () => assert.equal(suma(2, 3), 5));\n');
await writeFile(path.join(dir, "server.mjs"), 'import http from "node:http";\nhttp.createServer((q, s) => { s.setHeader("Content-Type", "text/html"); s.end("<h1>Hola desde la vista previa</h1>"); }).listen(5173, "127.0.0.1");\n');
const git = (...a) => execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=T", ...a], { cwd: dir, stdio: "pipe" });
git("init", "-q", "-b", "main"); git("add", "."); git("commit", "-q", "-m", "inicio"); git("bundle", "create", "repo.bundle", "--all");
const bundle = await readFile(path.join(dir, "repo.bundle"));
await rm(dir, { recursive: true, force: true });

const imported = await j("/api/code/cloud/import?name=suma&origin=local", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bundle });
check("import a repository", imported.status === 200 && imported.data?.project?.repo, JSON.stringify(imported.data).slice(0, 160));
const task = await j("/api/code/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: imported.data.project.id, text: "arregla la suma y prueba", engine: "claude-code", isolated: true, access: "full" }) });
check("task created", task.status === 200, task.data?.task?.id);
const id = task.data.task.id;
let detail = null;
for (let i = 0; i < 120; i++) {
  detail = (await j("/api/code/tasks/" + id)).data;
  if ((detail?.items || []).some((x) => /pruebas pasan|no pasan/.test(String(x.text || ""))) && !["working", "waiting"].includes(detail.task?.status)) break;
  await wait(500);
}
check("the engine fixed it and the tests pass", (detail?.items || []).some((x) => /pruebas pasan/.test(String(x.text || ""))));
const diff = await j("/api/code/tasks/" + id + "/diff");
check("diff", /a \+ b/.test(JSON.stringify(diff.data)));
const term = await j("/api/code/tasks/" + id + "/terminals", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
check("terminal opens (node-pty)", term.status === 200, JSON.stringify(term.data).slice(0, 120));
const run = await m.run({ file: "git", args: ["--version"], cwd: "missions/smoke" });
check("run a program", run.exitCode === 0 && /git version/.test(run.stdout), run.stdout.trim());
const dev = await m.run({ file: "sh", args: ["-c", "cd /work/Colmena/suma && (node server.mjs >/dev/null 2>&1 &) && sleep 1"], cwd: "missions/smoke" });
check("dev server started", dev.exitCode === 0);
const page = await m.request("/machine/port/5173/");
check("preview through the port proxy", page.ok && /Hola desde la vista previa/.test(await page.text()));

const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun("Informe de prueba de Colmena")] })] }] });
const docx = await Packer.toBuffer(doc);
const c0 = Date.now();
const pdf = await m.office().convert(docx, "docx");
check("Office → PDF with LibreOffice", pdf.pdf.subarray(0, 5).toString() === "%PDF-", (Date.now() - c0) + " ms, " + pdf.pdf.length + " bytes");
const backup = await m.request("/machine/backup");
const tgz = Buffer.from(await backup.arrayBuffer());
check("backup of the work folder", backup.ok && tgz.length > 1000, tgz.length + " bytes");
console.log(`\n${ok} ok, ${failed} failed, ${Math.round((Date.now() - t0) / 100) / 10} s`);
process.exit(failed ? 1 : 0);
