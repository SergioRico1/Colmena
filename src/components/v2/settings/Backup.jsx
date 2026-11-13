import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { del, get, post, postFile, put } from "../../../lib/api.js";
import { reversible } from "../../../lib/undoToast.js";
import { Alert, INK, LINE, MUTED, Pills, SOFT, UNDO_MS, anchorOf, btn, field, h3 } from "./v3.jsx";

// Ajustes › Privacidad y datos › «Copias de seguridad» (design/V3Privacidad.dc.html,
// server/backup-service.mjs): a copy of everything that is yours in Colmena, sealed with a
// password only you know, kept in a folder your computer already syncs (OneDrive, Google
// Drive) or wherever you choose, on its own every day or week if you want. Restoring brings
// the whole history back here or on a new computer; it is applied when Colmena starts again.
// The parent owns the state (GET /api/backup) so the summary above shows the last copy too.

const SCHEDULE = [["off", "Solo cuando la pida"], ["daily", "Cada día"], ["weekly", "Cada semana"]];
const SCHEDULE_TEXT = { off: "Solo cuando la pidas", daily: "Cada día", weekly: "Cada semana" };
const KEEP = [[3, "3"], [7, "7"], [14, "14"], [30, "30"]];
const RED = "#B4232A";
export const size = (bytes) => (bytes == null ? "" : bytes >= 1e9 ? (bytes / 1e9).toFixed(1).replace(".", ",") + " GB" : bytes >= 1e6 ? Math.round(bytes / 1e6) + " MB" : Math.max(1, Math.round(bytes / 1e3)) + " KB");
export const when = (iso) => {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  const hm = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return "Hoy a las " + hm;
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) + ", " + hm;
};
/** The name of the folder the copies go to: «OneDrive», or the last part of its path. */
export const folderLabel = (v) => v?.folders?.find((f) => f.path === v.folder)?.label || String(v?.folder || "").split(/[\\/]/).filter(Boolean).at(-1) || "";

const input = { ...field, width: "auto", flex: "1 1 220px" };
const sub = { fontSize: "var(--t-meta)", color: MUTED };

function PasswordForm({ onSave, onCancel, busy }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const short = a.length > 0 && a.length < 8;
  const differ = b.length > 0 && a !== b;
  const ok = a.length >= 8 && a === b;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ok) onSave(a); }} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "0 22px 16px", animation: "fade .25s ease-out" }}>
      <span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <input type="password" autoComplete="new-password" aria-label="Contraseña de las copias" placeholder="Contraseña (8 o más caracteres)" value={a} onChange={(e) => setA(e.target.value)} style={input} autoFocus />
        <input type="password" autoComplete="new-password" aria-label="Repite la contraseña" placeholder="Repítela" value={b} onChange={(e) => setB(e.target.value)} style={input} />
      </span>
      <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.5, color: short || differ ? RED : MUTED }}>
        {short ? "Necesita al menos 8 caracteres." : differ ? "No coinciden." : "Apúntala en un lugar seguro: sin ella nadie puede abrir tus copias, ni siquiera tú."}
      </span>
      <span style={{ display: "flex", gap: "8px" }}>
        <button type="submit" disabled={!ok || busy} style={{ ...btn("dark", 36), opacity: ok ? 1 : 0.4 }}>{busy ? "Guardando…" : "Guardar contraseña"}</button>
        <button type="button" onClick={onCancel} style={btn("ghost", 36)}>Cancelar</button>
      </span>
    </form>
  );
}

