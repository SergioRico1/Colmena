// The desktop app signs in (docs/CLOUD.md › Phase 5).
//   /entrar/escritorio          in the app's own window: a code, «Abrir el navegador», waiting.
//   /entrar/escritorio/aprobar  in the person's browser, signed in there: «¿Abrir Colmena en …?».
// The browser hands a second code back to the app (colmena://, or typed), and only then does the
// app's window get a session of its own from the Worker (an HttpOnly cookie in its partition).
import { useEffect, useRef, useState } from "react";
import { ArrowRight, CircleAlert, Laptop, ShieldCheck } from "../components/Icon.js";
import { Shell } from "./Shell.jsx";
import { AuthError, me } from "./api.js";

const desktop = () => (typeof window !== "undefined" ? window.colmenaWindow?.cloud || null : null);
const KEY = "colmena-desktop-signin";
async function post(path, body) {
  let r;
  try {
    r = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new AuthError("No hay conexión. Comprueba tu red.", 0);
  }
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new AuthError(data?.error || "No se pudo completar.", r.status, data);
  return data;
}
const codeOk = (c) => /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i.test(String(c || "").trim());

/** In the desktop window: start, open the browser, wait for the hand-back. */
export function DesktopSignIn() {
  const api = desktop();
  const [flow, setFlow] = useState(() => { try { const f = JSON.parse(sessionStorage.getItem(KEY) || "null"); return f && f.expiresAt > Date.now() ? f : null; } catch { return null; } });
  const [state, setState] = useState({ phase: "start", error: null, approved: false });
  const [typed, setTyped] = useState("");
  const handback = useRef("");
  const opened = useRef(false);
  // Already signed in: into the app.
  useEffect(() => { me().then((m) => { if (m?.user) location.replace(m.current ? "/" : "/empresa"); }).catch(() => {}); }, []);
  // A new request, unless one is still open in this window.
  useEffect(() => {
    if (flow || !api) return;
    let live = true;
    (async () => {
      try {
        const id = await api.identity().catch(() => ({ name: null }));
        const f = await post("/auth/desktop/start", { name: id?.name || null });
        if (!live) return;
        sessionStorage.setItem(KEY, JSON.stringify(f));
        setFlow(f);
      } catch (error) { if (live) setState((s) => ({ ...s, error: error.message })); }
    })();
    return () => { live = false; };
  }, [flow, api]);
  // The browser opens once by itself; the button opens it again.
  useEffect(() => { if (flow && api && !opened.current) { opened.current = true; api.openApproval(flow.id).catch(() => {}); } }, [flow, api]);
  // The colmena:// link from the browser carries the hand-back code.
  useEffect(() => api?.onEvent?.((e) => { if (e.type === "handback" && flow && e.id === flow.id) { handback.current = e.code; poll(); } }), [flow]); // eslint-disable-line react-hooks/exhaustive-deps
  const poll = async () => {
    if (!flow) return;
    try {
      const r = await post("/auth/desktop/poll", { id: flow.id, poll: flow.poll, handback: handback.current });
      if (r.ok) { sessionStorage.removeItem(KEY); location.replace(r.workspaceId ? "/" : "/empresa"); return; }
      setState((s) => ({ ...s, phase: "wait", approved: !!r.approved, error: null }));
    } catch (error) {
      handback.current = "";
      if (error.status === 410 || error.status === 404) { sessionStorage.removeItem(KEY); setFlow(null); opened.current = false; }
      setState((s) => ({ ...s, error: error.message }));
    }
  };
  useEffect(() => {
    if (!flow) return undefined;
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [flow]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = (e) => {
    e.preventDefault();
    if (!codeOk(typed)) return setState((s) => ({ ...s, error: "Escribe el código de 8 letras y números que te muestra el navegador." }));
    handback.current = typed.trim().toUpperCase();
    poll();
  };
  if (!api)
    return (
      <Shell>
        <h1 className="cl-title">Esta página es de la app de escritorio</h1>
        <p className="cl-lead">Para entrar desde el navegador, usa la página de entrada.</p>
        <a className="cl-btn" href="/entrar">Ir a la entrada</a>
      </Shell>
    );
  return (
    <Shell>
      <span className="cl-sent-mark" style={{ marginBottom: 20 }}><Laptop size={28} /></span>
      <h1 className="cl-title">Entra desde tu navegador</h1>
      <p className="cl-lead">Hemos abierto Colmena en tu navegador. Entra allí con tu correo y confirma que es este ordenador: verás el mismo código.</p>
      {flow ? (
        <div className="cl-desk-code" aria-label={"Código de este ordenador: " + flow.code}>{flow.code}</div>
      ) : <p className="cl-note" role="status">Preparando…</p>}
      {state.error ? <p className="cl-error" role="alert" style={{ margin: "16px 0 0" }}><CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />{state.error}</p> : null}
      <p className="cl-ok" role="status" style={{ margin: "18px 0 0" }}>{state.approved ? "Confirmado en el navegador. Si Colmena no ha entrado sola, escribe el código que te muestra el navegador." : flow ? "Esperando a que confirmes en el navegador…" : null}</p>
      <div className="cl-row" style={{ marginTop: 20 }}>
        <button type="button" className="cl-btn" disabled={!flow} onClick={() => flow && api.openApproval(flow.id)}>Abrir el navegador otra vez<ArrowRight size={16} /></button>
      </div>
      <form className="cl-form" onSubmit={submit} style={{ marginTop: 28 }}>
        <label className="cl-field">
          <span className="cl-label">¿El navegador te dio un código para la app?</span>
          <span className="cl-row">
            <input className="cl-input" style={{ flex: "1 1 160px", fontFamily: "'Geist Mono', monospace", letterSpacing: ".08em", textTransform: "uppercase" }} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="XXXX-XXXX" maxLength={9} autoComplete="off" spellCheck={false} aria-describedby="handback-help" />
            <button type="submit" className="cl-btn ghost" disabled={!flow || !typed.trim()}>Entrar</button>
          </span>
          <span id="handback-help" className="cl-note">Solo si Colmena no se abre sola al confirmar en el navegador.</span>
        </label>
      </form>
    </Shell>
  );
}

/** In the person's browser, signed in: they confirm it is their computer, the code goes back. */
export function ApproveDesktop() {
  const id = new URLSearchParams(location.search).get("c") || "";
  const [state, setState] = useState({ loading: true, error: null, request: null, done: null, busy: false });
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const who = await me();
        if (!who?.user) { location.replace("/entrar?next=" + encodeURIComponent(location.pathname + location.search)); return; }
        const r = await fetch("/auth/desktop/preview?c=" + encodeURIComponent(id), { credentials: "same-origin" });
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new AuthError(data?.error || "Esa petición no existe.", r.status);
        if (live) setState({ loading: false, error: null, request: data, done: null, busy: false, me: who.user });
      } catch (error) { if (live) setState({ loading: false, error: error.message, request: null, done: null, busy: false }); }
    })();
    return () => { live = false; };
  }, [id]);
  const approve = async () => {
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const { csrf } = await (await fetch("/auth/me", { credentials: "same-origin" })).json();
      const r = await fetch("/auth/desktop/approve", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify({ id }) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new AuthError(data?.error || "No se pudo confirmar.", r.status);
      setState((s) => ({ ...s, busy: false, done: data }));
      // Back to the app: the hand-back code travels in the colmena:// link (never to a server).
      location.href = "colmena://entrar?c=" + encodeURIComponent(id) + "&k=" + encodeURIComponent(data.handback);
    } catch (error) { setState((s) => ({ ...s, busy: false, error: error.message })); }
  };
  const r = state.request;
  return (
    <Shell>
      {state.loading ? <p className="cl-note" role="status">Cargando…</p> : state.done ? (
        <>
          <span className="cl-sent-mark" style={{ marginBottom: 20 }}><ShieldCheck size={28} /></span>
          <h1 className="cl-title">Vuelve a Colmena</h1>
          <p className="cl-lead">Hemos abierto Colmena en «{state.done.name}». Si no se abrió sola, escribe este código en la app:</p>
          <div className="cl-desk-code">{state.done.handback}</div>
          <p className="cl-note" style={{ marginTop: 20 }}>Ya puedes cerrar esta pestaña.</p>
        </>
      ) : state.error || !r ? (
        <>
          <h1 className="cl-title">No hemos podido seguir</h1>
          <p className="cl-error" role="alert"><CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />{state.error || "Esa petición no existe."}</p>
        </>
      ) : r.state !== "pending" ? (
        <>
          <h1 className="cl-title">{r.state === "expired" ? "Esta petición ha caducado" : "Esta petición ya se usó"}</h1>
          <p className="cl-lead">Vuelve a empezar desde Colmena en tu ordenador.</p>
        </>
      ) : (
        <>
          <span className="cl-sent-mark" style={{ marginBottom: 20 }}><Laptop size={28} /></span>
          <h1 className="cl-title">¿Abrir Colmena en «{r.name}»?</h1>
          <p className="cl-lead">Entrarás como <strong>{state.me?.email}</strong>. Comprueba que ese ordenador muestra ahora este código; si no lo tienes delante, no sigas.</p>
          <div className="cl-desk-code">{r.code}</div>
          <div className="cl-row" style={{ marginTop: 24 }}>
            <button type="button" className="cl-btn" onClick={approve} disabled={state.busy} autoFocus>{state.busy ? "Confirmando…" : "Sí, es mi ordenador"}{state.busy ? null : <ArrowRight size={16} />}</button>
            <a className="cl-btn ghost" href="/">No he sido yo</a>
          </div>
        </>
      )}
    </Shell>
  );
}
