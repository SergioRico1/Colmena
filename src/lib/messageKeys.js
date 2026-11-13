// Keyboard between the composer and the messages of a conversation (rooms, 1:1 chats with a
// bot, chats with people):
//
//   composer   Escape (when no menu wanted it)  → the message list
//   list       ArrowUp / End → the newest message · ArrowDown / Home → the oldest on screen
//   message    ArrowUp / ArrowDown → the one before / after · Home / End → first / last
//              Tab → its own actions (react, reply, copy…), which show while it has focus
//   list or message   Escape → back to the composer
//
// The list is one Tab stop (`data-message-list`, tabIndex 0); messages are the elements
// marked `data-message-id` and take focus only from these keys (roving focus).

export const LIST = "[data-message-list]";
export const ROW = "[data-message-id]";

/**
 * Where a key takes you among `count` messages. `at` is the focused one, -1 when focus is
 * on the list itself. Returns the index to focus, or null when the key is not ours.
 * Past either end it stays (the caller may scroll for more).
 */
export function rowStep(count, at, key) {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(key)) return null;
  if (count <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (at < 0) return key === "ArrowUp" ? count - 1 : 0;
  return Math.max(0, Math.min(count - 1, at + (key === "ArrowUp" ? -1 : 1)));
}

/** The closest element matching `selector` around `from`: inside the nearest ancestor that has one. */
export function nearest(from, selector) {
  for (let n = from?.parentElement; n; n = n.parentElement) {
    const found = n.querySelector?.(selector);
    if (found) return found;
    if (n.matches?.("[role='dialog'],[role='alertdialog'],[data-v2-content]")) break;
  }
  return null;
}

const focus = (el) => { try { el.focus(); } catch { /* gone */ } };

/**
 * Escape in a composer that nothing else handled: focus goes to the message list. Returns
 * true when it did. A composer inside a dialog keeps Escape for closing the dialog.
 */
export function leaveComposer(e) {
  if (e.key !== "Escape" || e.defaultPrevented || e.nativeEvent?.isComposing) return false;
  const field = e.currentTarget;
  if (field?.closest?.("[role='dialog'],[role='alertdialog']")) return false;
  const list = nearest(field, LIST);
  if (!list) return false;
  e.preventDefault();
  focus(list);
  return true;
}

/** onKeyDown of the message list (the scroller marked `data-message-list`). */
export function messageListKeys(e) {
  const list = e.currentTarget, target = e.target;
  const onRow = target !== list && target.matches?.(ROW);
  if (target !== list && !onRow) {
    // A button or a field inside a message keeps its keys; Escape from one of its actions
    // goes back to the message (a field, or a menu that used the key, is left alone).
    const row = target.closest?.(ROW);
    if (e.key === "Escape" && !e.defaultPrevented && row && list.contains(row) && !target.matches?.("input, textarea, select, [contenteditable='true']")) {
      e.preventDefault();
      if (!row.hasAttribute("tabindex")) row.setAttribute("tabindex", "-1");
      focus(row);
    }
    return;
  }
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === "Escape") {
    const field = nearest(list, "textarea:not([disabled]), input[type='text']:not([disabled])");
    if (field) { e.preventDefault(); focus(field); }
    return;
  }
  const rows = [...list.querySelectorAll(ROW)];
  const at = onRow ? rows.indexOf(target) : -1;
  const to = rowStep(rows.length, at, e.key);
  if (to === null) return;
  e.preventDefault();
  if (to < 0) return;
  if (to === at) {
    // The end of what is drawn: a long conversation keeps only part of itself on screen.
    list.scrollBy?.({ top: e.key === "ArrowUp" || e.key === "Home" ? -240 : 240 });
    return;
  }
  const row = rows[to];
  if (!row.hasAttribute("tabindex")) row.setAttribute("tabindex", "-1");
  focus(row);
}

/** Props for the element that scrolls the messages. */
export const messageListProps = (label = "Mensajes") => ({ "data-message-list": "", tabIndex: 0, role: "group", "aria-label": label, onKeyDown: messageListKeys });
