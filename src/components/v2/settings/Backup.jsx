import { useEffect, useRef, useState } from "react";
import { Check, Cloud, Download, FolderOpen, HardDrive, Lock, RotateCcw, ShieldCheck } from "lucide-react";
import { del, get, post, postFile, put } from "../../../lib/api.js";
import { FAINT, Group, INK, LINE, MUTED, Segmented, Text, anchorOf, inputStyle, pill, rowStyle } from "./rows.jsx";

// Ajustes › Privacidad y datos › «Copias de seguridad» (server/backup-service.mjs): a copy of
// everything that is yours in Colmena, sealed with a password only you know, kept in a folder
// your computer already syncs (OneDrive, Google Drive) or wherever you choose, on its own every
// day or week if you want. Restoring brings the whole history back here or on a new computer;
// it is applied when Colmena starts again.

const SCHEDULE = [["off", "Solo cuando la pida"], ["daily", "Cada día"], ["weekly", "Cada semana"]];
const KEEP = [[3, "3"], [7, "7"], [14, "14"], [30, "30"]];
const FOLDER_ICON = { onedrive: Cloud, gdrive: Cloud, documents: HardDrive };
const GREEN = "#0B6B4A", RED = "#B4372A";
const size = (bytes) => (bytes == null ? "" : bytes >= 1e9 ? (bytes / 1e9).toFixed(1) + " GB" : bytes >= 1e6 ? Math.round(bytes / 1e6) + " MB" : Math.max(1, Math.round(bytes / 1e3)) + " KB");
const when = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) + ", " + d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
};

function PasswordForm({ onSave, onCancel, busy }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const short = a.length > 0 && a.length < 8;
  const differ = b.length > 0 && a !== b;
  const ok = a.length >= 8 && a === b;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ok) onSave(a); }} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "4px 20px 18px", animation: "fade .25s ease-out" }}>
      <span style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
        <input type="password" autoComplete="new-password" aria-label="Contraseña de las copias" placeholder="Contraseña (8 o más caracteres)" value={a} onChange={(e) => setA(e.target.value)} style={inputStyle} autoFocus />
        <input type="password" autoComplete="new-password" aria-label="Repite la contraseña" placeholder="Repítela" value={b} onChange={(e) => setB(e.target.value)} style={inputStyle} />
      </span>
      <span style={{ fontSize: "13px", lineHeight: 1.5, color: short || differ ? RED : FAINT }}>
        {short ? "Necesita al menos 8 caracteres." : differ ? "No coinciden." : "Apúntala en un lugar seguro: sin ella nadie puede abrir tus copias, ni siquiera tú."}
      </span>
      <span style={{ display: "flex", gap: "10px" }}>
        <button type="submit" disabled={!ok || busy} style={{ ...pill(true), opacity: ok ? 1 : 0.4, cursor: ok && !busy ? "pointer" : "default" }}>{busy ? "Guardando…" : "Guardar contraseña"}</button>
        <button type="button" onClick={onCancel} style={pill(false)}>Cancelar</button>
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
    setBusy(true);
    setError(null);
    try { onStaged(await post("/backup/restore", { path: file.path, password, identity })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={go} style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px 20px 20px", borderTop: LINE, background: "#FBFBF9", animation: "fade .25s ease-out" }}>
      <Text title={"Restaurar la copia del " + when(file.at || file.createdAt)} sub="Colmena vuelve a como estaba entonces: conversaciones, entregables, lo que saben tus bots y tus ajustes. Lo de ahora no se borra: se aparta en tu carpeta de Colmena." />
      <input type="password" autoComplete="current-password" aria-label="Contraseña de la copia" placeholder="Contraseña de la copia" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} autoFocus />
      {file.identity ? (
        <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", fontSize: "14px", lineHeight: 1.5, color: INK, cursor: "pointer" }}>
          <input type="checkbox" checked={identity} onChange={(e) => setIdentity(e.target.checked)} style={{ marginTop: "3px", accentColor: INK }} />
          <span>Recuperar también mi dirección de Personas<br /><span style={{ color: MUTED }}>Tus contactos te seguirán encontrando. Úsala en un solo ordenador a la vez.</span></span>
        </label>
      ) : null}
      {error ? <span role="alert" style={{ fontSize: "13px", color: RED }}>{error}</span> : null}
      <span style={{ display: "flex", gap: "10px" }}>
        <button type="submit" disabled={password.length < 8 || busy} style={{ ...pill(true), opacity: password.length >= 8 ? 1 : 0.4 }}>{busy ? "Comprobando la copia…" : "Preparar la restauración"}</button>
        <button type="button" onClick={onClose} style={pill(false)}>Cancelar</button>
      </span>
    </form>
  );
}

