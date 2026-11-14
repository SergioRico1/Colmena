import { useState } from "react";
import { del, post } from "../../lib/api.js";
import { later, useHidden } from "../../lib/undoToast.js";
import { WORDS, askedLine, expiresText, pendingCodes, roomOwner } from "../../lib/invite.js";
import { useAction, useStore } from "../../lib/store.jsx";
import { SELF_FALLBACK, lacksOwnName, selfLabel } from "../../lib/ownName.js";
import BotFace from "../BotFace.jsx";
import { PersonAvatar } from "./Author.jsx";
import { QUEUE } from "./RoomExtras.jsx";
import { compactBots, noBotsText } from "../../lib/roomView.js";
import { firstName } from "../../lib/identity.js";
import { srOnly } from "../../lib/alt.js";
import { Brain, ChevronRight, Clock3, FolderOpen, MessageCircleQuestion, Plus, Sliders, Ticket, UserPlus } from "../Icon.js";
import "../../styles/conversation.css";
import OverlayBack from "../OverlayBack.jsx";

// The right panel of a room (Colmena 4: design/v4 › .panel): two tabs, the bot you opened (its
// face, role, whose it is, what it is doing, how it thinks, its autonomy, what it can use and,
// in a room with people, who can ask it for things) and «Miembros» (Personas, Tus bots, the bots
// of each other person as a compact row, what is pending about who comes in, «Invitar», the room's rules and files). A bot
// opens here from its face or name anywhere in the conversation. What waits for someone else is
// neutral here; only «te espera» wears honey.
const h3 = { margin: "0 0 6px", display: "flex", gap: "6px", fontSize: "var(--t-caption)", fontWeight: 600, color: "var(--c-text-3)" };
const small = { fontSize: "var(--t-meta)", color: "var(--c-text-3)" };
const ellipsis = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const faceState = (s) => (s === "working" || s === "thinking" ? "work" : s === "waiting" ? "wait" : s === "paused" || s === "limited" ? "pause" : "rest");

/**
 * What is pending about who comes in, in neutral words (it waits for someone else): what you
 * asked this room's owner, and the codes for this room nobody used yet (with «Revocar»).
 */
