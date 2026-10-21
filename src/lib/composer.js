import { useCallback, useEffect, useRef, useState } from "react";

// The composer remembers (OpenClaw composer persistence and prompt history):
// - what you were writing in each room or chat, saved 200 ms after you stop, for 7 days;
// - ↑ / ↓ in an empty box (or while browsing) bring back your previous messages there.

const DRAFTS_KEY = "colmena:drafts";
const DRAFT_DAYS = 7;
const MAX_DRAFTS = 60;
const HISTORY = 100;

function readDrafts() {
  try {
    const all = JSON.parse(localStorage.getItem(DRAFTS_KEY) || "{}");
    return all && typeof all === "object" ? all : {};
  } catch {
    return {};
  }
}
function writeDrafts(all) {
  try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(all)); } catch {}
}
export function readDraft(key) {
  if (!key) return "";
  const d = readDrafts()[key];
  if (!d || Date.now() - (d.at || 0) > DRAFT_DAYS * 864e5) return "";
  return typeof d.text === "string" ? d.text : "";
}
export function saveDraft(key, text) {
  if (!key) return;
  const all = readDrafts();
  const cutoff = Date.now() - DRAFT_DAYS * 864e5;
  for (const [k, v] of Object.entries(all)) if (!v || (v.at || 0) < cutoff) delete all[k];
  if (String(text || "").trim()) all[key] = { text: String(text).slice(0, 20000), at: Date.now() };
  else delete all[key];
  const keys = Object.keys(all);
  if (keys.length > MAX_DRAFTS) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - MAX_DRAFTS).forEach((k) => delete all[k]);
  writeDrafts(all);
}

/**
 * Keeps `text` of the composer for `key` (a room or chat): restores it when the key changes
 * and saves it while you write.
 */
export function useDraft(key, text, setText) {
  const loaded = useRef(null);
  useEffect(() => {
    if (loaded.current === key) return;
    loaded.current = key;
    // No key (an incognito chat): nothing is saved, and what you are writing stays.
    if (key) setText(readDraft(key));
  }, [key, setText]);
  useEffect(() => {
    if (!key || loaded.current !== key) return undefined;
    const t = setTimeout(() => saveDraft(key, text), 200);
    return () => clearTimeout(t);
  }, [key, text]);
}

// What you sent in each conversation, newest last (T3 Code composerPromptHistory): ↑ finds it
// even when those messages are not loaded (a long chat opens with its latest page) or were
// queued. Private chats keep none (no key).
const PROMPTS_KEY = "colmena:prompts";
const PROMPT_KEYS_MAX = 60;
let prompts = null; // parsed once; the composer reads it on every key
function readPrompts() {
  if (prompts) return prompts;
  try {
    const all = JSON.parse(localStorage.getItem(PROMPTS_KEY) || "{}");
    prompts = all && typeof all === "object" ? all : {};
  } catch {
    prompts = {};
  }
  return prompts;
}
export function rememberPrompt(key, text) {
  const body = String(text || "").trim();
  if (!key || !body) return;
  const all = readPrompts();
  const list = (all[key]?.list || []).filter((t) => t !== body);
  all[key] = { list: [...list, body.slice(0, 20000)].slice(-HISTORY), at: Date.now() };
  // At most ~400 KB in all: the oldest prompts of a conversation go first.
  while (JSON.stringify(all[key].list).length > 400000 && all[key].list.length > 1) all[key].list.shift();
  const keys = Object.keys(all);
  if (keys.length > PROMPT_KEYS_MAX) keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, keys.length - PROMPT_KEYS_MAX).forEach((k) => delete all[k]);
  try { localStorage.setItem(PROMPTS_KEY, JSON.stringify(all)); } catch {}
  prompts = all;
}
export const rememberedPrompts = (key) => (key ? readPrompts()[key]?.list || [] : []);

