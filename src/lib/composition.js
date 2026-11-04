// Writing with an input method (accents with dead keys, Japanese, Chinese, dictation that
// composes) must never send half a word nor open menus with it (after assistant-ui
// utils/isCompositionKey.ts and ComposerInput.tsx, MIT).

/**
 * A key that belongs to an IME composition. The Enter that commits one can arrive after
 * compositionend with isComposing false and keyCode 229 (Safari, some Windows IMEs).
 */
export const isCompositionKey = (event) => !!event && (event.isComposing === true || event.keyCode === 229);

/**
 * Tracks whether the box is composing. Some browsers never send compositionend (focus lost
 * mid-word, an IME switched off): the next change that is not composing clears it.
 */
export function createComposition() {
  let composing = false;
  return {
    get composing() { return composing; },
    start() { composing = true; },
    end() { composing = false; },
    /** On each change: true while that change is part of a composition. */
    change(nativeEvent) {
      const native = nativeEvent?.isComposing === true;
      if (composing && !native) composing = false;
      return native || composing;
    },
    /** On each key: true when the key must be left to the input method. */
    key(nativeEvent) { return composing || isCompositionKey(nativeEvent); },
  };
}

/** Focuses the box with the caret at the end, without scrolling anything. */
export function focusBox(el) {
  if (!el || typeof el.focus !== "function") return;
  el.focus({ preventScroll: true });
  try { el.setSelectionRange(el.value.length, el.value.length); } catch {}
}

/**
 * A turn starts: back to the box only if you were still in this chat (nothing focused, or
 * focus inside `root`) — never pull focus from another panel, menu or window.
 */
export function shouldRefocus(active, root, box, body) {
  if (!box || active === box) return false;
  return !active || active === body || !!root?.contains?.(active);
}
