// /entrar: your email, then «Revisa tu correo», with the hive alive behind. /entrar/verificar: the
// link from that mail, used with one press (mail scanners that open links never use it up).
// While «Revisa tu correo» shows, the page listens for the link being used in another tab of this
// browser (a BroadcastChannel from /entrar/verificar, and /auth/me now and then while the page is
// visible) and goes on by itself. Nothing new crosses the network: the session cookie is the
// browser's own, and another device's sign-in is never visible here.
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CircleAlert, CircleCheck, Mail } from "../components/Icon.js";
import { Shell } from "./Shell.jsx";
import { hive } from "./Hive.jsx";
import { auth, me, tokenFromHash } from "./api.js";

const nextParam = () => {
  const n = new URLSearchParams(location.search).get("next") || "/";
  return /^\/(?![/\\])/.test(n) ? n : "/";
};
/** What /auth/oauth/:provider/callback sends back in ?error= (cloud/src/worker.js). */
const OAUTH_ERRORS = {
  denied: "Has cancelado la entrada. Puedes probar otra vez o entrar con tu correo.",
  state: "La entrada ha caducado o se terminó en otro navegador. Empieza otra vez.",
  unverified: "Tu proveedor no confirma que ese correo sea tuyo. Entra con el enlace por correo.",
  "ms-email": "Tu cuenta de trabajo de Microsoft no comparte un correo verificado. Entra con el enlace por correo, o pide a quien administra Microsoft en tu empresa que lo active.",
  rate: "Demasiados intentos. Espera unos minutos y vuelve a probar.",
  account: "No hemos podido abrir tu cuenta. Prueba otra vez.",
  provider: "No hemos podido terminar la entrada con ese proveedor. Prueba otra vez o entra con tu correo.",
};
const oauthError = () => {
  const code = new URLSearchParams(location.search).get("error");
  return code ? OAUTH_ERRORS[code] || OAUTH_ERRORS.provider : null;
};
const CHANNEL = "colmena-auth";
const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Where a signed-in person goes: their company, the invitation they came from, or /empresa. */
const destination = (m, creating) => (!creating && (m?.current || nextParam().startsWith("/invitacion")) ? nextParam() : "/empresa");

/** «Continuar con Google / Microsoft / GitHub», only for the providers this deployment has. */
function Providers({ providers }) {
  if (!providers.length) return null;
  const next = encodeURIComponent(nextParam());
  return (
    <>
      <div className="cl-providers" role="group" aria-label="Entrar con otra cuenta">
        {providers.map((p) => (
          <a key={p.id} className="cl-btn ghost block" href={`/auth/oauth/${encodeURIComponent(p.id)}?next=${next}`}>Continuar con {p.name}</a>
        ))}
      </div>
      <p className="cl-divider"><span>o con tu correo</span></p>
    </>
  );
}

/** «Revisa tu correo»: the bots gather by the card; when the link is used here, the page goes on. */
function Sent({ email, delivery, creating, onBack }) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    hive("gather");
    hive("honey");
    let done = false, timer = 0;
    const until = Date.now() + 16 * 60e3; // the link lives 15 minutes
    const go = (m) => {
      if (done) return;
      done = true;
      setEntered(true);
      hive("ok");
      setTimeout(() => location.replace(destination(m, creating)), calm() ? 0 : 900);
    };
    const look = async () => {
      if (done || document.hidden || Date.now() > until) return;
      try { const m = await me(); if (m?.user) go(m); } catch {}
    };
    const tick = () => { timer = setTimeout(async () => { await look(); if (!done && Date.now() < until) tick(); }, 5000); };
    tick();
    let channel = null;
    try {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (e) => { if (e.data === "signed-in") look(); };
    } catch {}
    document.addEventListener("visibilitychange", look);
    return () => { done = true; clearTimeout(timer); channel?.close(); document.removeEventListener("visibilitychange", look); hive("free"); };
  }, [creating]);
  if (entered)
    return (
      <div className="cl-sent" role="status">
        <span className="cl-sent-mark ok"><CircleCheck size={28} /></span>
        <h1 className="cl-title">Ya has entrado</h1>
        <p className="cl-lead" style={{ margin: 0 }}>Abriste el enlace en otra pestaña. Seguimos aquí.</p>
      </div>
    );
  return (
    <div className="cl-sent">
      <span className="cl-sent-mark"><Mail size={28} /></span>
      <div role="status">
        <h1 className="cl-title">Revisa tu correo</h1>
        <p className="cl-lead" style={{ marginBottom: 12 }}>Te hemos enviado un enlace a <strong>{email}</strong>. Ábrelo en el ordenador o el móvil donde quieras usar Colmena: sirve una vez y caduca en 15 minutos.</p>
        {delivery === "dev" ? <p className="cl-note">Este espacio aún no tiene correo configurado: quien lo administra puede ver el enlace en los registros del servidor.</p> : null}
      </div>
      <p className="cl-listening"><i aria-hidden="true" />Si lo abres en este navegador, esta página sigue sola.</p>
      <button type="button" className="cl-link" onClick={onBack}><ArrowLeft size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />Usar otro correo</button>
    </div>
  );
}

