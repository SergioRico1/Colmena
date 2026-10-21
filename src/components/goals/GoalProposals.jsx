import React from "react";
import { post } from "../../lib/api.js";
import { useAction } from "../../lib/store.jsx";
import { navigate } from "../../lib/router.jsx";
import { botById } from "../../lib/bots.js";
import { BotAvatar, darkBtn, dueLabel, errorText, mono, textBtn, waitsForYou } from "./shared.jsx";

/** Goals proposed by a bot (suggestions kind 'goal'): wait for the person → honey shadow. */
export default function GoalProposals({ suggestions, bots }) {
  const { act, busy, error } = useAction();
  if (!suggestions.length) return null;
  const decide = async (s, decision) => {
    const result = await act(() => post(`/goals/proposals/${encodeURIComponent(s.id)}`, { decision }));
    if (decision === "accept" && result?.goal?.id) navigate(`/objetivos/${encodeURIComponent(result.goal.id)}`);
  };
  return (
    <section aria-labelledby="propuestas" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <h2 id="propuestas" style={{ margin: "0", display: "flex", alignItems: "center", gap: "8px", font: "600 18px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>
        <span style={{ width: "10px", height: "10px", borderRadius: "3px", background: "#C98A00" }} />
        {suggestions.length === 1 ? "Un objetivo propuesto te espera" : `${suggestions.length} objetivos propuestos te esperan`}
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(360px, 100%), 1fr))", gap: "22px", paddingRight: "8px", paddingBottom: "8px" }}>
        {suggestions.map((s) => {
          const bot = botById(bots, s.botId);
          const p = s.payload || {};
          const ms = p.milestones || [];
          return (
            <article key={s.id} style={{ ...waitsForYou, padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <BotAvatar bot={bot} size={24} />
                <span style={mono}>{`${bot?.name || "Un bot"} propone un objetivo`}</span>
              </span>
              <strong style={{ font: "600 19px/1.2 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{p.title}</strong>
              {p.why ? <span style={{ fontSize: "14px", lineHeight: "1.45", color: "#5C606C" }}>{p.why}</span> : null}
              {ms.length ? (
                <ol style={{ margin: "0", padding: "10px 12px", listStyle: "none", background: "#FFF4D1", borderRadius: "10px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  {ms.map((m, i) => (
                    <li key={i} style={{ display: "flex", justifyContent: "space-between", gap: "10px", fontSize: "14px", lineHeight: "1.35" }}>
                      <span>{m.title}</span>
                      {m.dueAt ? <span style={{ flex: "none", font: "500 12px/1.4 'Geist Mono', monospace", color: "#5C606C" }}>{dueLabel(m.dueAt)}</span> : null}
                    </li>
                  ))}
                </ol>
              ) : null}
              <span style={{ fontSize: "13px", color: "#5C606C" }}>{s.text}</span>
              <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                <button type="button" disabled={busy} onClick={() => decide(s, "accept")} style={{ ...darkBtn, height: "40px" }}>{s.cta || "Crear objetivo"}</button>
                <button type="button" disabled={busy} onClick={() => decide(s, "dismiss")} style={textBtn}>{"Ahora no"}</button>
              </span>
            </article>
          );
        })}
      </div>
      {error ? <span role="alert" style={errorText}>{error}</span> : null}
    </section>
  );
}
