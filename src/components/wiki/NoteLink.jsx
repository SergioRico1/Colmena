import { Fragment, createContext, useContext } from "react";
import { useNoteTarget } from "../../lib/wikiResolve.js";
import { findLinks, noteUrl, targetName } from "../../lib/wikiLinks.js";

// A `[[link]]` drawn as a link to its note (docs/CONTRACT.md §16), wherever Markdown is shown:
// chat messages, deliverables and the notes themselves. A note that exists opens; one that
// does not is «por crear» (dashed, muted): in a chat it opens the note's address, which offers
// to create it; inside «Notas» the screen creates it on the click (NoteLinkContext).

/** `{ onMissing(title) }`: what a click on a link to a note that does not exist does. */
export const NoteLinkContext = createContext(null);

export default function NoteLink({ target, children }) {
  const hit = useNoteTarget(target);
  const ctx = useContext(NoteLinkContext);
  const { name, heading } = targetName(target);
  const missing = hit ? !hit.exists : false;
  const href = noteUrl(hit?.exists ? hit.slug : name);
  const title = missing ? `«${name}» está por crear` : hit?.archived ? `${hit.title} (archivada)` : hit && hit.title !== name ? hit.title + (heading ? " › " + heading : "") : heading ? `${name} › ${heading}` : undefined;
  return (
    <a href={href} data-note={hit?.slug || ""} data-note-missing={missing ? "" : undefined} title={title}
      onClick={missing && ctx?.onMissing ? (e) => { e.preventDefault(); ctx.onMissing(name); } : undefined}
      style={missing
        ? { color: "var(--c-text-3)", textDecoration: "underline dashed", textUnderlineOffset: "3px" }
        : { color: "var(--c-accent-ink)", textDecoration: "underline", textDecorationColor: "color-mix(in srgb, var(--c-accent-ink) 35%, transparent)", textUnderlineOffset: "3px" }}>
      {children}
    </a>
  );
}

/**
 * Plain text (your own messages, which are not Markdown) with its `[[links]]` as links to
 * their notes. `plain(text, key)` draws every other piece (mention pills and so on).
 */
export function NoteText({ text, plain = (t) => t }) {
  const value = String(text ?? "");
  const links = findLinks(value);
  if (!links.length) return plain(value, "t");
  const out = [];
  let at = 0;
  links.forEach((l, i) => {
    if (l.start > at) out.push(<Fragment key={"t" + i}>{plain(value.slice(at, l.start), "t" + i)}</Fragment>);
    out.push(<NoteLink key={"n" + i} target={l.raw}>{l.text}</NoteLink>);
    at = l.end;
  });
  if (at < value.length) out.push(<Fragment key="end">{plain(value.slice(at), "end")}</Fragment>);
  return out;
}
