import { useEffect, useState } from "react";
import { Plus, UserPlus } from "../components/Icon.js";
import Shell from "../components/v2/Shell.jsx";
import NewBot from "../components/v2/team/NewBot.jsx";
import EquipoPeople from "../components/v3/team/People.jsx";
import TeamSection from "../components/v3/team/TeamSection.jsx";
import InviteSheet from "../components/people/InviteSheet.jsx";
import { currentTeam } from "../lib/teams.js";
import { LimitLine } from "../components/v2/LimitNotice.jsx";
import { Shape, autonomyHint, autonomyLabel, autonomyShown } from "../components/v3/team/parts.jsx";
import { useStore } from "../lib/store.jsx";
import { useActivity } from "../lib/liveStore.js";
import { useHidden } from "../lib/undoToast.js";
import { navigate } from "../lib/router.jsx";
import { useExpert } from "../lib/expert.js";
import { sidebarModel, waitingLabel } from "../lib/sidebar.js";
import { needsOf } from "../components/v2/needs.js";
import EquipoBot from "./EquipoBot.jsx";
import { aiConnected } from "../lib/aiAccount.js";
import { C, line } from "../lib/theme.js";
import { B, CARD, H1, LEAD, H2, COUNT, TAG, ONE } from "../lib/ui4.js";

// Colmena 4 · «Equipo» (design/V3Equipo.dc.html in the v4 look): who works with you. Your bots as
// cards (BotFace at 48 with its state, autonomy, what each is doing; «Hablar» and «Ficha»), «Un bot nuevo», and the people
// you connect with (Equipo › Personas, moved here from Ajustes) beside the invitation card.
// /equipo/:bot and /colmena/:bot open a bot's profile (EquipoBot), /equipo/nuevo the new bot.
const STATE = { trabaja: "Trabajando", espera: "Te espera", pausado: "En pausa", bloqueado: "Atascado", libre: "Libre" };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export default function ColmenaV2({ params = {}, query = {} }) {
  const path = typeof location !== "undefined" ? location.pathname : "";
  const creating = query.nuevo === "1" || /^\/(colmena|equipo)\/nuevo/.test(path);
  if (params.bot && !creating) return <EquipoBot params={params} query={query} />;
  return creating ? <NewBotPage /> : <Team query={query} />;
}

function NewBotPage() {
  return (
    <Shell active="equipo" background="var(--c-app)">
      <NewBot onClose={() => navigate("/equipo")} onHired={(b) => navigate(`/equipo/${encodeURIComponent(b.id)}`)} />
    </Shell>
  );
}

