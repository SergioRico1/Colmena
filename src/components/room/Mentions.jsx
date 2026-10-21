import { useCallback, useState } from "react";
import { BotAvatar, popoverItem, popoverStyle } from "./common.jsx";

const TRIGGER = /(^|\s)@([\p{L}\d_-]*)$/u;

/**
 * @mentions for composers: typing «@» opens a list of bots; ↑/↓ + Enter/Tab choose; Escape closes.
 * Returns props for the textarea/input and the menu element (render it inside a `position: relative` box).
 */
export function useMentions({ value, setValue, bots, inputRef }) {
  const [query, setQuery] = useState(null);
  const [index, setIndex] = useState(0);
  const matches = query == null ? [] : bots.filter((b) => b.name.toLowerCase().startsWith(query.toLowerCase())).slice(0, 6);
  const open = query != null && matches.length > 0;

  const detect = useCallback((text, caret) => {
    const m = TRIGGER.exec(text.slice(0, caret));
    setQuery(m ? m[2] : null);
    setIndex(0);
  }, []);

  const choose = (bot) => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(TRIGGER, (all, space) => `${space}@${bot.name} `);
    const next = before + value.slice(caret);
    setValue(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  };

  /** Inserts «@» at the caret and opens the list (the «@» button of the Sala composer). */
  const start = () => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? value.length;
    const pre = value.slice(0, caret);
    const insert = pre && !/\s$/.test(pre) ? " @" : "@";
    const next = pre + insert + value.slice(caret);
    setValue(next);
    setQuery("");
    setIndex(0);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pre.length + insert.length, pre.length + insert.length);
    });
  };

  const inputProps = {
    value,
    onChange: (e) => {
      setValue(e.target.value);
      detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
    },
    onClick: (e) => detect(e.target.value, e.target.selectionStart ?? 0),
    onBlur: () => setTimeout(() => setQuery(null), 150),
    "aria-autocomplete": "list",
    "aria-expanded": open ? "true" : "false",
    "aria-controls": open ? "rm-mentions" : undefined,
  };

  /** Call first in onKeyDown; returns true when the key was consumed by the menu. */
  const handleKey = (e) => {
    if (!open) return false;
    if (e.key === "ArrowDown") { e.preventDefault(); setIndex((index + 1) % matches.length); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); setIndex((index - 1 + matches.length) % matches.length); return true; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(matches[index]); return true; }
    if (e.key === "Escape") { e.preventDefault(); setQuery(null); return true; }
    return false;
  };

  const menu = open ? (
    <div id="rm-mentions" role="listbox" aria-label="Mencionar a un bot" style={{ ...popoverStyle, left: "0", bottom: "calc(100% + 6px)" }}>
      {matches.map((b, i) => (
        <button
          key={b.id}
          type="button"
          role="option"
          aria-selected={i === index ? "true" : "false"}
          className="rm-item"
          onMouseDown={(e) => { e.preventDefault(); choose(b); }}
          style={{ ...popoverItem, background: i === index ? "#F7F8FA" : "transparent" }}
        >
          <BotAvatar bot={b} size={24} />
          <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <strong style={{ fontSize: "14px" }}>{b.name}</strong>
            {b.role ? <span style={{ fontSize: "12px", color: "#555A68" }}>{b.role}</span> : null}
          </span>
        </button>
      ))}
    </div>
  ) : null;

  return { inputProps, handleKey, menu, start };
}
