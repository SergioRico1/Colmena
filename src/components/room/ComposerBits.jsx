import { useCallback, useEffect, useState } from "react";
import BotFace from "../BotFace.jsx";
import { Check, ChevronDown, LockSimple, Smiley, UsersThree } from "../Icon.js";
import { useDismiss } from "./common.jsx";
import "../../styles/conversation.css";

// The two small pieces of the composer bar (design/v4 › .cbox): the chip that says who a
// message is for, and the emoji button.

const pop = { position: "absolute", bottom: "calc(100% + 8px)", left: "0", zIndex: 30, display: "flex", flexDirection: "column", padding: "6px", borderRadius: "var(--r-lg)", background: "var(--c-raised)", border: "1px solid var(--c-line)", boxShadow: "var(--c-shadow-pop)", animation: "rise .15s ease-out" };
const item = { display: "flex", alignItems: "center", gap: "10px", width: "100%", minHeight: "36px", padding: "0 10px", border: 0, borderRadius: "var(--r-sm)", background: "transparent", color: "var(--c-text)", fontSize: "var(--t-ui)", textAlign: "left", cursor: "pointer" };

/** Arrows move between the items of a small menu; Escape closes it (useDismiss). */
function useMenu() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  useEffect(() => { if (open) ref.current?.querySelector("[role=menuitemradio], [role=menuitem], [role=gridcell]")?.focus(); }, [open, ref]);
  const keys = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); ref.current?.querySelector("button[aria-haspopup]")?.focus(); return; }
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const list = [...e.currentTarget.querySelectorAll("[role=menuitemradio], [role=menuitem], [role=gridcell]")];
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
    list[(list.indexOf(document.activeElement) + step + list.length) % list.length]?.focus();
  };
  return { open, setOpen, ref, keys };
}

/**
 * «Toda la sala» · a bot · «Solo para mí»: who the message is for. Picking a bot writes «@Vera»
 * at the start (the usual mention, which the room routes); «Solo para mí» turns on the aside
 * (`aside`: {on, toggle, label, hint}), answered only by your bots and never sent to anyone.
 */
export function AddressChip({ bots = [], current = null, aside = null, shared = false, onAll, onBot }) {
  const m = useMenu();
  const only = !!aside?.on;
  const label = only ? aside.label : current ? current.name : shared ? "Toda la sala" : "Todos tus bots";
  const pick = (fn) => { m.setOpen(false); fn(); };
  return (
    <span ref={m.ref} style={{ position: "relative", display: "inline-flex", alignSelf: "flex-end" }}>
      <button type="button" className="v4-chip" aria-haspopup="menu" aria-expanded={m.open ? "true" : "false"} aria-pressed={only ? "true" : undefined} aria-label={`Para: ${label}. Cambiar a quién va`} title={only ? aside.hint : "A quién va el mensaje"} onClick={() => m.setOpen((v) => !v)}>
        {only ? <LockSimple size={16} /> : current ? <BotFace bot={current} size={20} decorative /> : <UsersThree size={16} style={{ color: "var(--c-text-3)" }} />}
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        <ChevronDown size={12} weight="bold" style={{ color: only ? "currentColor" : "var(--c-text-3)" }} />
      </button>
      {m.open ? (
        <div role="menu" aria-label="A quién va el mensaje" onKeyDown={m.keys} style={{ ...pop, width: "248px" }}>
          <button type="button" role="menuitemradio" aria-checked={!only && !current} className="v4-menu-item" style={item} onClick={() => pick(onAll)}>
            <UsersThree size={18} style={{ color: "var(--c-text-3)" }} /><span style={{ flex: 1 }}>{shared ? "Toda la sala" : "Todos tus bots"}</span>{!only && !current ? <Check size={14} weight="bold" /> : null}
          </button>
          {bots.length ? <span aria-hidden="true" style={{ padding: "8px 10px 2px", fontSize: "var(--t-caption)", fontWeight: 600, color: "var(--c-text-3)" }}>{"Solo a un bot"}</span> : null}
          {bots.slice(0, 8).map((b) => (
            <button key={b.id} type="button" role="menuitemradio" aria-checked={!only && current?.id === b.id} className="v4-menu-item" style={item} onClick={() => pick(() => onBot(b))}>
              <BotFace bot={b} size={20} decorative /><span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
              {b.role ? <span className="v4-tag">{b.role}</span> : null}
              {!only && current?.id === b.id ? <Check size={14} weight="bold" /> : null}
            </button>
          ))}
          {aside?.available ? <>
            <span aria-hidden="true" style={{ height: "1px", margin: "6px 0", background: "var(--c-line)" }} />
            <button type="button" role="menuitemradio" aria-checked={only} className="v4-menu-item" style={{ ...item, alignItems: "flex-start", padding: "8px 10px" }} onClick={() => pick(aside.toggle)}>
              <LockSimple size={18} style={{ color: "var(--c-text-3)", marginTop: "1px" }} />
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}><span>{aside.label}</span><span style={{ fontSize: "var(--t-caption)", color: "var(--c-text-3)", lineHeight: 1.35 }}>{aside.hint}</span></span>
              {only ? <Check size={14} weight="bold" /> : null}
            </button>
          </> : null}
        </div>
      ) : null}
    </span>
  );
}

const EMOJI = ["👍", "🙏", "👏", "🙌", "✅", "👀", "🎉", "🔥", "❤️", "😊", "😂", "😅", "🤔", "😮", "😢", "💡", "📌", "📎", "⏰", "🚀", "☕", "🐝", "⚠️", "❓"];

/** A small grid of emoji; the one you pick goes in at the caret. */
export function EmojiButton({ onPick }) {
  const m = useMenu();
  return (
    <span ref={m.ref} style={{ position: "relative", display: "inline-flex", alignSelf: "flex-end" }}>
      <button type="button" className="v4-ib" aria-haspopup="menu" aria-expanded={m.open ? "true" : "false"} aria-label="Emoji" title="Emoji" onClick={() => m.setOpen((v) => !v)}><Smiley size={18} /></button>
      {m.open ? (
        <div role="menu" aria-label="Emoji" onKeyDown={m.keys} style={{ ...pop, display: "grid", gridTemplateColumns: "repeat(6, 36px)", gap: "2px" }}>
          {EMOJI.map((e) => <button key={e} type="button" role="menuitem" aria-label={"Emoji " + e} className="v4-menu-item" onClick={() => { m.setOpen(false); onPick(e); }} style={{ width: "36px", height: "36px", border: 0, borderRadius: "var(--r-sm)", background: "transparent", cursor: "pointer", fontSize: "var(--t-title)", lineHeight: 1 }}>{e}</button>)}
        </div>
      ) : null}
    </span>
  );
}
