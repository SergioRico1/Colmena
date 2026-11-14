// «Importar de Slack» (screens/AdminEmpresa.jsx › importar): an admin uploads a Slack export ZIP in
// parts (server/cloud/slack-import.mjs: POST /api/chat/import, PUT …/parts/:n, POST …/start), then
// watches it run in the background. Everything shown comes from GET /api/chat/import, so a reload
// finds the import where it is; an upload cut halfway can go on by picking the same file again
// (only the missing parts are sent).
import { useCallback, useEffect, useRef, useState } from "react";
import { chat, putBytes } from "./api.js";
import { Dialog, sizeOf, whenOf } from "./ui.jsx";
import { CircleAlert, CircleCheck, UploadCloud } from "../components/Icon.js";
import "./admin.css";

const POLL_MS = 2000;
// The server's part size (IMPORT_LIMITS.partSize); the import's view does not repeat it, so the
// one POST /api/chat/import answered is kept per import for a resumed upload.
const DEFAULT_PART = 64 * 1024 * 1024;
const partKey = (id) => "colmena:slack-import-part:" + id;
const rememberPart = (id, size) => { try { localStorage.setItem(partKey(id), String(size)); } catch {} };
const partSizeOf = (id) => { try { return Number(localStorage.getItem(partKey(id))) || DEFAULT_PART; } catch { return DEFAULT_PART; } };

const receivedOf = (view) => (Array.isArray(view?.received) ? view.received : []);
const n = (v) => (Number(v) || 0).toLocaleString("es-ES");
const pct = (x) => Math.round(Math.max(0, Math.min(1, x || 0)) * 100) + " %";

function phaseText(view) {
  if (view.status === "queued") return "Esperando turno para empezar…";
  if (view.phase === "scan") return "Leyendo personas, canales y conversaciones…";
  if (view.phase === "messages") return "Copiando mensajes, del más antiguo al más nuevo…";
  return "Importando…";
}

/** A promise that rejects when `signal` aborts (putBytes leaves its promise open on abort). */
const aborted = (signal) => new Promise((_, reject) => {
  if (signal.aborted) reject(Object.assign(Error("cancelled"), { cancelled: true }));
  signal.addEventListener("abort", () => reject(Object.assign(Error("cancelled"), { cancelled: true })), { once: true });
});

