import { useEffect, useRef, useState } from "react";
import { AlarmClock } from "lucide-react";
import { post } from "../../lib/api.js";
import { useStore } from "../../lib/store.jsx";
import { reversible } from "../../lib/undoToast.js";
import { snoozeChoicesFor, snoozeWhen } from "../../lib/snooze.js";

// «Recordar después» on a request that waits for you: in one hour, tomorrow at 9:00 or next
// Monday at 9:00. The request leaves «Te necesitan» and its counts until then and comes back
// by itself (the time is kept on the approval, server/snooze.mjs). Not offered for what has a
// deadline that would pass first: a send about to leave, a request that expires, a timed
// question. The 5 s notice undoes it.

/** Puts these requests off until `at` (a Date), or brings them back with `null`. */
export async function snooze(items, at) {
  for (const a of items) await post(`/approvals/${encodeURIComponent(a.id)}/snooze`, { until: at ? at.toISOString() : null });
}

/**
 * @param {object} p
 * @param {object[]} p.items the approval(s) of the card (a folded card passes all of them)
 * @param {object} p.style the card's own quiet button style
 * @param {(message: string) => void} [p.onError] where the card shows what went wrong
 */
export default function SnoozeMenu({ items, style, onError }) {
  const { run } = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  const button = useRef(null);
  const menu = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    menu.current?.querySelector("[role='menuitem']")?.focus({ preventScroll: true });
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [open]);

  const choices = snoozeChoicesFor(items);
  if (!choices.length) return null;

  const close = (refocus = true) => { setOpen(false); if (refocus) button.current?.focus({ preventScroll: true }); };
  const onKeyDown = (e) => {
    if (!open) return;
    const rows = [...(menu.current?.querySelectorAll("[role='menuitem']") || [])];
    const at = rows.indexOf(document.activeElement);
    const to = e.key === "ArrowDown" ? rows[(at + 1) % rows.length] : e.key === "ArrowUp" ? rows[(at - 1 + rows.length) % rows.length] : e.key === "Home" ? rows[0] : e.key === "End" ? rows.at(-1) : null;
    if (to) { e.preventDefault(); to.focus({ preventScroll: true }); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "Tab") setOpen(false);
  };
  const choose = async (choice) => {
    if (busy) return;
    setBusy(true);
    onError?.(null);
    try {
      await run(() => snooze(items, choice.at));
      setOpen(false);
      reversible({
        id: "snooze:" + items[0].id,
        text: `Pospuesto: vuelve ${snoozeWhen(choice.at)}`,
        undo: () => run(() => snooze(items, null)),
        error: "No se pudo traer de vuelta",
      });
    } catch (e) {
      close();
      onError?.(e?.message || "No se pudo posponer. Vuelve a intentarlo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span ref={box} onKeyDown={onKeyDown} style={{ position: "relative", display: "inline-flex" }}>
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open ? "true" : "false"} onClick={() => setOpen((v) => !v)} style={{ ...style, display: "inline-flex", alignItems: "center", gap: "6px" }}>
        <AlarmClock size={15} strokeWidth={2} aria-hidden="true" />{"Recordar después"}
      </button>
      {open ? (
        <div ref={menu} role="menu" aria-label="Recordar después" style={{ position: "absolute", zIndex: 20, top: "calc(100% + 6px)", left: "0", minWidth: "270px", display: "flex", flexDirection: "column", gap: "2px", padding: "6px", borderRadius: "16px", background: "#FFFFFF", boxShadow: "0 2px 6px rgba(18,19,26,.08), 0 24px 48px -20px rgba(18,19,26,.4)", animation: "fade .15s ease-out" }}>
          {choices.map((c) => (
            <button key={c.id} type="button" role="menuitem" disabled={busy} onClick={() => choose(c)} className="v3-hover"
              style={{ display: "flex", alignItems: "center", minHeight: "40px", padding: "0 10px", border: "0", borderRadius: "10px", background: "transparent", textAlign: "left", cursor: busy ? "progress" : "pointer", fontSize: "14px", color: "#12131A" }}>
              {c.label}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
