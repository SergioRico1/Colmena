import { useCallback, useEffect, useRef, useState } from "react";

// Conversations open at the latest message (as in Slack) and follow new ones while you are
// at the end (OpenClaw chat scroll). Any move up by you stops following, so nothing moves
// under you while you read; new content then shows «Mensajes nuevos ↓». Going back to the
// end (or the pill) follows again. Each conversation remembers where you left it.
const END_PX = 8; // «at the end»
const BACK_PX = 48; // back near the end: follow again
const places = new Map(); // key → { top, following }

/**
 * Returns { ref, below, toEnd }: `ref` is a callback ref for the scrolling element (it may
 * appear after loading), `below` is true while new content arrived under your reading
 * place, `toEnd()` scrolls to the latest message and follows again.
 */
export function useFollow(key) {
  const following = useRef(true);
  const cleanup = useRef(null);
  const node = useRef(null);
  const keyRef = useRef(key);
  const [below, setBelow] = useState(false);
  const belowRef = useRef(false);
  const setBelowOnce = (v) => { if (belowRef.current !== v) { belowRef.current = v; setBelow(v); } };

  const attach = useCallback((el) => {
    cleanup.current?.();
    cleanup.current = null;
    node.current = el;
    if (!el) return;
    let lastTop = el.scrollTop, ours = false, frame = 0;
    const toBottom = () => {
      ours = true;
      el.scrollTop = el.scrollHeight;
      lastTop = el.scrollTop;
    };
    const gap = () => el.scrollHeight - el.scrollTop - el.clientHeight;
    const onScroll = () => {
      const top = el.scrollTop;
      const movedUp = top < lastTop - 1;
      lastTop = top;
      if (ours && !movedUp) { ours = false; return; }
      ours = false;
      if (movedUp && gap() > END_PX) following.current = false;
      else if (gap() <= BACK_PX) { following.current = true; setBelowOnce(false); }
      places.set(keyRef.current, { top, following: following.current });
    };
    // Content arrives in pieces (messages, live text, cards, images…): one anchor per frame.
    const follow = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (following.current) toBottom();
        else if (gap() > BACK_PX) setBelowOnce(true);
      });
    };
    const mutations = new MutationObserver(follow);
    mutations.observe(el, { childList: true, subtree: true, characterData: true });
    const sizes = new ResizeObserver(follow);
    sizes.observe(el);
    for (const child of el.children) sizes.observe(child);
    el.addEventListener("scroll", onScroll, { passive: true });
    // Back to this conversation: where you left it, or its latest message.
    const place = places.get(keyRef.current);
    requestAnimationFrame(() => {
      if (place && !place.following) {
        following.current = false;
        ours = true;
        el.scrollTop = place.top;
        lastTop = el.scrollTop;
      } else toBottom();
    });
    cleanup.current = () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      sizes.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Another conversation in the same screen: its own place.
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    const el = node.current;
    const place = places.get(key);
    following.current = !place || place.following;
    setBelowOnce(false);
    if (el) requestAnimationFrame(() => { el.scrollTop = following.current ? el.scrollHeight : place.top; });
  }, [key]);
  useEffect(() => () => cleanup.current?.(), []);

  const toEnd = useCallback(() => {
    const el = node.current;
    following.current = true;
    setBelowOnce(false);
    places.delete(keyRef.current);
    if (!el) return;
    const smooth = typeof matchMedia !== "function" || !matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);
  return { ref: attach, below, toEnd };
}

/** Older callers: just the ref. */
export function useStickToBottom(key) {
  return useFollow(key).ref;
}