export default function SlackImport() {
  const [view, setView] = useState(undefined); // undefined: loading; null: none yet
  const [error, setError] = useState(null);
  const [upload, setUpload] = useState(null); // { name, loaded, size } while bytes go up
  const [fresh, setFresh] = useState(false); // «Importar otro archivo»: the picker over a finished import
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const abort = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const r = await chat.get("/import");
      setView(r?.import || null);
      return r?.import || null;
    } catch (e) {
      setError(e.message);
      setView((v) => (v === undefined ? null : v));
      return null;
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // While it runs: ask again every 2 s.
  const running = view && (view.status === "queued" || view.status === "running");
  useEffect(() => {
    if (!running) return undefined;
    const t = setTimeout(refresh, POLL_MS);
    return () => clearTimeout(t);
  }, [running, view, refresh]);

  // Leaving the page mid-upload loses it (it can go on later, but warn).
  useEffect(() => {
    if (!upload) return undefined;
    const hold = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [upload]);
  useEffect(() => () => abort.current?.abort(), []);

  /** Sends the parts not received yet; resolves when all are up. */
  async function sendParts(file, { id, parts, partSize, have = [] }) {
    const ctrl = new AbortController();
    abort.current = ctrl;
    const missing = [];
    for (let k = 0; k < parts; k++) if (!have.includes(k)) missing.push(k);
    const lengthOf = (k) => Math.min(partSize, file.size - k * partSize);
    let done = file.size - missing.reduce((sum, k) => sum + lengthOf(k), 0);
    setUpload({ name: file.name, loaded: done, size: file.size });
    for (const k of missing) {
      const blob = file.slice(k * partSize, k * partSize + lengthOf(k));
      await Promise.race([
        putBytes(`/chat/import/${id}/parts/${k}`, blob, {
          type: "application/zip", signal: ctrl.signal,
          onProgress: (f) => setUpload({ name: file.name, loaded: done + f * blob.size, size: file.size }),
        }),
        aborted(ctrl.signal),
      ]);
      done += blob.size;
      setUpload({ name: file.name, loaded: done, size: file.size });
    }
    abort.current = null;
  }

  async function pick(file) {
    setError(null);
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) { setError("Elige el archivo .zip que descargaste de Slack."); return; }
    // An upload cut halfway: the same file goes on where it stopped.
    const resume = view?.status === "uploading" && receivedOf(view).length < view.parts ? view : null;
    try {
      if (resume) {
        if (file.size !== resume.size) { setError(`Ese no es el mismo archivo: la subida que se cortó era «${resume.name}» (${sizeOf(resume.size)}). Elige ese, o cancela la subida para empezar con otro.`); return; }
        await sendParts(file, { id: resume.id, parts: resume.parts, partSize: partSizeOf(resume.id), have: receivedOf(resume) });
      } else {
        const made = await chat.post("/import", { size: file.size, name: file.name });
        rememberPart(made.id, made.partSize);
        await sendParts(file, { id: made.id, parts: made.parts, partSize: made.partSize });
      }
      setFresh(false);
    } catch (e) {
      if (!e.cancelled) setError(e.message || "No se pudo subir el archivo.");
    } finally {
      setUpload(null);
      abort.current = null;
      await refresh();
    }
  }

  async function act(fn) {
    setBusy(true);
    setError(null);
    try { const v = await fn(); if (v && typeof v === "object" && "status" in v) setView(v); else await refresh(); }
    catch (e) { setError(e.message); await refresh(); }
    finally { setBusy(false); }
  }
  const start = () => act(() => chat.post(`/import/${view.id}/start`));
  const cancel = () => act(async () => {
    abort.current?.abort();
    return chat.post(`/import/${view.id}/cancel`);
  });
  const cancelUpload = async () => {
    abort.current?.abort();
    const latest = await refresh();
    if (latest?.status === "uploading") await act(() => chat.post(`/import/${latest.id}/cancel`));
  };

  if (view === undefined) return <p className="ad-loading" role="status">Cargando…</p>;

  const err = error ? <p className="ch-error" role="alert">{error}</p> : null;

  // Bytes going up right now.
  if (upload) {
    const f = upload.size ? upload.loaded / upload.size : 0;
    return (
      <>
        {err}
        <div className="ad-job" aria-live="polite">
          <div className="ad-job-head">
            <p className="ad-job-title">Subiendo el archivo…</p>
            <span className="ad-job-pct">{pct(f)}</span>
          </div>
          <p className="ad-job-file">{upload.name} · {sizeOf(upload.loaded)} de {sizeOf(upload.size)}</p>
          <div className="ad-bar" role="progressbar" aria-label="Subida" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f * 100)}><span style={{ width: f * 100 + "%" }} /></div>
          <p className="ch-hint">Deja esta página abierta hasta que termine. Si se corta, podrás seguir eligiendo el mismo archivo.</p>
          <div className="ch-row-actions"><button type="button" className="ch-btn" onClick={cancelUpload}>Cancelar la subida</button></div>
        </div>
      </>
    );
  }

  // Uploaded (or cut halfway).
  if (view?.status === "uploading" && !fresh) {
    const got = receivedOf(view).length;
    if (got >= view.parts) {
      return (
        <>
          {err}
          <div className="ad-job">
            <div className="ad-job-head"><p className="ad-job-title">Archivo subido</p></div>
            <p className="ad-job-file">{view.name} · {sizeOf(view.size)}</p>
            <p className="ch-hint">La importación sigue sola aunque cierres la página. Puede tardar un rato con exportaciones grandes.</p>
            <div className="ch-row-actions">
              <button type="button" className="ch-btn is-primary" onClick={start} disabled={busy}>Empezar la importación</button>
              <button type="button" className="ch-btn" onClick={cancel} disabled={busy}>Descartar</button>
            </div>
          </div>
        </>
      );
    }
    return (
      <>
        {err}
        <div className="ad-job">
          <div className="ad-job-head"><p className="ad-job-title">La subida se cortó</p><span className="ad-job-pct">{n(got)} de {n(view.parts)} partes</span></div>
          <p className="ad-job-file">{view.name} · {sizeOf(view.size)}</p>
          <p className="ch-hint">Elige otra vez el mismo archivo para subir solo lo que falta, o cancela la subida para empezar de cero.</p>
          <DropZone onFile={pick} title="Elige el mismo archivo para seguir" sub={`${view.name} · ${sizeOf(view.size)}`} />
          <div className="ch-row-actions" style={{ marginTop: 12 }}><button type="button" className="ch-btn" onClick={cancel} disabled={busy}>Cancelar la subida</button></div>
        </div>
      </>
    );
  }

  // Running in the background.
  if (running) {
    const c = view.counts || {};
    const ch = c.channels || {};
    const waiting = view.status === "queued" || (view.phase === "scan" && !view.progress);
    return (
      <>
        {err}
        <div className="ad-job" aria-live="polite">
          <div className="ad-job-head">
            <p className="ad-job-title">{phaseText(view)}</p>
            {waiting ? null : <span className="ad-job-pct">{pct(view.progress)}</span>}
          </div>
          <p className="ad-job-file">{view.name} · {sizeOf(view.size)}{view.startedAt ? " · empezó " + whenOf(view.startedAt) : ""}</p>
          <div className={"ad-bar" + (waiting ? " is-wait" : "")} role="progressbar" aria-label="Importación" aria-valuemin={0} aria-valuemax={100} aria-valuenow={waiting ? undefined : Math.round((view.progress || 0) * 100)}><span style={{ width: (view.progress || 0) * 100 + "%" }} /></div>
          {c.users != null ? (
            <dl className="ad-stats">
              <Stat label="Personas" value={c.users} />
              <Stat label="Canales" value={(ch.public || 0) + (ch.private || 0)} />
              <Stat label="Conversaciones directas" value={(ch.dm || 0) + (ch.group || 0)} />
              <Stat label="Mensajes" value={c.messages} />
              <Stat label="Archivos" value={(c.files?.held || 0) + (c.files?.linked || 0)} />
            </dl>
          ) : null}
          <p className="ch-hint">Sigue sola aunque cierres esta página. Lo que ya está importado aparece en los canales mientras tanto.</p>
          <div className="ch-row-actions"><button type="button" className="ch-btn" onClick={() => setConfirmStop(true)} disabled={busy}>Detener la importación</button></div>
        </div>
        {confirmStop ? (
          <Dialog title="¿Detener la importación?" onClose={() => setConfirmStop(false)} footer={<>
            <button type="button" className="ch-btn" onClick={() => setConfirmStop(false)}>Seguir importando</button>
            <button type="button" className="ch-btn is-danger" onClick={() => { setConfirmStop(false); cancel(); }}>Detener</button>
          </>}>
            <p style={{ margin: 0 }}>Lo que ya se ha importado se queda. Para traer el resto tendrás que importar el archivo otra vez.</p>
          </Dialog>
        ) : null}
      </>
    );
  }

  const intro = <Intro />;

  if (view?.status === "done" && !fresh) {
    const c = view.counts || {};
    const ch = c.channels || {};
    const files = c.files || {};
    return (
      <>
        {err}
        <div className="ad-job">
          <div className="ad-job-head"><CircleCheck size={18} aria-hidden="true" style={{ color: "var(--c-ok)", alignSelf: "center" }} /><p className="ad-job-title">Importación terminada</p></div>
          <p className="ad-job-file">{view.name}{view.finishedAt ? " · " + whenOf(view.finishedAt) : ""}</p>
          <dl className="ad-stats">
            <Stat label="Personas encontradas" value={c.matched} />
            <Stat label="Invitaciones pendientes" value={c.invited} />
            <Stat label="Canales públicos" value={ch.public} />
            <Stat label="Canales privados" value={ch.private} />
            <Stat label="Conversaciones directas" value={(ch.dm || 0) + (ch.group || 0)} />
            <Stat label="Mensajes" value={c.messages} />
            <Stat label="Hilos" value={c.threads} />
            <Stat label="Respuestas" value={c.replies} />
            <Stat label="Reacciones" value={c.reactions} />
            <Stat label="Archivos copiados" value={files.held} />
            <Stat label="Archivos enlazados" value={files.linked} />
            <Stat label="Mensajes omitidos" value={c.skipped} />
          </dl>
          {files.linked ? <p className="ch-hint">Los archivos enlazados no venían en la exportación: el mensaje guarda su enlace a Slack.</p> : null}
          {c.invited ? <p className="ch-hint">Las personas invitadas encuentran la invitación al entrar con su correo; no se les ha enviado nada.</p> : null}
          <Problems view={view} />
          <div className="ch-row-actions">
            <a className="ch-btn is-primary" href="/canales">Ir a los canales</a>
            <a className="ch-btn" href="/admin/personas">Ver las personas</a>
            <button type="button" className="ch-btn" onClick={() => setFresh(true)}>Importar otro archivo</button>
          </div>
        </div>
      </>
    );
  }

  if (view?.status === "failed" && !fresh) {
    return (
      <>
        <div className="ad-job" role="alert">
          <div className="ad-job-head"><CircleAlert size={18} aria-hidden="true" style={{ color: "var(--c-error)", alignSelf: "center" }} /><p className="ad-job-title">La importación no pudo terminar</p></div>
          <p className="ad-job-file">{view.name}</p>
          <p className="ch-error">{view.error || "Algo ha fallado al leer el archivo."}</p>
          <Problems view={view} />
          <p className="ch-hint">Lo que llegó a importarse se queda. Si lo vuelves a probar con el mismo archivo, no se duplica.</p>
          <div className="ch-row-actions"><button type="button" className="ch-btn is-primary" onClick={() => setFresh(true)}>Probar otra vez</button></div>
        </div>
      </>
    );
  }

  return (
    <>
      {intro}
      {view?.status === "cancelled" && !fresh ? <p className="ch-hint">La última importación ({view.name}) se canceló. Lo que llegó a importarse se queda.</p> : null}
      {err}
      <DropZone onFile={pick} title="Elige el archivo .zip de Slack" sub="o arrástralo aquí" />
      {fresh ? <div className="ch-row-actions" style={{ marginTop: 12 }}><button type="button" className="ch-btn" onClick={() => { setFresh(false); setError(null); }}>Volver</button></div> : null}
    </>
  );
}