export function SignIn() {
  const [email, setEmail] = useState(() => new URLSearchParams(location.search).get("correo") || "");
  const [state, setState] = useState({ step: "ask", busy: false, error: null, delivery: null });
  const [providers, setProviders] = useState([]);
  const [failed] = useState(oauthError);
  const input = useRef(null);
  const typed = useRef(0);
  const leaving = new URLSearchParams(location.search).has("salir");
  // ?crear=1: the home page's «Crear mi empresa». The same sign-in, saying what comes after it.
  const creating = !leaving && new URLSearchParams(location.search).has("crear");
  useEffect(() => { let live = true; auth.providers().then((list) => { if (live) setProviders(list); }); return () => { live = false; }; }, []);
  // The error code leaves the address bar (a reload should not show it again); `next` stays.
  useEffect(() => {
    if (!failed) return;
    const q = new URLSearchParams(location.search);
    q.delete("error");
    history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : ""));
  }, [failed]);
  // Already signed in: straight on (to the company form when they came to create one).
  useEffect(() => { if (!leaving) me().then((m) => { if (m?.user) location.replace(destination(m, creating)); }).catch(() => {}); }, [leaving, creating]);
  const send = async (e) => {
    e.preventDefault();
    if (state.busy) return;
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const r = await auth.link(email.trim(), nextParam());
      setState({ step: "sent", busy: false, error: null, delivery: r.delivery, email: r.email });
    } catch (error) {
      setState((s) => ({ ...s, busy: false, error: error.message }));
      input.current?.focus();
    }
  };
  const onType = (e) => {
    setEmail(e.target.value);
    // A bot comes to look at what you write, now and then (not on every key).
    const now = Date.now();
    if (now - typed.current > 700) { typed.current = now; hive("type"); }
  };
  if (state.step === "sent")
    return <Shell><Sent email={state.email} delivery={state.delivery} creating={creating} onBack={() => setState({ step: "ask", busy: false, error: null })} /></Shell>;
  return (
    <Shell>
      <h1 className="cl-title">{leaving ? "Has cerrado la sesión" : creating ? "Crea tu empresa en Colmena" : "Entra en Colmena"}</h1>
      <p className="cl-lead">{leaving ? "Tu equipo sigue aquí. Vuelve cuando quieras con tu correo."
        : creating ? "Tu correo primero: te mandamos un enlace para entrar, sin contraseña. Luego nombras tu empresa y conoces a tus bots."
        : "El chat donde tu equipo y sus bots trabajan juntos. Escribe tu correo y te mandamos un enlace para entrar, sin contraseña."}</p>
      {failed ? <p className="cl-error" role="alert" style={{ marginBottom: 20 }}><CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />{failed}</p> : null}
      <Providers providers={providers} />
      <form className="cl-form" onSubmit={send} noValidate>
        <label className="cl-field">
          <span className="cl-label">Correo</span>
          <input ref={input} className="cl-input" type="email" name="email" autoComplete="email" inputMode="email" autoFocus required placeholder="nombre@empresa.com"
            value={email} onChange={onType} aria-invalid={state.error ? "true" : undefined} aria-describedby={state.error ? "signin-error" : undefined} />
        </label>
        {state.error ? <p id="signin-error" className="cl-error" role="alert"><CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />{state.error}</p> : null}
        <button className="cl-btn block" type="submit" disabled={state.busy || !email.trim()}>{state.busy ? "Enviando…" : "Enviarme el enlace"}{state.busy ? null : <ArrowRight size={16} />}</button>
      </form>
      <p className="cl-note" style={{ marginTop: 20 }}>¿Te han invitado a una empresa? Abre el enlace de tu invitación: te pedirá este mismo paso.</p>
    </Shell>
  );
}

export function Verify() {
  const [token] = useState(tokenFromHash);
  const [state, setState] = useState({ busy: false, error: token ? null : "Este enlace está incompleto. Pide otro desde la página de entrada." });
  // The token leaves the address bar at once (it is not kept in the history).
  useEffect(() => { if (token) history.replaceState(null, "", location.pathname); }, [token]);
  const go = async () => {
    setState({ busy: true, error: null });
    try {
      const r = await auth.verify(token);
      // «Revisa tu correo» in another tab of this browser goes on by itself (it asks /auth/me).
      try { const c = new BroadcastChannel(CHANNEL); c.postMessage("signed-in"); c.close(); } catch {}
      hive("ok");
      location.replace(r.next?.startsWith("/invitacion") ? r.next : r.workspaceId ? r.next || "/" : "/empresa");
    } catch (error) {
      setState({ busy: false, error: error.message });
    }
  };
  return (
    <Shell>
      <h1 className="cl-title">{state.error ? "No hemos podido entrar" : "Un paso más"}</h1>
      {state.error ? (
        <>
          <p className="cl-error" role="alert" style={{ marginBottom: 20 }}><CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />{state.error}</p>
          <a className="cl-btn" href="/entrar">Pedir otro enlace</a>
        </>
      ) : (
        <>
          <p className="cl-lead">Pulsa el botón para entrar con este dispositivo. Tu equipo te espera dentro.</p>
          <button type="button" className="cl-btn block" onClick={go} disabled={state.busy} autoFocus>{state.busy ? "Entrando…" : "Entrar en Colmena"}{state.busy ? null : <ArrowRight size={16} />}</button>
        </>
      )}
    </Shell>
  );
}