function RestorePanel({ file, onStaged, onClose }) {
  const [password, setPassword] = useState("");
  const [identity, setIdentity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const go = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { onStaged(await post("/backup/restore", { path: file.path, password, identity })); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={go} style={{ display: "flex", flexDirection: "column", gap: "10px", margin: "0 22px 16px", padding: "14px 16px", borderRadius: "var(--r-lg)", background: "#F6F6F3", animation: "fade .25s ease-out" }}>
      <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <span style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>{"Restaurar la copia del " + when(file.at || file.createdAt).toLowerCase()}</span>
        <span style={{ fontSize: "var(--t-meta)", lineHeight: 1.5, color: SOFT }}>Colmena vuelve a como estaba entonces: conversaciones, entregables, lo que saben tus bots y tus ajustes. Lo de ahora no se borra: se aparta en tu carpeta de Colmena.</span>
      </span>
      <input type="password" autoComplete="current-password" aria-label="Contraseña de la copia" placeholder="Contraseña de la copia" value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...field, width: "100%" }} autoFocus />
      {file.identity ? (
        <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", fontSize: "var(--t-ui)", lineHeight: 1.5, cursor: "pointer" }}>
          <input type="checkbox" checked={identity} onChange={(e) => setIdentity(e.target.checked)} style={{ marginTop: "3px", accentColor: INK }} />
          <span>Recuperar también mi dirección de Personas<br /><span style={{ color: MUTED }}>Tus contactos te seguirán encontrando. Úsala en un solo ordenador a la vez.</span></span>
        </label>
      ) : null}
      <Alert>{error}</Alert>
      <span style={{ display: "flex", gap: "8px" }}>
        <button type="submit" disabled={password.length < 8 || busy} style={{ ...btn("dark", 36), opacity: password.length >= 8 ? 1 : 0.4 }}>{busy ? "Comprobando la copia…" : "Preparar la restauración"}</button>
        <button type="button" onClick={onClose} style={btn("ghost", 36)}>Cancelar</button>
      </span>
    </form>
  );
}

function Line({ anchor, k, n, v, children, first }) {
  return (
    <div {...anchorOf(anchor)} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 20px", minHeight: "60px", padding: "10px 22px", borderTop: first ? 0 : LINE, scrollMarginTop: "24px" }}>
      <span style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
        <span style={{ fontSize: "var(--t-body)", fontWeight: 500 }}>{k}</span>
        {n ? <span style={{ ...sub, overflowWrap: "anywhere" }}>{n}</span> : null}
      </span>
      {v ? <span style={{ fontSize: "var(--t-ui)", color: "#3D404A" }}>{v}</span> : null}
      {children}
    </div>
  );
}

