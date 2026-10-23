import { useState } from "react";
import SettingsLayout from "../components/v2/settings/Layout.jsx";
import { BotPresence } from "../components/v2/Presence.jsx";
import { ChoiceRow, EngineLogo } from "../components/v2/settings/Engines.jsx";
import { WithMark, engineOfModel } from "../components/v2/ProviderMark.jsx";
import { useAction, useStore } from "../lib/store.jsx";
import { patch } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";

// Ajustes › Qué usa cada bot (v2): with which account each bot thinks, and — for those who
// want it — which model each family uses on Claude and OpenCode Go. Colmena still picks the
// family from the bot's role; nothing here is needed to get started.

const INK = "#12131A";
const MUTED = "#5C606C";
const FAINT = "#6B6F7A";
const LINE = "1px solid rgba(18,19,26,.06)";
const FAMILIES = [
  ["astra", "Astra", "Coordina el equipo y lo más difícil"],
  ["sol", "Sol", "Programa, analiza e investiga"],
  ["luna", "Luna", "Redacta y ayuda en el día a día"],
];

function Section({ id, title, note, children }) {
  return (
    <section aria-labelledby={id} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <h2 id={id} style={{ margin: "0 0 0 20px", fontSize: "13px", fontWeight: 500, color: FAINT }}>{title}</h2>
      <div style={{ background: "#FFFFFF", borderRadius: "26px", overflow: "hidden" }}>{children}</div>
      {note ? <p style={{ margin: "0 20px", fontSize: "13px", lineHeight: 1.5, color: FAINT }}>{note}</p> : null}
    </section>
  );
}

