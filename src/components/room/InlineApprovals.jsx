import { useRef, useState } from "react";
import { ArrowUpRight, ShieldAlert } from "lucide-react";
import { post } from "../../lib/api.js";
import { useAction } from "../../lib/store.jsx";
import { leave } from "../../lib/motion.js";
import { useCountdown } from "./Dots.jsx";
import { BotAvatar, ErrorLine, findBot } from "./common.jsx";

// Approvals inside the conversation that asked for them (OpenClaw inline approvals): a
// compact row per request above the composer — what, for whom, how long it waits — with
// «Sí, hazlo», «Siempre en <app>» and «Ahora no» (optionally saying why), in plain words —
// like asking a colleague. Only a send opens Revisar, to read and edit it in full. A typed
// «sí» in the chat also approves the one pending request (server: messages route).
const INLINE = new Set(["permission", "write", "memory", "read"]);
const I = { size: 14, strokeWidth: 2.3, "aria-hidden": "true" };

/** «caduca en 12 min» (red under 2 min, OpenClaw's urgent threshold). */
export function ExpiryChip({ expiresAt, style }) {
  const left = useCountdown(expiresAt ? Date.parse(expiresAt) : null);
  if (left == null) return null;
  const urgent = left < 120;
  const text = left === 0 ? "caducada" : left < 60 ? `caduca en ${left} s` : `caduca en ${Math.ceil(left / 60)} min`;
  return <span role="timer" aria-label={text} style={{ font: "500 11px/1 'Geist Mono', monospace", padding: "4px 7px", borderRadius: "5px", background: urgent ? "#FBE7DF" : "#F7F8FA", color: urgent ? "#B4372A" : "#555A68", border: "1px solid " + (urgent ? "#F1B5B7" : "#E6E8EE"), whiteSpace: "nowrap", ...style }}>{text}</span>;
}

