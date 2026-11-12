import { useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { scheduleApproval } from "./Needs.jsx";
import { foldRows, needRow } from "./needRows.js";
import { Shape, btn } from "./parts.jsx";
import { approvalCard } from "../../../lib/approvalCard.js";
import { navigate } from "../../../lib/router.jsx";

// «Te necesitan» on Inicio: one compact row per thing that waits (who, what, the action that
// moves it on), three on screen and «Ver las N» for the rest. A row opens its full card in
// place: the same card as before, with every verb and line of lib/approvalCard.js. The honey
// ring is the row's own: each of them waits for you.

const RING = "0 0 0 1.5px #FFC93C";
const rowBox = { display: "flex", alignItems: "center", gap: "8px", minHeight: "60px", padding: "6px 10px 6px 6px", borderRadius: "18px", background: "#FFFFFF", boxShadow: RING };
const one = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

/**
 * `entries`: needEntries(needsOf(store)); `card(entry)`: the full card of one of them;
 * `botOf(id)`: the bot record.
 */
export default function NeedRows({ entries = [], card, botOf }) {
  const [open, setOpen] = useState([]); // keys of the rows whose card is open
  const [all, setAll] = useState(false);
  const toggle = useRef(null);
  const { shown, label } = foldRows(entries, { all, open });
  const flip = (key) => setOpen((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <ul aria-label="Lo que te espera" style={{ margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
        {shown.map((entry) => {
          const bot = botOf(entry.botId);
          const row = needRow(entry, { botName: bot?.name });
          const isOpen = open.includes(entry.key);
          const id = "need-" + entry.key;
          if (isOpen) {
            return (
              <li key={entry.key} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <button type="button" aria-expanded="true" aria-controls={id} onClick={() => flip(entry.key)} style={{ ...btn.text, alignSelf: "flex-end", height: "30px", display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13.5px" }}>
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
            <li key={entry.key} style={rowBox}>
              <button type="button" aria-expanded="false" aria-controls={id} onClick={() => flip(entry.key)} aria-label={`${row.who}: ${row.what}. Abrir`}
                style={{ flex: "1", minWidth: 0, display: "flex", alignItems: "center", gap: "12px", minHeight: "48px", padding: "0 6px 0 12px", border: "0", borderRadius: "12px", background: "transparent", textAlign: "left", cursor: "pointer", color: "#12131A" }}>
                <Shape bot={bot} size={18} />
                <span style={{ flex: "1", minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ ...one, fontSize: "15px", lineHeight: "1.3" }}><strong style={{ fontWeight: "600" }}>{row.who}</strong><span style={{ color: "#5C606C" }}>{" · "}</span>{row.what}</span>
                  {row.sub ? <span style={{ ...one, fontSize: "13.5px", lineHeight: "1.3", color: "#5C606C" }}>{row.sub}</span> : null}
                </span>
                <ChevronDown size={16} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none", color: "#5C606C" }} />
              </button>
              {row.action.kind === "link"
                ? <a href={row.action.href} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); navigate(row.action.href); }} style={{ ...btn.dark, flex: "none", height: "38px", padding: "0 16px", fontSize: "14px" }}>{row.action.label}</a>
                : <button type="button" onClick={act} style={{ ...btn.dark, flex: "none", height: "38px", padding: "0 16px", fontSize: "14px" }}>{row.action.label}</button>}
            </li>
          );
        })}
      </ul>
      {label ? (
        <button ref={toggle} type="button" aria-expanded={all ? "true" : "false"} onClick={() => setAll((v) => !v)} style={{ ...btn.line, alignSelf: "flex-start", height: "36px", fontSize: "14px" }}>{label}</button>
      ) : null}
    </div>
  );
}
