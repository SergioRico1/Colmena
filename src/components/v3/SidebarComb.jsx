import { memo, useEffect, useState } from "react";
import { hexPath, pitch } from "../../lib/hive.js";

// A corner of the home page's honeycomb at the top of the sidebar (src/lib/hive.js; the onboarding
// draws the same comb alive). Decorative and quiet: hairline cells in the ink colour at a few
// percent, painted under the bar's rows. Open, it fills the empty stretch of the title strip
// between the wordmark and «Plegar»; folded, a thin column beside the button. No cell sits under
// a control or a word.
// It reacts twice, both in CSS: one cell fills honey while something waits for you («te
// necesita»), and one breathes faintly while a bot works. No timers, no canvas; the breathing is
// an opacity animation the compositor runs, stopped while the window is hidden and still with
// reduced motion (styles in base.css › .sb-comb).

// Per shape: cell radius, the cells as [column, row] of an offset comb, the two that react, and
// how far from the bar's right edge the patch ends (clear of «Plegar»).
const SHAPES = {
  open: { r: 9, right: 50, cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [3, 2], [4, 2], [5, 2]], honey: [3, 1], work: [1, 0] },
  folded: { r: 5, right: 1, cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]], honey: [0, 2], work: [0, 4] },
};

function SidebarComb({ folded = false, waiting = false, working = false }) {
  const [hidden, setHidden] = useState(typeof document !== "undefined" && document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  const s = SHAPES[folded ? "folded" : "open"];
  const { cw, rh } = pitch(s.r);
  const centre = ([c, r]) => [c * cw + (r & 1 ? cw / 2 : 0) + cw / 2, r * rh + s.r + 1];
  const width = Math.ceil((Math.max(...s.cells.map(([c]) => c)) + 1.5) * cw);
  const height = Math.ceil((Math.max(...s.cells.map(([, r]) => r)) + 1) * rh + s.r);
  const path = (cell, inset = 1) => { const [x, y] = centre(cell); return hexPath(x, y, s.r - inset); };
  return (
    <svg className="sb-comb" data-folded={folded ? "" : undefined} data-paused={hidden ? "" : undefined} aria-hidden="true" focusable="false" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ right: s.right + "px" }}>
      <path className="sb-comb-lines" d={s.cells.map((c) => path(c)).join("")} />
      {waiting ? <path className="sb-comb-honey" d={path(s.honey, folded ? 1.5 : 2.5)} /> : null}
      {working ? <path className="sb-comb-work" d={path(s.work, folded ? 1.5 : 2.5)} /> : null}
    </svg>
  );
}

export default memo(SidebarComb);