/** The prompts to browse: the remembered ones, then the loaded messages, each once (newest last). */
export function promptHistory(remembered = [], messages = []) {
  const sent = (messages || []).filter((m) => m.role === "user" && (!m.kind || m.kind === "message") && m.text && !m.optimistic).map((m) => String(m.text));
  const out = [];
  for (const t of [...remembered, ...sent]) {
    const i = out.indexOf(t);
    if (i >= 0) out.splice(i, 1);
    out.push(t);
  }
  return out.slice(-HISTORY);
}

/**
 * ↑ / ↓ through your previous messages in this conversation. Returns `onKey(e)`: true when it
 * handled the key. It only acts on an empty box or while you are browsing (the text is
 * still the recalled one), with the caret on the first (↑) or last (↓) line. `key` (a chat)
 * adds what you sent there before, even if it is not loaded.
 */
export function useInputHistory(messages, text, setText, key = null) {
  const index = useRef(-1);
  const saved = useRef("");
  const list = promptHistory(rememberedPrompts(key), messages);
  const browsing = index.current >= 0 && list[list.length - 1 - index.current] === text;
  if (index.current >= 0 && !browsing) index.current = -1;
  return useCallback((e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !["ArrowUp", "ArrowDown"].includes(e.key) || !list.length) return false;
    const el = e.currentTarget;
    const before = el?.value?.slice(0, el.selectionStart ?? 0) ?? "";
    const after = el?.value?.slice(el.selectionEnd ?? 0) ?? "";
    if (e.key === "ArrowUp" && (text && !browsing || before.includes("\n"))) return false;
    if (e.key === "ArrowDown" && (!browsing || after.includes("\n"))) return false;
    e.preventDefault();
    if (index.current < 0) saved.current = text;
    const next = e.key === "ArrowUp" ? Math.min(list.length - 1, index.current + 1) : index.current - 1;
    index.current = next;
    const value = next < 0 ? saved.current : list[list.length - 1 - next];
    setText(value);
    requestAnimationFrame(() => { try { el.setSelectionRange(value.length, value.length); } catch {} });
    return true;
  }, [list.join("\u0000"), text, browsing, setText]); // eslint-disable-line react-hooks/exhaustive-deps
}

// «Guardar para después» (Ctrl+S, T3 Code prompt stash): what you were writing leaves the box
// and waits in a short list under it, in any conversation, until you bring it back or remove it.
const STASH_KEY = "colmena:stash";
const STASH_MAX = 20;
const stashSubs = new Set();
export function readStash() {
  try {
    const list = JSON.parse(localStorage.getItem(STASH_KEY) || "[]");
    return Array.isArray(list) ? list.filter((x) => x && typeof x.text === "string") : [];
  } catch {
    return [];
  }
}
function writeStash(list) {
  try { localStorage.setItem(STASH_KEY, JSON.stringify(list.slice(0, STASH_MAX))); } catch {}
  for (const fn of stashSubs) fn();
}
/** Keeps `text` for later (newest first). Returns the entry, or null when there was nothing. */
export function stashPrompt(text, { from = null, label = null } = {}) {
  const body = String(text || "").trim();
  if (!body) return null;
  const entry = { id: "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: body.slice(0, 20000), at: Date.now(), from, label };
  writeStash([entry, ...readStash().filter((x) => x.text !== body)]);
  return entry;
}
export function unstash(id) {
  const list = readStash();
  const entry = list.find((x) => x.id === id) || null;
  if (entry) writeStash(list.filter((x) => x.id !== id));
  return entry;
}
/** The stash, kept current across every composer that shows it. */
export function useStash() {
  const [list, setList] = useState(readStash);
  useEffect(() => {
    const update = () => setList(readStash());
    stashSubs.add(update);
    const onStorage = (e) => { if (e.key === STASH_KEY) update(); };
    window.addEventListener("storage", onStorage);
    return () => { stashSubs.delete(update); window.removeEventListener("storage", onStorage); };
  }, []);
  return list;
}
