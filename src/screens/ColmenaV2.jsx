import { useState } from "react";
import { Plus } from "../components/Icon.js";
import Shell from "../components/v2/Shell.jsx";
import NewBot from "../components/v2/team/NewBot.jsx";
import EquipoPeople from "../components/v3/team/People.jsx";
import TeamSection from "../components/v3/team/TeamSection.jsx";
import { InviteSheet } from "../components/v2/people/InviteSheets.jsx";
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

// Colmena 3 · «Equipo» (design/V3Equipo.dc.html): who works with you. Your bots as cards
// (shape, autonomy, what each is doing; «Hablar» and «Ficha»), «Un bot nuevo», and the people
// you connect with (Equipo › Personas, moved here from Ajustes) beside the invitation card.
// /equipo/:bot and /colmena/:bot open a bot's profile (EquipoBot), /equipo/nuevo the new bot.
const STATE = { trabaja: "Trabajando", espera: "Te espera", pausado: "En pausa", bloqueado: "Atascado", libre: "Libre" };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export default function ColmenaV2({ params = {}, query = {} }) {
  const path = typeof location !== "undefined" ? location.pathname : "";
  const creating = query.nuevo === "1" || /^\/(colmena|equipo)\/nuevo/.test(path);
  if (params.bot && !creating) return <EquipoBot params={params} query={query} />;
  return creating ? <NewBotPage /> : <Team />;
}

function NewBotPage() {
  return (
    <Shell active="equipo">
      <NewBot onClose={() => navigate("/equipo")} onHired={(b) => navigate(`/equipo/${encodeURIComponent(b.id)}`)} />
    </Shell>
  );
}

function Team() {
  const store = useStore();
  const connected = aiConnected(store);
  const { bots = [], peers = null } = store;
  const hiddenBot = useHidden("bot");
  const [expert] = useExpert();
  const [invite, setInvite] = useState(false);
  const team = bots.filter((b) => b.enabled !== false && !hiddenBot(b.id));
  // Who works and what waits for you: the same model as the sidebar (lib/sidebar.js), so the
  // header, each card and the foot of the sidebar can never disagree. The number is the one
  // count of what waits for you; a bot's «Te espera» is that list filtered by bot.
  const model = sidebarModel(store);
  const rows = new Map(model.bots.map((r) => [r.id, r]));
  const { asks } = needsOf(store);
  const count = [String(team.length), model.summary.working ? `${model.summary.working} trabajando` : null, model.waitingCount ? waitingLabel(model.waitingCount) : null].filter(Boolean).join(" · ");
  const relayOff = peers?.relay?.status === "off";
  return (
    <Shell active="equipo">
      <main style={{ maxWidth: "1160px", margin: "0 auto", padding: "44px clamp(20px, 4vw, 48px) 64px", display: "flex", flexDirection: "column", gap: "36px" }}>
        <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <h1 style={{ margin: "0", font: "600 var(--t-display-m)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.04em" }}>{"Equipo"}</h1>
            <p style={{ margin: "0", fontSize: "var(--t-read)", color: "var(--c-text-2)" }}>{"Quién trabaja contigo: tus bots y las personas con las que te conectas."}</p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button type="button" disabled={!peers?.me || relayOff} onClick={() => setInvite(true)} style={{ height: "44px", padding: "0 18px", border: "1px solid rgb(var(--c-ink-rgb) / .16)", borderRadius: "var(--r-pill)", background: "var(--c-card)", fontSize: "var(--t-body)", fontWeight: "500", cursor: "pointer" }}>{"Invitar a una persona"}</button>
            <a href="/equipo/nuevo" style={{ height: "44px", padding: "0 20px", display: "inline-flex", alignItems: "center", gap: "8px", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-body)", fontWeight: "600" }}>
              <Plus size={16} weight="bold" />
              {"Nuevo bot"}
            </a>
          </div>
        </header>
        {/* Your team as everyone in it sees it: people, roles and each one's bots (or «Solo tú»). */}
        <TeamSection />
        <section aria-labelledby="bots-t" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
            <h2 id="bots-t" style={{ margin: "0", font: "600 var(--t-heading)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Bots"}</h2>
            <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-3)" }}>{count}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(250px, 100%), 1fr))", gap: "12px" }}>
            {team.map((b) => <BotCard key={b.id} bot={b} row={rows.get(b.id)} ask={asks.find((a) => a.botId === b.id) || null} expert={expert} account={connected} />)}
            <a href="/equipo/nuevo" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "10px", padding: "20px", borderRadius: "var(--r-2xl)", border: "1.5px dashed rgb(var(--c-ink-rgb) / .2)", color: "var(--c-text)", minHeight: "220px" }}>
              <span style={{ font: "600 var(--t-title)/1.1 'Bricolage Grotesque', sans-serif" }}>{"Un bot nuevo"}</span>
              <span style={{ fontSize: "var(--t-ui)", lineHeight: "1.45", color: "var(--c-text-2)" }}>{"Descríbelo como a un compañero nuevo, o empieza de una plantilla: contable, atención al cliente, investigador…"}</span>
              <span style={{ fontSize: "var(--t-ui)", fontWeight: "600", color: "var(--c-accent-ink)" }}>{"Crear →"}</span>
            </a>
          </div>
        </section>
        <EquipoPeople peers={peers} />
      </main>
      {invite ? <InviteSheet onClose={() => setInvite(false)} /> : null}
    </Shell>
  );
}