function Team({ query = {} }) {
  const store = useStore();
  const connected = aiConnected(store);
  const { bots = [], peers = null } = store;
  const hiddenBot = useHidden("bot");
  const [expert] = useExpert();
  // Hosted Colmena: the team is the company (store.cloud). Its people are invited and managed
  // on /empresa (cloud.html); the desktop's teams, codes and «Personas» mailbox don't exist there.
  const hosted = !!store.cloud;
  // «Invita a tu equipo» on Inicio opens the invitation here (/equipo?invitar=1).
  const [invite, setInvite] = useState(query.invitar === "1" && !hosted);
  useEffect(() => { if (hosted && query.invitar === "1") window.location.replace("/empresa#personas"); }, [hosted, query.invitar]);
  const team = bots.filter((b) => b.enabled !== false && !hiddenBot(b.id));
  // Who works and what waits for you: the same model as the sidebar (lib/sidebar.js), so the
  // header, each card and the foot of the sidebar can never disagree. The number is the one
  // count of what waits for you; a bot's «Te espera» is that list filtered by bot.
  const model = sidebarModel(store);
  const rows = new Map(model.bots.map((r) => [r.id, r]));
  const { asks } = needsOf(store);
  const count = [String(team.length), model.summary.working ? `${model.summary.working} trabajando` : null, model.waitingCount ? waitingLabel(model.waitingCount) : null].filter(Boolean).join(" · ");
  // «Invitar» here is your team's when you administer one; otherwise a code to talk to someone.
  const current = currentTeam(store.teams);
  const inviteTo = current?.admin ? { kind: "team", team: { id: current.id, name: current.name, admin: true } } : null;
  return (
    <Shell active="equipo" background="var(--c-app)">
      <main style={{ maxWidth: "1180px", margin: "0 auto", padding: "28px clamp(20px, 3.4vw, 40px) 56px", display: "flex", flexDirection: "column", gap: "28px" }}>
        <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "12px 16px" }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={H1}>{"Equipo"}</h1>
            <p style={LEAD}>{hosted ? "Quién trabaja contigo: las personas de tu empresa y los bots." : "Quién trabaja contigo: tus bots y las personas con las que te conectas."}</p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {hosted
              ? <a href="/empresa#personas" target="_self" className="u4-sec" style={{ ...B.secondary, ...B.lg }}><UserPlus size={16} />{"Invitar"}</a>
              : <button type="button" onClick={() => setInvite(true)} className="u4-sec" style={{ ...B.secondary, ...B.lg }}><UserPlus size={16} />{"Invitar"}</button>}
            <a href="/equipo/nuevo" className="u4-pri" style={{ ...B.primary, ...B.lg }}>
              <Plus size={16} weight="bold" />
              {"Nuevo bot"}
            </a>
          </div>
        </header>
        {/* Your team as everyone in it sees it: people, roles and each one's bots (or «Solo tú»). */}
        {hosted ? <CompanyPeople cloud={store.cloud} /> : <TeamSection />}
        <section aria-labelledby="bots-t" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h2 id="bots-t" style={H2}>{"Bots"}</h2>
            <span style={COUNT}>{count}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))", gap: "10px" }}>
            {team.map((b) => <BotCard key={b.id} bot={b} row={rows.get(b.id)} ask={asks.find((a) => a.botId === b.id) || null} expert={expert} account={connected} />)}
            <a href="/equipo/nuevo" className="u4-row" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "6px", padding: "14px 16px", borderRadius: "var(--r-md)", border: `1px dashed ${C.lineStrong}`, color: C.text, minHeight: "180px" }}>
              <span style={{ fontSize: "var(--t-read)", fontWeight: 600 }}>{"Un bot nuevo"}</span>
              <span style={{ fontSize: "var(--t-meta)", lineHeight: "1.45", color: C.text3 }}>{"Descríbelo como a un compañero nuevo, o empieza de una plantilla: contable, atención al cliente, investigador…"}</span>
              <span style={{ fontSize: "var(--t-meta)", fontWeight: 600, color: C.accentInk }}>{"Crear un bot"}</span>
            </a>
          </div>
        </section>
        {hosted ? null : <EquipoPeople peers={peers} />}
      </main>
      {invite ? <InviteSheet context={inviteTo} onClose={() => setInvite(false)} /> : null}
    </Shell>
  );
}

const ROLE_LABEL = { owner: "Propietario", admin: "Administra", member: "Miembro", guest: "Invitado" };
const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";