function Pending({ view }) {
  const { peers } = useStore();
  const hidden = useHidden("invite");
  const owner = roomOwner(view);
  const codes = pendingCodes(peers?.invites || [], { kind: "room", room: view }).filter((i) => !hidden(i.id));
  const asked = view.asked || [];
  if (!codes.length && !asked.length) return null;
  const revoke = (inv) => later({ id: "invite:" + inv.id, keys: ["invite:" + inv.id], ms: 8000, text: "Código revocado: ya no sirve", error: "No se pudo revocar", run: () => del(`/peers/invites/${encodeURIComponent(inv.id)}`) });
  return (
    <section style={{ margin: "6px 0 16px" }}>
      <h3 style={h3}>{`${WORDS.pending} · ${codes.length + asked.length}`}</h3>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }}>
        {asked.map((a) => (
          <li key={a.id} className="v4-mrow" title={askedLine([a], owner?.name)}>
            <PersonAvatar person={a.person} size={28} ring="var(--c-app)" />
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span style={{ ...ellipsis, fontSize: "var(--t-ui)", fontWeight: 500, color: "var(--c-text-2)" }}>{a.person?.name}</span>
              <span style={{ ...ellipsis, fontSize: "var(--t-caption)", color: "var(--c-text-3)" }}>{`Se lo has pedido a ${firstName(owner?.name)}`}</span>
            </span>
            <Clock3 size={14} style={{ flex: "none", color: "var(--c-text-3)" }} />
          </li>
        ))}
        {codes.map((inv) => (
          <li key={inv.id} className="v4-mrow">
            <span aria-hidden="true" style={{ flex: "none", width: "28px", height: "28px", display: "grid", placeItems: "center", borderRadius: "var(--r-circle)", border: "1.5px dashed var(--c-line-strong)", color: "var(--c-text-3)" }}><Ticket size={14} /></span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span style={{ ...ellipsis, fontSize: "var(--t-ui)", fontWeight: 500, color: "var(--c-text-2)" }}>{inv.name && inv.name !== "Alguien" ? inv.name : "Código sin nombre"}</span>
              <span style={{ ...ellipsis, fontSize: "var(--t-caption)", color: "var(--c-text-3)" }}>{"Código · " + expiresText(inv.expiresAt).toLowerCase()}</span>
            </span>
            <button type="button" className="v4-btn ghost" onClick={() => revoke(inv)} aria-label={`${WORDS.revoke} el código para ${inv.name || "alguien"}`} style={{ height: "28px", padding: "0 8px" }}>{WORDS.revoke}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A bot as a cell (design/v4 › .bcell): its face and name; it opens its profile here. */
function BotCell({ b, owner = null, onOpen }) {
  const label = b.a11y + (b.state && b.state !== "free" && b.stateWord ? ", " + b.stateWord : "");
  return (
    <li style={{ listStyle: "none" }}>
      <button type="button" className="v4-bcell" onClick={() => onOpen?.(b, owner)} aria-label={label} title={[b.shown || b.name, b.role, b.state !== "free" ? b.stateWord : null].filter(Boolean).join(" · ")}>
        <BotFace bot={b} size={32} owner={owner} state={faceState(b.state)} decorative />
        <span aria-hidden="true">{b.name}</span>
      </button>
    </li>
  );
}

/** Someone else's bots: a compact row of cells, the busy ones first, the rest behind «Ver los N». */
function OwnerBots({ group, onOpen }) {
  const [open, setOpen] = useState(false);
  const { shown, hidden } = compactBots(group.bots, open);
  return (
    <section className="msec" style={{ margin: "6px 0 16px" }}>
      <h3 style={h3}>{`${group.label} · ${group.bots.length}`}</h3>
      <ul style={{ margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "4px" }}>
        {shown.map((b) => <BotCell key={b.id} b={b} owner={group.owner} onOpen={onOpen} />)}
      </ul>
      {hidden || open ? (
        <button type="button" className="v4-btn ghost" aria-expanded={open ? "true" : "false"} onClick={() => setOpen((v) => !v)} style={{ marginTop: "4px" }}>
          {open ? "Ver menos" : `Ver los ${group.bots.length}`}
        </button>
      ) : null}
    </section>
  );
}

const AUTONOMY = { sugiere: ["Solo sugiere", "Te propone cada paso y espera tu OK"], avisa: ["Hace y avisa", "Lo que sale de tu ordenador te lo pregunta"], solo: ["Hace solo", "Solo te pregunta las líneas rojas"] };
const TOOL_WORD = { correo: "Correo", calendario: "Calendario", carpeta: "Carpeta", hojas: "Hojas", chat: "Chat", erp: "ERP", web: "Web", navegador: "Navegador" };
const ASK_WORD = { pregunta: "Pregúntame", siempre: "Siempre", nunca: "Nunca" };

/**
 * The bot's profile (design/v4 › #pp): big face, name, role, whose it is, its state; for your
 * own bot how it thinks, its autonomy, what it can use and who in this room can ask it; then
 * «Abrir chat» and «Ver en Equipo». Someone else's bot says only what its owner shares.
 */
export function BotProfile({ bot, owner = null, state = null, stateWord = null, doing = null, view = null }) {
  const store = useStore();
  const mine = !owner || owner.you;
  const full = mine ? (store.bots || []).find((b) => b.id === bot.id) || bot : bot;
  const auto = AUTONOMY[full.autonomy || "avisa"] || AUTONOMY.avisa;
  const tools = Object.entries(full.tools || {}).filter(([, v]) => v && v !== "none").map(([k]) => TOOL_WORD[k] || k.charAt(0).toUpperCase() + k.slice(1));
  const thinks = [full.usesChatGPT ? "ChatGPT" : full.engine?.label || full.model?.engine || null, full.model?.label || null].filter(Boolean).join(" · ");
  const askers = mine && view && !view.private ? (view.people || []).filter((p) => !p.you) : [];
  const contactOf = (address) => (store.peers?.contacts || []).find((c) => c.id === address) || null;
  const waits = state === "waiting";
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px", padding: "8px 0 16px", borderBottom: "1px solid var(--c-line)" }}>
        <span style={{ marginBottom: "10px" }}><BotFace bot={full} size={96} owner={mine ? null : owner} state={faceState(state)} decorative /></span>
        <h2 style={{ margin: 0, font: "700 var(--t-heading)/1.1 'Bricolage Grotesque', 'Geist', sans-serif", letterSpacing: "-0.01em", color: "var(--c-text)" }}>{full.name}</h2>
        {full.role ? <span className="v4-tag">{full.role}</span> : null}
        <span style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>
          <PersonAvatar person={mine ? { you: true, name: store.settings?.userName, color: store.settings?.botLooks?.family?.tint } : owner} size={20} />
          {mine ? "Tu bot" : "Bot de " + firstName(owner?.name)}
        </span>
        {stateWord ? (
          <span style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
            {waits && mine ? <span className="v4-pill-wait" style={{ height: "20px", padding: "0 7px" }}>{"te espera"}</span> : <span className="v4-tag" style={{ height: "20px", fontSize: "var(--t-caption)" }}>{stateWord}</span>}
            {doing ? <span style={{ fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{doing}</span> : null}
          </span>
        ) : null}
      </div>
      <dl style={{ margin: 0, padding: "12px 0", display: "flex", flexDirection: "column", gap: "12px", borderBottom: "1px solid var(--c-line)" }}>
        {mine ? <>
          {thinks ? <div><dt style={{ fontSize: "var(--t-caption)", color: "var(--c-text-3)", marginBottom: "3px" }}>{"Cómo piensa"}</dt><dd style={{ margin: 0, display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--t-ui)", color: "var(--c-text)" }}><Brain size={16} style={{ color: "var(--c-text-3)" }} />{thinks}</dd></div> : null}
          <div><dt style={{ fontSize: "var(--t-caption)", color: "var(--c-text-3)", marginBottom: "3px" }}>{"Autonomía"}</dt><dd style={{ margin: 0, display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--t-ui)", color: "var(--c-text)" }}><Sliders size={16} style={{ color: "var(--c-text-3)" }} />{auto[0]}</dd><dd style={{ margin: "2px 0 0", fontSize: "var(--t-meta)", color: "var(--c-text-3)" }}>{auto[1]}</dd></div>
          <div><dt style={{ fontSize: "var(--t-caption)", color: "var(--c-text-3)", marginBottom: "3px" }}>{"Puede usar"}</dt><dd style={{ margin: 0, display: "flex", flexWrap: "wrap", gap: "6px" }}>{tools.length ? tools.map((t) => <span key={t} className="v4-tag">{t}</span>) : <span style={small}>{"Solo lo que le des en la conversación"}</span>}</dd></div>
          {askers.length ? (
            <div><dt style={{ fontSize: "var(--t-caption)", color: "var(--c-text-3)", marginBottom: "3px" }}>{"Quién puede pedirle"}</dt>
              {askers.map((p) => <dd key={p.address || p.name} style={{ margin: "0 0 4px", display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--t-ui)", color: "var(--c-text)" }}><PersonAvatar person={p} size={20} />{firstName(p.name)}<span style={small}>{"· " + (ASK_WORD[contactOf(p.address)?.asks?.encargos] || ASK_WORD.pregunta)}</span></dd>)}
            </div>
          ) : null}
        </> : (
          <div><dt style={{ fontSize: "var(--t-caption)", color: "var(--c-text-3)", marginBottom: "3px" }}>{"Dónde trabaja"}</dt><dd style={{ margin: 0, fontSize: "var(--t-ui)", lineHeight: 1.45, color: "var(--c-text)" }}>{`En el ordenador de ${firstName(owner?.name)}, con su cuenta. Aquí ves lo que dice y lo que entrega.`}</dd><dd style={{ margin: "6px 0 0", fontSize: "var(--t-meta)", lineHeight: 1.45, color: "var(--c-text-3)" }}>{`Nómbralo con @ para pedirle algo: decide ${firstName(owner?.name)}.`}</dd></div>
        )}
      </dl>
      {mine ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingTop: "16px" }}>
          <a href={`/chat/${encodeURIComponent(full.id)}`} className="v4-btn primary lg" style={{ width: "100%" }}><MessageCircleQuestion size={16} />{"Abrir chat"}</a>
          <a href={`/equipo/${encodeURIComponent(full.id)}`} className="v4-btn lg" style={{ width: "100%" }}>{"Ver en Equipo"}</a>
        </div>
      ) : null}
    </div>
  );
}

export default function MemberPanel({ view, panel, mission = null, addable = [], fileCount = 0, onRules = null, onFiles = null, onInvite = null, profile = null, tab = "miembros", onTab = null, onOpenBot = null, onClose = null }) {
  const { act, busy } = useAction();
  const nameless = lacksOwnName(useStore());
  const queue = QUEUE.find(([v]) => v === (mission?.queueMode || "steer"))?.[1] || QUEUE[0][1];
  const rules = mission ? [
    ["Si escribes mientras trabajan", queue.charAt(0).toUpperCase() + queue.slice(1)],
    ["Para enviar algo fuera o gastar dinero", mission.safety === "avisar" ? "Te avisan antes y esperan tu OK" : "Siempre esperan tu OK"],
    ...(view.private ? [] : [["Lo que ven los demás", "Lo que dicen tus bots y lo que entregan. Nunca sus pasos ni tus archivos"]]),
  ] : [];
  const members = panel.people.length + panel.botCount;
  // The bot of the profile tab, with its live state from the panel (who owns it, what it does).
  const found = profile ? panel.groups.flatMap((g) => g.bots.map((b) => ({ b, g }))).find(({ b, g }) => b.id === profile.id && (profile.owner ? g.owner?.address === profile.owner : g.mine)) : null;
  const shownTab = profile ? tab : "miembros";
  const open = (b, owner) => onOpenBot?.({ id: b.id, owner: owner?.address || null });
  return (
    <aside id="sala-miembros" aria-label="Detalles de la sala" className="r-overlay" style={{ flex: "none", width: "312px", height: "100%", display: "flex", flexDirection: "column", background: "var(--c-app)", borderLeft: "1px solid var(--c-line)", "--c-cut": "var(--c-app)" }}>
      <OverlayBack onClose={onClose} label="Volver a la sala" />
      {profile ? (
        <div className="v4-seg" role="tablist" aria-label="Panel">
          <button type="button" role="tab" id="panel-tab-perfil" aria-selected={shownTab === "perfil"} aria-controls="panel-perfil" onClick={() => onTab?.("perfil")}>{found?.b.name || profile.name || "Bot"}</button>
          <button type="button" role="tab" id="panel-tab-miembros" aria-selected={shownTab === "miembros"} aria-controls="panel-miembros" onClick={() => onTab?.("miembros")}>{`Miembros · ${members}`}</button>
        </div>
      ) : <h2 style={{ margin: "16px 20px 4px", fontSize: "var(--t-meta)", fontWeight: 600, color: "var(--c-text)" }}>{`Miembros · ${members}`}</h2>}
      {shownTab === "perfil" && profile ? (
        <div id="panel-perfil" role="tabpanel" aria-labelledby="panel-tab-perfil" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 20px 20px" }}>
          <BotProfile bot={found?.b || profile} owner={found ? (found.g.mine ? null : found.g.owner) : null} state={found?.b.state || null} stateWord={found?.b.stateWord || null} view={view} />
        </div>
      ) : (
        <div id="panel-miembros" role={profile ? "tabpanel" : undefined} aria-labelledby={profile ? "panel-tab-miembros" : undefined} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 20px 20px" }}>
          <section style={{ margin: "6px 0 16px" }}>
            <h3 style={h3}>{`Personas · ${panel.people.length}`}</h3>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }}>
              {panel.people.map((p) => {
                const away = !p.you && p.presence !== "online";
                return (
                  <li key={p.address || p.name} className="v4-mrow">
                    <PersonAvatar person={p} size={28} ring="var(--c-app)" presence={p.you ? "online" : p.presence === "online" ? "online" : "offline"} />
                    <span style={{ flex: 1, ...ellipsis, fontSize: "var(--t-ui)", fontWeight: 500, color: away ? "var(--c-text-3)" : "var(--c-text)" }}>
                      {p.you ? (selfLabel(p.name) === SELF_FALLBACK ? SELF_FALLBACK : <>{p.name}<span style={{ fontWeight: 400, color: "var(--c-text-3)" }}>{" (tú)"}</span></>) : p.name}
                    </span>
                    <span style={{ flex: "none", maxWidth: "120px", ...ellipsis, fontSize: "var(--t-caption)", color: "var(--c-text-3)" }} title={[p.roleWord, p.presenceWord].filter(Boolean).join(" · ")}>{away ? p.presenceWord : p.roleWord}</span>
                  </li>
                );
              })}
            </ul>
            {/* Where your name matters (a room with people): a quiet way to set it. */}
            {nameless && panel.people.length > 1 ? <a href="/ajustes/general#tu-nombre" style={{ ...small, display: "block", lineHeight: 1.45, paddingTop: "4px", color: "var(--c-text-2)" }}>{"Los demás te ven como «Sin nombre». "}<span style={{ textDecoration: "underline", textUnderlineOffset: "3px" }}>{"Ponte un nombre"}</span></a> : null}
          </section>
          {view.private ? null : <Pending view={view} />}
          {panel.groups.map((g) => (g.mine ? (
            <section key="mine" style={{ margin: "6px 0 16px" }}>
              <h3 style={h3}>{`${g.label} · ${g.bots.length}`}</h3>
              <ul style={{ margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {g.bots.map((b) => <BotCell key={b.id} b={b} onOpen={open} />)}
              </ul>
              {addable.length && mission ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", paddingTop: "8px" }}>
                  {addable.map((b) => (
                    <button key={b.id} type="button" className="v4-btn" disabled={busy} onClick={() => act(() => post(`/missions/${mission.id}/members`, { botId: b.id }))} aria-label={`Añadir a ${b.name} a la sala`} title={[b.name, b.role].filter(Boolean).join(" · ")} style={{ height: "30px", padding: "0 10px 0 6px", fontWeight: 500 }}>
                      <BotFace bot={b} size={20} decorative /><Plus size={12} weight="bold" />{b.name}
                    </button>
                  ))}
                </div>
              ) : null}
              {!view.private ? <span style={{ ...small, display: "block", lineHeight: 1.45, paddingTop: "6px" }}>{"Trabajan en tu ordenador, con tu cuenta. Nómbralos con @ para que contesten aquí."}</span> : null}
            </section>
          ) : <OwnerBots key={g.owner?.address || g.label} group={g} onOpen={open} />))}
          {panel.groups.length ? null : (
            <section style={{ margin: "6px 0 16px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <h3 style={h3}>{"Bots · 0"}</h3>
              <span style={{ ...small, lineHeight: 1.5 }}>{noBotsText(view)}</span>
              {view.private ? null : <a href="/equipo" className="v4-btn" style={{ alignSelf: "flex-start" }}>{"Ver mis bots"}</a>}
            </section>
          )}
          {onInvite ? <button type="button" className="v4-invite" onClick={onInvite}><UserPlus size={16} />{WORDS.invite}</button> : null}
          {rules.length ? (
            <section style={{ margin: "16px 0 0", paddingTop: "14px", borderTop: "1px solid var(--c-line)" }}>
              <h3 style={h3}>{"Reglas de esta sala"}</h3>
              <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                {rules.map(([k, v]) => <div key={k}><dt style={{ fontSize: "var(--t-caption)", color: "var(--c-text-3)", marginBottom: "2px" }}>{k}</dt><dd style={{ margin: 0, fontSize: "var(--t-meta)", lineHeight: 1.45, color: "var(--c-text)" }}>{v}</dd></div>)}
              </dl>
              {onRules ? <button type="button" className="v4-btn" onClick={onRules} style={{ marginTop: "10px" }}>{"Cambiar reglas"}</button> : null}
            </section>
          ) : null}
          {onFiles ? (
            <button type="button" onClick={onFiles} className="v4-mrow" style={{ width: "calc(100% + 12px)", marginTop: "12px", border: 0, background: "transparent", color: "var(--c-text)", fontSize: "var(--t-ui)", fontWeight: 500, cursor: "pointer", textAlign: "left" }}>
              <FolderOpen size={18} style={{ color: "var(--c-text-3)" }} /><span style={{ flex: 1 }}>{"Archivos de la sala"}</span><span style={{ color: "var(--c-text-3)", fontVariantNumeric: "tabular-nums" }}>{fileCount}</span><ChevronRight size={14} style={{ color: "var(--c-text-3)" }} />
            </button>
          ) : null}
          {/* How rooms, people and bots work: the help page, one step away from where it matters. */}
          {view.private ? null : <a href="/personas/como-funciona" style={{ ...small, marginTop: "12px", minHeight: "24px", display: "inline-flex", alignItems: "center", color: "var(--c-text-2)", textDecoration: "underline", textUnderlineOffset: "3px" }}>{"Cómo funciona"}</a>}
          <span style={srOnly}>{`${panel.people.length} personas y ${panel.botCount} bots en la sala`}</span>
        </div>
      )}
    </aside>
  );
}
