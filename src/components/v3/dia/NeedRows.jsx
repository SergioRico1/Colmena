import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, Hash } from "../../Icon.js";
import { scheduleApproval } from "./Needs.jsx";
import { foldRows, needRow } from "./needRows.js";
import { Shape } from "./parts.jsx";
import { B } from "../../../lib/ui4.js";
import { approvalCard } from "../../../lib/approvalCard.js";
import { navigate } from "../../../lib/router.jsx";

// «Te necesitan» on Inicio: one compact row per thing that waits (who, what, the action that
// moves it on), three on screen and «Ver las N» for the rest. A row opens its full card in
// place: the same card as before, with every verb and line of lib/approvalCard.js. The honey
// ground is theirs alone: each of them waits for you.

// v4: the rows share one honey ground (muted amber in dark, no glow), split by hairlines.
const box = { margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", border: "1px solid var(--c-honey-ring)", borderRadius: "var(--r-md)", background: "var(--c-honey-soft)", overflow: "hidden" };
const sep = "1px solid color-mix(in oklab, var(--c-honey-ring) 55%, transparent)";
const one = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

/**
 * `entries`: needEntries(needsOf(store)); `card(entry)`: the full card of one of them;
 * `botOf(id)`: the bot record.
 */
export default function NeedRows({ entries = [], card, botOf, roomOf = () => "" }) {
  const [open, setOpen] = useState([]); // keys of the rows whose card is open
  const [all, setAll] = useState(false);
  const toggle = useRef(null);
  const { shown, label } = foldRows(entries, { all, open });
  const flip = (key) => setOpen((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <ul aria-label="Lo que te espera" style={box}>
        {shown.map((entry, i) => {
          const bot = botOf(entry.botId);
          const row = needRow(entry, { botName: bot?.name, roomName: roomOf(entry.missionId) });
          const isOpen = open.includes(entry.key);
          const id = "need-" + entry.key;
          if (isOpen) {
            return (
              <li key={entry.key} style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "8px", borderTop: i ? sep : "0" }}>
                <button type="button" aria-expanded="true" aria-controls={id} onClick={() => flip(entry.key)} className="u4-ghost" style={{ ...B.ghost, alignSelf: "flex-end" }}>
                  {"Plegar"}<ChevronUp size={14} strokeWidth={2.2} aria-hidden="true" />
                </button>
                <div id={id}>{card(entry)}</div>
              </li>
            );
          }
          const act = () => {
            if (row.action.kind === "approve") { scheduleApproval(entry.a, approvalCard(entry.a, { botName: bot?.name })); flip(entry.key); }
            else flip(entry.key);
          };
          return (
            <li key={entry.key} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0 14px 0 0", borderTop: i ? sep : "0" }}>
              <button type="button" aria-expanded="false" aria-controls={id} onClick={() => flip(entry.key)} aria-label={`${row.who}: ${row.what}. Abrir`} className="u4-honey"
                style={{ flex: "1", minWidth: 0, display: "flex", alignItems: "center", gap: "12px", minHeight: "60px", padding: "8px 8px 8px 14px", border: "0", background: "transparent", textAlign: "left", cursor: "pointer", color: "var(--c-text)" }}>
                {entry.room && !bot ? <span aria-hidden="true" style={{ flex: "none", width: "32px", height: "32px", display: "grid", placeItems: "center", borderRadius: "var(--r-sm)", background: "color-mix(in oklab, var(--c-honey-ring) 30%, transparent)", color: "var(--c-honey-text)" }}><Hash size={16} weight="bold" /></span> : <Shape bot={bot} size={32} halo={false} style={null} />}
                <span style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ ...one, fontSize: "var(--t-ui)", fontWeight: 600, lineHeight: "1.35" }}>{row.what}</span>
                  <span style={{ ...one, fontSize: "var(--t-meta)", lineHeight: "1.35", color: "var(--c-text-2)" }}>{[row.who, row.sub].filter(Boolean).join(" · ")}</span>
                </span>
                <ChevronDown size={16} aria-hidden="true" style={{ flex: "none", color: "var(--c-text-3)" }} />
              </button>
              {row.action.kind === "link"
                ? <a href={row.action.href} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); navigate(row.action.href); }} className="u4-pri" style={{ ...B.primary, flex: "none" }}>{row.action.label}</a>
                : <button type="button" onClick={act} className="u4-pri" style={{ ...B.primary, flex: "none" }}>{row.action.label}</button>}
            </li>
          );
        })}
      </ul>
      {label ? (
        <button ref={toggle} type="button" aria-expanded={all ? "true" : "false"} onClick={() => setAll((v) => !v)} className="u4-sec" style={{ ...B.secondary, alignSelf: "flex-start" }}>{label}</button>
      ) : null}
    </div>
  );
}
