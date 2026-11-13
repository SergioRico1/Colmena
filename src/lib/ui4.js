// Colmena 4 · the shared look of the screens (design/v4/colmena-v4.html): buttons, cards,
// section heads, rows and tags as inline-style objects, so every screen speaks the same
// density. Colours only through tokens (src/lib/theme.js); honey never appears here: only
// what waits for the person wears it (C.honey*, at the call site).
import { C, line } from "./theme.js";

const base = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px", height: "32px", padding: "0 12px", borderRadius: "var(--r-sm)", fontSize: "var(--t-meta)", fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer", textDecoration: "none", fontFamily: "inherit" };

/** Buttons: `B.primary` (ink), `B.secondary` (outlined), `B.ghost` (text); `B.lg` makes any of them 36 px. */
export const B = Object.freeze({
  primary: { ...base, border: `1px solid ${C.btn}`, background: C.btn, color: C.btnText },
  secondary: { ...base, border: line(true), background: C.raised, color: C.text },
  ghost: { ...base, border: "1px solid transparent", background: "transparent", color: C.text2 },
  danger: { ...base, border: line(true), background: C.raised, color: C.error },
  lg: { height: "36px", padding: "0 14px", fontSize: "var(--t-ui)" },
  icon: { ...base, width: "32px", padding: 0, border: "1px solid transparent", background: "transparent", color: C.text3 },
});

/** A bordered card on the window's ground (v4 cards have a hairline, not a shadow). */
export const CARD = Object.freeze({ border: line(), borderRadius: "var(--r-md)", background: C.card });
/** A row inside a card: the next one draws the hairline on top (`ROW_SEP` from the 2nd on). */
export const ROW = Object.freeze({ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px" });
export const ROW_SEP = Object.freeze({ borderTop: line() });

/** The page title (display face) and the line under it. */
export const H1 = Object.freeze({ margin: 0, font: "700 var(--t-headline)/1.15 'Bricolage Grotesque', 'Geist', sans-serif", letterSpacing: "-0.015em", color: C.text, textWrap: "balance" });
export const LEAD = Object.freeze({ margin: "6px 0 0", fontSize: "var(--t-ui)", lineHeight: 1.5, color: C.text3 });
/** A section head: title, a quiet count, and a link pushed to the right. */
export const SEC = Object.freeze({ display: "flex", alignItems: "center", gap: "8px", margin: "0 0 10px" });
export const H2 = Object.freeze({ margin: 0, fontSize: "var(--t-read)", fontWeight: 600, lineHeight: 1.3, color: C.text });
export const COUNT = Object.freeze({ fontSize: "var(--t-meta)", color: C.text3, fontVariantNumeric: "tabular-nums" });
export const MORE = Object.freeze({ marginLeft: "auto", fontSize: "var(--t-meta)", fontWeight: 500, color: C.accentInk, textDecoration: "none" });
/** The small heading of a side column («Hoy», «Ahora»). */
export const SIDE_H = Object.freeze({ margin: "0 0 8px", fontSize: "var(--t-caption)", fontWeight: 600, color: C.text3 });

/** A role or kind tag («Redacción», «PDF»). */
export const TAG = Object.freeze({ display: "inline-flex", alignItems: "center", height: "18px", padding: "0 6px", borderRadius: "var(--r-xs)", background: `color-mix(in oklab, ${C.text} 7%, transparent)`, color: C.text3, fontSize: "var(--t-micro)", fontWeight: 500, whiteSpace: "nowrap" });
/** A chip (filters, choices): `on` fills it with the ink. */
export const chip = (on = false) => ({ display: "inline-flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 10px", borderRadius: "var(--r-sm)", border: on ? `1px solid ${C.btn}` : line(), background: on ? C.btn : C.card, color: on ? C.btnText : C.text2, fontSize: "var(--t-meta)", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" });
/** The honey count of what waits for you (and only that). */
export const WAIT_COUNT = Object.freeze({ minWidth: "20px", height: "20px", padding: "0 6px", display: "inline-grid", placeItems: "center", borderRadius: "var(--r-pill)", background: C.honey, color: C.honeyInk, fontSize: "var(--t-micro)", fontWeight: 600, fontVariantNumeric: "tabular-nums" });
/** A thin progress track and its fill. */
export const TRACK = Object.freeze({ position: "relative", height: "4px", borderRadius: "var(--r-xs)", background: C.line, overflow: "hidden" });
export const fill = (pct) => ({ position: "absolute", inset: "0 auto 0 0", width: Math.max(4, Math.min(100, pct ?? 4)) + "%", background: C.text, opacity: 0.7, borderRadius: "var(--r-xs)", transition: "width .4s ease" });
/** One line, cut with an ellipsis. */
export const ONE = Object.freeze({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