function Row({ a, bots }) {
  const { act, busy, error } = useAction();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const self = useRef(null);
  const bot = findBot(bots, a.botId);
  const decide = (decision, always = false, why = "") => act(() => leave(self.current, () => post(`/approvals/${a.id}`, { decision, revision: a.revision, ...(always ? { always: true } : {}), ...(why ? { reason: why } : {}) })));
  // A send is read and edited in full in Revisar; everything else is decided right here.
  const review = a.kind === "send" || !INLINE.has(a.kind);
  const btn = { height: "38px", padding: "0 16px", borderRadius: "999px", cursor: "pointer", fontSize: "14px", fontWeight: "600", whiteSpace: "nowrap", border: "0" };
  const always = a.app ? `Siempre en ${a.app}` : `Siempre a ${bot.name}`;
  // You asked for this email yourself: it leaves on its own unless you stop it now.
  const leavesIn = useCountdown(a.autoSendAt ? Date.parse(a.autoSendAt) : null);
  const leaving = a.kind === "send" && leavesIn != null && leavesIn > 0;
  return (
    <div ref={self} id={"aprobacion-" + a.id} role="group" aria-label={`${bot.name} pide permiso: ${a.title}`} className="c-band"
      style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px 18px", background: "#FFFFFF", borderRadius: "24px", boxShadow: "0 0 0 1px rgba(255,201,60,.6), 0 0 0 6px rgba(255,201,60,.14), 0 20px 40px -24px rgba(201,138,0,.55)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <BotAvatar bot={bot} size={28} state="wait" />
        <div style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", fontSize: "13px", color: "#6B6F7A" }}>
            <strong style={{ color: "#12131A", fontWeight: "600" }}>{bot.name}</strong>
            {a.redLine ? <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 8px", borderRadius: "999px", background: "#FBEAE7", color: "#B4372A", fontSize: "12px", fontWeight: "600" }}><ShieldAlert {...I} size={12} />sale de tu cuenta</span> : <span>{"· necesita tu OK"}</span>}
          </span>
          <span style={{ fontSize: "15px", lineHeight: "1.45", color: "#12131A" }}>{a.summary || a.title}</span>
          {a.redLine && a.impact?.headline ? <span style={{ fontSize: "13px", lineHeight: "1.4", color: "#8F1D22" }}>{a.impact.headline}</span> : null}
        </div>
        <ExpiryChip expiresAt={a.expiresAt} />
      </div>
      {denying ? (
        <form className="c-enter" onSubmit={(e) => { e.preventDefault(); decide("denied", false, reason.trim()); }} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", paddingLeft: "40px" }}>
          <input autoFocus value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setDenying(false); } }}
            placeholder={`¿Por qué? Se lo diremos a ${bot.name} (opcional)`} aria-label="Por qué no"
            style={{ flex: "1 1 220px", height: "38px", padding: "0 14px", background: "#F4F4F0", border: "0", borderRadius: "999px", fontSize: "14px", outline: "none" }} />
          <button type="submit" disabled={busy} style={{ ...btn, background: "#12131A", color: "#FFFFFF" }}>No lo hagas</button>
          <button type="button" onClick={() => setDenying(false)} style={{ ...btn, background: "transparent", fontWeight: "500", color: "#5C606C" }}>Cancelar</button>
        </form>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", paddingLeft: "40px" }}>
          {leaving ? (
            <>
              <span role="timer" style={{ display: "inline-flex", alignItems: "center", gap: "8px", height: "38px", padding: "0 14px", borderRadius: "999px", background: "#F4F4F0", fontSize: "14px", fontWeight: "600" }}>
                <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#0B8A5F", animation: "halo 1.8s ease-out infinite" }} />
                {`Lo pediste tú · se envía en ${leavesIn} s`}
              </span>
              <button type="button" className="rm-focus" disabled={busy} onClick={() => decide("denied", false, "Cancelado antes de enviarse")} style={{ ...btn, background: "#12131A", color: "#FFFFFF" }}>Cancelar envío</button>
              <button type="button" className="rm-focus" disabled={busy} onClick={() => decide("approved")} style={{ ...btn, background: "rgba(18,19,26,.06)", color: "#12131A" }}>Enviar ya</button>
              <a href={`/revisar/${encodeURIComponent(a.id)}`} className="rm-focus" style={{ ...btn, display: "inline-flex", alignItems: "center", gap: "6px", background: "transparent", color: "#5C606C", fontWeight: "500", textDecoration: "none" }}>Revisarlo<ArrowUpRight {...I} /></a>
            </>
          ) : review ? (
            <a href={`/revisar/${encodeURIComponent(a.id)}`} className="rm-focus" style={{ ...btn, display: "inline-flex", alignItems: "center", gap: "6px", background: "#12131A", color: "#FFFFFF", textDecoration: "none" }}>Revisarlo<ArrowUpRight {...I} /></a>
          ) : (
            <>
              <button type="button" className="rm-focus" disabled={busy} onClick={() => decide("approved")} style={{ ...btn, background: "#12131A", color: "#FFFFFF" }}>Sí, hazlo</button>
              {a.canAlways && !a.redLine ? <button type="button" className="rm-focus" disabled={busy} onClick={() => decide("approved", true)} style={{ ...btn, background: "rgba(18,19,26,.06)", color: "#12131A" }}>{always}</button> : null}
              <button type="button" className="rm-focus" disabled={busy} onClick={() => setDenying(true)} style={{ ...btn, background: "transparent", fontWeight: "500", color: "#5C606C" }}>Ahora no</button>
            </>
          )}
          {!review && !leaving ? <span style={{ marginLeft: "auto", fontSize: "12px", color: "#8A8D96" }}>{"También puedes responder «sí» en el chat"}</span> : null}
        </div>
      )}
      <ErrorLine style={{ paddingLeft: "40px" }}>{error}</ErrorLine>
    </div>
  );
}

/** The pending approvals of this conversation that can be decided right here. */
export default function InlineApprovals({ approvals = [], bots = [] }) {
  const list = approvals.filter((a) => a.status === "pending" && a.kind !== "question" && a.kind !== "plan" && a.kind !== "secret" && a.kind !== "skill" && a.kind !== "soul");
  if (!list.length) return null;
  return (
    <section aria-label="Necesitan tu OK" style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "0 0 10px" }}>
      {list.slice(0, 3).map((a) => <Row key={a.id} a={a} bots={bots} />)}
      {list.length > 3 ? <a href="/" style={{ fontSize: "13px", fontWeight: "600", color: "#1F4FD1" }}>{`Y ${list.length - 3} más en Hoy`}</a> : null}
    </section>
  );
}