/** Hosted: the company's people as the server lists them (state.cloud.members), and where to invite. */
function CompanyPeople({ cloud }) {
  const people = (cloud.members || []).filter((m) => !m.deactivated);
  const me = cloud.me?.id;
  return (
    <section aria-labelledby="people-t" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <h2 id="people-t" style={H2}>{`Personas de ${cloud.workspace?.name || "tu empresa"}`}</h2>
        <span style={COUNT}>{people.length}</span>
      </div>
      <ul aria-label="Personas de la empresa" style={{ ...CARD, margin: 0, padding: 0, listStyle: "none" }}>
        {people.map((m, i) => (
          <li key={m.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", borderTop: i ? line() : 0 }}>
            <span aria-hidden="true" style={{ flex: "none", width: "32px", height: "32px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: C.chip, color: C.text2, fontSize: "var(--t-meta)", fontWeight: 600 }}>{initials(m.name)}</span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
              <span style={{ ...ONE, fontSize: "var(--t-ui)", fontWeight: 600, color: C.text }}>{m.name}{m.id === me ? " (tú)" : ""}</span>
              {m.email ? <span style={{ ...ONE, fontSize: "var(--t-meta)", color: C.text3 }}>{m.email}</span> : null}
            </span>
            <span style={TAG}>{ROLE_LABEL[m.role] || ROLE_LABEL.member}</span>
          </li>
        ))}
        <li style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px", padding: "12px 14px", borderTop: people.length ? line() : 0 }}>
          <span style={{ flex: "1 1 260px", fontSize: "var(--t-meta)", lineHeight: 1.45, color: C.text3 }}>{people.length > 1 ? "Invita a más gente, cambia papeles o saca a alguien en «Empresa y personas»." : "Solo estás tú. Invita a tu equipo por correo: cada persona entra con un enlace y llega a #general."}</span>
          <a href="/empresa#personas" target="_self" className="u4-sec" style={B.secondary}><UserPlus size={15} />{people.length > 1 ? "Empresa y personas" : "Invitar"}</a>
        </li>
      </ul>
    </section>
  );
}

/** `row`: this bot in the sidebar's model (state, how many things of it wait for you); `ask`: the oldest of them. */
function BotCard({ bot, row, ask, expert, account = true }) {
  const activity = useActivity(bot.id);
  const work = row?.state === "working";
  const wait = (row?.waiting || 0) > 0;
  const waits = ask?.title ? `Te espera: ${ask.title.charAt(0).toLowerCase() + ask.title.slice(1)}` : "Te espera";
  const state = work ? (cap(activity?.verb) || "Trabajando") + (wait ? " · te espera" : "") : wait ? waits : STATE[bot.status] || "Libre";
  return (
    <article style={{ ...CARD, display: "flex", flexDirection: "column", gap: "10px", padding: "14px 16px", ...(wait ? { borderColor: C.honeyRing } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <Shape bot={bot} size={48} state={work ? "work" : wait ? "wait" : bot.status === "pausado" ? "pause" : null} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
          <h3 style={{ ...ONE, margin: "0", fontSize: "var(--t-read)", fontWeight: 600, lineHeight: 1.2 }}>{bot.name}</h3>
          <span style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
            {bot.role ? <span style={TAG}>{bot.role}</span> : null}
            {/* Autonomy only where it is not the usual («Hace y te avisa» on every card was noise). */}
            {autonomyShown(bot.autonomy) ? <span title={autonomyHint(bot.autonomy)} style={TAG}>{autonomyLabel(bot.autonomy)}</span> : null}
          </span>
        </div>
      </div>
      {bot.status === "limitado" ? (
        <>
          <LimitLine limited={bot.limited} style={{ fontSize: "var(--t-meta)" }} />
          {wait ? <span style={{ ...ONE, fontSize: "var(--t-meta)", fontWeight: 600, color: C.honeyText }} title={waits}>{waits}</span> : null}
        </>
      ) : (
        <span style={{ ...ONE, display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--t-meta)", fontWeight: wait ? 600 : 400, color: wait ? C.honeyText : work ? C.text2 : C.text3 }} title={state}>
          <span aria-hidden="true" style={{ flex: "none", width: "7px", height: "7px", borderRadius: "var(--r-circle)", background: wait ? C.honey : work ? C.ok : bot.status === "bloqueado" ? C.error : C.lineStrong }} />
          <span style={ONE}>{state}</span>
        </span>
      )}
      {/* Modo experto says the real state: no AI account, no model at work («sin cuenta»). */}
      {expert && (bot.model?.label || !account) ? <span style={{ font: "500 var(--t-caption)/1.3 'Geist Mono', monospace", color: C.text3 }}>{account || bot.engine ? [bot.model?.label || "sin modelo", bot.thinking || "equilibrado", bot.engine || "equipo"].join(" · ") : "sin cuenta de IA"}</span> : null}
      <div style={{ marginTop: "auto", display: "flex", gap: "6px", paddingTop: "10px", borderTop: line() }}>
        <a href={`/chat/${encodeURIComponent(bot.id)}`} className="u4-pri" style={{ ...B.primary, flex: "1" }}>{"Hablar"}</a>
        <a href={`/equipo/${encodeURIComponent(bot.id)}`} className="u4-sec" style={{ ...B.secondary, flex: "1" }}>{"Ficha"}</a>
      </div>
    </article>
  );
}
