import { useState } from "react";
import { del, patch } from "../../lib/api.js";
import { useStore } from "../../lib/store.jsx";
import { navigate } from "../../lib/router.jsx";
import { dmMenu } from "../../lib/invite.js";
import { Archive, BellRing, BellSlash, Ellipsis, UserMinus, UserRound } from "../Icon.js";
import { MenuButton } from "../Menu.js";
import "../../styles/conversation.css";
import "../../styles/invite.css";

// The «…» of a direct conversation's header (docs/SCREENS.md › «Invitar»): «Ver perfil»,
// «Silenciar», «Archivar» and «Quitar de contactos», each saying what it means under its name
// (components/Menu.js). Silencing and archiving stay on this computer (PATCH
// /api/peers/shares/:id/prefs); removing tells the other Colmena (DELETE
// /api/peers/contacts/:id), so it is last, in red, and asks inside the menu first.
export default function DmMenu({ share, other, onProfile, onChanged = null }) {
  const { run } = useStore();
  const [error, setError] = useState(null);
  const words = dmMenu({ name: other?.name, muted: !!share?.muted });
  const prefs = async (body) => {
    setError(null);
    try { await run(() => patch(`/peers/shares/${encodeURIComponent(share.id)}/prefs`, body)); if (body.archived) navigate("/"); else await onChanged?.(); } catch (e) { setError(e.message); }
  };
  const remove = async () => {
    setError(null);
    try { await run(() => del(`/peers/contacts/${encodeURIComponent(other.id)}`)); navigate("/"); } catch (e) { setError(e.message); }
  };
  const items = [
    { label: words.profile, icon: UserRound, hint: "Quién es, vuestras palabras de seguridad y qué pueden pedirte sus bots.", onSelect: () => onProfile?.() },
    { group: null, items: [
      { label: words.mute, icon: share?.muted ? BellRing : BellSlash, hint: words.muteHint, onSelect: () => prefs({ muted: !share?.muted }) },
      { label: words.archive, icon: Archive, hint: words.archiveHint, onSelect: () => prefs({ archived: true }) },
    ] },
    other?.status === "active" ? { label: words.remove, icon: UserMinus, danger: true, onSelect: remove, confirm: { title: words.removeTitle, text: words.removeText, action: words.remove } } : null,
  ];
  return (
    <>
      <MenuButton label={`Más opciones de la conversación con ${other?.name || "esta persona"}`} title="Más opciones" menuLabel={`Conversación con ${other?.name || "esta persona"}`} items={items} className="v4-ib"><Ellipsis size={18} /></MenuButton>
      {error ? <span role="alert" style={{ flexBasis: "100%", fontSize: "var(--t-meta)", color: "var(--c-error)" }}>{error}</span> : null}
    </>
  );
}
