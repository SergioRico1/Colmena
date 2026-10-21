import { useEffect, useRef } from "react";

// Jump to a message (OpenClaw chat-message-reveal): /sala/x?m=<id> or /chat/bot?c=y&m=<id>
// opens the conversation with that message centred and briefly highlighted. If it is older
// than what is loaded, the earlier pages load first, one after another. `locate(id)` (a
// virtual list) brings a loaded message that is not on screen into the page first.
export function useRevealMessage(messageId, { ready, olderCount = 0, showOlder = null, locate = null }) {
  const done = useRef(null);
  const asked = useRef(null); // the olderCount the last page was asked at
  useEffect(() => {
    if (!messageId || !ready || done.current === messageId) return undefined;
    let tries = 0;
    let timer;
    const look = () => {
      locate?.(messageId);
      const el = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
      if (el) {
        done.current = messageId;
        el.scrollIntoView({ block: "center", behavior: matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        flash(el);
        return;
      }
      if (olderCount && showOlder && asked.current !== olderCount && !(locate && locate(messageId))) {
        asked.current = olderCount;
        showOlder();
      }
      if (tries++ < 20) timer = setTimeout(look, 150);
    };
    timer = setTimeout(look, 60);
    return () => clearTimeout(timer);
  }, [messageId, ready, olderCount, showOlder, locate]);
}

/** The short highlight of a message you jumped to. */
export function flash(el) {
  el.classList.remove("c-reveal");
  void el.offsetWidth;
  el.classList.add("c-reveal");
  setTimeout(() => el.classList.remove("c-reveal"), 1400);
}

/** «…?m=id» added to a conversation's address. */
export const withMessage = (url, id) => url + (url.includes("?") ? "&" : "?") + "m=" + encodeURIComponent(id);
