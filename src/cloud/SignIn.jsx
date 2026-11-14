// /entrar: your email, then «Revisa tu correo». /entrar/verificar: the link from that mail, used
// with one press (mail scanners that open links never use it up).
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CircleAlert, Mail } from "../components/Icon.js";
import { Shell } from "./Shell.jsx";
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

export function SignIn() {
  const [email, setEmail] = useState(() => new URLSearchParams(location.search).get("correo") || "");
  const [state, setState] = useState({ step: "ask", busy: false, error: null, delivery: null });
  const [providers, setProviders] = useState([]);
  const [failed] = useState(oauthError);
  const input = useRef(null);
  const leaving = new URLSearchParams(location.search).has("salir");
  useEffect(() => { let live = true; auth.providers().then((list) => { if (live) setProviders(list); }); return () => { live = false; }; }, []);
  // The error code leaves the address bar (a reload should not show it again); `next` stays.
  useEffect(() => {
    if (!failed) return;
    const q = new URLSearchParams(location.search);
    q.delete("error");
    history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : ""));
  }, [failed]);
  // Already signed in: straight on.
  useEffect(() => { if (!leaving) me().then((m) => { if (m?.user) location.replace(m.current || nextParam().startsWith("/invitacion") ? nextParam() : "/empresa"); }).catch(() => {}); }, [leaving]);
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
  if (state.step === "sent")
    return (
      <Shell>
        <div className="cl-sent" role="status">
          <span className="cl-sent-mark"><Mail size={28} /></span>
          <div>
            <h1 className="cl-title">Revisa tu correo</h1>
            <p className="cl-lead" style={{ marginBottom: 12 }}>Te hemos enviado un enlace a <strong>{state.email}</strong>. Ábrelo en este dispositivo para entrar; sirve una vez y caduca en 15 minutos.</p>
            {state.delivery === "dev" ? <p className="cl-note">Este espacio aún no tiene correo configurado: quien lo administra puede ver el enlace en los registros del servidor.</p> : null}
          </div>
          <button type="button" className="cl-link" onClick={() => setState({ step: "ask", busy: false, error: null })}><ArrowLeft size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />Usar otro correo</button>
        </div>
      </Shell>
    );
  return (
    <Shell>
      <h1 className="cl-title">{leaving ? "Has cerrado la sesión" : "Entra en Colmena"}</h1>
      <p className="cl-lead">{leaving ? "Vuelve cuando quieras con tu correo." : "Escribe tu correo de trabajo y te enviamos un enlace para entrar. Sin contraseñas."}</p>
      {failed ? <p className="cl-error" role="alert" style={{ marginBottom: 20 }}><CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />{failed}</p> : null}
      <Providers providers={providers} />
      <form className="cl-form" onSubmit={send} noValidate>
        <label className="cl-field">
          <span className="cl-label">Correo</span>
          <input ref={input} className="cl-input" type="email" name="email" autoComplete="email" inputMode="email" autoFocus required placeholder="nombre@empresa.com"
            value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={state.error ? "true" : undefined} aria-describedby={state.error ? "signin-error" : undefined} />
        </label>
        {state.error ? <p id="signin-error" className="cl-error" role="alert"><CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />{state.error}</p> : null}
        <button className="cl-btn block" type="submit" disabled={state.busy || !email.trim()}>{state.busy ? "Enviando…" : "Enviarme el enlace"}{state.busy ? null : <ArrowRight size={16} />}</button>
      </form>
      <p className="cl-note" style={{ marginTop: 20 }}>¿Te han invitado a una empresa? Abre el enlace de la invitación: te pedirá este mismo paso.</p>
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
          <p className="cl-lead">Pulsa el botón para entrar con este dispositivo.</p>
          <button type="button" className="cl-btn block" onClick={go} disabled={state.busy} autoFocus>{state.busy ? "Entrando…" : "Entrar en Colmena"}{state.busy ? null : <ArrowRight size={16} />}</button>
        </>
      )}
    </Shell>
  );
}