function BotRow({ bot, engines, team, last }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const own = engines.find((e) => e.id === bot.engine && e.connected);
  const current = own ? own.id : null;
  const model = bot.model?.label ? bot.model.label + (bot.model.reason ? " · " + bot.model.reason : "") : "Sin modelo todavía";
  const modelEngine = bot.model?.engine || (bot.model?.slug ? engineOfModel(bot.model.slug) : null);
  const shown = own?.id || team?.id || null;
  const options = [{ id: null, label: "Como el equipo", sub: team ? team.label : "La cuenta que elijas en Ajustes", icon: team ? <EngineLogo engine={team.id} size={28} /> : null }, ...engines.filter((e) => e.connected).map((e) => ({ id: e.id, label: e.label, sub: e.detail || null, icon: <EngineLogo engine={e.id} size={28} /> }))];
  return (
    <>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} disabled={act.busy || options.length < 2} onClick={() => setOpen(!open)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: "14px", minHeight: "68px", padding: "12px 20px", border: 0, borderBottom: last && !open ? 0 : LINE, background: "transparent", textAlign: "left", color: INK, cursor: options.length < 2 ? "default" : "pointer" }}>
        <BotPresence bot={bot} size={30} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
          <strong style={{ fontSize: "16px", fontWeight: 600 }}>{bot.name}</strong>
          <span style={{ display: "flex", minWidth: 0, fontSize: "13px", color: MUTED }}>{modelEngine ? <WithMark engine={modelEngine} size={13} gap="6px">{model}</WithMark> : model}</span>
        </span>
        <span style={{ flex: "none", fontSize: "15px", color: MUTED }}>{shown && own ? <WithMark engine={shown}>{own.label}</WithMark> : "Como el equipo"}</span>
        {options.length > 1 ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9A9DA6" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", transition: "transform .2s ease", transform: open ? "rotate(180deg)" : "none" }}><path d="m6 9 6 6 6-6" /></svg> : null}
      </button>
      {open ? (
        <div role="listbox" aria-label={"Con qué piensa " + bot.name} style={{ display: "flex", flexDirection: "column", gap: "2px", margin: "0 12px 12px", padding: "6px", borderRadius: "18px", background: "#F4F4F0", animation: "rise .2s ease-out" }}>
          {options.map((o) => {
            const on = o.id === current;
            return (
              <button key={String(o.id)} type="button" role="option" aria-selected={on} onClick={() => { setOpen(false); if (!on) act.act(() => patch(`/bots/${encodeURIComponent(bot.id)}`, { engine: o.id })); }}
                style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "52px", padding: "6px 14px", border: 0, borderRadius: "14px", cursor: "pointer", textAlign: "left", color: INK, background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 3px rgba(18,19,26,.12)" : "none" }}>
                {o.icon || null}
                <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
                  <strong style={{ fontSize: "15px", fontWeight: 600 }}>{o.label}</strong>
                  {o.sub ? <span style={{ fontSize: "13px", color: MUTED }}>{o.sub}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {act.error ? <p role="alert" style={{ margin: 0, padding: "0 20px 12px", fontSize: "14px", color: "#B4231A" }}>{act.error}</p> : null}
    </>
  );
}

function FamilyRows({ engine, label, catalog, pins }) {
  const act = useAction();
  const own = pins?.[engine] || {};
  const pick = (family, slug) => {
    const next = { ...own };
    if (slug) next[family] = slug;
    else delete next[family];
    act.act(() => patch("/ai/engines", { pins: { [engine]: next } }));
  };
  return (
    <Section id={"fam-" + engine} title={"Modelos de " + label} note="Colmena elige la familia por la función de cada bot. «Automático» usa siempre el modelo recomendado.">
      {FAMILIES.map(([family, name, sub], i) => {
        const pinned = catalog.find((m) => m.slug === own[family]);
        const automatic = pinned ? null : catalog.find((m) => m.families?.includes(family));
        return (
          <ChoiceRow key={family} title={name} label={name + " en " + label} last={i === FAMILIES.length - 1} busy={act.busy}
            value={pinned ? pinned.label : "Automático" + (automatic ? " · " + automatic.label : "")} valueEngine={engine}
            current={pinned ? pinned.slug : null}
            options={[{ id: null, label: "Automático", sub, icon: <EngineLogo engine={engine} size={28} /> }, ...catalog.map((m) => ({ id: m.slug, label: m.label, sub: m.utility ? "El más ligero y barato" : null, icon: <EngineLogo engine={engine} size={28} /> }))]}
            onPick={(slug) => pick(family, slug)} />
        );
      })}
      {act.error ? <p role="alert" style={{ margin: 0, padding: "10px 20px", fontSize: "14px", color: "#B4231A" }}>{act.error}</p> : null}
    </Section>
  );
}

export default function AjustesIAV2() {
  const { bots = [], ai = null } = useStore();
  const engines = ai?.engines || [];
  const team = engines.find((e) => e.id === ai?.primary) || null;
  const list = bots.filter((b) => b.enabled !== false && b.audience !== "yo");
  return (
    <SettingsLayout active="inteligencia" back="inteligencia" title="Qué usa cada bot" lead={team ? `Tu equipo piensa con ${team.label}. Cambia aquí la cuenta de un bot concreto.` : "Conecta una cuenta en Inteligencia para que tus bots puedan pensar."}>
        <Section id="bots-t" title="Tu equipo">
          {list.map((b, i) => <BotRow key={b.id} bot={b} engines={engines} team={team} last={i === list.length - 1} />)}
        </Section>
        {engines.filter((e) => e.connected && ai?.catalog?.[e.id]).map((e) => (
          <FamilyRows key={e.id} engine={e.id} label={e.label} catalog={ai.catalog[e.id]} pins={ai.pins} />
        ))}
        <Section id="otros-t" title="Más">
          <a href="/ajustes/ia-v1" onClick={(e) => { e.preventDefault(); navigate("/ajustes/ia-v1"); }} style={{ display: "flex", alignItems: "center", gap: "16px", minHeight: "64px", padding: "12px 20px", color: INK, textDecoration: "none" }}>
            <span style={{ flex: 1, fontSize: "16px" }}>Clave de OpenAI y modelo de este ordenador</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9A9DA6" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: "rotate(-90deg)" }}><path d="m6 9 6 6 6-6" /></svg>
          </a>
        </Section>
    </SettingsLayout>
  );
}
