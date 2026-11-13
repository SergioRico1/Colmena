import { useCallback, useRef, useState } from "react";
import { X } from "../Icon.js";
import { useDialogFocus } from "../../lib/useDialogFocus.js";
import { WORDS } from "../../lib/invite.js";
import "../../styles/conversation.css";
import "../../styles/invite.css";

// The pieces the invitation sheets share (styles/invite.css): the dialog itself, the block that
// says why inviting cannot happen now, the copy buttons and a picker list with roving focus.

/**
 * A dialog over the app: a veil, the card, a title (and a line under it), «Cerrar», a scrolling
 * body and an optional foot. The keyboard stays inside; Escape closes; focus goes back on close.
 */
export function InvSheet({ id, title, sub = null, width = 560, onClose, foot = null, children }) {
  const box = useDialogFocus({ onEscape: onClose });
  return (
    <div className="inv-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section ref={box} role="dialog" aria-modal="true" aria-labelledby={id} className="inv-card" style={{ "--inv-w": width + "px" }}>
        <div className="inv-head">
          <div style={{ minWidth: 0 }}>
            <h2 id={id}>{title}</h2>
            {sub ? <p className="inv-sub">{sub}</p> : null}
          </div>
          <button type="button" className="inv-x" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="inv-body">{children}</div>
        {foot ? <div className="inv-foot">{foot}</div> : null}
      </section>
    </div>
  );
}

/** Why it cannot happen now (lib/invite.js › inviteBlock), with the way out when there is one. */
export function Blocked({ block, onGo = null }) {
  if (!block) return null;
  return (
    <div className="inv-block" role="note">
      <b>{block.title}</b>
      <span>{block.text}</span>
      {block.action ? <a href={block.action.href} onClick={onGo || undefined} className="v4-btn primary" style={{ alignSelf: "flex-start", marginTop: "4px" }}>{block.action.label}</a> : null}
    </div>
  );
}

/** Copies `text` and says so for a moment («Copiado»), to the eye and to a screen reader. */
export function useCopy(onError) {
  const [copied, setCopied] = useState(null);
  const timer = useRef(null);
  const copy = useCallback(async (key, text) => {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      setCopied(key);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 2500);
    } catch {
      onError?.("No se pudo copiar. Selecciona el texto y cópialo tú.");
    }
  }, [onError]);
  return [copied, copy];
}

/**
 * A list you move through with the arrows (one Tab stop): Home/End jump, Enter or Space picks.
 * `items` [{key, disabled}], `onPick(item)`. Returns props for the <ul> and for each <li>.
 */
export function useRoving(items, onPick) {
  const [active, setActive] = useState(0);
  const list = useRef(null);
  const at = Math.min(active, Math.max(0, items.length - 1));
  const focusAt = (i) => {
    setActive(i);
    requestAnimationFrame(() => list.current?.querySelectorAll("[data-opt]")[i]?.focus());
  };
  const onKeyDown = (e) => {
    if (!items.length) return;
    const last = items.length - 1;
    if (e.key === "ArrowDown") { e.preventDefault(); focusAt(at >= last ? 0 : at + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusAt(at <= 0 ? last : at - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusAt(0); }
    else if (e.key === "End") { e.preventDefault(); focusAt(last); }
    else if (e.key === "Enter" || e.key === " ") {
      const item = items[at];
      if (item && !item.disabled && e.target?.hasAttribute?.("data-opt")) { e.preventDefault(); onPick(item); }
    }
  };
  const itemProps = (i) => ({
    "data-opt": "", tabIndex: i === at ? 0 : -1, "data-active": i === at ? "true" : undefined,
    onFocus: () => setActive(i), onClick: () => { setActive(i); if (!items[i]?.disabled) onPick(items[i]); },
  });
  return { listProps: { ref: list, onKeyDown }, itemProps, active: at, focusFirst: () => focusAt(0) };
}

/** «Copiar mensaje» and «Copiar código» side by side, the message first: it is what most people send. */
export function CopyButtons({ made, copied, copy }) {
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      <button type="button" className="v4-btn primary lg" data-autofocus="" onClick={() => copy("message", made.text)}>{copied === "message" ? "Mensaje copiado" : WORDS.copyMessage}</button>
      <button type="button" className="v4-btn lg" onClick={() => copy("code", made.code)}>{copied === "code" ? "Código copiado" : WORDS.copyCode}</button>
      <span role="status" className="inv-sr">{copied === "message" ? "Mensaje copiado" : copied === "code" ? "Código copiado" : ""}</span>
    </span>
  );
}
