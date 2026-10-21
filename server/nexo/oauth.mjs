import { readFileSync } from "node:fs";
import http from "node:http";
import { mkdir, readFile, writeFile, rename, chmod } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { windowsVault } from "./credential-vault.mjs";
import {
  ISSUER,
  RESOURCE,
  DISCOVERY,
  TOKEN_ENDPOINT,
  PLAN_SCOPE,
  opaque,
  equal,
  pkce,
  normalizeHostID,
  authorizeURL,
  trustedAuthEndpoint,
  verifyIDToken,
  normalizeModels,
} from "./security.mjs";
export function configDirectory() {
  if (process.env.COLMENA_AUTH_DIRECTORY)
    return process.env.COLMENA_AUTH_DIRECTORY;
  return process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || os.homedir(), "Colmena")
    : process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support", "Colmena")
      : path.join(
          process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
          "colmena",
        );
}
export class ChatGPTSession {
  constructor({
    emit = () => {},
    fetchImpl = fetch,
    directory = configDirectory(),
    profileId = null,
    vault = windowsVault(directory),
  } = {}) {
    if (profileId !== null && !/^[A-Za-z0-9_-]{1,100}$/.test(profileId))
      throw Error("Identificador de perfil no válido.");
    this.profileId = profileId;
    this.emit = emit;
    this.fetch = fetchImpl;
    this.directory = directory;
    this.vault = vault;
    this.persistent = false;
    this.epoch = 0;
    this.meta = null;
    this.credentials = null;
    this.pending = null;
    this.discovery = null;
    this.keys = null;
    this.refreshing = null;
    this.models = [];
  }
  binding() {
    return {
      profile: this.profileId || "default",
      hostId: this.meta.hostId,
      clientId: this.meta.clientId,
      subject: this.meta.subject,
    };
  }
  async saveCredentials() {
    if (!this.vault) return;
    const current = this.credentials,
      epoch = this.epoch,
      binding = this.binding(),
      previous = this.saving;
    const pending = (async () => {
      if (previous) await previous.catch(() => {});
      if (epoch !== this.epoch || current !== this.credentials) return;
      await this.vault.save(binding, current);
      if (epoch !== this.epoch) await this.vault.remove(this.profileId);
      else this.persistent = true;
    })();
    this.saving = pending;
    try {
      await pending;
    } finally {
      if (this.saving === pending) this.saving = null;
    }
  }
  async restore() {
    const epoch = this.epoch;
    if (!this.meta) await this.init();
    if (!this.vault || !this.meta.clientId || !this.meta.subject) return null;
    const saved = await this.vault.load(this.binding());
    if (epoch !== this.epoch) return null;
    if (!saved) return null;
    if (
      saved.clientId !== this.meta.clientId ||
      saved.subject !== this.meta.subject ||
      typeof saved.access !== "string" ||
      !saved.access ||
      (saved.refresh !== null && typeof saved.refresh !== "string") ||
      typeof saved.scope !== "string" ||
      !saved.scope.split(/\s+/).includes(PLAN_SCOPE) ||
      !Number.isFinite(saved.expiresAt)
    )
      throw Error(
        "La sesión guardada no corresponde a este perfil. Reconecta ChatGPT.",
      );
    this.credentials = saved;
    this.persistent = true;
    return this.status();
  }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const baseFile = path.join(this.directory, "installation.json");
    let base,
      writeBase = false;
    try {
      base = JSON.parse(await readFile(baseFile, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT")
        throw Error(
          "No se puede leer el registro local de identidad. Conserva el archivo antes de recuperarlo.",
        );
      base = { hostId: "urn:uuid:" + randomUUID() };
      writeBase = true;
    }
    let hostId;
    try {
      hostId = normalizeHostID(base.hostId);
    } catch {
      throw Error(
        "No se puede leer el registro local de identidad. Conserva el archivo antes de recuperarlo.",
      );
    }
    if (hostId !== base.hostId) {
      base = { ...base, hostId };
      writeBase = true;
    }
    if (writeBase) await this.atomicMetadata(baseFile, base);
    let registration = this.profileId ? {} : base;
    if (this.profileId) {
      await mkdir(path.join(this.directory, "profiles"), {
        recursive: true,
        mode: 0o700,
      });
      try {
        registration = JSON.parse(
          await readFile(
            path.join(this.directory, "profiles", this.profileId + ".json"),
            "utf8",
          ),
        );
      } catch (e) {
        if (e.code !== "ENOENT")
          throw Error("El registro de esta cuenta necesita recuperación.");
      }
    }
    this.meta = {
      hostId: base.hostId,
      clientId:
        typeof registration.clientId === "string"
          ? registration.clientId
          : undefined,
      subject:
        typeof registration.subject === "string"
          ? registration.subject
          : undefined,
    };
  }
  async atomicMetadata(file, data) {
    const temp = file + "." + opaque(8) + ".tmp";
    await writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(temp, file);
    await chmod(file, 0o600).catch(() => {});
  }
  async saveMetadata() {
    const file = this.profileId
      ? path.join(this.directory, "profiles", this.profileId + ".json")
      : path.join(this.directory, "installation.json");
    await this.atomicMetadata(file, this.meta);
  }
  status() {
    const c = this.credentials;
    if (!c) return null;
    return {
      subject: c.subject,
      clientId: c.clientId,
      email: c.email || "",
      label: c.email || "Cuenta ChatGPT",
      canInfer: c.scope.split(/\s+/).includes(PLAN_SCOPE),
      expiresAt: c.expiresAt,
      persistent: this.persistent,
    };
  }
  async fetchJSON(url, options = {}) {
    const response = await this.fetch(url, {
      ...options,
      redirect: "error",
      signal: options.signal || AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const error = Error(
        `OpenAI no ha completado la operación (${response.status}).${response.status === 429 ? " Revisa los límites en los ajustes de uso de ChatGPT." : ""}`,
      );
      error.status = response.status;
      try {
        const body = (await response.text()).slice(0, 16000),
          parsed = JSON.parse(body);
        const code =
          typeof parsed.error === "string" ? parsed.error : parsed.error?.code;
        error.oauthCode =
          typeof code === "string" && /^[a-z_]{1,80}$/.test(code)
            ? code
            : undefined;
      } catch {}
      throw error;
    }
    const text = await response.text();
    if (text.length > 2000000)
      throw Error("Respuesta de identidad demasiado grande.");
    try {
      return JSON.parse(text);
    } catch {
      throw Error("OpenAI devolvió una respuesta JSON no válida.");
    }
  }
  async getDiscovery() {
    if (!this.discovery) {
      const d = await this.fetchJSON(DISCOVERY);
      if (d.issuer !== ISSUER) throw Error("Emisor de identidad no válido.");
      trustedAuthEndpoint(d.jwks_uri);
      if (d.revocation_endpoint) trustedAuthEndpoint(d.revocation_endpoint);
      this.discovery = d;
    }
    return this.discovery;
  }
  async getKeys(force = false) {
    if (!this.keys || force) {
      const d = await this.getDiscovery();
      this.keys = await this.fetchJSON(trustedAuthEndpoint(d.jwks_uri));
    }
    return this.keys;
  }
  async validateToken(token, options) {
    try {
      return verifyIDToken(token, await this.getKeys(), options);
    } catch (e) {
      if (e.message.includes("Clave de firma desconocida"))
        return verifyIDToken(token, await this.getKeys(true), options);
      throw e;
    }
  }
  async start() {
    if (!this.meta) await this.init();
    this.closePending();
    const proof = pkce(),
      state = opaque(),
      nonce = opaque();
    const server = http.createServer((req, res) => {
      this.callback(req, res).catch(() => {
        if (!res.headersSent)
          this.html(
            res,
            400,
            "No se pudo validar la autorización. Regresa a Colmena.",
          );
      });
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const redirectURI = `http://127.0.0.1:${server.address().port}/auth/callback`;
    const timeout = setTimeout(() => {
      this.closePending();
      this.emit({
        kind: "auth-error",
        message: "La autorización ha caducado. Vuelve a iniciarla.",
      });
    }, 300000);
    timeout.unref();
    this.pending = {
      server,
      timeout,
      redirectURI,
      state,
      nonce,
      verifier: proof.verifier,
      clientId: this.meta.clientId,
      subject: this.meta.subject,
      consumed: false,
    };
    return {
      url: authorizeURL({
        hostId: this.meta.hostId,
        clientId: this.meta.clientId,
        redirectURI,
        state,
        nonce,
        challenge: proof.challenge,
        idTokenHint: this.credentials?.idToken,
        loginHint: this.credentials?.email,
      }),
    };
  }
  html(res, status, text) {
    const mark = "data:image/png;base64," + readFileSync(new URL("./logo-96.png", import.meta.url)).toString("base64");
    let poppins = "";
    try {
      poppins = "@font-face{font-family:Poppins;font-weight:800;font-display:block;src:url(data:font/woff2;base64," + readFileSync(new URL("../../node_modules/@fontsource/poppins/files/poppins-latin-800-normal.woff2", import.meta.url)).toString("base64") + ") format(\"woff2\")}";
    } catch {}
    res.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; frame-ancestors 'none'",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    const ok = status < 400;
    const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    // Same look as Colmena: dark brand panel, honey accent, black-bordered card with honey shadow.
    res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Colmena</title>
<style>
${poppins}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;flex-wrap:wrap;background:#EEF0F4;color:#12131A;font-family:'Geist','Segoe UI Variable','Segoe UI',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.brand{flex:1 1 380px;background:#12131A;color:#FFFFFF;padding:clamp(28px,5vw,64px);display:flex;flex-direction:column;gap:32px;position:relative;overflow:hidden}
.logo{display:flex;align-items:center;gap:10px;font:800 24px/1 'Poppins','Segoe UI Variable Display','Segoe UI',sans-serif;letter-spacing:-.02em}
.brand h1{margin:auto 0 0;font:800 clamp(36px,4.6vw,56px)/1 'Bricolage Grotesque','Segoe UI Variable Display','Segoe UI',sans-serif;letter-spacing:-.03em;max-width:520px}
.brand p{margin:0;font-size:17px;line-height:1.5;color:#C9CCD6;max-width:440px}
.bg{position:absolute;right:-170px;top:-150px;opacity:.07}
.side{flex:1.3 1 480px;display:grid;place-items:center;padding:clamp(28px,5vw,64px)}
.card{width:min(520px,100%);background:#FFFFFF;border:2px solid #12131A;border-radius:20px;box-shadow:8px 8px 0 ${ok ? "#FFC93C" : "#E5484D"};padding:28px;display:flex;flex-direction:column;gap:14px}
.tag{align-self:flex-start;display:flex;align-items:center;gap:8px;height:30px;padding:0 12px;border-radius:15px;font-size:13px;font-weight:600;background:${ok ? "#E1F4EC" : "#FBE7DF"};color:${ok ? "#0B5A3E" : "#9A2A1F"};border:1px solid ${ok ? "#9ED4BC" : "#E8A99B"}}
.card h2{margin:0;font:800 30px/1.1 'Bricolage Grotesque','Segoe UI Variable Display','Segoe UI',sans-serif;letter-spacing:-.02em}
.card p{margin:0;font-size:16px;line-height:1.55;color:#2B2D36}
.hint{font:500 12px/1.5 'Geist Mono',ui-monospace,Consolas,monospace;letter-spacing:.04em;text-transform:uppercase;color:#555A68}
</style></head><body>
<section class="brand">
<img class="bg" alt="" aria-hidden="true" width="420" height="420" src="${mark}">
<div class="logo"><img alt="" aria-hidden="true" width="34" height="34" src="${mark}">Colmena</div>
<h1>${ok ? "Tu equipo ya puede pensar." : "No se pudo conectar."}</h1>
<p>${ok ? "Tus bots usarán los modelos incluidos en tu plan de ChatGPT. Tu contraseña nunca pasa por Colmena." : "No se ha guardado nada. Puedes volver a intentarlo desde Ajustes › Cuentas de IA."}</p>
</section>
<section class="side"><div class="card" role="status">
<span class="tag">${ok ? "✓ ChatGPT conectado" : "Sin conectar"}</span>
<h2>${ok ? "Vuelve a Colmena" : "Algo ha fallado"}</h2>
<p>${esc(text)}</p>
<span class="hint">Puedes cerrar esta pestaña</span>
</div></section>
</body></html>`);
  }
  async callback(req, res) {
    const p = this.pending;
    if (!p || req.method !== "GET" || req.url.length > 16384) {
      this.html(res, 400, "Solicitud no válida.");
      return;
    }
    const u = new URL(req.url, p.redirectURI);
    if (
      u.pathname !== "/auth/callback" ||
      req.headers.host !== new URL(p.redirectURI).host
    ) {
      this.html(res, 404, "Esta dirección no está disponible.");
      return;
    }
    if (
      p.consumed ||
      u.searchParams.getAll("state").length !== 1 ||
      !equal(u.searchParams.get("state"), p.state)
    ) {
      this.html(res, 400, "La respuesta no corresponde a esta autorización.");
      return;
    }
    p.consumed = true;
    try {
      if (u.searchParams.has("error"))
        throw Error(
          "La autorización no se ha completado. Puedes volver a iniciarla.",
        );
      const code = u.searchParams.get("code"),
        issued = u.searchParams.get("client_id") || p.clientId;
      if (
        !code ||
        code.length > 8192 ||
        !issued ||
        issued === "dynamic_agent_client" ||
        issued.length > 512 ||
        (p.clientId && issued !== p.clientId)
      )
        throw Error("Respuesta de registro incompleta o de otro cliente.");
      const tokens = await this.fetchJSON(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: issued,
          code,
          code_verifier: p.verifier,
          redirect_uri: p.redirectURI,
          resource: RESOURCE,
        }),
      });
      const claims = await this.validateToken(tokens.id_token, {
        clientId: issued,
        nonce: p.nonce,
        subject: p.subject,
      });
      if (this.pending !== p)
        throw Error("La autorización ha sido cancelada o sustituida.");
      this.accept(tokens, claims, issued);
      this.meta.clientId = issued;
      this.meta.subject = claims.sub;
      await this.saveMetadata();
      await this.saveCredentials();
      this.html(
        res,
        200,
        "Cuenta validada. La ventana de Colmena ya muestra tu cuenta conectada.",
      );
      this.emit({ kind: "auth-success", account: this.status() });
    } catch (e) {
      this.html(
        res,
        400,
        "No se pudo validar la autorización. Regresa a Colmena para revisar el motivo.",
      );
      this.emit({ kind: "auth-error", message: e.message });
    } finally {
      if (this.pending === p) this.closePending();
    }
  }
  accept(tokens, claims, clientId) {
    if (
      typeof tokens.access_token !== "string" ||
      tokens.token_type?.toLowerCase() !== "bearer" ||
      !Number.isFinite(tokens.expires_in) ||
      tokens.expires_in <= 0 ||
      typeof tokens.scope !== "string"
    )
      throw Error("Credenciales incompletas.");
    if (!tokens.scope.split(/\s+/).includes(PLAN_SCOPE))
      throw Error(
        "La identidad se ha validado, pero falta autorizar el uso del plan de ChatGPT.",
      );
    this.credentials = {
      access: tokens.access_token,
      refresh: tokens.refresh_token || null,
      idToken: tokens.id_token,
      scope: tokens.scope,
      clientId,
      subject: claims.sub,
      email: claims.email || "",
      expiresAt: Date.now() + tokens.expires_in * 1000,
      earliestRefreshAt: tokens.earliest_refresh_at,
    };
    this.models = [];
  }
  closePending() {
    if (this.pending) {
      clearTimeout(this.pending.timeout);
      this.pending.server.close();
      this.pending = null;
    }
  }
  async accessToken() {
    if (!this.credentials)
      throw Error("Conecta tu ChatGPT antes de continuar.");
    if (this.credentials.expiresAt > Date.now() + 30000)
      return this.credentials.access;
    if (!this.credentials.refresh)
      throw Error("La sesión ha caducado. Vuelve a conectar ChatGPT.");
    if (!this.refreshing) {
      const previous = this.credentials;
      this.refreshing = this.refresh()
        .catch(async (error) => {
          const revoked =
            error.status === 400 && error.oauthCode === "invalid_grant";
          if (this.credentials === previous && revoked) {
            this.credentials = null;
            this.models = [];
            this.persistent = false;
            await this.vault?.remove(this.profileId);
            this.emit({ kind: "session-expired" });
          }
          throw Error(
            revoked
              ? "La autorización ha caducado o fue revocada. Reconecta ChatGPT."
              : "No se pudo renovar la sesión. La conexión guardada se conserva; vuelve a intentarlo cuando haya conexión.",
          );
        })
        .finally(() => {
          this.refreshing = null;
        });
    }
    await this.refreshing;
    return this.credentials.access;
  }
  async refresh() {
    const old = this.credentials;
    // One refresh in flight; a rotating refresh token is never blindly retried.
    const d = await this.fetchJSON(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: old.clientId,
        refresh_token: old.refresh,
        resource: RESOURCE,
      }),
    });
    if (this.credentials !== old)
      throw Error("La sesión cambió durante la renovación.");
    const claims = d.id_token
      ? await this.validateToken(d.id_token, {
          clientId: old.clientId,
          subject: old.subject,
        })
      : { sub: old.subject, email: old.email };
    if (this.credentials !== old)
      throw Error("La sesión cambió durante la renovación.");
    this.accept(
      {
        ...d,
        scope: d.scope || old.scope,
        id_token: d.id_token || old.idToken,
        refresh_token: d.refresh_token || old.refresh,
      },
      claims,
      old.clientId,
    );
    await this.saveCredentials();
  }
  async listModels() {
    const token = await this.accessToken();
    this.models = normalizeModels(
      await this.fetchJSON(RESOURCE + "/models", {
        headers: { Authorization: "Bearer " + token },
      }),
    );
    return this.models;
  }
  async logout() {
    this.epoch++;
    this.closePending();
    const old = this.credentials;
    this.credentials = null;
    this.models = [];
    let revoked = !old?.refresh;
    if (old?.refresh) {
      try {
        const d = await this.getDiscovery();
        const url = trustedAuthEndpoint(d.revocation_endpoint);
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const r = await this.fetch(url, {
              method: "POST",
              redirect: "error",
              signal: AbortSignal.timeout(8000),
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                token: old.refresh,
                token_type_hint: "refresh_token",
                client_id: old.clientId,
              }),
            });
            if (r.status === 200) {
              revoked = true;
              break;
            }
            if (r.status < 500) break;
          } catch {}
          if (attempt === 0) await new Promise((r) => setTimeout(r, 300));
        }
      } catch {}
    }
    if (this.saving) await this.saving.catch(() => {});
    await this.vault?.remove(this.profileId);
    this.persistent = false;
    return {
      revoked,
      message: revoked
        ? "Sesión retirada."
        : "Credenciales borradas localmente. No se ha confirmado la revocación remota; desconecta Colmena en los ajustes de ChatGPT.",
    };
  }
  dispose() {
    this.epoch++;
    this.closePending();
    this.credentials = null;
    this.models = [];
  }
}
