import { memo } from "react";
import Markdown from "./Markdown.jsx";
import { repairTail, splitStable } from "../../lib/streaming.js";

export { repairTail, splitStable };

// Text that is still being written (OpenClaw streaming markdown): the finished part (up to
// the last blank line outside a code block) is parsed once and kept; only the short tail is
// parsed again on each frame, after closing what is half written (**, `, ``` and links), so
// nothing flashes as raw Markdown and the cost does not grow with the answer.

const Stable = memo(function Stable({ text, size, mentions, style }) {
  return <Markdown text={text} size={size} mentions={mentions} style={style} />;
});

const NONE = [];
export default function LiveMarkdown({ text, size = 16, mentions = NONE, caret = false, style }) {
  const [stable, tail] = splitStable(text);
  const repaired = repairTail(tail);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: size <= 14 ? "8px" : "12px" }}>
      {stable ? <Stable text={stable} size={size} mentions={mentions} style={style} /> : null}
      {repaired.trim() ? <Markdown text={repaired} size={size} mentions={mentions} style={style} /> : null}
      {caret ? <span aria-hidden="true" style={{ display: "inline-block", width: "2px", height: "1.1em", marginTop: stable || repaired.trim() ? "-8px" : "4px", verticalAlign: "text-bottom", background: "#12131A", animation: "caret 1s steps(1) infinite" }} /> : null}
    </div>
  );
}

// Steps whose answer was shown while it was written: their final message takes the place of
// the live text without rising in again (OpenClaw: one avatar per streamed reply).
const shownLive = new Set();
export function markLive(stepIds) {
  for (const id of stepIds) if (id) shownLive.add(id);
  if (shownLive.size > 500) for (const id of [...shownLive].slice(0, 250)) shownLive.delete(id);
}
export const wasLive = (stepId) => !!stepId && shownLive.has(stepId);