export default function BackupSettings({ v, setV, error: loadError = null }) {
  const [busy, setBusy] = useState(null); // "password" | "run" | "settings" | "upload" | "restart" | "inspect"
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null); // "when" | "where" | "password" | "list"
  const [otherFolder, setOtherFolder] = useState(null);
  const [restoring, setRestoring] = useState(null);
  const [done, setDone] = useState(false);
  const fileInput = useRef(null);
  const load = () => get("/backup").then(setV).catch((e) => setError(e.message));
  const act = async (what, fn) => {
    setBusy(what); setError(null);
    try { const r = await fn(); if (r && typeof r === "object" && "folder" in r) setV(r); return r; } catch (e) { setError(e.message); return null; } finally { setBusy(null); }
  };
  if (!v) {
    return (
      <section {...anchorOf("copias")} style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "18px 22px", borderRadius: "var(--r-xl)", background: "#FFFFFF" }}>
        <h3 style={{ ...h3, fontSize: "var(--t-read)" }}>Copias de seguridad</h3>
        <span style={{ fontSize: "var(--t-meta)", color: loadError ? RED : MUTED }}>{loadError || "Cargando…"}</span>
      </section>
    );
  }
  const settings = (change, text, back) => act("settings", () => put("/backup/settings", change)).then((r) => { if (r && text) reversible({ id: "backup:" + Object.keys(change)[0], text, ms: UNDO_MS, undo: () => put("/backup/settings", back).then(setV) }); return r; });
  const runNow = async () => {
    const r = await act("run", () => post("/backup/run", {}));
    if (r?.view) { setV(r.view); setDone(true); setTimeout(() => setDone(false), 4000); }
  };
  const upload = async (file) => {
    if (!file) return;
    const r = await act("upload", () => postFile("/backup/upload", file));
    if (r?.path) setRestoring({ path: r.path, createdAt: r.createdAt, identity: r.identity });
  };
  const toggle = (what) => setOpen(open === what ? null : what);
  const known = new Set(v.folders.map((f) => f.path));
  const custom = v.chosen && !known.has(v.chosen);
  const pending = v.pending;
  const detected = v.folders.find((f) => f.path === v.folder && (f.kind === "onedrive" || f.kind === "gdrive"));
  const restoreHere = restoring && !v.backups.some((b) => b.path === restoring.path);
  const chip = (on) => ({ display: "inline-flex", alignItems: "center", gap: "6px", height: "34px", padding: "0 14px", borderRadius: "var(--r-pill)", border: 0, cursor: "pointer", fontSize: "var(--t-ui)", fontWeight: 500, color: on ? "#FFFFFF" : "#3D404A", background: on ? INK : "#F1F1EC" });

  return (
    <>
      {pending ? (
        <section role="status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 18px", padding: "16px 22px", borderRadius: "var(--r-xl)", background: "#FFF6DC", animation: "rise .35s cubic-bezier(.2,.8,.2,1)" }}>
          <span style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: "2px" }}>
            <span style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>La copia está lista para restaurarse</span>
            <span style={{ fontSize: "var(--t-meta)", color: SOFT }}>{`Del ${when(pending.createdAt).toLowerCase()} · ${pending.files} archivos${pending.identity ? " · con tu dirección de Personas" : ""}. Se aplica al reiniciar Colmena.`}</span>
          </span>
          {v.canRelaunch ? <button type="button" onClick={() => act("restart", () => post("/backup/relaunch", {}))} disabled={busy === "restart"} style={btn("dark", 38)}>{busy === "restart" ? "Reiniciando…" : "Reiniciar ahora"}</button> : <span style={{ fontSize: "var(--t-ui)", color: MUTED }}>Cierra Colmena y vuelve a abrirla.</span>}
          <button type="button" onClick={() => act("settings", async () => { await del("/backup/restore"); return get("/backup"); })} style={btn("outline", 38)}>Anular</button>
        </section>
      ) : null}
      {v.restored && !pending ? <p role="status" style={{ margin: 0, fontSize: "var(--t-ui)", color: "#0B6B4A" }}>{`✓ Restaurada la copia del ${when(v.restored.from).toLowerCase()}. Lo que había antes está en la carpeta «${v.restored.aside}».`}</p> : null}

      <section {...anchorOf("copias")} aria-labelledby="copy-t" style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-xl)", background: "#FFFFFF", overflow: "hidden", scrollMarginTop: "24px" }}>
        <div {...anchorOf("copia-ahora")} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", padding: "18px 22px 10px", scrollMarginTop: "24px" }}>
          <span style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: "2px" }}>
            <h3 id="copy-t" style={{ ...h3, fontSize: "var(--t-read)" }}>Copias de seguridad</h3>
            <span style={{ fontSize: "var(--t-meta)", color: v.lastError ? RED : MUTED }}>{v.lastError || (v.hasPassword ? "Cifradas con tu contraseña. Sirven para pasar Colmena a otro ordenador." : "Pon una contraseña para poder hacer copias. Sirven para pasar Colmena a otro ordenador.")}</span>
          </span>
          <button type="button" onClick={runNow} disabled={!v.hasPassword || busy === "run" || v.running} title={v.hasPassword ? undefined : "Pon antes la contraseña de las copias"} style={{ ...btn("dark", 40), opacity: v.hasPassword ? 1 : 0.4, cursor: busy === "run" ? "wait" : v.hasPassword ? "pointer" : "default" }}>
            {busy === "run" || v.running ? "Haciendo la copia…" : done ? "✓ Copia hecha" : "Hacer una copia ahora"}
          </button>
        </div>

        <Line anchor="copia-automatica" k="Copias automáticas" n={v.schedule === "off" ? "Mientras Colmena está abierta, si las enciendes." : `Se conservan las ${v.keep} últimas`} v={SCHEDULE_TEXT[v.schedule]}>
          <button type="button" aria-expanded={open === "when"} onClick={() => toggle("when")} style={btn("outline", 32)}>Cambiar</button>
        </Line>
        {open === "when" ? (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 16px", padding: "0 22px 16px", animation: "fade .25s ease-out" }}>
            <Pills label="Copias automáticas" items={SCHEDULE} value={v.schedule} busy={busy === "settings" || !v.hasPassword} onPick={(schedule) => schedule !== v.schedule && settings({ schedule }, "Copias: " + SCHEDULE_TEXT[schedule].toLowerCase(), { schedule: v.schedule })} />
            {v.schedule !== "off" ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "var(--t-ui)", color: MUTED }}>Conservar
                <Pills label="Cuántas conservar" items={KEEP} value={v.keep} busy={busy === "settings"} onPick={(keep) => keep !== v.keep && settings({ keep }, `Se conservan las ${keep} últimas`, { keep: v.keep })} />
              </span>
            ) : null}
            {!v.hasPassword ? <span style={{ fontSize: "var(--t-meta)", color: MUTED }}>Pon antes la contraseña.</span> : null}
          </div>
        ) : null}

        <Line anchor="copia-donde" k="Dónde se guardan" n={detected ? `Detectamos tu carpeta de ${detected.label.split(/\s|›/)[0]}` : v.folder} v={folderLabel(v)}>
          <button type="button" aria-expanded={open === "where"} onClick={() => toggle("where")} style={btn("outline", 32)}>Cambiar</button>
        </Line>
        {open === "where" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "0 22px 16px", animation: "fade .25s ease-out" }}>
            <div role="radiogroup" aria-label="Carpeta de las copias" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {v.folders.map((f) => <button key={f.path} type="button" role="radio" aria-checked={v.folder === f.path} title={f.path} disabled={busy === "settings"} onClick={() => v.folder !== f.path && settings({ folder: f.path }, "Las copias van a " + f.label, { folder: v.folder })} style={chip(v.folder === f.path)}>{f.label}</button>)}
              <button type="button" role="radio" aria-checked={!!custom} onClick={() => setOtherFolder(custom ? v.chosen : "")} style={chip(!!custom)}>Otra carpeta</button>
            </div>
            {otherFolder !== null ? (
              <form onSubmit={async (e) => { e.preventDefault(); const r = await settings({ folder: otherFolder.trim() }, "Carpeta de las copias cambiada", { folder: v.folder }); if (r) setOtherFolder(null); }} style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                <input aria-label="Ruta de la carpeta" placeholder="Por ejemplo, E:\Copias" value={otherFolder} onChange={(e) => setOtherFolder(e.target.value)} style={input} autoFocus />
                <button type="submit" disabled={otherFolder.trim().length < 3} style={btn("dark", 40)}>Usar esta carpeta</button>
              </form>
            ) : null}
            <span style={{ font: "400 var(--t-caption)/1.4 'Geist Mono', monospace", color: MUTED, overflowWrap: "anywhere" }}>{v.folder}</span>
          </div>
        ) : null}

        <Line anchor="copia-contrasena" k="Contraseña de las copias" n={v.hasPassword ? "Windows la guarda protegida. Apúntala: sin ella no se abren." : "Sin ella no se puede hacer ninguna copia."} v={v.hasPassword ? "✓ Puesta" : "Sin poner"}>
          <button type="button" aria-expanded={open === "password"} onClick={() => toggle("password")} style={btn(v.hasPassword ? "outline" : "dark", 32)}>{v.hasPassword ? "Cambiar" : "Poner"}</button>
        </Line>
        {open === "password" ? (
          <>
            <PasswordForm busy={busy === "password"} onCancel={() => setOpen(null)} onSave={async (p) => { const r = await act("password", () => post("/backup/password", { password: p })); if (r) setOpen(null); }} />
            {v.hasPassword ? <p style={{ margin: "-6px 22px 14px", fontSize: "var(--t-meta)", color: MUTED }}>¿Ya no quieres copias? <button type="button" onClick={() => act("password", () => del("/backup/password")).then(() => setOpen(null))} style={{ padding: 0, border: 0, background: "none", font: "inherit", fontWeight: 600, color: INK, textDecoration: "underline", cursor: "pointer" }}>Olvidar la contraseña</button>.</p> : null}
          </>
        ) : null}

        <Line anchor="copia-restaurar" k="Restaurar una copia" n={v.backups.length ? `De este u otro ordenador · ${v.backups.length} en la carpeta` : "De este u otro ordenador"}>
          <span style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {v.backups.length ? <button type="button" aria-expanded={open === "list"} onClick={() => toggle("list")} style={btn("ghost", 32)}>{open === "list" ? "Ocultar copias" : "Ver copias"}</button> : null}
            <input ref={fileInput} type="file" accept=".colmena-backup" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
            <button type="button" onClick={() => fileInput.current?.click()} disabled={busy === "upload"} style={btn("outline", 32)}>{busy === "upload" ? "Leyendo la copia…" : "Elegir archivo…"}</button>
          </span>
        </Line>
        {restoreHere ? <RestorePanel file={restoring} onClose={() => setRestoring(null)} onStaged={() => { setRestoring(null); load(); }} /> : null}
        {open === "list" ? v.backups.slice(0, 8).map((b) => (
          <div key={b.name}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", minHeight: "52px", padding: "6px 22px 6px 38px", borderTop: LINE }}>
              <span style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: "1px" }}>
                <span style={{ fontSize: "var(--t-ui)" }}>{when(b.at)}{b.name.startsWith("colmena-auto-") ? <span style={{ color: MUTED }}> · automática</span> : null}</span>
                <span style={sub}>{size(b.bytes)}</span>
              </span>
              <a href={"/api/backup/file/" + encodeURIComponent(b.name)} download title="Guardar este archivo en otro sitio" aria-label={"Descargar la copia de " + when(b.at)} style={{ ...btn("outline", 32), width: "32px", padding: 0 }}><Download size={14} strokeWidth={2} aria-hidden="true" /></a>
              <button type="button" onClick={async () => {
                if (restoring?.path === b.path) { setRestoring(null); return; }
                const head = await act("inspect", () => post("/backup/inspect", { path: b.path }));
                if (head) setRestoring({ ...b, identity: head.identity });
              }} style={btn("outline", 32)}>Restaurar…</button>
            </div>
            {restoring?.path === b.path ? <RestorePanel file={restoring} onClose={() => setRestoring(null)} onStaged={() => { setRestoring(null); load(); }} /> : null}
          </div>
        )) : null}

        <details {...anchorOf("copia-que-protege")} style={{ margin: "4px 22px 18px", padding: "12px 14px", borderRadius: "var(--r-md)", background: "#F6F6F3", fontSize: "var(--t-ui)", lineHeight: 1.5 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Qué lleva cada copia y qué no</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px", color: "#3D404A" }}>
            <span>Va entera cifrada con tu contraseña: si alguien la encuentra en la nube o en un disco, no puede leer nada. Si la tocan, Colmena lo nota y no la restaura.</span>
            <span>Lleva tus conversaciones y su historial, entregables y archivos, lo que saben tus bots y tus ajustes. Tu dirección de Personas va aparte, con su propia clave, y solo vuelve si lo eliges.</span>
            <span>No lleva tus sesiones de ChatGPT, Claude y las apps conectadas, las contraseñas de webs ni las claves de API: en otro ordenador vuelves a entrar.</span>
            <span>Si cifraste la base de datos, su clave va dentro de cada copia, protegida con la contraseña de la copia.</span>
          </div>
        </details>
      </section>
      <Alert>{error}</Alert>
    </>
  );
}

