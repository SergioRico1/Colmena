import { memo, useEffect, useState } from "react";
import { hexPath, pitch } from "../../lib/hive.js";

// A corner of the home page's honeycomb at the top of the sidebar (src/lib/hive.js; the onboarding
// draws the same comb alive). Decorative and quiet: hairline cells in the ink colour at a few
// percent, fading out towards the content, painted under the bar's rows so it never sits on text.
// It reacts twice, both in CSS: one cell fills honey while something waits for you («te
// necesita»), and one breathes faintly while a bot works. No timers, no canvas; the breathing is
// an opacity animation the compositor runs, stopped while the window is hidden and absent with
// reduced motion (styles in base.css › .sb-comb).

const R = 9;
// Cells of the patch, as [column, row] of an offset comb: a ragged corner, denser at the edge.
const OPEN = [[5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [6, 1], [7, 1], [8, 1], [9, 1], [7, 2], [8, 2], [9, 2], [8, 3], [9, 3], [9, 4]];
const FOLDED = [[2, 0], [3, 0], [2, 1], [3, 1], [3, 2], [3, 3]];
// The two cells that react sit in the header's empty stretch, clear of the wordmark and buttons.
const HONEY_CELL = { open: [6, 1], folded: [3, 2] };
const WORK_CELL = { open: [5, 0], folded: [3, 0] };

const centre = ([c, r]) => { const { cw, rh } = pitch(R); return [c * cw + (r & 1 ? cw / 2 : 0) + cw / 2, r * rh + R]; };

function SidebarComb({ folded = false, waiting = false, working = false }) {
  const [hidden, setHidden] = useState(typeof document !== "undefined" && document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  const cells = folded ? FOLDED : OPEN;
  const { cw } = pitch(R);
  const width = Math.ceil((Math.max(...cells.map(([c]) => c)) + 1.5) * cw);
  const height = Math.ceil((Math.max(...cells.map(([, r]) => r)) + 1) * 1.5 * R + R);
  const at = (cell) => cells.some(([c, r]) => c === cell[0] && r === cell[1]);
  const key = folded ? "folded" : "open";
  const path = (cell, r = R - 1) => { const [x, y] = centre(cell); return hexPath(x, y, r); };
  return (
    <svg className="sb-comb" data-folded={folded ? "" : undefined} data-paused={hidden ? "" : undefined} aria-hidden="true" focusable="false" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path className="sb-comb-lines" d={cells.map((c) => path(c)).join("")} />
      {waiting && at(HONEY_CELL[key]) ? <path className="sb-comb-honey" d={path(HONEY_CELL[key], R - 2.5)} /> : null}
      {working && at(WORK_CELL[key]) ? <path className="sb-comb-work" d={path(WORK_CELL[key], R - 2.5)} /> : null}
    </svg>
  );
}

export default memo(SidebarComb);
