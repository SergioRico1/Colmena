// Following the answer as it arrives (after assistant-ui thread-viewport-auto-scroll.ts and
// viewport-scroll.ts, MIT): the conversation stays at its end while you are there, and stops
// following the moment you go up — wheel, touch, keyboard or the scrollbar — even while text
// keeps arriving. It never fights the reader:
// - a gesture that a scrolling block inside a message can still take (a long code block)
//   goes to that block first and does not count as leaving the end;
// - opening something inside a message (a «Cómo lo hizo», a step) pauses following, so what
//   you opened does not run away under you;
// - growth without DOM changes (images, fonts, a textarea) is caught by ResizeObserver,
//   new nodes by MutationObserver;
// - «at the end» tolerates 1 px, and a reserved inset (the composer) counts as the end;
// - a long answer opens at its first line: while it follows, the start of the latest answer
//   (`anchor`) is never pushed out of view — the list stops there, with that start at the top,
//   and the reader goes on from the first line (`landing`). The same holds while the answer
//   is still being written: it follows until the answer's top would leave, then lets it grow
//   below; when the finished answer takes the place of the one being written, or the rows
//   over it change height, it lands on that start again — until the reader moves: from then
//   on the place is theirs. Each answer lands once: after the reader (or «Ir al final») goes
//   on to its end, that answer is followed like any other content.
// No framework: the virtual list (Timeline.jsx) attaches it to its scrolling element.

const DISCLOSURE = "[aria-expanded], summary";
const ROW = "[data-index], [data-message-id]";
const TEXT_ENTRY = "textarea, select, [contenteditable]:not([contenteditable='false']), input:not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit'])";
const SCROLL_KEYS = new Set([" ", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);
const UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);

/** At the end, within 1 px; with an inset, the inset's height also counts as the end. */
export function isAtBottom({ scrollTop, scrollHeight, clientHeight }, inset = 0) {
  return scrollHeight - inset - scrollTop - clientHeight <= 1 || scrollHeight - inset <= clientHeight;
}
const overflows = ({ scrollHeight, clientHeight }, inset = 0) => scrollHeight - inset > clientHeight + 1;

/**
 * Where the list lands when its content grew while it followed the end: the end, unless
 * that would push the start of the latest answer out of view (`block`: { top } in the
 * content, null when there is none) — then that start stays `pad` px under the top of the
 * viewport: { top, pinned }.
 */
export function landing({ scrollHeight, clientHeight }, block = null, { pad = 0, inset = 0 } = {}) {
  const end = Math.max(0, scrollHeight - inset - clientHeight);
  if (!block || !Number.isFinite(block.top)) return { top: end, pinned: false };
  const start = Math.max(0, block.top - pad);
  return start < end - 1 ? { top: start, pinned: true } : { top: end, pinned: false };
}

const isElement = (node) => !!node && node.nodeType === 1;

/** Something closed (aria-expanded="false", a closed <details>) that a click opens. */
function opensDisclosure(target) {
  const control = target?.closest?.(DISCLOSURE);
  if (!control) return false;
  if (control.tagName === "SUMMARY") return control.parentElement?.hasAttribute("open") === false;
  const popup = control.getAttribute("aria-haspopup");
  return control.getAttribute("aria-expanded") === "false" && (popup === null || popup === "false") && control.getAttribute("role") !== "combobox";
}

/** Calls `onChange` when the content grows or shrinks, however it happens. */
function observeContent(el, onChange) {
  const off = [];
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => onChange()) : null;
  if (ro) {
    ro.observe(el);
    // Content can grow without a DOM change (an image, a font): only its children's sizes show it.
    for (const child of el.children || []) ro.observe(child);
    off.push(() => ro.disconnect());
  }
  if (typeof MutationObserver === "function") {
    const mo = new MutationObserver((mutations) => {
      if (ro) for (const m of mutations) {
        if (m.target !== el) continue;
        for (const n of m.addedNodes) if (isElement(n)) ro.observe(n);
        for (const n of m.removedNodes) if (isElement(n)) ro.unobserve(n);
      }
      // Style-only changes are the list placing its rows: they follow through the sizes.
      if (mutations.some((m) => m.type !== "attributes" || m.attributeName !== "style")) onChange();
    });
    mo.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
    off.push(() => mo.disconnect());
  }
  return () => off.forEach((fn) => fn());
}

