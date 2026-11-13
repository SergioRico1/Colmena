import { useClickAway } from "../../../lib/useClickAway.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../../lib/store.jsx";
import { navigate } from "../../../lib/router.jsx";
import { needsYou } from "../../../lib/format.js";
import { listRows } from "../../../lib/threads.js";
import { isBotChat, isTask } from "../../../lib/rooms.js";
import { patch } from "../../../lib/api.js";
import { shareUrl } from "../../../lib/peers.js";
import { exportConversation } from "../../../lib/exportConversation.jsx";
import { promise as toastWork, reversible } from "../../../lib/undoToast.js";
import { shapeOf } from "../Presence.jsx";
import { AcceptSheet, InviteSheet } from "../people/InviteSheets.jsx";
import { NewConversation, chatUrl, salaUrl, whenLabel } from "./ConvList.jsx";
import { RowTile } from "./Mark.jsx";
import NewRoomSheet from "../../v3/team/NewRoomSheet.jsx";

// Colmena 3 · «Chats» (design/V3Chats.dc.html): every conversation in one place — with a bot,
// a room of the team, other people — by kind (tabs with counts) and by time (Fijados, Hoy,
// Esta semana, Antes). «···» (or right click) pins, renames, silences, takes it to a room,
// exports or archives; archiving and silencing undo from their notice. On the right, «Empezar
// a hablar»: a bot, a room or a person. Ctrl N's «Chat con un bot» / «Sala» open the sheet here.
const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const DAY = 864e5;
const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const people = (list) => list.length <= 1 ? list.join("") : list.slice(0, -1).join(", ") + " y " + list[list.length - 1];

/** Opens «Nuevo chat» / «Nueva sala» when the sidebar's «Nuevo» asks for it (Ctrl N). */
export function useNewConversationEvent(open) {
  const ref = useRef(open);
  ref.current = open;
  useEffect(() => {
    const onOpen = (e) => ref.current(e?.detail?.kind === "sala" ? "sala" : "chat");
    window.addEventListener("colmena:new-conversation", onOpen);
    return () => window.removeEventListener("colmena:new-conversation", onOpen);
  }, []);
}

