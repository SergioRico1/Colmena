// The frame of the hosted pages: the living hive behind, the wordmark, the page's card set in a
// clearing of the comb, a quiet foot. The card is usable at first paint; the hive only decorates.
import { useRef } from "react";
import Logo from "../components/Logo.jsx";
import WindowChrome from "../components/WindowChrome.jsx";
import Hive from "./Hive.jsx";
import { SEEDED_TEAM } from "../lib/hive.js";

// Inside the desktop app (cloud mode, docs/CLOUD.md › Phase 5) the window is frameless: its own bar.
const inDesktop = () => typeof window !== "undefined" && !!window.colmenaWindow?.close;

/**
 * `bots`: who flies in the hive (the seeded team by default); `asleep`: they rest with their eyes
 * closed. `wide`: the card takes the wider measure (company pages). `below`: what sits under the
 * card, outside it (the roster of the team).
 */
export function Shell({ children, wide = false, right = null, bots = SEEDED_TEAM, asleep = false, below = null, label = null }) {
  const card = useRef(null);
  return (
    <div className={"cl-shell" + (inDesktop() ? " in-desktop" : "")}>
      {inDesktop() ? <WindowChrome /> : null}
      <Hive bots={bots} asleep={asleep} clear={card} />
      <header className="cl-top">
        <nav aria-label="Colmena" className="cl-nav">
          <a href="/" aria-label="Colmena, inicio" className="cl-brand"><Logo size={28} fontSize={20} tone="dark" gap={9} /></a>
        </nav>
        {right}
      </header>
      <main className={"cl-main" + (wide ? " wide" : "")}>
        <div ref={card} className="cl-card" aria-label={label || undefined} role={label ? "region" : undefined}>{children}</div>
        {below}
      </main>
      <footer className="cl-foot">Colmena · tus datos se guardan cifrados en la Unión Europea</footer>
    </div>
  );
}
