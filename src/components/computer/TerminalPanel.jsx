import { useCallback, useEffect, useState } from "react";
import { Globe, Server, Square, SquareTerminal } from "lucide-react";
import { BotPresence } from "../v2/Presence.jsx";
import { findBot } from "../room/common.jsx";
import { get, post } from "../../lib/api.js";

// «Terminal» in the side panel (as the macOS app of OpenClaw keeps a bot's commands in the
// app): every command the bots ran in this chat or room, in order — who, what, how it ended
// and the end of what it printed. It only shows: each command asks for your OK before it
// runs (server/computer/policy.mjs), and you answer that in the conversation.

const STATUS = {
  running: ["Ejecutando…", "#FFFFFF"],
  waiting: ["Espera tu OK", "#FFC93C"],
  error: ["Falló", "#FF8A80"],
};

/** The commands of these steps, oldest first: [{id, botId, card, status}]. */
export function commandsOf(steps = []) {
  return steps.flatMap((s) => (s.tools || []).filter((t) => t.card?.type === "command").map((t) => ({ ...t, botId: s.botId, stepAt: s.startedAt || null })));
}

const SERVER_STATUS = {
  running: ["En marcha", "#7BE0B4"],
  starting: ["Arrancando…", "#FFC93C"],
  stopped: ["Parado", "#8A8D96"],
  failed: ["No arrancó", "#FF8A80"],
};
const SMALL_BUTTON = { height: "32px", padding: "0 12px", borderRadius: "999px", border: "0", cursor: "pointer", fontSize: "13px", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "6px" };

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
    <article style={{ borderRadius: "20px", background: "#12131A", color: "#E6E7EC", overflow: "hidden", animation: "rise .3s ease-out" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px 16px 0", fontSize: "13px" }}>
        <span aria-hidden="true" style={{ width: "24px", height: "24px", display: "grid", placeItems: "center", borderRadius: "8px", background: "rgba(255,255,255,.08)", color: "#FFFFFF" }}><Server size={14} strokeWidth={2.2} /></span>
        <strong style={{ fontWeight: 600, color: "#FFFFFF", overflowWrap: "anywhere" }}>{server.project}</strong>
        <span style={{ color: "#8A8D96" }}>{"Servidor de desarrollo"}</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "6px", color: tint, whiteSpace: "nowrap" }}>
          {live ? <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "50%", background: tint }} /> : null}
          {label}{server.status === "failed" && server.exitCode != null ? ` · código ${server.exitCode}` : ""}
        </span>
      </header>
      <div style={{ padding: "10px 16px 14px", display: "flex", flexDirection: "column", gap: "10px", font: "400 13px/1.6 'Geist Mono', monospace" }}>
        {server.url ? <span style={{ color: live ? "#FFFFFF" : "#8A8D96", overflowWrap: "anywhere" }}>{server.url.replace(/\/$/, "")}</span> : null}
        {server.command ? <span style={{ color: "#8A8D96", overflowWrap: "anywhere" }}><span aria-hidden="true">{"> "}</span>{server.command}</span> : null}
        {server.logs?.length ? (
          <details>
            <summary style={{ cursor: "pointer", color: "#C9CBD3", fontFamily: "Geist, sans-serif" }}>{"Ver registro"}</summary>
            <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "#C9CBD3", font: "inherit", maxHeight: "220px", overflow: "auto" }}>{server.logs.join("\n")}</pre>
          </details>
        ) : null}
        {live ? (
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", fontFamily: "Geist, sans-serif" }}>
            {onOpenBrowser ? <button type="button" className="rm-focus" onClick={onOpenBrowser} style={{ ...SMALL_BUTTON, background: "#FFFFFF", color: "#12131A" }}><Globe size={14} strokeWidth={2.2} aria-hidden="true" />{"Ver"}</button> : null}
            <button type="button" className="rm-focus" onClick={stop} disabled={busy} style={{ ...SMALL_BUTTON, background: "rgba(255,255,255,.1)", color: "#FFFFFF" }}><Square size={12} strokeWidth={2.6} aria-hidden="true" />{busy ? "Parando…" : "Parar"}</button>
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
        <span aria-hidden="true" style={{ width: "44px", height: "44px", display: "grid", placeItems: "center", borderRadius: "14px", background: "#12131A", color: "#FFFFFF" }}><SquareTerminal size={20} strokeWidth={2.2} /></span>
        <strong style={{ font: "600 20px/1.15 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Aún no ha ejecutado nada"}</strong>
        <span style={{ fontSize: "14px", lineHeight: "1.55", color: "#5C606C" }}>{"Cuando un bot ejecute un comando en tu ordenador lo verás aquí, con lo que respondió. Antes de cada comando te pide permiso."}</span>
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
        const [label, tint] = STATUS[r.status === "error" || failed ? "error" : r.status] || [c.exitCode != null ? "Terminó bien" : "Hecho", "#7BE0B4"];
        return (
          <article key={r.id} style={{ borderRadius: "20px", background: "#12131A", color: "#E6E7EC", overflow: "hidden", animation: "rise .3s ease-out" }}>
            <header style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px 16px 0", fontSize: "13px" }}>
              <BotPresence bot={bot} size={16} state={r.status === "running" ? "work" : "rest"} />
              <strong style={{ fontWeight: 600, color: "#FFFFFF" }}>{bot?.name || "Bot"}</strong>
              <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "6px", color: tint }}>
                {r.status === "running" ? <span aria-hidden="true" style={{ width: "12px", height: "12px", borderRadius: "50%", border: "2px solid rgba(255,255,255,.25)", borderTopColor: "#FFFFFF", animation: "spin .8s linear infinite" }} /> : null}
                {label}{c.exitCode != null && failed ? ` · código ${c.exitCode}` : ""}
              </span>
            </header>
            <div style={{ padding: "10px 16px 14px", display: "flex", flexDirection: "column", gap: "6px", font: "400 13px/1.6 'Geist Mono', monospace" }}>
              <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "#FFFFFF" }}><span aria-hidden="true" style={{ color: "#8A8D96" }}>{"> "}</span>{c.command || c.program || "comando"}</span>
              {c.output ? <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "#C9CBD3" }}>{c.output}</span> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
