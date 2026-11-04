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
// - «at the end» tolerates 1 px, and a reserved inset (the composer) counts as the end.
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
 * `onAtBottomChange(bool)`: whether the end is in view. Returns { attach(el) → detach,
 * scrollToBottom(behavior), contentChanged(), threadSwitched(), runStarted(), setInset(px),
 * isAtBottom, following }.
 */
export function createFollowScroll({ onAtBottomChange = () => {}, raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 16), cancelRaf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout } = {}) {
  let el = null;
  let detachAll = null;
  let atBottom = true;
  let follow = true; // keep the end in view as content grows
  let paused = false; // something inside a message was opened
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
      } else if (wentUp) {
        intent = null;
        follow = false;
      }
      if (bottom || intent === null) setAtBottom(bottom);
    }
    lastTop = el.scrollTop;
    lastHeight = el.scrollHeight;
  };

  const scrollToBottom = (behavior = "auto") => {
    if (!el) return;
    follow = true;
    paused = false;
    movedSincePause = false;
    intent = behavior;
    if (typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior });
    else el.scrollTop = el.scrollHeight;
    if (behavior !== "smooth") intent = null;
    check();
  };

  const contentChanged = () => {
    if (!el) return;
    if (el.scrollHeight === seenHeight && el.clientHeight === seenClient) return;
    seenHeight = el.scrollHeight;
    seenClient = el.clientHeight;
    if (intent) scrollToBottom(intent);
    else if (follow && !paused) scrollToBottom("instant");
    check();
  };

  // Any going-up gesture stops following at once, before its scroll event: content that
  // grows in between must never pull the reader back down.
  const leave = () => {
    follow = false;
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
    if (e.deltaY < 0 && !innerTakesUp(e.target)) leave();
  };
  const onTouchStart = (e) => { touchY = e.touches?.[0]?.clientY ?? null; };
  const onTouchMove = (e) => {
    movedSincePause = true;
    const y = e.touches?.[0]?.clientY ?? null;
    if (y !== null && touchY !== null && y > touchY && !innerTakesUp(e.target)) leave();
    touchY = y;
  };
  const onKeyDown = (e) => {
    if (!SCROLL_KEYS.has(e.key) || e.target?.closest?.(TEXT_ENTRY)) return;
    movedSincePause = true;
    if (UP_KEYS.has(e.key) || (e.key === " " && e.shiftKey)) leave();
  };
  // Pressing the scrollbar (the element itself, not its content): wait for the scroll event.
  const onPointerDown = (e) => { if (e.target === el) { movedSincePause = true; intent = null; } };
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
      intent = null;
      setAtBottom(true);
      const unobserve = observeContent(node, contentChanged);
      const on = (type, fn, opts) => { node.addEventListener(type, fn, opts); return () => node.removeEventListener(type, fn, opts); };
      const offs = [
        unobserve,
        on("scroll", check, { passive: true }),
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
    scrollToBottom,
    contentChanged,
    /** Back to the end on the next frame (a chat just opened, or another one). */
    threadSwitched() {
      paused = false;
      follow = true;
      if (frame !== null) cancelRaf(frame);
      frame = raf(() => { frame = null; scrollToBottom("instant"); });
    },
    /** The chat reopened where you left it (not at the end): do not follow until you go back. */
    hold() { follow = false; intent = null; if (el) { lastTop = el.scrollTop; lastHeight = el.scrollHeight; setAtBottom(isAtBottom(el, inset)); } },
    /** You sent something: back to the end, whatever you were reading. */
    runStarted() { scrollToBottom("auto"); },
    setInset(px) {
      const grew = px > inset;
      inset = Math.max(0, px || 0);
      if (grew) contentChanged();
      check();
    },
    get isAtBottom() { return atBottom; },
    get following() { return follow && !paused; },
  };
}