function Intro() {
  return (
    <div className="ad-intro">
      <p>Se importan las personas (como invitaciones a su correo), los canales públicos y privados con sus miembros, las conversaciones directas y de grupo, y los mensajes con sus hilos, reacciones y ediciones. Los archivos se copian si vienen en la exportación; si no, queda su enlace.</p>
      <p>Descarga la exportación en Slack: <span className="ad-path">Configuración y administración › Importar y exportar datos › Exportar</span>.</p>
    </div>
  );
}

function DropZone({ onFile, title, sub }) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={"ad-drop" + (over ? " is-over" : "")}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files?.[0] || null); }}
    >
      <UploadCloud size={28} aria-hidden="true" />
      <p className="ad-drop-title">{title}</p>
      <p className="ad-drop-sub">{sub}</p>
      <input type="file" accept=".zip,application/zip" onChange={(e) => { const f = e.target.files?.[0] || null; e.target.value = ""; onFile(f); }} />
    </label>
  );
}

function Stat({ label, value }) {
  return <div><dt>{label}</dt><dd>{n(value)}</dd></div>;
}

function Problems({ view }) {
  const list = Array.isArray(view.errors) ? view.errors : [];
  if (!list.length) return null;
  return (
    <>
      <p className="ch-hint">Avisos durante la importación ({n(list.length)}):</p>
      <ul className="ad-errors">{list.slice(0, 5).map((e, i) => <li key={i}>{typeof e === "string" ? e : e?.message || e?.error || JSON.stringify(e)}</li>)}</ul>
    </>
  );
}
