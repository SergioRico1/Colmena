import { useEffect, useRef, useState } from "react";
import { createAnnouncer, fresh } from "./announce.js";

// The text of a conversation's live region (components/Announcer.jsx). Rooms, 1:1 chats with
// a bot and direct chats with people all feed it the same way:
//
//   const said = useAnnouncer({ scope: id, ready, items, waiting });
//   <Announcer text={said} />
//
//   items    [{ id, name, text, skip, done }]  every message on screen; `skip` for your own
//            and system lines, `done: false` while it is still being written
//   waiting  [{ id, name, kind }]              what waits for you now
//   scope    the conversation: changing it starts again without saying what was already there
//
// What is there when the conversation opens is never read out; only what arrives after.

const CLEAR_MS = 5000; // the line is emptied afterwards, so the same words can be said again

export function useAnnouncer({ scope = "", ready = true, items, waiting }) {
  const [text, setText] = useState("");
  const state = useRef(null);
  const clear = useRef(null);
  const announcer = useRef(null);
  if (!announcer.current) {
    announcer.current = createAnnouncer({
      say: (line) => {
        setText(line);
        clearTimeout(clear.current);
        clear.current = setTimeout(() => setText(""), CLEAR_MS);
      },
    });
  }
  useEffect(() => {
    if (!ready) return;
    const list = items || [], waits = waiting || [];
    if (!state.current || state.current.scope !== scope) {
      // First look at this conversation: everything here is already known.
      announcer.current.cancel();
      state.current = { scope, seen: new Set(), waited: new Set(waits.map((w) => w.id)) };
      fresh(state.current.seen, list);
      return;
    }
    const news = fresh(state.current.seen, list);
    const waited = state.current.waited;
    const started = waits.filter((w) => !waited.has(w.id));
    // Something answered can wait again later (a new question reuses nothing, but be safe).
    state.current.waited = new Set(waits.map((w) => w.id));
    announcer.current.add(news, started);
  }, [scope, ready, items, waiting]);
  useEffect(() => () => { announcer.current?.cancel(); clearTimeout(clear.current); }, []);
  return text;
}
