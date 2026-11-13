import { useState } from "react";
import { AlarmClock, CalendarClock, Clock, Sun } from "../Icon.js";
import { MenuButton } from "../Menu.js";
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
  const [busy, setBusy] = useState(false);
  const choices = snoozeChoicesFor(items);
  if (!choices.length) return null;

  const choose = async (choice) => {
    if (busy) return;
    setBusy(true);
    onError?.(null);
    try {
      await run(() => snooze(items, choice.at));
      reversible({
        id: "snooze:" + items[0].id,
        text: `Pospuesto: vuelve ${snoozeWhen(choice.at)}`,
        undo: () => run(() => snooze(items, null)),
        error: "No se pudo traer de vuelta",
      });
    } catch (e) {
      onError?.(e?.message || "No se pudo posponer. Vuelve a intentarlo.");
    } finally {
      setBusy(false);
    }
  };

  // The app's one menu (components/Menu.js): each choice says when it comes back.
  const entries = choices.map((c) => ({ label: c.label, icon: c.id === "hour" ? Clock : c.id === "tomorrow" ? Sun : CalendarClock, meta: c.id === "hour" ? hhmm(c.at) : null, onSelect: () => choose(c) }));
  return (
    <MenuButton items={entries} menuLabel="Recordar después" placement="bottom-start" disabled={busy} showTitle={false} openStyle={{}} style={{ ...style, display: "inline-flex", alignItems: "center", gap: "6px" }}>
      <AlarmClock size={15} strokeWidth={2} aria-hidden="true" />{"Recordar después"}
    </MenuButton>
  );
}
const hhmm = (d) => d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
