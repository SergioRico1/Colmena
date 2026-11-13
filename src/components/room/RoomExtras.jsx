import { useEffect, useState } from "react";
import { Check } from "../Icon.js";
import Shell from "../v2/Shell.jsx";
import Composer from "../v2/chat/Composer.jsx";
import { BotMark } from "../v2/chat/Mark.jsx";
import { patch, post } from "../../lib/api.js";
import { useAction, useStore } from "../../lib/store.jsx";
import { navigate } from "../../lib/router.jsx";
import { findBot } from "./common.jsx";
import { coordinatorOf } from "../../lib/bots.js";

// Pieces of the room screen that came with the sala of your bots (design/V2Sala.dc.html,
// V3Sala): «Mientras no estabas», «Bots y reglas» and the room that waits for its first message.
export const QUEUE = [["steer", "cambian de rumbo enseguida"], ["followup", "te contestan al terminar su paso"], ["collect", "lo juntan todo y te contestan al acabar"], ["interrupt", "paran y te atienden"]];

/** «Mientras no estabas»: what happened since your last visit (the room's recap), once. */
export function useSince(id, messages) {
  const key = "colmena:seen:" + id;
  const [since] = useState(() => { try { return localStorage.getItem(key); } catch { return null; } });
  useEffect(() => () => { try { localStorage.setItem(key, new Date().toISOString()); } catch {} }, [key]);
  useEffect(() => {
    const mark = () => { try { localStorage.setItem(key, new Date().toISOString()); } catch {} };
    window.addEventListener("beforeunload", mark);
    return () => window.removeEventListener("beforeunload", mark);
  }, [key]);
  return since ? messages.filter((m) => m.role !== "user" && m.at && Date.parse(m.at) > Date.parse(since)).length : 0;
}

/** «Mientras no estabas» (V3Sala): what happened since your last visit, in ink, once. */
export function CatchUp({ count, mission, pending, id }) {
  const sentences = String(mission?.recap?.text || "").match(/[^.!?]+[.!?]?/g)?.map((s) => s.trim()).filter(Boolean) || [];
  if (count < 2 || !sentences.length) return null;
  const need = pending.filter((a) => a.status === "pending");
  const vote = mission?.mode === "debate" && mission?.status === "awaiting_choice";
  return (
    <section aria-label="Mientras no estabas" style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "14px", padding: "18px 20px", borderRadius: "var(--r-xl)", background: "var(--c-btn)", color: "var(--c-btn-text)", animation: "rise .4s ease-out" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
        <span aria-hidden="true" style={{ width: "18px", height: "18px", background: "var(--c-card)", clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)" }} />
        <span style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>{"Mientras no estabas"}</span>
        <span style={{ fontSize: "var(--t-meta)", color: "#C9CBD3" }}>{`${count} mensajes${need.length ? ` · ${need.length} te ${need.length === 1 ? "necesita" : "necesitan"}` : ""}`}</span>
        <span style={{ flex: "1" }} />
        {vote ? <a href={`/debate/${id}`} style={{ height: "32px", padding: "0 12px", display: "inline-flex", alignItems: "center", borderRadius: "var(--r-pill)", background: "var(--c-card)", color: "var(--c-text)", fontSize: "var(--t-meta)", fontWeight: 600, textDecoration: "none" }}>{"Ir a la votación"}</a> : null}
      </div>
      <ul style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: "4px", fontSize: "var(--t-ui)", lineHeight: "1.5", color: "#E6E7EC" }}>
        {sentences.slice(0, 3).map((t, i) => <li key={i}>{t}</li>)}
        {need.length ? <li>{"Te toca: " + need[0].title.charAt(0).toLowerCase() + need[0].title.slice(1) + "."}</li> : null}
      </ul>
    </section>
  );
}

