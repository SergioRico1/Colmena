// The `Machine` Durable Object: one container per company (docs/CLOUD.md › Phase 4). It starts the
// container on demand (Durable Object Container API, `durable_object` scheduling policy), forwards
// the workspace's requests to the machine server inside (server/machine/serve.mjs, port 8080) and
// puts it to sleep when nobody used it for `MACHINE_SLEEP_AFTER_S` seconds and nothing works in it.
//
// - Persistence: before stopping, the work folder (projects, worktrees, the encrypted store of
//   «Código») is packed by the machine and kept in R2 (workspaces/<id>/machine/work.tar.gz, multipart);
//   a new container gets it back before it opens anything. Survives new images, unlike snapshots.
// - Quotas: minutes per month per company (`MACHINE_MINUTES_PER_MONTH`, or the workspace's own
//   number); past it the machine does not start and the person reads why. One container per company
//   is the concurrency limit by construction.
// - Measures: each cold start (container up, work folder back, ready) and the minutes used.
// Only the Workspace object talks to it; the container's port is never public.
import { DurableObject } from "cloudflare:workers";
import { createHmac, randomBytes } from "node:crypto";

const PORT = 8080;
const ID = /^[0-9a-f-]{36}$/;
import { monthOf as month, usedMs, quotaMinutes as minutesFor, quotaRefusal, stopped } from "../../server/cloud/machine-quota.mjs";
const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PART = 16 * 1024 * 1024;

/** The machine's store key: derived like the workspace's own, for another purpose. */
export function machineStoreKey(master, workspaceId) {
  if (!/^[0-9a-f]{64}$/i.test(master || "")) throw Error("WORKSPACE_KEYS is not configured.");
  return createHmac("sha256", Buffer.from(master, "hex")).update("colmena-machine-store-v1\u0000" + workspaceId).digest("hex");
}

export class QuotaError extends Error {
  constructor(message) { super(message); this.status = 429; this.quota = true; }
}

