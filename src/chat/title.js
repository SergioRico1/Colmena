// The phone's top bar names the open channel (components/v3/Sidebar.jsx reads it), so the channel
// screen can hide its own heading on a phone instead of saying the name twice.
import { useEffect, useSyncExternalStore } from "react";

let title = null;
const listeners = new Set();
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const read = () => title;

export function setChatTitle(value) {
  if (title === value) return;
  title = value || null;
  for (const fn of listeners) fn();
}
/** The open channel's name for the top bar, or null. */
export const useChatTitle = () => useSyncExternalStore(subscribe, read, read);
/** A screen that names itself in the top bar while it is open. */
export function useTopTitle(value) {
  useEffect(() => { setChatTitle(value); return () => setChatTitle(null); }, [value]);
}