/** `row`: this bot in the sidebar's model (state, how many things of it wait for you); `ask`: the oldest of them. */
function BotCard({ bot, row, ask, expert, account = true }) {
  const activity = useActivity(bot.id);
  const work = row?.state === "working";
  const wait = (row?.waiting || 0) > 0;
  const waits = ask?.title ? `Te espera: ${ask.title.charAt(0).toLowerCase() + ask.title.slice(1)}` : "Te espera";
  const state = work ? (cap(activity?.verb) || "Trabajando") + (wait ? " · te espera" : "") : wait ? waits : STATE[bot.status] || "Libre";
  const idle = !work && !wait;
  return (
    <article style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "20px", borderRadius: "var(--r-2xl)", background: "var(--c-card)", boxShadow: wait ? "0 0 0 1.5px #FFC93C" : "0 1px 2px rgba(18,19,26,.04)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
        <Shape bot={bot} size={48} style={{ opacity: idle ? 0.55 : 1, animation: work ? "breathe 2.6s ease-in-out infinite" : "none" }} />
        {/* Autonomy only where it is not the usual («Hace y te avisa» on every card was noise). */}
        {autonomyShown(bot.autonomy) ? <span title={autonomyHint(bot.autonomy)} style={{ height: "24px", padding: "0 10px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-pill)", background: "var(--c-chip)", fontSize: "var(--t-caption)", fontWeight: "500", color: "var(--c-text-2)", whiteSpace: "nowrap" }}>{autonomyLabel(bot.autonomy)}</span> : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
        <h3 style={{ margin: "0", font: "600 var(--t-heading)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{bot.name}</h3>
        <span style={{ fontSize: "var(--t-ui)", color: "var(--c-text-2)" }}>{bot.role}</span>
      </div>
      {bot.status === "limitado" ? (
        <>
          <LimitLine limited={bot.limited} style={{ fontSize: "var(--t-ui)" }} />
          {wait ? <span style={{ marginTop: "-8px", fontSize: "var(--t-ui)", color: "var(--c-honey-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={waits}>{waits}</span> : null}
        </>
      ) : (
        <span style={{ fontSize: "var(--t-ui)", color: wait ? "var(--c-honey-text)" : work ? "var(--c-text-2)" : "var(--c-text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={state}>{state}</span>
      )}
      {/* Modo experto says the real state: no AI account, no model at work («sin cuenta»). */}
      {expert && (bot.model?.label || !account) ? <span style={{ marginTop: "-6px", font: "500 var(--t-caption)/1.3 'Geist Mono', monospace", color: "var(--c-text-3)" }}>{account || bot.engine ? [bot.model?.label || "sin modelo", bot.thinking || "equilibrado", bot.engine || "equipo"].join(" · ") : "sin cuenta de IA"}</span> : null}
      <div style={{ marginTop: "auto", display: "flex", gap: "8px", paddingTop: "12px", borderTop: "1px solid rgb(var(--c-ink-rgb) / .06)" }}>
        <a href={`/chat/${encodeURIComponent(bot.id)}`} style={{ flex: "1", height: "38px", display: "grid", placeItems: "center", borderRadius: "var(--r-pill)", background: "var(--c-btn)", color: "var(--c-btn-text)", fontSize: "var(--t-ui)", fontWeight: "600" }}>{"Hablar"}</a>
        <a href={`/equipo/${encodeURIComponent(bot.id)}`} style={{ flex: "1", height: "38px", display: "grid", placeItems: "center", border: "1px solid rgb(var(--c-ink-rgb) / .14)", borderRadius: "var(--r-pill)", color: "var(--c-text)", fontSize: "var(--t-ui)", fontWeight: "500" }}>{"Ficha"}</a>
      </div>
    </article>
  );
}
