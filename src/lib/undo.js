// Words of «Deshacer cambios» (src/components/v2/chat/UndoChanges.jsx).
export const plural = (n, one, many) => (n === 1 ? "1 " + one : n + " " + many);

/** «2 creados, 1 editado»: what the turn did, in a few words. */
export function changesSummary(cp) {
  const parts = [];
  if (cp.created) parts.push(plural(cp.created, "creado", "creados"));
  if (cp.edited) parts.push(plural(cp.edited, "editado", "editados"));
  if (cp.deleted) parts.push(plural(cp.deleted, "borrado", "borrados"));
  return parts.join(", ") || "sin cambios";
}

/** Deliverables that leave the Biblioteca, named only when the list above does not show them. */
export function libraryLine(titles, files) {
  const shown = new Set(files.map((f) => f.path));
  const named = titles.filter((t) => !shown.has(t));
  if (!named.length) return titles.length === 1 ? "Ese archivo también sale de la Biblioteca." : "Esos archivos también salen de la Biblioteca.";
  return (named.length === 1 ? "También sale de la Biblioteca: " : "También salen de la Biblioteca: ") + named.map((t) => `«${t}»`).join(", ") + ".";
}
