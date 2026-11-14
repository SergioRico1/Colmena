// /invitacion#t=…: which company invites you and from whom; accept once signed in with the
// address it was sent to. The token waits in this browser while you sign in (it never goes in
// a URL the server sees).
import { useEffect, useState } from "react";
import { ArrowRight, CircleAlert, UsersThree } from "../components/Icon.js";
import { Shell } from "./Shell.jsx";
import { auth, me, tokenFromHash, unnamed } from "./api.js";
import { YourName } from "./YourName.jsx";
import { Roster } from "./Roster.jsx";

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
  const [person, setPerson] = useState("");
  useEffect(() => {
    if (!token) { setView({ error: "Este enlace de invitación está incompleto. Pide a quien te invitó que te lo envíe otra vez." }); return; }
    Promise.all([auth.previewInvite(token), me()])
      .then(([invite, who]) => setView({ invite, who }))
      .catch((error) => setView({ error: error.message }));
  }, [token]);
  const accept = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try {
      if (unnamed(view.who?.user) && person.trim()) await auth.rename(person.trim());
      await auth.acceptInvite(token);
      forget();
      // The guided start, short for someone who joins: your AI, the company's bots, a first request.
      location.replace("/empezar");
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
  // Who is already in the hive: the people (circles) and the company's bots.
  const team = closed ? [] : [
    ...(invite.people || []).map((name, i) => ({ kind: "person", key: "p" + i, name, fresh: true })),
    ...(invite.bots || []).map((b) => ({ kind: "bot", key: "b" + b.id, bot: b, name: b.name, line: b.role, fresh: true })),
  ];
  const others = Math.max(0, (invite.count || 0) - (invite.people || []).length);
  const hiveBots = (invite.bots || []).length ? invite.bots : undefined;
  return (
    <Shell bots={hiveBots} below={team.length ? (
      <section className="cl-card cl-team" aria-labelledby="team-head">
        <h2 className="cl-h2" id="team-head" style={{ marginTop: 0 }}>Quién hay en {invite.workspace}</h2>
        <p className="cl-sub">{[invite.count === 1 ? "1 persona" : `${invite.count || 0} personas`, (invite.bots || []).length ? `${invite.bots.length} bots` : null].filter(Boolean).join(" y ")}{others ? `. Ves a ${(invite.people || []).length} de ellas.` : "."}</p>
        <Roster items={team} label={`Personas y bots de ${invite.workspace}`} />
      </section>
    ) : null}>
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
          <form className="cl-form" onSubmit={accept}>
            {view.failure ? <p className="cl-error" role="alert"><CircleAlert size={16} style={{ flex: "none", marginTop: 1 }} />{view.failure}</p> : null}
            {unnamed(who.user) ? <YourName value={person} onChange={setPerson} autoFocus /> : null}
            <button type="submit" className="cl-btn block" disabled={busy || (unnamed(who.user) && !person.trim())} autoFocus={!unnamed(who.user)}>{busy ? "Entrando…" : "Aceptar y entrar"}{busy ? null : <ArrowRight size={16} />}</button>
          </form>
        )}
      {closed ? null : <p className="cl-note" style={{ marginTop: 24 }}>Colmena es el chat de trabajo de {invite.workspace}: canales y mensajes con tu equipo, y bots que preparan el trabajo y esperan el OK de una persona antes de enviar, pagar, comprar, publicar o borrar nada.</p>}
    </Shell>
  );
}
