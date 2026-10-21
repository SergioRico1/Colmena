import { bump } from "../../lib/motion.js";
import { BotPresence } from "../v2/Presence.jsx";
import { useEffect, useRef } from "react";
import { plain } from "../room/Markdown.jsx";
import { useAction, useStore } from "../../lib/store.jsx";
import { post } from "../../lib/api.js";
import { navigate } from "../../lib/router.jsx";
import { avatarStyle, botById, initial } from "../../lib/bots.js";
import { ago } from "../../lib/format.js";

// Avisos (OpenMuse background-updates, MIT: licenses/OpenMuse.txt): the server only writes
// one when something ends, needs you or fails, plus Atlas's grouped round. Data from
// /api/state: `unread` and the 10 latest `notifications`.

const LABEL = { done: "Terminado", needs: "Te necesita", failed: "Bloqueado", digest: "Ronda de Atlas" };
const TONE = {
  done: { background: "#FFFFFF", border: "1px solid #DCE0E8" },
  digest: { background: "#FFFFFF", border: "1px solid #DCE0E8" },
  needs: { background: "#FFF4D1", border: "1px solid #F2D27A" },
  failed: { background: "#FBE7DF", border: "1.5px solid #B4372A" },
};
const MONO_LABEL = { font: "500 12px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", color: "#555A68" };
const DARK = { display: "flex", alignItems: "center", height: "40px", padding: "0 14px", background: "#12131A", color: "#FFFFFF", border: "0", borderRadius: "10px", cursor: "pointer", fontWeight: "600", fontSize: "14px" };
const LIGHT = { display: "flex", alignItems: "center", height: "40px", padding: "0 14px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "10px", cursor: "pointer", fontSize: "14px" };

function Face({ bot, size = 32 }) {
  return (
    <BotPresence bot={bot} size={size} />
  );
}

const target = (n) => n.url || (n.missionId ? `/sala/${n.missionId}` : "/bandeja");

/** Marks notifications as read; returns { read, readAll, busy }. */
export function useMarkRead() {
  const { act, busy } = useAction();
  return {
    busy,
    read: (ids) => act(() => post("/notifications/read", { ids })),
    readAll: () => act(() => post("/notifications/read", { all: true })),
  };
}

/** «Una novedad»: the latest unread notification, with «Ver misión» and «N más». */
export function NotificationCard({ onMore, style, filter = null }) {
  const { notifications = [], unread = 0, bots } = useStore();
  const { read, busy } = useMarkRead();
  const latest = notifications.find((n) => !n.read && (!filter || filter(n)));
  if (!latest) return null;
  const bot = botById(bots, latest.botId) || botById(bots, "atlas");
  const more = Math.max(0, unread - 1);
  const open = async () => {
    await read([latest.id]);
    navigate(target(latest));
  };
  return (
    <section aria-label="Una novedad" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 16px", padding: "14px 18px", borderRadius: "16px", ...(TONE[latest.kind] || TONE.done), ...style }}>
      <Face bot={bot} size={36} />
      <div style={{ flex: "1 1 300px", minWidth: "0", display: "flex", flexDirection: "column", gap: "5px" }}>
        <span style={MONO_LABEL}>{`Una novedad · ${LABEL[latest.kind] || "Aviso"} · ${ago(latest.createdAt)}`}</span>
        <strong style={{ fontSize: "16px", lineHeight: "1.35", overflowWrap: "anywhere" }}>{latest.title}</strong>
        {latest.text ? <span style={{ fontSize: "14px", lineHeight: "1.45", color: "#2B2D36", overflowWrap: "anywhere" }}>{plain(latest.text)}</span> : null}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
        <button type="button" disabled={busy} onClick={open} style={DARK}>{latest.missionId ? "Ver misión" : "Ver"}</button>
        {more ? <button type="button" onClick={onMore} aria-haspopup="dialog" style={LIGHT}>{`${more} más`}</button> : null}
        <button type="button" disabled={busy} aria-label="Marcar como leída" title="Marcar como leída" onClick={() => read([latest.id])} style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "10px", cursor: "pointer", color: "#4A4F5C" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
    </section>
  );
}

/** Bell button for the top bar: same look as the «Bandeja» button, with the unread count. */
export function BellButton({ onClick, expanded }) {
  const { unread = 0 } = useStore();
  return (
    <button type="button" onClick={onClick} aria-haspopup="dialog" aria-expanded={expanded ? "true" : "false"} aria-label={unread ? `Avisos: ${unread} sin leer` : "Avisos"} style={{ display: "flex", alignItems: "center", gap: "8px", height: "46px", padding: "0 16px", background: "#FFFFFF", border: "1px solid #DCE0E8", borderRadius: "12px", cursor: "pointer", fontWeight: "600", fontSize: "14px", color: "#12131A" }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" /></svg>
      Avisos
      {unread ? <span key={unread} className={bump("avisos", unread)} style={{ minWidth: "22px", height: "22px", padding: "0 6px", borderRadius: "11px", background: "#12131A", color: "#FFC93C", font: "600 12px/22px 'Geist Mono', monospace", textAlign: "center" }}>{unread}</span> : null}
    </button>
  );
}

/** Side panel with the latest notifications (style of Bandeja's «Vista previa» panel). */
export function NotificationsPanel({ open, onClose }) {
  const { notifications = [], unread = 0, bots } = useStore();
  const { read, readAll, busy } = useMarkRead();
  const closeRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const go = async (n) => {
    if (!n.read) await read([n.id]);
    onClose();
    navigate(target(n));
  };
  return (
    <>
      <button type="button" aria-label="Cerrar avisos" tabIndex={-1} onClick={onClose} style={{ position: "fixed", inset: "0", zIndex: "40", background: "rgba(18,19,26,0.18)", border: "0", cursor: "default" }} />
      <aside role="dialog" aria-modal="true" aria-label="Avisos" style={{ position: "fixed", top: "0", right: "0", bottom: "0", zIndex: "41", width: "min(440px, 100vw)", overflowY: "auto", background: "#FFFFFF", borderLeft: "1px solid #DCE0E8", boxShadow: "-18px 0 40px rgba(18,19,26,.12)", padding: "24px", display: "flex", flexDirection: "column", gap: "18px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <span style={MONO_LABEL}>{unread ? `Avisos · ${unread} sin leer` : "Avisos"}</span>
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            {unread ? <button type="button" disabled={busy} onClick={readAll} style={{ height: "34px", padding: "0 10px", background: "transparent", border: "0", borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontWeight: "600", color: "#1F4FD1" }}>Marcar todo como leído</button> : null}
            <button ref={closeRef} type="button" aria-label="Cerrar" onClick={onClose} style={{ width: "40px", height: "40px", display: "grid", placeItems: "center", background: "transparent", border: "0", borderRadius: "10px", cursor: "pointer" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </span>
        </div>
        <h2 style={{ margin: "0", font: "800 28px/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>Avisos</h2>
        {notifications.length === 0 ? (
          <div style={{ border: "1px solid #DCE0E8", borderRadius: "14px", padding: "18px 16px", fontSize: "15px", lineHeight: "1.6" }}>
            Sin avisos. Te avisaremos cuando algo termine, te necesite o falle.
          </div>
        ) : (
          <div style={{ flex: "none", border: "1px solid #DCE0E8", borderRadius: "14px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {notifications.map((n, i) => {
              const bot = botById(bots, n.botId) || botById(bots, "atlas");
              return (
                <button key={n.id} type="button" onClick={() => go(n)} style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: "12px", padding: "14px 16px", background: n.read ? "#FFFFFF" : n.kind === "failed" ? "#FBE7DF" : n.kind === "needs" ? "#FFF4D1" : "#F7F8FA", border: "0", borderTop: i ? "1px solid #E6E8EE" : "0", cursor: "pointer", textAlign: "left", color: "#12131A" }}>
                  <Face bot={bot} size={28} />
                  <span style={{ minWidth: "0", display: "flex", flexDirection: "column", gap: "4px" }}>
                    <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                      <span style={{ font: "600 11px/1 'Geist Mono', monospace", letterSpacing: "0.06em", textTransform: "uppercase", padding: "4px 7px", background: n.kind === "failed" ? "#FFFFFF" : "#EEF0F4", color: n.kind === "failed" ? "#B4372A" : "#4A4F5C", borderRadius: "5px" }}>{LABEL[n.kind] || "Aviso"}</span>
                      <span style={{ fontSize: "12px", color: "#555A68" }}>{ago(n.createdAt)}</span>
                      {!n.read ? <span aria-label="Sin leer" style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#12131A" }} /> : null}
                    </span>
                    <strong style={{ fontSize: "14px", lineHeight: "1.4", fontWeight: n.read ? "600" : "700", overflowWrap: "anywhere" }}>{n.title}</strong>
                    {n.text ? <span style={{ fontSize: "13px", lineHeight: "1.45", color: "#2B2D36", overflowWrap: "anywhere" }}>{plain(n.text)}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <p style={{ margin: "0", fontSize: "12px", lineHeight: "1.5", color: "#555A68" }}>Solo avisamos cuando algo termina, te necesita o falla. Entre las 8:00 y las 20:00, Atlas repasa cada media hora lo que lleva tiempo esperando.</p>
      </aside>
    </>
  );
}
