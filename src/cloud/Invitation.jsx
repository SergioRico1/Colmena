// /invitacion#t=…: which company invites you and from whom; accept once signed in with the
// address it was sent to. The token waits in this browser while you sign in (it never goes in
// a URL the server sees).
import { useEffect, useState } from "react";
import { ArrowRight, CircleAlert, UsersThree } from "../components/Icon.js";
import { Shell } from "./Shell.jsx";
import { auth, me, tokenFromHash } from "./api.js";

const KEY = "colmena:invitation";
const ROLE = { admin: "para administrarla", member: "como miembro", guest: "como invitado" };
function keptToken() {
  const fresh = tokenFromHash();
  try {
    if (fresh) { localStorage.setItem(KEY, JSON.stringify({ t: fresh, at: Date.now() })); history.replaceState(null, "", location.pathname); return fresh; }
    const kept = JSON.parse(localStorage.getItem(KEY) || "null");
    return kept && Date.now() - kept.at < 3600e3 ? kept.t : null;
  } catch {
    return fresh;
  }
}
const forget = () => { try { localStorage.removeItem(KEY); } catch {} };

export function Invitation() {
  const [token] = useState(keptToken);
  const [view, setView] = useState({ loading: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!token) { setView({ error: "Este enlace de invitación está incompleto. Pide a quien te invitó que te lo envíe otra vez." }); return; }
    Promise.all([auth.previewInvite(token), me()])
      .then(([invite, who]) => setView({ invite, who }))
      .catch((error) => setView({ error: error.message }));
  }, [token]);
  const accept = async () => {
    setBusy(true);
    try {
      await auth.acceptInvite(token);
      forget();
      location.replace("/");
    } catch (error) {
      setBusy(false);
      setView((v) => ({ ...v, failure: error.message }));
    }
  };
  if (view.loading) return <Shell><div className="cl-skeleton" style={{ width: "70%", height: 28, marginBottom: 16 }} /><div className="cl-skeleton" style={{ width: "90%" }} /></Shell>;
  if (view.error)
    return (
      <Shell>
        <h1 className="cl-title">Esta invitación no sirve</h1>
        <p className="cl-error" role="alert" style={{ marginBottom: 20 }}><CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />{view.error}</p>
        <a className="cl-btn ghost" href="/entrar">Ir a la entrada</a>
      </Shell>
    );
  const { invite, who } = view;
  const wrongPerson = who?.user && who.user.email !== invite.email;
  const closed = invite.accepted || invite.expired;
  return (
    <Shell>
      <span className="cl-sent-mark" style={{ marginBottom: 20 }}><UsersThree size={28} /></span>
      <h1 className="cl-title">{invite.inviter} te invita a {invite.workspace}</h1>
      <p className="cl-lead">Entrarás {ROLE[invite.role] || "como miembro"}. La invitación es para <strong>{invite.email}</strong>.</p>
      {closed ? <p className="cl-error" role="alert"><CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />{invite.accepted ? "Esta invitación ya se aceptó." : "Esta invitación ha caducado. Pide otra."}</p>
        : !who?.user ? (
          <a className="cl-btn block" href={"/entrar?next=/invitacion&correo=" + encodeURIComponent(invite.email)}>Entrar con {invite.email}<ArrowRight size={16} /></a>
        ) : wrongPerson ? (
          <>
            <p className="cl-error" role="alert" style={{ marginBottom: 16 }}><CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />Has entrado como {who.user.email}. Cierra la sesión y entra con {invite.email} para aceptarla.</p>
            <button type="button" className="cl-btn ghost block" onClick={async () => { await auth.logout().catch(() => {}); location.assign("/entrar?next=/invitacion&correo=" + encodeURIComponent(invite.email)); }}>Cambiar de cuenta</button>
          </>
        ) : (
          <>
            {view.failure ? <p className="cl-error" role="alert" style={{ marginBottom: 16 }}><CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />{view.failure}</p> : null}
            <button type="button" className="cl-btn block" onClick={accept} disabled={busy} autoFocus>{busy ? "Entrando…" : "Aceptar y entrar"}{busy ? null : <ArrowRight size={16} />}</button>
          </>
        )}
    </Shell>
  );
}
