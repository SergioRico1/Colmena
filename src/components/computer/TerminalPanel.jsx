import { useCallback, useEffect, useState } from "react";
import { Globe, Server, Square, SquareTerminal } from "../Icon.js";
import { BotPresence } from "../v2/Presence.jsx";
import { findBot } from "../room/common.jsx";
import { get, post } from "../../lib/api.js";
import { TERM } from "../../lib/palette4.js";

// «Terminal» in the side panel (as the macOS app of OpenClaw keeps a bot's commands in the
// app): every command the bots ran in this chat or room, in order — who, what, how it ended
// and the end of what it printed. It only shows: each command asks for your OK before it
// runs (server/computer/policy.mjs), and you answer that in the conversation.

const STATUS = {
  running: ["Ejecutando…", TERM.strong],
  waiting: ["Espera tu OK", TERM.wait],
  error: ["Falló", TERM.error],
};

/** The commands of these steps, oldest first: [{id, botId, card, status}]. */
export function commandsOf(steps = []) {
  return steps.flatMap((s) => (s.tools || []).filter((t) => t.card?.type === "command").map((t) => ({ ...t, botId: s.botId, stepAt: s.startedAt || null })));
}

const SERVER_STATUS = {
  running: ["En marcha", TERM.ok],
  starting: ["Arrancando…", TERM.info],
  stopped: ["Parado", TERM.dim],
  failed: ["No arrancó", TERM.error],
};
const SMALL_BUTTON = { height: "32px", padding: "0 12px", borderRadius: "var(--r-sm)", border: "0", cursor: "pointer", fontSize: "var(--t-meta)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "6px" };

/** Development servers of this conversation (server/projects), refreshed every few seconds. */
function useDevServers(missionId) {
  const [servers, setServers] = useState([]);
  const load = useCallback(async () => {
    if (!missionId) return;
    try { setServers((await get("/missions/" + encodeURIComponent(missionId) + "/devservers")).servers || []); } catch {}
  }, [missionId]);
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);
  return [servers, load];
}