export default function ChatsHome() {
  const { missions = [], bots = [], notifications = [], peers = null, settings = {}, run, ready } = useStore();
  const [tab, setTab] = useState("todos");
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(null); // row key with «···» open
  const [renaming, setRenaming] = useState(null); // {key, value}
  const [sheet, setSheet] = useState(null); // {mode, preset}
  const [peerSheet, setPeerSheet] = useState(null);
  const hovered = useRef(null);
  useNewConversationEvent((mode) => setSheet({ mode, preset: [] }));
  // /chats?nuevo=sala (an old link, a notice) opens the sheet too.
  useEffect(() => {
    const kind = new URLSearchParams(location.search).get("nuevo");
    if (kind === "chat" || kind === "sala") setSheet({ mode: kind, preset: [] });
  }, []);
  const botOf = (id) => bots.find((b) => b.id === id) || null;
  const pinned = Array.isArray(settings.pinned) ? settings.pinned : [];
  const unreadOf = (id) => notifications.filter((n) => !n.read && n.missionId === id && (n.kind === "mention" || n.kind === "message")).length;

  // One row per bot (its single chat), each room and each conversation with people.
  const rows = useMemo(() => {
    const out = [];
    for (const m of listRows(missions)) {
      // A chat with one bot (its thread or a private one) or a room; a task lives in Trabajo (lib/rooms.js).
      if (isTask(m)) continue;
      const isBot = isBotChat(m);
      const b = isBot ? botOf(m.botIds[0]) : null;
      const href = isBot ? chatUrl(m) : salaUrl(m);
      const count = (m.botIds || []).length;
      const attention = needsYou(m);
      const unread = unreadOf(m.id);
      out.push({
        key: m.id, m, href, type: isBot ? "bots" : "salas", bot: b,
        name: isBot ? b?.name || "Bot" : "# " + (m.room || m.title || "sala"),
        kind: isBot ? (m.incognito ? "De incógnito" : b?.role || "Bot") : `Sala · ${count === 1 ? "1 bot" : count + " bots"}`,
        preview: m.narration?.text || (isBot ? m.lastLine || m.title : m.activityLine || m.title) || "",
        at: m.rowAt || m.updatedAt || m.createdAt,
        busy: m.status === "running" || m.status === "planning",
        attention, badge: attention ? String(m.waiting || 1) : unread ? String(unread) : null,
        pinHref: isBot ? `/chat/${m.botIds[0]}` : salaUrl(m),
      });
    }
    for (const s of peers?.shares || []) {
      if (s.removed || s.left) continue;
      const others = (s.members || []).filter((p) => !p.me);
      const dm = s.kind === "dm";
      const me = s.members?.find((p) => p.me)?.name;
      const who = s.lastFrom ? (s.lastFrom === me ? "Tú: " : !dm ? s.lastFrom.split(" ")[0] + ": " : "") : "";
      const typing = s.typing?.length ? s.typing.map((n) => n.split(" ")[0]).join(", ") + (s.typing.length > 1 ? " escriben…" : " está escribiendo…") : null;
      out.push({
        key: s.id, share: s, href: shareUrl(s.id), type: "personas", person: dm ? others[0]?.name || s.title : null,
        name: dm ? s.title : "# " + s.title,
        kind: dm ? "Persona · su Colmena" : "Con " + people(others.map((p) => p.name.split(" ")[0])),
        preview: typing || (s.lastLine ? who + s.lastLine : dm ? "Aún no os habéis escrito" : `${(s.members || []).length} personas`),
        at: s.lastAt, attention: false, badge: s.unread > 0 ? String(s.unread > 9 ? "9+" : s.unread) : null, pinHref: shareUrl(s.id),
      });
    }
    return out.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  }, [missions, bots, notifications, peers]); // eslint-disable-line react-hooks/exhaustive-deps

  const matches = (r) => !q.trim() || fold([r.name, r.kind, r.preview, r.m?.title, r.m?.prompt].join(" ")).includes(fold(q.trim()));
  const counts = { todos: rows.length, bots: rows.filter((r) => r.type === "bots").length, salas: rows.filter((r) => r.type === "salas").length, personas: rows.filter((r) => r.type === "personas").length, sinleer: rows.filter((r) => r.badge).length };
  const shown = rows.filter((r) => (tab === "todos" || (tab === "sinleer" ? !!r.badge : r.type === tab)) && matches(r));
  const today = startOfDay();
  const groups = [
    ["Fijados", (r) => pinned.includes(r.pinHref)],
    ["Hoy", (r) => Date.parse(r.at || 0) >= today],
    ["Esta semana", (r) => Date.parse(r.at || 0) >= today - 6 * DAY],
    ["Antes", () => true],
  ];
  const placed = new Set();
  const grouped = groups.map(([title, test]) => {
    const items = shown.filter((r) => !placed.has(r.key) && test(r));
    items.forEach((r) => placed.add(r.key));
    return { title, items };
  }).filter((g) => g.items.length);

  // ── what «···» does
  const togglePin = (r) => {
    const next = pinned.includes(r.pinHref) ? pinned.filter((h) => h !== r.pinHref) : [r.pinHref, ...pinned].slice(0, 30);
    run(() => patch("/settings", { pinned: next })).catch(() => {});
  };
  const tidy = (r, body, text, back) => run(() => patch(`/missions/${encodeURIComponent(r.m.id)}`, body))
    .then(() => reversible({ id: "mission:" + r.m.id, text, undo: () => run(() => patch(`/missions/${encodeURIComponent(r.m.id)}`, back)) }))
    .catch(() => {});
  const saveName = (r, value) => {
    setRenaming(null);
    const v = value.trim().replace(/^#\s*/, "");
    if (!v || !r.m) return;
    run(() => patch(`/missions/${encodeURIComponent(r.m.id)}`, r.type === "salas" ? { room: v } : { title: v })).catch(() => {});
  };
  const itemsFor = (r) => {
    const isPinned = pinned.includes(r.pinHref);
    const list = [{ label: isPinned ? "Quitar de fijados" : "Fijar arriba", key: "Ctrl P", run: () => togglePin(r) }];
    if (r.m) {
      list.push({ label: "Renombrar…", key: "F2", run: () => setRenaming({ key: r.key, value: r.type === "salas" ? r.m.room || r.m.title || "" : r.m.title || "" }) });
      const snoozed = r.m.snoozedUntil && Date.parse(r.m.snoozedUntil) > Date.now();
      list.push(snoozed
        ? { label: "Dejar de silenciar", run: () => run(() => patch(`/missions/${encodeURIComponent(r.m.id)}`, { snoozedUntil: null })).catch(() => {}) }
        : { label: "Silenciar hasta mañana", run: () => tidy(r, { snooze: "manana" }, "Silenciado hasta mañana", { snoozedUntil: null }) });
      if (r.type === "bots") list.push({ label: "Llevar a una sala", run: () => setSheet({ mode: "sala", preset: r.m.botIds || [] }) });
      list.push({ label: "Exportar conversación", run: () => toastWork(() => exportConversation(r.m.id, "word", { bots }), { loading: "Exportando la conversación a Word…", success: "Conversación exportada a Word", error: "No se pudo exportar" }) });
      if (!["queued", "running", "planning"].includes(r.m.status)) list.push({ label: "Archivar", danger: true, run: () => tidy(r, { archived: true }, r.type === "salas" ? "Sala archivada" : "Conversación archivada", { archived: false }) });
    }
    return list;
  };
  // Ctrl P pins and F2 renames the row under the pointer (or with the focus).
  useEffect(() => {
    const onKey = (e) => {
      const r = rows.find((x) => x.key === hovered.current);
      if (!r || e.target.closest?.("input, textarea")) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "p") { e.preventDefault(); togglePin(r); }
      else if (e.key === "F2" && r.m) { e.preventDefault(); setRenaming({ key: r.key, value: r.type === "salas" ? r.m.room || r.m.title || "" : r.m.title || "" }); }
      else if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  useClickAway(!!menu, (target) => target.closest?.("[data-row-menu]"), () => setMenu(null), { escape: false, event: "pointerdown" });

  const team = bots.filter((b) => b.enabled !== false);
  const tabsDef = [["todos", "Todos"], ["bots", "Bots"], ["salas", "Salas"], ["personas", "Personas"], ["sinleer", "Sin leer"]];
  const ghost = { height: "44px", display: "flex", alignItems: "center", gap: "10px", padding: "0 14px", borderRadius: "var(--r-md)", border: "1px solid rgba(18,19,26,.12)", background: "transparent", color: "#12131A", fontSize: "var(--t-body)", fontWeight: 500, cursor: "pointer", textAlign: "left" };

  return (
    <main data-chats-home="" style={{ maxWidth: "1160px", margin: "0 auto", padding: "44px clamp(20px, 4vw, 52px) 64px", display: "flex", flexDirection: "column", gap: "26px" }}>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "16px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <h1 style={{ margin: 0, font: "600 var(--t-display-m)/1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.04em" }}>{"Chats"}</h1>
          <p style={{ margin: 0, fontSize: "var(--t-read)", color: "#4A4D57" }}>{"Tus conversaciones con un bot, con salas de equipo y con otras personas."}</p>
        </div>
        <button type="button" onClick={() => setSheet({ mode: "chat", preset: [] })} title="Nuevo chat (Ctrl N › Chat con un bot)" style={{ height: "44px", padding: "0 20px", display: "inline-flex", alignItems: "center", gap: "8px", border: 0, borderRadius: "var(--r-pill)", background: "#12131A", color: "#FFFFFF", fontSize: "var(--t-body)", fontWeight: 600, cursor: "pointer" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>{"Nuevo chat"}
        </button>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
        <div role="tablist" aria-label="Tipo de chat" style={{ display: "inline-flex", flexWrap: "wrap", padding: "4px", gap: "2px", borderRadius: "var(--r-pill)", background: "#EBEBE6" }}>
          {tabsDef.map(([id, label]) => {
            const on = tab === id;
            return (
              <button key={id} type="button" role="tab" aria-selected={on ? "true" : "false"} onClick={() => setTab(id)} style={{ height: "34px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "6px", border: 0, borderRadius: "var(--r-pill)", background: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 2px rgba(18,19,26,.1)" : "none", fontSize: "var(--t-ui)", fontWeight: on ? 600 : 500, color: "#12131A", cursor: "pointer" }}>
                {label}<span style={{ fontSize: "var(--t-caption)", color: "#5C606C" }}>{counts[id]}</span>
              </button>
            );
          })}
        </div>
        <label style={{ flex: "1 1 260px", display: "flex", alignItems: "center", gap: "10px", height: "42px", padding: "0 14px", borderRadius: "var(--r-md)", background: "#FFFFFF", border: "1px solid rgba(18,19,26,.08)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5C606C" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.2-4.2" /></svg>
          <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Buscar en los chats"}</span>
          <input className="c-bare" type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en nombres y mensajes" style={{ flex: "1", minWidth: 0, border: 0, background: "transparent", fontSize: "var(--t-body)" }} />
        </label>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "flex-start" }}>
        <section aria-label="Conversaciones" style={{ flex: "999 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: "18px" }}>
          {ready && !grouped.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "22px 24px", borderRadius: "var(--r-xl)", background: "#FFFFFF" }}>
              <strong style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>{q.trim() ? "Ningún chat coincide" : tab === "sinleer" ? "Lo tienes todo leído" : "Aún no hay chats aquí"}</strong>
              <span style={{ fontSize: "var(--t-ui)", color: "#5C606C" }}>{q.trim() ? "Prueba con otro nombre o con una palabra del mensaje." : "Empieza a hablar con un bot, crea una sala o invita a una persona."}</span>
            </div>
          ) : null}
          {grouped.map((g) => (
            <div key={g.title} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <h2 style={{ margin: 0, padding: "0 6px", fontSize: "var(--t-meta)", fontWeight: 600, color: "#5C606C" }}>{g.title}</h2>
              <div style={{ display: "flex", flexDirection: "column", borderRadius: "var(--r-xl)", background: "#FFFFFF" }}>
                {g.items.map((r, i) => {
                  const open = menu === r.key;
                  const n = g.items.length;
                  const round = n === 1 ? "var(--r-xl)" : i === 0 ? "var(--r-xl) var(--r-xl) 0 0" : i === n - 1 ? "0 0 var(--r-xl) var(--r-xl)" : "0";
                  const bold = !!r.badge;
                  return (
                    <div key={r.key} data-row-menu={open ? "" : undefined} onMouseEnter={() => { hovered.current = r.key; }} onFocus={() => { hovered.current = r.key; }}
                      style={{ position: "relative", zIndex: open ? 6 : "auto", display: "flex", alignItems: "center", gap: "14px", minHeight: "70px", padding: "10px 14px 10px 18px", borderTop: i ? "1px solid rgba(18,19,26,.06)" : "0", borderRadius: round, background: open ? "#F6F6F3" : "transparent" }}>
                      <RowTile bot={r.bot} state={r.busy ? "work" : "rest"} person={r.person} room={!r.bot && !r.person} />
                      {renaming?.key === r.key ? (
                        <form onSubmit={(e) => { e.preventDefault(); saveName(r, renaming.value); }} style={{ flex: "1", minWidth: 0, display: "flex" }}>
                          <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>{"Nuevo nombre"}</span>
                          <input className="c-quiet" autoFocus value={renaming.value} onChange={(e) => setRenaming({ ...renaming, value: e.target.value })} onBlur={() => saveName(r, renaming.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setRenaming(null); } }}
                            style={{ flex: "1", minWidth: 0, height: "38px", padding: "0 12px", border: "1px solid rgba(18,19,26,.16)", borderRadius: "var(--r-md)", background: "#FFFFFF", fontSize: "var(--t-body)", fontWeight: 500 }} />
                        </form>
                      ) : (
                        <a href={r.href} style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "3px", color: "#12131A" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                            <span style={{ flex: "none", maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--t-body)", fontWeight: bold ? 600 : 500 }}>{r.name}</span>
                            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--t-meta)", color: "#5C606C" }}>{r.kind}</span>
                          </span>
                          <span style={{ fontSize: "var(--t-ui)", color: bold ? "#12131A" : "#5C606C", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.preview}</span>
                        </a>
                      )}
                      <span style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
                        <span style={{ fontSize: "var(--t-meta)", color: "#5C606C" }}>{whenLabel(r.at)}</span>
                        {r.badge ? <span aria-label={r.attention ? "Te necesita" : "Mensajes sin leer"} style={{ minWidth: "20px", height: "20px", padding: "0 6px", display: "grid", placeItems: "center", borderRadius: "var(--r-pill)", background: r.attention ? "#FFC93C" : "#12131A", color: r.attention ? "#12131A" : "#FFFFFF", fontSize: "var(--t-caption)", fontWeight: 600 }}>{r.badge}</span> : null}
                      </span>
                      <button type="button" aria-label={"Más opciones de " + r.name} aria-haspopup="menu" aria-expanded={open ? "true" : "false"} onClick={() => setMenu(open ? null : r.key)} style={{ flex: "none", width: "34px", height: "34px", display: "grid", placeItems: "center", padding: 0, border: 0, borderRadius: "var(--r-md)", background: "transparent", color: "#4A4D57", cursor: "pointer" }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18.5" cy="12" r="1.6" /></svg>
                      </button>
                      {open ? (
                        <div role="menu" aria-label="Opciones" style={{ position: "absolute", zIndex: 5, right: "14px", top: "58px", width: "230px", display: "flex", flexDirection: "column", padding: "6px", borderRadius: "var(--r-lg)", background: "#FFFFFF", boxShadow: "0 2px 4px rgba(18,19,26,.06), 0 24px 48px -16px rgba(18,19,26,.35)", animation: "rise .15s ease-out" }}>
                          {itemsFor(r).map((it) => (
                            <button key={it.label} type="button" role="menuitem" onClick={() => { setMenu(null); it.run(); }} style={{ height: "38px", padding: "0 12px", display: "flex", alignItems: "center", justifyContent: "space-between", border: 0, borderRadius: "var(--r-sm)", background: "transparent", fontSize: "var(--t-ui)", color: it.danger ? "#B4232A" : "#12131A", textAlign: "left", cursor: "pointer" }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = "#F6F6F3"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                              {it.label}<span style={{ font: "500 var(--t-micro)/1 'Geist Mono', monospace", color: "#6B6F7A" }}>{it.key || ""}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        <aside aria-labelledby="start-t" style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "20px", borderRadius: "var(--r-2xl)", background: "#FFFFFF" }}>
            <h2 id="start-t" style={{ margin: 0, font: "600 var(--t-title)/1.1 'Bricolage Grotesque', sans-serif", letterSpacing: "-0.02em" }}>{"Empezar a hablar"}</h2>
            <p style={{ margin: 0, fontSize: "var(--t-ui)", lineHeight: "1.45", color: "#4A4D57" }}>{"Con un bot si sabes quién lo hace. Con una sala si trabajan varios, o hay personas."}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px" }}>
              {team.map((b) => (
                <a key={b.id} href={`/chat/${b.id}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", padding: "12px 4px", borderRadius: "var(--r-lg)", background: "#F6F6F3", color: "#12131A", fontSize: "var(--t-meta)", fontWeight: 500, minWidth: 0 }}>
                  <span aria-hidden="true" style={{ width: "26px", height: "26px", background: b.color || "#C9CBD1", clipPath: shapeOf(b).clip, borderRadius: shapeOf(b).radius }} />
                  <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
                </a>
              ))}
            </div>
            <button type="button" onClick={() => setSheet({ mode: "sala", preset: [] })} style={ghost}><span aria-hidden="true" style={{ fontWeight: 600, color: "#5C606C" }}>{"#"}</span>{"Crear una sala"}</button>
            <button type="button" onClick={() => (peers?.me ? setPeerSheet("invitar") : navigate("/equipo"))} style={ghost}><span aria-hidden="true" style={{ width: "18px", height: "18px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", background: "#E6E7EC", fontSize: "var(--t-micro)", fontWeight: 600 }}>{"+"}</span>{"Invitar a una persona"}</button>
          </div>
          <p style={{ margin: 0, padding: "0 6px", fontSize: "var(--t-meta)", lineHeight: "1.5", color: "#5C606C" }}>{"Clic derecho en un chat: fijar, renombrar, silenciar, llevar a una sala o archivar."}</p>
        </aside>
      </div>
      {/* A new room from scratch is the small sheet (POST /api/rooms); «llevar a una sala» keeps the bots' sheet. */}
      {sheet?.mode === "sala" && !sheet.preset?.length ? <NewRoomSheet onClose={() => setSheet(null)} />
        : sheet ? <NewConversation mode={sheet.mode} preset={sheet.preset} onClose={() => setSheet(null)} onPeople={(which) => { setSheet(null); setPeerSheet(which); }} /> : null}
      {peerSheet === "invitar" ? <InviteSheet onClose={() => setPeerSheet(null)} /> : null}
      {peerSheet === "aceptar" ? <AcceptSheet onClose={() => setPeerSheet(null)} /> : null}
    </main>
  );
}