export class Machine extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.booting = null;
    this.token = null;
    this.lastUse = Date.now();
    this.streams = 0;
    // A container that outlived this object (a deploy) keeps its sleep rule.
    if (ctx.container?.running) ctx.blockConcurrencyWhile(async () => {
      this.token = (await ctx.storage.get("token")) || null;
      await ctx.container.setInactivityTimeout(this.idleMs() + 5 * 60000);
    });
  }
  idleMs() { return Math.max(60, Number(this.env.MACHINE_SLEEP_AFTER_S || 600)) * 1000; }
  tcp() { return this.ctx.container.getTcpPort(PORT); }
  async meta() { return (await this.ctx.storage.get("meta")) || { usage: { month: month(), ms: 0 }, starts: [], workspaceId: null }; }
  async saveMeta(m) { await this.ctx.storage.put("meta", m); }
  backupKey(workspaceId) { return "workspaces/" + workspaceId + "/machine/work.tar.gz"; }

  /** Minutes used this month, the running span included (server/cloud/machine-quota.mjs). */
  usedMs(m, at = Date.now()) { return usedMs(m, at, !!this.ctx.container?.running); }

  async health() {
    const r = await this.tcp().fetch("http://machine/machine/health", { headers: { "X-Machine-Token": this.token } });
    if (!r.ok) throw Error("health " + r.status);
    return r.json();
  }

  /** The container running and the machine ready (work folder back): started when needed. */
  async ensure(workspaceId, quotaMinutes) {
    if (this.ctx.container.running && this.token && this.ready) return;
    this.booting ??= this.boot(workspaceId, quotaMinutes).finally(() => { this.booting = null; });
    return this.booting;
  }
  async boot(workspaceId, quotaMinutes) {
    if (!ID.test(workspaceId || "")) throw Error("Workspace id expected.");
    const m = await this.meta();
    if (m.workspaceId && m.workspaceId !== workspaceId) throw Error("Machine mismatch.");
    m.workspaceId = workspaceId;
    const quota = minutesFor(quotaMinutes, this.env.MACHINE_MINUTES_PER_MONTH);
    const t0 = Date.now();
    let restoreMs = null, fresh = false;
    if (!this.ctx.container.running) {
      const refusal = quotaRefusal(m, quota, t0);
      if (refusal) throw new QuotaError(refusal);
      this.token = randomBytes(24).toString("hex");
      await this.ctx.storage.put("token", this.token);
      this.ctx.container.start({
        image: this.ctx.container.images.base, instance: this.env.MACHINE_INSTANCE || "standard-1", enableInternet: true,
        env: { MACHINE_TOKEN: this.token, MACHINE_STORE_KEY: machineStoreKey(this.env.WORKSPACE_KEYS, workspaceId) },
        labels: { workspace: workspaceId.slice(0, 36) },
      });
      fresh = true;
      m.runningSince = Date.now();
    } else this.token ||= await this.ctx.storage.get("token");
    await this.ctx.container.setInactivityTimeout(this.idleMs() + 5 * 60000);
    // Up: the server answers (a fresh container takes a few seconds).
    let h = null;
    for (let i = 0; i < 240 && !h; i++) {
      try { h = await this.health(); } catch { await sleep(i < 20 ? 250 : 500); }
    }
    if (!h) { await this.ctx.container.destroy("no health").catch(() => {}); throw Error("La máquina no ha arrancado."); }
    const upMs = Date.now() - t0;
    if (h.ready === false) {
      // The work folder back from R2, before the store or «Código» open.
      const object = this.env.FILES ? await this.env.FILES.get(this.backupKey(workspaceId)) : null;
      if (object) {
        const r0 = Date.now();
        const r = await this.tcp().fetch("http://machine/machine/restore", { method: "POST", headers: { "X-Machine-Token": this.token, "Content-Type": "application/gzip" }, body: object.body });
        if (!r.ok) console.error("machine restore: " + r.status + " " + (await r.text()).slice(0, 200));
        restoreMs = Date.now() - r0;
      }
      const b = await this.tcp().fetch("http://machine/machine/begin", { method: "POST", headers: { "X-Machine-Token": this.token } });
      if (!b.ok) throw Error("La máquina no se ha podido preparar.");
    }
    this.ready = true;
    if (fresh) {
      m.starts = [...(m.starts || []), { at: new Date(t0).toISOString(), upMs, restoreMs, readyMs: Date.now() - t0, restored: restoreMs != null }].slice(-30);
    }
    await this.saveMeta(m);
    this.lastUse = Date.now();
    await this.ctx.storage.setAlarm(Date.now() + this.idleMs());
  }

  /** Packs the work folder into R2 (multipart: no length needed, nothing whole in memory). */
  async backup(workspaceId) {
    if (!this.env.FILES || !this.ctx.container.running || !this.ready) return null;
    const t0 = Date.now();
    const r = await this.tcp().fetch("http://machine/machine/backup", { headers: { "X-Machine-Token": this.token } });
    if (!r.ok || !r.body) return null;
    // A multipart upload replaces the old copy only when it completes: a cut backup changes nothing.
    const upload = await this.env.FILES.createMultipartUpload(this.backupKey(workspaceId), { httpMetadata: { contentType: "application/gzip" } });
    const parts = [];
    let chunks = [], held = 0, size = 0;
    const reader = r.body.getReader();
    // Every part but the last is exactly PART bytes (R2's rule).
    const take = (n) => {
      const out = new Uint8Array(n);
      let o = 0;
      while (o < n) {
        const c = chunks[0], k = Math.min(c.length, n - o);
        out.set(c.subarray(0, k), o);
        o += k;
        if (k === c.length) chunks.shift(); else chunks[0] = c.subarray(k);
      }
      held -= n;
      return out;
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        held += value.length;
        while (held >= PART) { parts.push(await upload.uploadPart(parts.length + 1, take(PART))); size += PART; }
      }
      if (held || !parts.length) { const n = held; parts.push(await upload.uploadPart(parts.length + 1, take(n))); size += n; }
      await upload.complete(parts);
    } catch (error) {
      await upload.abort().catch(() => {});
      throw error;
    }
    return { bytes: size, ms: Date.now() - t0 };
  }

  /** Stops the container after keeping its work: the minutes it ran go to this month. */
  async sleepNow(why = "idle") {
    const m = await this.meta();
    let saved = null;
    if (this.ctx.container.running && m.workspaceId) {
      try { saved = await this.backup(m.workspaceId); } catch (error) { console.error("machine backup: " + (error?.stack || error)); }
      await this.ctx.container.destroy(why).catch(() => {});
    }
    const at = Date.now();
    Object.assign(m, stopped(m, at));
    m.lastSleep = { at: new Date(at).toISOString(), why, backup: saved };
    this.ready = false;
    await this.saveMeta(m);
    await this.ctx.storage.deleteAlarm();
    return m.lastSleep;
  }

  async alarm() {
    if (!this.ctx.container.running) {
      const m = await this.meta();
      if (m.runningSince) await this.sleepNow("stopped");
      return;
    }
    const quiet = Date.now() - this.lastUse;
    if (quiet < this.idleMs() || this.streams > 0) return this.ctx.storage.setAlarm(Date.now() + Math.max(15000, this.idleMs() - quiet));
    try {
      this.token ||= await this.ctx.storage.get("token");
      const h = await this.health();
      if (h.busy) return this.ctx.storage.setAlarm(Date.now() + 60000);
    } catch {}
    await this.sleepNow("idle");
  }

  /** What the workspace shows and the e2e measures. */
  async status() {
    const m = await this.meta();
    return { running: !!this.ctx.container?.running, ready: !!this.ready, usedMinutes: Math.round(this.usedMs(m) / 600) / 100, month: month(), starts: m.starts || [], lastSleep: m.lastSleep || null, sleepAfterS: this.idleMs() / 1000 };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const workspaceId = request.headers.get("X-Machine-Workspace");
    try {
      if (url.pathname === "/__status") return json(await this.status());
      if (url.pathname === "/__sleep") return json(await this.sleepNow("asked"));
      await this.ensure(workspaceId, request.headers.get("X-Machine-Quota"));
    } catch (error) {
      if (error.quota) return json({ error: error.message, quota: true }, 429);
      console.error("machine: " + (error?.stack || error));
      return json({ error: "La máquina de tu empresa no ha podido arrancar. Prueba en un minuto." }, 503);
    }
    this.lastUse = Date.now();
    const headers = new Headers(request.headers);
    headers.set("X-Machine-Token", this.token);
    headers.delete("X-Machine-Workspace");
    headers.delete("X-Machine-Quota");
    let response;
    try {
      response = await this.tcp().fetch("http://machine" + url.pathname + url.search, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? null : request.body, redirect: "manual" });
    } catch (error) {
      this.ready = false;
      console.error("machine fetch: " + (error?.stack || error));
      return json({ error: "La máquina no responde. Prueba otra vez." }, 502);
    }
    // A stream (live events, a terminal, a command's output) keeps the machine awake while open.
    const type = response.headers.get("Content-Type") || "";
    if (response.body && /event-stream|ndjson/.test(type)) {
      this.streams++;
      let closed = false;
      const done = () => { if (!closed) { closed = true; this.streams--; this.lastUse = Date.now(); } };
      const { readable, writable } = new TransformStream();
      response.body.pipeTo(writable).catch(() => {}).finally(done);
      return new Response(readable, { status: response.status, headers: response.headers });
    }
    this.lastUse = Date.now();
    return response;
  }
}