function ServerCard({ server, onOpenBrowser, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [label, tint] = SERVER_STATUS[server.status] || SERVER_STATUS.stopped;
  const live = server.status === "running" || server.status === "starting";
  const stop = async () => {
    setBusy(true);
    try { await post("/missions/" + encodeURIComponent(server.missionId) + "/devservers/" + encodeURIComponent(server.project) + "/stop"); } catch {}
    setBusy(false);
    onChanged();
  };
  return (
    <article style={{ borderRadius: "var(--r-xl)", background: TERM.bg, color: TERM.fg, border: `1px solid ${TERM.line}`, overflow: "hidden", animation: "rise .3s ease-out" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px 16px 0", fontSize: "var(--t-meta)" }}>
        <span aria-hidden="true" style={{ width: "24px", height: "24px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", background: TERM.chip, color: TERM.strong }}><Server size={14} strokeWidth={2.2} /></span>
        <strong style={{ fontWeight: 600, color: TERM.strong, overflowWrap: "anywhere" }}>{server.project}</strong>
        <span style={{ color: TERM.dim }}>{"Servidor de desarrollo"}</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "6px", color: tint, whiteSpace: "nowrap" }}>
          {live ? <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "var(--r-circle)", background: tint }} /> : null}
          {label}{server.status === "failed" && server.exitCode != null ? ` · código ${server.exitCode}` : ""}
        </span>
      </header>
      <div style={{ padding: "10px 16px 14px", display: "flex", flexDirection: "column", gap: "10px", font: "400 var(--t-meta)/1.6 'Geist Mono', monospace" }}>
        {server.url ? <span style={{ color: live ? TERM.strong : TERM.dim, overflowWrap: "anywhere" }}>{server.url.replace(/\/$/, "")}</span> : null}
        {server.command ? <span style={{ color: TERM.dim, overflowWrap: "anywhere" }}><span aria-hidden="true">{"> "}</span>{server.command}</span> : null}
        {server.logs?.length ? (
          <details>
            <summary style={{ cursor: "pointer", color: TERM.fg, fontFamily: "Geist, sans-serif" }}>{"Ver registro"}</summary>
            <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: TERM.fg, font: "inherit", maxHeight: "220px", overflow: "auto" }}>{server.logs.join("\n")}</pre>
          </details>
        ) : null}
        {live ? (
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", fontFamily: "Geist, sans-serif" }}>
            {onOpenBrowser ? <button type="button" className="rm-focus" onClick={onOpenBrowser} style={{ ...SMALL_BUTTON, background: "var(--c-card)", color: "var(--c-text)" }}><Globe size={14} strokeWidth={2.2} aria-hidden="true" />{"Ver"}</button> : null}
            <button type="button" className="rm-focus" onClick={stop} disabled={busy} style={{ ...SMALL_BUTTON, background: TERM.hover, color: TERM.strong }}><Square size={12} strokeWidth={2.6} aria-hidden="true" />{busy ? "Parando…" : "Parar"}</button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default function TerminalPanel({ steps = [], bots = [], missionId = null, onOpenBrowser = null }) {
  const runs = commandsOf(steps);
  const [servers, reload] = useDevServers(missionId);
  const serverCards = servers.map((s) => <ServerCard key={s.id} server={s} onOpenBrowser={onOpenBrowser} onChanged={reload} />);
  if (!runs.length && !servers.length) {
    return (
      <div style={{ padding: "28px 22px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "12px" }}>
        <span aria-hidden="true" style={{ width: "44px", height: "44px", display: "grid", placeItems: "center", borderRadius: "var(--r-lg)", background: "var(--c-btn)", color: "var(--c-btn-text)" }}><SquareTerminal size={20} strokeWidth={2.2} /></span>
        <strong style={{ font: "600 var(--t-title)/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Aún no ha ejecutado nada"}</strong>
        <span style={{ fontSize: "var(--t-ui)", lineHeight: "1.55", color: "var(--c-text-3)" }}>{"Cuando un bot ejecute un comando en tu ordenador lo verás aquí, con lo que respondió. Antes de cada comando te pide permiso."}</span>
      </div>
    );
  }
  return (
    <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "12px" }}>
      {serverCards}
      {runs.map((r) => {
        const bot = findBot(bots, r.botId);
        const c = r.card || {};
        const failed = r.status === "error" || (c.exitCode != null && Number(c.exitCode) !== 0);
        const [label, tint] = STATUS[r.status === "error" || failed ? "error" : r.status] || [c.exitCode != null ? "Terminó bien" : "Hecho", TERM.ok];
        return (
          <article key={r.id} style={{ borderRadius: "var(--r-xl)", background: TERM.bg, color: TERM.fg, border: `1px solid ${TERM.line}`, overflow: "hidden", animation: "rise .3s ease-out" }}>
            <header style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px 16px 0", fontSize: "var(--t-meta)" }}>
              <BotPresence bot={bot} size={16} state={r.status === "running" ? "work" : "rest"} />
              <strong style={{ fontWeight: 600, color: TERM.strong }}>{bot?.name || "Bot"}</strong>
              <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "6px", color: tint }}>
                {r.status === "running" ? <span aria-hidden="true" style={{ width: "12px", height: "12px", borderRadius: "var(--r-circle)", border: `2px solid ${TERM.line}`, borderTopColor: TERM.strong, animation: "spin .8s linear infinite" }} /> : null}
                {label}{c.exitCode != null && failed ? ` · código ${c.exitCode}` : ""}
              </span>
            </header>
            <div style={{ padding: "10px 16px 14px", display: "flex", flexDirection: "column", gap: "6px", font: "400 var(--t-meta)/1.6 'Geist Mono', monospace" }}>
              <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: TERM.strong }}><span aria-hidden="true" style={{ color: TERM.dim }}>{"> "}</span>{c.command || c.program || "comando"}</span>
              {c.output ? <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: TERM.fg }}>{c.output}</span> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
