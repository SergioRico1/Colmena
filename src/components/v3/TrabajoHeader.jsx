import { navigate } from "../../lib/router.jsx";
import { useStore } from "../../lib/store.jsx";
import { C, line } from "../../lib/theme.js";
import { B, H1, LEAD, ONE } from "../../lib/ui4.js";
import { elapsed, workingNow } from "../../lib/workingNow.js";
import { needsOf } from "../v2/needs.js";
import BotFace from "../BotFace.jsx";
import { Plus } from "../Icon.js";

// Colmena 4 · the head of «Trabajo» (design/v4): the place's title and the one sentence that
// explains it, the main action on the right, «Trabajando ahora» (the bots at work this moment,
// what each is doing and since when, then the ones waiting for you) and the three tabs ordered
// by time: once (Tareas), every so often (Rutinas), long term (Objetivos).

export const TRABAJO_TABS = [
  { id: "tareas", label: "Tareas", hint: "una vez", href: "/trabajo" },
  { id: "rutinas", label: "Rutinas", hint: "se repiten", href: "/trabajo/rutinas" },
  { id: "objetivos", label: "Objetivos", hint: "a largo plazo", href: "/trabajo/objetivos" },
];

/** The page column every Trabajo screen sits in: one width for the three tabs, so the left
 *  edge of the text does not move when you switch. */
export const trabajoMain = () => ({ maxWidth: "1180px", margin: "0 auto", padding: "28px clamp(20px, 3.4vw, 40px) 56px", display: "flex", flexDirection: "column", gap: "20px" });

const go = (href) => (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  e.preventDefault();
  navigate(href);
};

/** `tab`: tareas | rutinas | objetivos. `action`: { label, onClick } for the ink button. `counts`: optional { tareas: n, … }. */
export default function TrabajoHeader({ tab, action = null, counts = null }) {
  return (
    <>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "12px 16px" }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={H1}>{"Trabajo"}</h1>
          <p style={LEAD}>{"Todo lo que hacen tus bots: una vez, cada cierto tiempo o a largo plazo."}</p>
        </div>
        {action ? (
          <button type="button" onClick={action.onClick} className="u4-pri" style={{ ...B.primary, ...B.lg }}>
            <Plus size={16} weight="bold" />
            {action.label}
          </button>
        ) : null}
      </header>
      <WorkingStrip />
      <nav aria-label="Partes de Trabajo" className="r-scroll-x" style={{ display: "flex", gap: "2px", borderBottom: line(), overflowX: "auto" }}>
        {TRABAJO_TABS.map((t) => {
          const on = t.id === tab;
          const n = counts?.[t.id];
          return (
            <a key={t.id} href={t.href} onClick={go(t.href)} aria-current={on ? "page" : undefined}
              style={{ flex: "none", height: "40px", padding: "0 12px", display: "inline-flex", alignItems: "center", gap: "8px", borderBottom: `2px solid ${on ? C.text : "transparent"}`, marginBottom: "-1px", color: on ? C.text : C.text2, fontSize: "var(--t-ui)", fontWeight: on ? 600 : 500 }}>
              {t.label}
              <span style={{ fontSize: "var(--t-caption)", fontWeight: 400, color: C.text3 }}>{t.hint}</span>
              {n ? <span style={{ minWidth: "20px", height: "20px", padding: "0 6px", display: "grid", placeItems: "center", borderRadius: "var(--r-pill)", background: C.chip, fontSize: "var(--t-micro)", fontWeight: 600, color: C.text, fontVariantNumeric: "tabular-nums" }}>{n}</span> : null}
            </a>
          );
        })}
      </nav>
    </>
  );
}

/**
 * «Trabajando ahora»: one card per bot at work (its face working, what it does, for how long),
 * then the bots something of which waits for you (honey: it is yours to move). From the state
 * the store has (lib/workingNow.js): no new server data.
 */
export function WorkingStrip() {
  const store = useStore();
  const working = workingNow(store);
  const busy = new Set(working.map((w) => w.bot.id));
  const { items } = needsOf(store);
  const waitingBots = [...new Set(items.map((i) => i.botId).filter(Boolean))].filter((id) => !busy.has(id)).map((id) => (store.bots || []).find((b) => b.id === id)).filter(Boolean);
  const waitsFor = (id) => items.filter((i) => i.botId === id).length;
  const cards = [
    ...working.map((w) => ({ key: w.bot.id, bot: w.bot, state: "work", what: w.what, where: w.place, when: elapsed(w.since), href: w.href })),
    ...waitingBots.map((b) => ({ key: b.id, bot: b, state: "wait", what: waitsFor(b.id) === 1 ? "Te espera" : `${waitsFor(b.id)} cosas te esperan`, where: b.role || "", when: "", href: `/chat/${b.id}` })),
  ].slice(0, 8);
  const head = working.length ? `${working.length} ${working.length === 1 ? "bot" : "bots"} trabajando` : "Nadie trabaja ahora mismo";
  return (
    <section aria-labelledby="working-t" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <h2 id="working-t" style={{ margin: 0, fontSize: "var(--t-caption)", fontWeight: 600, color: C.text3 }}>
        {"Trabajando ahora"}<span style={{ fontWeight: 400 }}>{" · " + head}</span>
      </h2>
      {cards.length ? (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "8px" }}>
          {cards.map((c) => (
            <li key={c.key}>
              <a href={c.href} onClick={go(c.href)} className={c.state === "wait" ? "u4-honey" : "u4-row"}
                style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px 8px 8px", borderRadius: "var(--r-md)", border: c.state === "wait" ? `1px solid ${C.honeyRing}` : line(), background: c.state === "wait" ? C.honeySoft : C.card, color: C.text }}>
                <BotFace bot={c.bot} size={32} state={c.state} decorative />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                    <strong style={{ ...ONE, fontSize: "var(--t-ui)", fontWeight: 600 }}>{c.bot.name}</strong>
                    {c.when ? <span style={{ marginLeft: "auto", flex: "none", fontSize: "var(--t-caption)", color: C.text3, fontVariantNumeric: "tabular-nums" }}>{c.when}</span> : null}
                  </span>
                  <span style={{ ...ONE, fontSize: "var(--t-caption)", color: c.state === "wait" ? C.honeyText : C.text3, fontWeight: c.state === "wait" ? 600 : 400 }}>{c.what}{c.where ? <span style={{ fontWeight: 400, color: C.text3 }}>{" · " + c.where}</span> : null}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** A bot as the boards draw it at small sizes: its flat shape, breathing while it works. */
export function BotDot({ bot, size = 14, work = false, style = null }) {
  return <BotFace bot={bot} size={size} state={work ? "work" : "rest"} decorative style={{ display: "inline-block", ...style }} />;
}