export default function BackupSettings() {
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(null); // "password" | "run" | "settings" | "upload" | "restart"
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [otherFolder, setOtherFolder] = useState(null);
  const [restoring, setRestoring] = useState(null);
  const [done, setDone] = useState(null);
  const fileInput = useRef(null);
  const load = () => get("/backup").then(setV).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const act = async (what, fn) => {
    setBusy(what);
    setError(null);
    try { const r = await fn(); if (r && typeof r === "object" && "folder" in r) setV(r); return r; }
    catch (e) { setError(e.message); return null; }
    finally { setBusy(null); }
  };
  if (!v) return <Group id="bk-t" title="Copias de seguridad" anchor="copias"><div style={rowStyle(true, "72px")}><Text title="Copias de seguridad" sub={error || "Cargando…"} /></div></Group>;

  const chooseFolder = (folder) => act("settings", () => put("/backup/settings", { folder }));
  const runNow = async () => {
    const r = await act("run", () => post("/backup/run", {}));
    if (r?.view) { setV(r.view); setDone("Copia hecha: " + size(r.bytes)); setTimeout(() => setDone(null), 4000); }
  };
  const upload = async (file) => {
    if (!file) return;
    const r = await act("upload", () => postFile("/backup/upload", file));
    if (r?.path) setRestoring({ path: r.path, createdAt: r.createdAt, identity: r.identity });
  };
  const known = new Set(v.folders.map((f) => f.path));
  const custom = v.chosen && !known.has(v.chosen);
  const pending = v.pending;

  return (
    <>
      {pending ? (
        <section role="status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px 18px", padding: "18px 20px", borderRadius: "26px", background: "#FFF4D1", animation: "rise .35s cubic-bezier(.2,.8,.2,1)" }}>
          <RotateCcw size={20} strokeWidth={2} color={INK} aria-hidden="true" />
          <Text title="La copia está lista para restaurarse" sub={`Del ${when(pending.createdAt)} · ${pending.files} archivos${pending.identity ? " · con tu dirección de Personas" : ""}. Se aplica al reiniciar Colmena.`} />
          <span style={{ display: "flex", gap: "10px" }}>
            {v.canRelaunch ? <button type="button" onClick={() => act("restart", () => post("/backup/relaunch", {}))} disabled={busy === "restart"} style={pill(true)}>{busy === "restart" ? "Reiniciando…" : "Reiniciar ahora"}</button> : <span style={{ fontSize: "14px", color: MUTED }}>Cierra Colmena y vuelve a abrirla.</span>}
            <button type="button" onClick={() => act("settings", async () => { await del("/backup/restore"); return get("/backup"); })} style={pill(false)}>Anular</button>
          </span>
        </section>
      ) : null}
      {v.restored && !pending ? (
        <p style={{ margin: "0 20px", display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: GREEN }}>
          <Check size={16} strokeWidth={2.4} aria-hidden="true" />{`Restaurada la copia del ${when(v.restored.from)}. Lo que había antes está en la carpeta «${v.restored.aside}».`}
        </p>
      ) : null}

      <Group id="bk-t" title="Copias de seguridad" anchor="copias" note="Cada copia va cifrada (AES-256) con tu contraseña. Ni Colmena ni Microsoft o Google pueden abrirla; si olvidas la contraseña, tampoco tú.">
        {/* Password */}
        <div {...anchorOf("copia-contrasena")} style={{ ...rowStyle(editing ? true : false, "76px"), flexWrap: "wrap" }}>
          <span aria-hidden="true" style={{ width: "36px", height: "36px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: v.hasPassword ? INK : "rgba(18,19,26,.06)", color: v.hasPassword ? "#FFFFFF" : "#A3A6AF" }}><Lock size={16} strokeWidth={2} /></span>
          <Text title="Contraseña de las copias" sub={v.hasPassword ? "Puesta el " + when(v.keySetAt) + ". Se guarda protegida por Windows, nunca en claro." : "Ponla para poder hacer copias."} subColor={v.hasPassword ? MUTED : FAINT} />
          {!editing ? (
            <span style={{ display: "flex", gap: "8px" }}>
              <button type="button" onClick={() => setEditing(true)} style={pill(!v.hasPassword)}>{v.hasPassword ? "Cambiar" : "Poner contraseña"}</button>
              {v.hasPassword ? <button type="button" onClick={() => act("password", () => del("/backup/password"))} style={{ ...pill(false), background: "transparent", color: MUTED }}>Olvidar</button> : null}
            </span>
          ) : null}
        </div>
        {editing ? <div style={{ borderBottom: LINE }}><PasswordForm busy={busy === "password"} onCancel={() => setEditing(false)} onSave={async (p) => { const r = await act("password", () => post("/backup/password", { password: p })); if (r) setEditing(false); }} /></div> : null}

        {/* Where */}
        <div {...anchorOf("copia-donde")} style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px 20px", borderBottom: LINE }}>
          <Text title="Dónde se guardan" sub="En una carpeta que tu ordenador ya sincroniza, tu copia viaja sola a la nube." />
          <div role="radiogroup" aria-label="Carpeta de las copias" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {v.folders.map((f) => {
              const Icon = FOLDER_ICON[f.kind] || FolderOpen;
              const on = v.folder === f.path;
              return (
                <button key={f.path} type="button" role="radio" aria-checked={on} title={f.path} onClick={() => chooseFolder(f.path)} disabled={busy === "settings"}
                  style={{ display: "inline-flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 16px", borderRadius: "999px", border: 0, cursor: "pointer", fontSize: "14px", fontWeight: 600, color: INK, background: on ? "#FFFFFF" : "rgba(18,19,26,.05)", boxShadow: on ? "0 0 0 1.5px " + INK : "none", transition: "box-shadow .2s ease" }}>
                  <Icon size={15} strokeWidth={2} aria-hidden="true" />{f.label}
                </button>
              );
            })}
            <button type="button" role="radio" aria-checked={custom} onClick={() => setOtherFolder(v.chosen && custom ? v.chosen : "")}
              style={{ display: "inline-flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 16px", borderRadius: "999px", border: 0, cursor: "pointer", fontSize: "14px", fontWeight: 600, color: INK, background: custom ? "#FFFFFF" : "rgba(18,19,26,.05)", boxShadow: custom ? "0 0 0 1.5px " + INK : "none" }}>
              <FolderOpen size={15} strokeWidth={2} aria-hidden="true" />Otra carpeta
            </button>
          </div>
          {otherFolder !== null ? (
            <form onSubmit={async (e) => { e.preventDefault(); const r = await chooseFolder(otherFolder.trim()); if (r) setOtherFolder(null); }} style={{ display: "flex", flexWrap: "wrap", gap: "10px", animation: "fade .25s ease-out" }}>
              <input aria-label="Ruta de la carpeta" placeholder="Por ejemplo, E:\Copias" value={otherFolder} onChange={(e) => setOtherFolder(e.target.value)} style={inputStyle} autoFocus />
              <button type="submit" disabled={otherFolder.trim().length < 3} style={pill(true)}>Usar esta carpeta</button>
            </form>
          ) : null}
          <span style={{ fontSize: "12px", color: FAINT, font: "500 12px/1.4 'Geist Mono', monospace", overflowWrap: "anywhere" }}>{v.folder}</span>
        </div>

        {/* When */}
        <div {...anchorOf("copia-automatica")} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", minHeight: "76px", padding: "12px 20px", borderBottom: LINE }}>
          <span style={{ flex: "1 1 200px", minWidth: 0, display: "flex" }}><Text title="Copias automáticas" sub={v.schedule === "off" ? "Solo cuando pulses «Hacer copia ahora»." : `Mientras Colmena está abierta. Se guardan las ${v.keep} más recientes.`} /></span>
          <span style={{ flex: "0 1 420px", minWidth: "min(100%, 300px)" }}><Segmented label="Copias automáticas" items={SCHEDULE} value={v.schedule} busy={busy === "settings" || !v.hasPassword} onPick={(schedule) => act("settings", () => put("/backup/settings", { schedule }))} /></span>
          {v.schedule !== "off" ? (
            <span style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "14px", color: MUTED }}>Conservar
              <span style={{ width: "200px" }}><Segmented label="Cuántas conservar" items={KEEP} value={v.keep} busy={busy === "settings"} onPick={(keep) => act("settings", () => put("/backup/settings", { keep }))} /></span>
            </span>
          ) : null}
        </div>

        {/* Now */}
        <div {...anchorOf("copia-ahora")} style={{ ...rowStyle(!v.backups.length, "76px"), flexWrap: "wrap" }}>
          <span aria-hidden="true" style={{ width: "36px", height: "36px", flex: "none", display: "grid", placeItems: "center", borderRadius: "50%", background: v.last && !v.lastError ? "#E1F4EC" : "rgba(18,19,26,.06)", color: v.last && !v.lastError ? GREEN : "#A3A6AF" }}><ShieldCheck size={17} strokeWidth={2} /></span>
          <Text title={done || (v.last ? "Última copia: " + when(v.last.at) : "Aún no hay ninguna copia")} sub={v.lastError ? v.lastError : v.last ? size(v.last.bytes) : "Tarda poco y puedes seguir trabajando."} subColor={v.lastError ? RED : MUTED} />
          <button type="button" onClick={runNow} disabled={!v.hasPassword || busy === "run" || v.running} style={{ ...pill(true), opacity: v.hasPassword ? 1 : 0.4, cursor: busy === "run" ? "wait" : "pointer" }}>{busy === "run" || v.running ? "Haciendo la copia…" : "Hacer copia ahora"}</button>
        </div>
        {v.backups.slice(0, 5).map((b, i) => (
          <div key={b.name}>
            <div style={{ ...rowStyle(i === Math.min(v.backups.length, 5) - 1 && restoring?.path !== b.path, "60px") }}>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "15px" }}>{when(b.at)}{b.name.startsWith("colmena-auto-") ? <span style={{ color: FAINT }}> · automática</span> : null}</span>
                <span style={{ fontSize: "13px", color: FAINT }}>{size(b.bytes)}</span>
              </span>
              <a href={"/api/backup/file/" + encodeURIComponent(b.name)} download title="Guardar este archivo en otro sitio" aria-label={"Descargar la copia del " + when(b.at)} style={{ ...pill(false), width: "42px", padding: 0, textDecoration: "none" }}><Download size={16} strokeWidth={2} aria-hidden="true" /></a>
              <button type="button" onClick={async () => {
                if (restoring?.path === b.path) return setRestoring(null);
                const head = await act("inspect", () => post("/backup/inspect", { path: b.path }));
                if (head) setRestoring({ ...b, identity: head.identity });
              }} style={pill(false)}>Restaurar…</button>
            </div>
            {restoring?.path === b.path ? <RestorePanel file={restoring} onClose={() => setRestoring(null)} onStaged={() => { setRestoring(null); load(); }} /> : null}
          </div>
        ))}
      </Group>

      <Group id="bk-r" title="Restaurar desde otro ordenador" anchor="copia-restaurar" note="Instala Colmena en el ordenador nuevo, abre aquí la copia y pon su contraseña. Vuelven tus conversaciones, entregables, lo que saben tus bots y tus ajustes.">
        <div style={{ ...rowStyle(!restoring || v.backups.some((b) => b.path === restoring.path), "72px"), flexWrap: "wrap" }}>
          <Text title="Abrir una copia" sub="Un archivo .colmena-backup de tu OneDrive, Google Drive o un disco." />
          <input ref={fileInput} type="file" accept=".colmena-backup" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" onClick={() => fileInput.current?.click()} disabled={busy === "upload"} style={pill(false)}>{busy === "upload" ? "Leyendo la copia…" : "Elegir archivo…"}</button>
        </div>
        {restoring && !v.backups.some((b) => b.path === restoring.path) ? <RestorePanel file={restoring} onClose={() => setRestoring(null)} onStaged={() => { setRestoring(null); load(); }} /> : null}
      </Group>
      {error ? <p role="alert" style={{ margin: "0 20px", fontSize: "13px", color: RED }}>{error}</p> : null}

      <Group id="bk-q" title="Qué protege cada cosa" anchor="copia-que-protege">
        {[
          ["La copia", "Va entera cifrada con tu contraseña: si alguien la encuentra en la nube o en un disco, no puede leer nada. Si la tocan, Colmena lo nota y no la restaura."],
          ["Qué lleva", "Tus conversaciones y su historial, entregables y archivos de misión, lo que saben tus bots (su SOUL y tu perfil) y tus ajustes. Tu dirección de Personas va aparte, con su propia clave, y solo vuelve si lo eliges."],
          ["Qué no lleva", "Tus sesiones de ChatGPT, Claude y las apps conectadas, las contraseñas de webs y las claves de API. Windows las protege para este ordenador; en otro, vuelves a entrar."],
          ["En este ordenador", "La carpeta de Colmena no va cifrada: quien entre con tu sesión de Windows o copie esa carpeta puede leer tus datos. Para eso, el cifrado local (próximamente) o el cifrado de Windows."],
        ].map(([title, text], i, all) => (
          <div key={title} style={{ ...rowStyle(i === all.length - 1, "auto"), alignItems: "flex-start", padding: "16px 20px" }}>
            <span style={{ flex: "0 0 150px", fontSize: "15px", fontWeight: 600 }}>{title}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: "14px", lineHeight: 1.55, color: MUTED }}>{text}</span>
          </div>
        ))}
      </Group>
    </>
  );
}
