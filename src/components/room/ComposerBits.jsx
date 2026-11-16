import { useState } from "react";
import BotFace from "../BotFace.jsx";
import { ChevronDown, LockSimple, Smiley, UsersThree } from "../Icon.js";
import { MenuButton } from "../Menu.js";
import EmojiPicker from "../../chat/emoji/EmojiPicker.jsx";
import "../../styles/conversation.css";

// The two small pieces of the composer bar (design/v4 › .cbox): the chip that says who a
// message is for, and the emoji button.

/**
 * «Toda la sala» · a bot · «Solo para mí»: who the message is for. Picking a bot writes «@Vera»
 * at the start (the usual mention, which the room routes); «Solo para mí» turns on the aside
 * (`aside`: {on, toggle, label, hint}), answered only by your bots and never sent to anyone.
 */
export function AddressChip({ bots = [], current = null, aside = null, shared = false, onAll, onBot }) {
  const only = !!aside?.on;
  const label = only ? aside.label : current ? current.name : shared ? "Toda la sala" : "Todos tus bots";
  // One choice of three kinds, as radio items of the app's one menu (components/Menu.js). It is
  // the one place «Solo para mí» is turned on (the room's «…» no longer repeats it).
  const items = [
    { label: shared ? "Toda la sala" : "Todos tus bots", icon: <UsersThree size={20} />, radio: "to", checked: !only && !current, onSelect: onAll },
    bots.length ? { group: "Solo a un bot", items: bots.slice(0, 8).map((b) => ({ label: b.name, icon: <BotFace bot={b} size={20} decorative />, meta: b.role || null, radio: "to", checked: !only && current?.id === b.id, onSelect: () => onBot(b) })) } : null,
    aside?.available ? { group: null, items: [{ label: aside.label, icon: <LockSimple size={20} />, hint: aside.hint, radio: "to", checked: only, onSelect: aside.toggle }] } : null,
  ];
  return (
    <span style={{ position: "relative", display: "inline-flex", alignSelf: "flex-end" }}>
      <MenuButton className="v4-chip" label={`Para: ${label}. Cambiar a quién va`} title={only ? aside.hint : "A quién va el mensaje"} menuLabel="A quién va el mensaje" items={items} placement="top-start" openStyle={{}} buttonProps={{ "aria-pressed": only ? "true" : undefined }}>
        {only ? <LockSimple size={16} /> : current ? <BotFace bot={current} size={20} decorative /> : <UsersThree size={16} style={{ color: "var(--c-text-3)" }} />}
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        <ChevronDown size={12} weight="bold" style={{ color: only ? "currentColor" : "var(--c-text-3)" }} />
      </MenuButton>
    </span>
  );
}


/** A small grid of emoji; the one you pick goes in at the caret. */
/** The emoji panel (src/chat/emoji/EmojiPicker.jsx, Blobmoji) from the composer's smiley. */
export function EmojiButton({ onPick }) {
  const [at, setAt] = useState(null); // the button it opens from
  return (
    <span style={{ position: "relative", display: "inline-flex", alignSelf: "flex-end" }}>
      <button type="button" className="v4-ib" aria-haspopup="dialog" aria-expanded={at ? "true" : "false"} aria-label="Añadir un emoji" title="Emoji" onClick={(e) => setAt(at ? null : e.currentTarget)}><Smiley size={18} /></button>
      {at ? <EmojiPicker anchor={at} title="Añadir un emoji" onPick={(e) => { setAt(null); onPick(e); }} onClose={() => setAt(null)} /> : null}
    </span>
  );
}