/**
 * `onAtBottomChange(bool)`: whether the end is in view. `anchor()` gives the start of the
 * latest answer ({ top, id? } in the content; `id` names the answer across the row being
 * written and the finished one) or null; `pad` is the room left over it. Returns
 * { attach(el) → detach, scrollToBottom(behavior), contentChanged(), threadSwitched(),
 * runStarted(), setInset(px), reland(), isAtBottom, following, pinned }.
 */
export function createFollowScroll({ onAtBottomChange = () => {}, anchor = null, pad = 0, raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 16), cancelRaf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout } = {}) {
  let el = null;
  let detachAll = null;
  let atBottom = true;
  let follow = true; // keep the end in view as content grows
  let paused = false; // something inside a message was opened
  let pinned = false; // it stopped at the start of a long answer, and the reader has not moved since
  let landedId = null; // the answer it stopped on
  let doneId = null; // the answer whose end the reader went on to: it does not land again
  let movedSincePause = false;
  let intent = null; // a scroll to the end on its way ("auto" | "smooth" | "instant")
  let lastTop = 0;
  let lastHeight = 0;
  let seenHeight = 0;
  let seenClient = 0;
  let inset = 0;
  let frame = null;
  let touchY = null;

  const setAtBottom = (v) => { if (v !== atBottom) { atBottom = v; onAtBottomChange(v); } };

  const check = () => {
    if (!el) return;
    const bottom = isAtBottom(el, inset);
    // Up from where it was, while the content did not shrink: the reader went up.
    const clampTop = Math.max(0, lastHeight - el.clientHeight);
    const wentUp = el.scrollTop < Math.min(lastTop, clampTop) - 0.5 && el.scrollHeight >= lastHeight;
    const goingDown = intent !== null && !bottom && lastTop < el.scrollTop;
    if (!goingDown) {
      if (bottom) {
        // Without overflow «at the end» means nothing yet: the intent waits for real content.
        if (overflows(el, inset)) {
          intent = null;
          if (paused && movedSincePause) paused = false;
          movedSincePause = false;
        }
        follow = true;
        passed();
      } else if (wentUp) {
        intent = null;
        follow = false;
      }
      if (bottom || intent === null) setAtBottom(bottom);
    }
    lastTop = el.scrollTop;
    lastHeight = el.scrollHeight;
  };

  // Going on to the end of the answer it had stopped on: that answer has had its landing.
  const passed = () => { if (landedId !== null) { doneId = landedId; landedId = null; } };

  const scrollToBottom = (behavior = "auto") => {
    if (!el) return;
    follow = true;
    pinned = false;
    paused = false;
    movedSincePause = false;
    intent = behavior;
    if (typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior });
    else el.scrollTop = el.scrollHeight;
    if (behavior !== "smooth") intent = null;
    check();
  };

  // The end, or the start of the latest answer when the end would hide it.
  const land = () => {
    const found = anchor ? anchor() : null;
    const block = found && found.id != null && found.id === doneId ? null : found;
    const to = landing(el, block, { pad, inset });
    if (!to.pinned) { scrollToBottom("instant"); return; }
    follow = false;
    intent = null;
    pinned = true;
    landedId = block.id ?? true;
    if (Math.abs(el.scrollTop - to.top) > 0.5) {
      if (typeof el.scrollTo === "function") el.scrollTo({ top: to.top, behavior: "instant" });
      else el.scrollTop = to.top;
    }
    lastTop = el.scrollTop;
    lastHeight = el.scrollHeight;
    setAtBottom(isAtBottom(el, inset));
  };

  const contentChanged = () => {
    if (!el) return;
    if (el.scrollHeight === seenHeight && el.clientHeight === seenClient) return;
    seenHeight = el.scrollHeight;
    seenClient = el.clientHeight;
    if (intent) scrollToBottom(intent);
    else if (follow && !paused) land();
    // Still on the start of the answer (the reader has not moved): it stays there while the
    // finished answer takes the place of the one being written and the rows over it settle.
    else if (pinned && anchor?.()) land();
    check();
  };
  // A scroll while it holds the start of an answer is not the reader's (their gestures let
  // go of it first): the list moved it to make up for a row measured over it. Back on the start.
  const onScroll = () => {
    if (pinned) {
      const block = anchor?.();
      const to = block ? landing(el, block, { pad, inset }) : null;
      if (to?.pinned && Math.abs(el.scrollTop - to.top) > 1) land();
    }
    check();
  };

  // Any going-up gesture stops following at once, before its scroll event: content that
  // grows in between must never pull the reader back down.
  const leave = () => {
    follow = false;
    pinned = false;
    intent = null;
    if (frame !== null) { cancelRaf(frame); frame = null; }
  };
  // The nearest scrolling block under the pointer that can still go up takes the gesture.
  const innerTakesUp = (target) => {
    for (let node = isElement(target) ? target : null; node && node !== el; node = node.parentElement) {
      if (node.scrollTop > 0 && typeof getComputedStyle === "function" && /^(auto|scroll)$/.test(getComputedStyle(node).overflowY)) return true;
    }
    return false;
  };
  const onWheel = (e) => {
    movedSincePause = true;
    pinned = false;
    if (e.deltaY < 0 && !innerTakesUp(e.target)) leave();
  };
  const onTouchStart = (e) => { touchY = e.touches?.[0]?.clientY ?? null; };
  const onTouchMove = (e) => {
    movedSincePause = true;
    pinned = false;
    const y = e.touches?.[0]?.clientY ?? null;
    if (y !== null && touchY !== null && y > touchY && !innerTakesUp(e.target)) leave();
    touchY = y;
  };
  const onKeyDown = (e) => {
    if (!SCROLL_KEYS.has(e.key) || e.target?.closest?.(TEXT_ENTRY)) return;
    movedSincePause = true;
    pinned = false;
    if (UP_KEYS.has(e.key) || (e.key === " " && e.shiftKey)) leave();
  };
  // Pressing the scrollbar (the element itself, not its content): wait for the scroll event.
  const onPointerDown = (e) => { if (e.target === el) { movedSincePause = true; pinned = false; intent = null; } };
  const onClick = (e) => {
    const t = e.target;
    if (!t?.closest?.(ROW) || t.closest(TEXT_ENTRY) || !opensDisclosure(t)) return;
    paused = true;
    movedSincePause = false;
    intent = null;
  };

  return {
    attach(node) {
      detachAll?.();
      el = node;
      lastTop = node.scrollTop;
      lastHeight = node.scrollHeight;
      seenHeight = 0;
      seenClient = 0;
      follow = true;
      paused = false;
      pinned = false;
      landedId = null;
      doneId = null;
      intent = null;
      setAtBottom(true);
      const unobserve = observeContent(node, contentChanged);
      const on = (type, fn, opts) => { node.addEventListener(type, fn, opts); return () => node.removeEventListener(type, fn, opts); };
      const offs = [
        unobserve,
        on("scroll", onScroll, { passive: true }),
        on("wheel", onWheel, { passive: true }),
        on("touchstart", onTouchStart, { passive: true }),
        on("touchmove", onTouchMove, { passive: true }),
        on("keydown", onKeyDown),
        on("pointerdown", onPointerDown, { passive: true }),
        on("click", onClick, true),
      ];
      const detach = () => {
        if (detachAll !== detach) return;
        offs.forEach((fn) => fn());
        if (frame !== null) { cancelRaf(frame); frame = null; }
        el = null;
        detachAll = null;
      };
      detachAll = detach;
      return detach;
    },
    scrollToBottom(behavior) { passed(); scrollToBottom(behavior); },
    contentChanged,
    /** Back to the end on the next frame (a chat just opened, or another one). */
    threadSwitched() {
      paused = false;
      follow = true;
      if (frame !== null) cancelRaf(frame);
      frame = raf(() => { frame = null; scrollToBottom("instant"); });
    },
    /** The chat reopened where you left it (not at the end): do not follow until you go back. */
    hold() { follow = false; pinned = false; intent = null; if (el) { lastTop = el.scrollTop; lastHeight = el.scrollHeight; setAtBottom(isAtBottom(el, inset)); } },
    /** You sent something: back to the end, whatever you were reading. */
    runStarted() { passed(); scrollToBottom("auto"); },
    setInset(px) {
      const grew = px > inset;
      inset = Math.max(0, px || 0);
      if (grew) contentChanged();
      check();
    },
    /**
     * The row it stopped on was replaced (the answer being written is now the finished one):
     * land on the start of the new one. Nothing happens once the reader has moved, or while
     * the new row is not in the page yet.
     */
    reland() {
      if (!el || !pinned || !anchor?.()) return;
      land();
      check();
    },
    get isAtBottom() { return atBottom; },
    /** Stopped at the start of a long answer, and the reader has not moved since. */
    get pinned() { return pinned; },
    get following() { return follow && !paused; },
  };
}