/** «Bots y reglas»: who is in the room and how it works, as sentences you change by tapping. */
export function RulesPanel({ mission, bots, memberIds }) {
  const { act, busy, error } = useAction();
  const [open, setOpen] = useState(null);
  const [saved, setSaved] = useState(false);
  const inRoom = memberIds.map((id) => findBot(bots, id)).filter(Boolean);
  const others = bots.filter((b) => b.enabled !== false && !memberIds.includes(b.id));
  const mode = mission.queueMode || "steer";
  const rules = [
    { id: "queue", pre: "Si escribes mientras trabajan, ", options: QUEUE, value: mode, post: ".", save: (v) => patch(`/missions/${mission.id}`, { queueMode: v }) },
  ];
  const choose = async (rule, v) => { setOpen(null); const ok = await act(() => rule.save(v)); if (ok !== undefined) { setSaved(true); setTimeout(() => setSaved(false), 2500); } };
  return (
    <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "22px" }}>
      <section style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <span style={{ fontSize: "var(--t-meta)", fontWeight: "500", color: "var(--c-text-3)" }}>{`Bots en la sala · ${inRoom.length}`}</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {inRoom.map((b) => (
            <a key={b.id} href={`/colmena/${b.id}`} style={{ display: "flex", alignItems: "center", gap: "8px", height: "40px", padding: "0 14px 0 10px", borderRadius: "var(--r-pill)", background: "var(--c-hover)", fontSize: "var(--t-ui)", fontWeight: "600" }}>
              <BotMark bot={b} size={18} />{b.name}
            </a>
          ))}
        </div>
        {others.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {others.map((b) => (
              <button key={b.id} type="button" disabled={busy} onClick={() => act(() => post(`/missions/${mission.id}/members`, { botId: b.id }))} style={{ display: "flex", alignItems: "center", gap: "6px", height: "34px", padding: "0 12px 0 8px", border: 0, borderRadius: "var(--r-pill)", background: "transparent", boxShadow: "inset 0 0 0 1px rgb(var(--c-ink-rgb) / .12)", cursor: "pointer", fontSize: "var(--t-meta)", color: "var(--c-text-2)" }}>
                <BotMark bot={b} size={14} />{"+ " + b.name}
              </button>
            ))}
          </div>
        ) : null}
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <span style={{ fontSize: "var(--t-meta)", fontWeight: "500", color: "var(--c-text-3)" }}>{"Cómo funciona esta sala · toca lo subrayado para elegir"}</span>
        {rules.map((r) => {
          const current = r.options.find(([v]) => v === r.value)?.[1] || r.options[0][1];
          return (
            <div key={r.id} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <p style={{ margin: 0, fontSize: "var(--t-lead)", lineHeight: "1.55" }}>
                {r.pre}
                <button type="button" aria-expanded={open === r.id ? "true" : "false"} onClick={() => setOpen(open === r.id ? null : r.id)} style={{ padding: "0 4px", border: 0, borderRadius: "var(--r-sm)", background: open === r.id ? "rgba(255,201,60,.25)" : "transparent", cursor: "pointer", font: "inherit", fontWeight: 600, textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: "4px" }}>{current}</button>
                {r.post}
              </p>
              {open === r.id ? (
                <div role="listbox" style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "4px", borderRadius: "var(--r-lg)", background: "var(--c-sunken)", animation: "rise .2s ease-out" }}>
                  {r.options.map(([v, label]) => {
                    const on = v === r.value;
                    return (
                      <button key={v} type="button" role="option" aria-selected={on ? "true" : "false"} onClick={() => choose(r, v)} style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "44px", padding: "0 12px", border: 0, borderRadius: "var(--r-md)", background: on ? "var(--c-card)" : "transparent", boxShadow: on ? "0 1px 3px rgba(18,19,26,.12)" : "none", cursor: "pointer", textAlign: "left", fontSize: "var(--t-ui)" }}>
                        <span aria-hidden="true" style={{ width: "18px", height: "18px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: on ? "#12131A" : "transparent", boxShadow: on ? "none" : "inset 0 0 0 1.5px rgb(var(--c-ink-rgb) / .2)" }}>
                          <Check size={9} weight="bold" color="#FFFFFF" style={{ opacity: on ? 1 : 0 }} />
                        </span>
                        {label.charAt(0).toUpperCase() + label.slice(1)}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
        <p style={{ margin: 0, fontSize: "var(--t-lead)", lineHeight: "1.55", color: "var(--c-text-2)" }}>{mission.safety === "avisar" ? "Para enviar algo fuera o gastar dinero, te avisan antes y esperan tu OK." : "Para enviar algo fuera o gastar dinero, siempre esperan tu OK."}</p>
        {saved ? <span role="status" style={{ fontSize: "var(--t-ui)", color: "var(--c-ok-ink)" }}>{`Guardado. ${coordinatorOf(bots)} lo tendrá en cuenta desde ahora.`}</span> : null}
        {error ? <span role="alert" style={{ fontSize: "var(--t-ui)", color: "var(--c-error)" }}>{error}</span> : null}
      </section>
    </div>
  );
}

/** A room chosen in «Nueva sala»: its name and bots, waiting for the first message. */
export function NewRoom({ query }) {
  const { bots, run } = useStore();
  const ids = String(query.bots || "").split(",").filter((b) => bots.some((x) => x.id === b));
  const name = String(query.nombre || "").slice(0, 60) || "sala";
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const members = ids.map((b) => findBot(bots, b));
  const submit = async (e) => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const created = await run(() => post("/missions", { prompt: text.trim(), title: name, mode: "equipo", botIds: ids.filter((b) => b !== "atlas"), safety: "preguntar" }));
      const m = created?.mission || created;
      if (m?.id) { await patch(`/missions/${m.id}`, { room: name }).catch(() => {}); navigate(`/sala/${m.id}`, { replace: true }); }
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Shell active="chats" scroll={false}>
      <div style={{ display: "flex", height: "100%" }}>
        <section style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column" }}>
          <header style={{ flex: "none", display: "flex", flexDirection: "column", gap: "2px", padding: "14px 26px", borderBottom: "1px solid rgb(var(--c-ink-rgb) / .06)" }}>
            <h1 style={{ margin: 0, fontSize: "var(--t-lead)", fontWeight: 600, lineHeight: 1.2 }}>{"# " + name}</h1>
            <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{"Sala nueva · empieza con tu primer mensaje"}</span>
          </header>
          <div style={{ flex: "1", display: "flex", flexDirection: "column", justifyContent: "flex-end", width: "100%", maxWidth: "840px", margin: "0 auto", padding: "22px clamp(20px, 4vw, 44px)", gap: "16px" }}>
            <span style={{ display: "flex", gap: "10px" }}>{members.map((b) => <BotMark key={b.id} bot={b} size={34} />)}</span>
            <strong style={{ font: "600 var(--t-headline)/1.05 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.03em" }}>{`Sala con ${members.map((b) => b.name).join(", ").replace(/, ([^,]*)$/, " y $1")}`}</strong>
            <span style={{ fontSize: "var(--t-read)", lineHeight: "1.5", color: "var(--c-text-3)" }}>{`Escribe qué necesitáis. ${coordinatorOf(bots)} reparte el trabajo y todos lo veis aquí.`}</span>
            {error ? <span role="alert" style={{ color: "var(--c-error)" }}>{error}</span> : null}
          </div>
          <Composer value={text} onChange={setText} onSubmit={submit} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} label="Primer mensaje de la sala" placeholder={`Mensaje en #${name} · qué necesitáis`} busy={busy} v3 />
        </section>
      </div>
    </Shell>
  );
}
