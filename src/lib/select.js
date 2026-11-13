// The keyboard model of the app's select (components/Select.jsx), as pure functions so it
// can be tested without a browser. It follows the native control and the ARIA listbox:
//   closed   ArrowDown / ArrowUp / Enter / Space / Alt+ArrowDown open on the chosen option;
//            Home / End open on the first / last; a letter picks the next match without opening
//   open     ArrowDown / ArrowUp, Home / End, PageDown / PageUp move; a letter jumps to a match;
//            Enter / Space / Tab choose; Escape closes and keeps what was chosen
// Disabled options are never landed on.

const PAGE = 8;

/** «á» matches «a», case does not matter. */
export const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const usable = (options, i) => i >= 0 && i < options.length && !options[i].disabled;

/** The first usable index from `from` walking by `step`, or -1. */
export function seek(options, from, step) {
  for (let i = from; i >= 0 && i < options.length; i += step) if (usable(options, i)) return i;
  return -1;
}

/** Where a movement key takes the active option (stays put when there is nowhere to go). */
export function moveIndex(options, at, key) {
  const last = options.length - 1;
  const or = (i) => (i < 0 ? at : i);
  switch (key) {
    case "ArrowDown": return or(seek(options, at + 1, 1));
    case "ArrowUp": return or(seek(options, at - 1, -1));
    case "Home": return or(seek(options, 0, 1));
    case "End": return or(seek(options, last, -1));
    case "PageDown": { const i = seek(options, Math.min(last, at + PAGE), 1); return or(i < 0 ? seek(options, last, -1) : i); }
    case "PageUp": { const i = seek(options, Math.max(0, at - PAGE), -1); return or(i < 0 ? seek(options, 0, 1) : i); }
    default: return at;
  }
}

/**
 * Typing to find. `buffer` is what was typed in the last moment. The same letter repeated
 * walks through the options that start with it; anything else finds the first option after
 * the current one (the current one included while the word grows) that starts with the buffer.
 */
export function typeahead(options, buffer, at) {
  const typed = fold(buffer);
  if (!typed) return -1;
  const same = [...typed].every((ch) => ch === typed[0]);
  const needle = same ? typed[0] : typed;
  const start = same || typed.length === 1 ? at + 1 : Math.max(at, 0);
  for (let n = 0; n < options.length; n += 1) {
    const i = (start + n + options.length) % options.length;
    if (usable(options, i) && fold(options[i].label).startsWith(needle)) return i;
  }
  return -1;
}

const printable = (e) => e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey;

/**
 * One key on the select. `state`: { open, at (active index), selected (chosen index), buffer }.
 * Returns the next state plus what to do: `choose` (index to commit), `handled` (the key was
 * the select's: prevent the default), `refocus` (give focus back to the button).
 */
export function selectKey(options, state, e) {
  const { open, at, selected, buffer = "" } = state;
  const same = { open, at, selected, buffer, handled: false };
  if (!options.length) return same;
  const home = selected >= 0 && usable(options, selected) ? selected : seek(options, 0, 1);
  if (!open) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) return { ...same, open: true, at: home, buffer: "", handled: true };
    if (e.key === "Home") return { ...same, open: true, at: moveIndex(options, home, "Home"), buffer: "", handled: true };
    if (e.key === "End") return { ...same, open: true, at: moveIndex(options, home, "End"), buffer: "", handled: true };
    if (printable(e)) {
      const next = buffer + e.key, i = typeahead(options, next, selected);
      return i < 0 ? { ...same, buffer: next, handled: true } : { ...same, selected: i, buffer: next, choose: i, handled: true };
    }
    return same;
  }
  if (e.key === "Escape") return { ...same, open: false, buffer: "", handled: true, refocus: true };
  if (e.key === "Enter" || e.key === " ") return { ...same, open: false, selected: at, buffer: "", choose: at, handled: true, refocus: true };
  // Tab chooses like the native control and lets focus move on from the button.
  if (e.key === "Tab") return { ...same, open: false, selected: at, buffer: "", choose: at, handled: false, refocus: true };
  if (e.altKey && e.key === "ArrowUp") return { ...same, open: false, selected: at, buffer: "", choose: at, handled: true, refocus: true };
  if (["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(e.key)) return { ...same, at: moveIndex(options, at, e.key), buffer: "", handled: true };
  if (printable(e)) {
    const next = buffer + e.key, i = typeahead(options, next, at);
    return { ...same, at: i < 0 ? at : i, buffer: next, handled: true };
  }
  return same;
}

/** Options from the shapes call sites use: [value, label] pairs, plain values or objects. */
export function normalizeOptions(list) {
  return (list || []).filter((o) => o !== null && o !== undefined && o !== false).map((o) => {
    if (Array.isArray(o)) return { value: o[0], label: String(o[1] ?? o[0]) };
    if (typeof o === "object") return { ...o, label: String(o.label ?? o.value) };
    return { value: o, label: String(o) };
  });
}

/**
 * Where the list goes: below the button, or above it when it does not fit below and there
 * is more room above. `rect` is the button's box, `size` the list's, `view` the window's.
 */
export function placeList(rect, size, view, gap = 6, margin = 8) {
  const below = view.height - rect.bottom - gap - margin, above = rect.top - gap - margin;
  const up = size.height > below && above > below;
  const maxHeight = Math.max(120, Math.floor(up ? above : below));
  const height = Math.min(size.height, maxHeight);
  const width = Math.max(rect.width, size.width);
  const left = Math.max(margin, Math.min(rect.left, view.width - width - margin));
  return { left, top: up ? rect.top - gap - height : rect.bottom + gap, minWidth: rect.width, maxHeight, up };
}
