import test from "node:test";
import assert from "node:assert/strict";
import { NO_UNSEEN, arrivals, inView, jumpTarget, unseenAfter, unseenLabel } from "../src/lib/unseen.js";
import { createFollowScroll, landing } from "../src/lib/followScroll.js";
import { landingRow, underWay } from "../src/lib/landingRow.js";
import { receiptKey, receiptOf } from "../src/lib/receipts.js";
import { shortDuration, turnSummary } from "../src/lib/worklog.js";
import { elapsedText, moreText, workingNow } from "../src/lib/nowBar.js";

// The pure parts of the chat's reading aids: the «Nuevos» divider and its count
// (src/lib/unseen.js), where a long answer lands (followScroll.js landing, landingRow.js),
// the receipts of what you send while a bot works (receipts.js), a finished turn folded to
// one line (worklog.js turnSummary) and the «qué está haciendo ahora» bar (nowBar.js).

const row = (key, own = false) => ({ key, own });

// ---------- «Nuevos» ----------

test("what a chat opens with and the pages before it are history; only what comes after is an arrival", () => {
  assert.deepEqual(arrivals([], [row("a"), row("b")]), [], "the first load");
  assert.deepEqual(arrivals([row("a"), row("b")], [row("a"), row("b")]), []);
  assert.deepEqual(arrivals([row("c"), row("d")], [row("a"), row("b"), row("c"), row("d")]), [], "an older page goes before");
  assert.deepEqual(arrivals([row("a"), row("b")], [row("a"), row("b"), row("c"), row("d", true)]), [row("c"), row("d", true)]);
  // A message being sent changes its key when it lands: the row before it still anchors.
  assert.deepEqual(arrivals([row("a"), row("tmp", true)], [row("a"), row("u1", true), row("b1")]), [row("u1", true), row("b1")]);
  assert.equal(arrivals([row("a"), row("b")], [row("x"), row("y")]), null, "another version of the conversation");
});

test("the divider goes before the first message that arrived unseen, and counts them", () => {
  let s = unseenAfter(NO_UNSEEN, [row("b1")], { seen: true });
  assert.deepEqual(s, NO_UNSEEN, "you were at the end, looking: nothing to mark");
  s = unseenAfter(s, [row("b2")], { seen: false });
  assert.deepEqual(s, { first: "b2", count: 1 });
  s = unseenAfter(s, [row("b3"), row("b4")], { seen: false });
  assert.deepEqual(s, { first: "b2", count: 3 }, "the divider stays before the first one");
  assert.equal(unseenLabel(s.count), "3 mensajes nuevos");
  assert.equal(unseenLabel(1), "1 mensaje nuevo");
});

test("your own message never gets the divider and clears it; so does reading something new at the end", () => {
  assert.deepEqual(unseenAfter(NO_UNSEEN, [row("u1", true)], { seen: false }), NO_UNSEEN);
  const marked = { first: "b2", count: 2 };
  assert.deepEqual(unseenAfter(marked, [row("u2", true)], { seen: false }), NO_UNSEEN, "you wrote: you are at the end");
  assert.deepEqual(unseenAfter(marked, [row("u2", true), row("b5")], { seen: false }), { first: "b5", count: 1 }, "what comes after your message counts again");
  assert.deepEqual(unseenAfter(marked, [row("b5")], { seen: true, atEnd: true }), NO_UNSEEN);
  // On screen but not at the end (a long answer that opened at its first line): the older mark stays.
  assert.deepEqual(unseenAfter(marked, [row("b5")], { seen: true, atEnd: false }), marked);
});

test("the button jumps to the divider when it is far, else to the end", () => {
  const view = { scrollTop: 1000, clientHeight: 600 };
  // The divider is further down than what you see.
  assert.equal(jumpTarget({ ...view, dividerTop: 2400 }), "divider");
  assert.equal(jumpTarget({ ...view, dividerTop: 1600 }), "divider");
  // Already at the divider, or past it: on to the end.
  assert.equal(jumpTarget({ ...view, dividerTop: 1036 }), "end");
  assert.equal(jumpTarget({ ...view, dividerTop: 400 }), "end");
  assert.equal(jumpTarget({ ...view, dividerTop: null }), "end");
  assert.equal(inView({ start: 900, size: 200 }, view), true);
  assert.equal(inView({ start: 1600, size: 200 }, view), false);
  assert.equal(inView({ start: 100, size: 900 }, view), false);
});

// ---------- long answers open at their first line ----------

test("landing: the end, unless that would push the start of the latest answer out of view", () => {
  const box = { scrollHeight: 3000, clientHeight: 600 };
  assert.deepEqual(landing(box, null), { top: 2400, pinned: false });
  // A short answer: its start is still in view at the end.
  assert.deepEqual(landing(box, { top: 2700 }, { pad: 36 }), { top: 2400, pinned: false });
  // Taller than the viewport: its first line goes to the top, with the room over it.
  assert.deepEqual(landing(box, { top: 1500 }, { pad: 36 }), { top: 1464, pinned: true });
  assert.deepEqual(landing(box, { top: 10 }, { pad: 36 }), { top: 0, pinned: true });
  // The composer's inset counts as the end.
  assert.deepEqual(landing(box, { top: 2330 }, { pad: 0, inset: 100 }), { top: 2300, pinned: false });
  assert.deepEqual(landing({ scrollHeight: 400, clientHeight: 600 }, { top: 100 }), { top: 0, pinned: false });
});

// A scrolling element as the browser keeps it (as tests/follow-scroll.test.mjs).
class Scroller {
  constructor() { this.nodeType = 1; this.scrollHeight = 2000; this.clientHeight = 500; this._top = 1500; this.listeners = {}; this.children = []; }
  get scrollTop() { return this._top; }
  set scrollTop(v) { this._top = Math.max(0, Math.min(v, this.scrollHeight - this.clientHeight)); }
  scrollTo({ top }) { this.scrollTop = top; this.emit("scroll", {}); }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
  emit(t, e) { for (const fn of this.listeners[t] || []) fn({ target: this, ...e }); }
  grow(px) { this.scrollHeight += px; }
}
const following = (block) => {
  const el = new Scroller();
  const seen = [];
  const f = createFollowScroll({ onAtBottomChange: (v) => seen.push(v), anchor: () => block.at, pad: 36, raf: (fn) => { fn(); return 1; }, cancelRaf: () => {} });
  f.attach(el);
  return { el, f, seen };
};

test("a streaming answer is followed until its top would leave; then its first line stays pinned while it grows", () => {
  const block = { at: null };
  const { el, f, seen } = following(block);
  // The answer starts at the end of the list (2000) and grows.
  block.at = { top: 2000 };
  el.grow(300); f.contentChanged();
  assert.equal(el.scrollTop, 1800, "it fits: today's follow");
  assert.equal(f.pinned, false);
  el.grow(300); f.contentChanged();
  // The end would be 2100 and hide the start (2000 − 36): it stops there.
  assert.equal(el.scrollTop, 1964);
  assert.equal(f.pinned, true);
  assert.equal(f.following, false);
  assert.equal(f.isAtBottom, false, "«Ir al final» shows");
  assert.equal(seen.at(-1), false);
  // It keeps growing below: nothing moves.
  el.grow(900); f.contentChanged();
  el.grow(900); f.contentChanged();
  assert.equal(el.scrollTop, 1964);
});

test("a finished answer taller than the viewport lands with its start at the top, in one move", () => {
  const block = { at: null };
  const { el, f } = following(block);
  block.at = { top: 2000 };
  el.grow(1800); f.contentChanged();
  assert.equal(el.scrollTop, 1964);
  assert.equal(f.pinned, true);
  // «Ir al final» follows the end again, and the next long answer lands on its own start.
  f.scrollToBottom("auto");
  assert.equal(el.scrollTop, el.scrollHeight - el.clientHeight);
  assert.equal(f.pinned, false);
  assert.equal(f.following, true);
});

test("the hand-over: the finished answer takes the place of the one being written and lands on its start again", () => {
  const block = { at: { top: 2000 } };
  const { el, f } = following(block);
  el.grow(900); f.contentChanged();
  assert.equal(el.scrollTop, 1964);
  // The finished row starts a little higher (its head and folded work): same row, new start.
  block.at = { top: 1900 };
  f.reland();
  assert.equal(el.scrollTop, 1864);
  // Its rows settle in the next frames (measured heights): it stays on the start.
  block.at = { top: 1930 };
  el.grow(40); f.contentChanged();
  assert.equal(el.scrollTop, 1894);
  // A row over it grows later (your message gets its «Editar»): still on the start.
  block.at = { top: 1962 };
  el.grow(32); f.contentChanged();
  assert.equal(el.scrollTop, 1926);
  // Between the two rows (the one being written is gone, the finished one not there yet): nothing moves.
  block.at = null;
  el.grow(-200); f.reland(); f.contentChanged();
  assert.equal(el.scrollTop, 1926);
  assert.equal(f.pinned, true);
});

test("once the reader moves, nothing lands any more: no jump under them", () => {
  const block = { at: { top: 2000 } };
  const { el, f } = following(block);
  el.grow(900); f.contentChanged();
  assert.equal(f.pinned, true);
  // Reading down the answer as it is written.
  el.emit("wheel", { deltaY: 120 });
  el.scrollTop = 2200; el.emit("scroll", {});
  assert.equal(f.pinned, false);
  block.at = { top: 1900 };
  f.reland();
  el.grow(50); f.contentChanged();
  assert.equal(el.scrollTop, 2200);
  // A finished answer that fits lands at the end and keeps following.
  const short = following({ at: { top: 2000 } });
  short.el.grow(200); short.f.contentChanged();
  assert.equal(short.el.scrollTop, 1700);
  assert.equal(short.f.following, true);
});

test("each answer lands once: after the reader goes on to its end, it is followed like any other content", () => {
  const block = { at: { top: 2000, id: "s1" } };
  const { el, f } = following(block);
  el.grow(1800); f.contentChanged();
  assert.equal(el.scrollTop, 1964);
  // The reader scrolls down to the end of the answer.
  el.emit("wheel", { deltaY: 500 });
  el.scrollTop = el.scrollHeight; el.emit("scroll", {});
  assert.equal(f.following, true);
  // The list changes height there (the «Nuevos» divider goes, a card unfolds): no bounce to the start.
  el.grow(-40); f.contentChanged();
  assert.equal(el.scrollTop, el.scrollHeight - el.clientHeight);
  // The finished row of the same answer takes the place of the one being written: still at the end.
  block.at = { top: 1950, id: "s1" };
  el.grow(60); f.contentChanged();
  assert.equal(el.scrollTop, el.scrollHeight - el.clientHeight);
  assert.equal(f.pinned, false);
  // The next answer lands on its own start.
  block.at = { top: el.scrollHeight, id: "s2" };
  el.grow(1500); f.contentChanged();
  assert.equal(f.pinned, true);
  assert.equal(el.scrollTop, block.at.top - 36);
  // «Ir al final» also counts as going on to its end.
  f.scrollToBottom("auto");
  el.grow(100); f.contentChanged();
  assert.equal(el.scrollTop, el.scrollHeight - el.clientHeight);
});

test("the row to land on: the latest answer that came while the chat was open", () => {
  const opened = { openedAt: Date.parse("2026-11-12T10:00:00Z"), under: new Set() };
  const user = (key) => ({ key, kind: "user", m: { id: key } });
  const answer = (key, at, stepId = null) => ({ key, kind: "answer", m: { id: key, text: "Hola", at, stepId } });
  const live = (stepId, text = "Hol") => ({ key: "live-" + stepId, kind: "now", live: { stepId, text } });
  // What the chat opened with is history: it opens at its end.
  assert.equal(landingRow([user("u1"), answer("b1", "2026-11-12T09:00:00Z")], opened), null);
  // The answer being written, then the finished one that takes its place.
  assert.deepEqual(landingRow([user("u1"), answer("b1", "2026-11-12T09:00:00Z"), user("u2"), { key: "trail-s2", kind: "trail" }, live("s2")], opened), { key: "live-s2", turn: "s2" });
  assert.deepEqual(landingRow([user("u2"), answer("b2", "2026-11-12T10:01:00Z", "s2"), { key: "follow", kind: "follow" }], opened), { key: "b2", turn: "s2" }, "the same answer, finished");
  assert.deepEqual(landingRow([user("u2"), answer("b3", "2026-11-12T10:01:00Z")], opened), { key: "b3", turn: "b3" });
  // Thinking or using tools (no text yet): today's follow.
  assert.equal(landingRow([user("u2"), { key: "await", kind: "now", live: undefined }], opened), null);
  // An answer before your last message is not the latest one.
  assert.equal(landingRow([answer("b2", "2026-11-12T10:01:00Z"), user("u3")], opened), null);
  // A turn already well into its answer when the chat opened keeps following its end, finished or not.
  const under = { ...opened, under: underWay([{ stepId: "s9", text: "x".repeat(700) }, { stepId: "s8", text: "corto" }]) };
  assert.deepEqual([...under.under], ["s9"]);
  assert.equal(landingRow([user("u2"), live("s9", "x".repeat(900))], under), null);
  assert.equal(landingRow([user("u2"), answer("b9", "2026-11-12T10:02:00Z", "s9")], under), null);
  assert.equal(landingRow([user("u2"), live("s8")], under).key, "live-s8");
});

// ---------- receipts ----------

test("a message sent while a bot works: waiting for a pause, read, or held by an approval", () => {
  const at = (s) => new Date(Date.parse("2026-11-12T10:00:00Z") + s * 1000).toISOString();
  const working = { id: "s1", botId: "nora", status: "running", startedAt: at(0), completedAt: null, acks: ["u1"] };
  const u1 = { id: "u1", role: "user", text: "Investiga", at: at(-1), reactions: [] };
  const u2 = { id: "u2", role: "user", text: "Y mira también Francia", at: at(30), reactions: [] };
  // The message that started the turn has no receipt; nor one sent at rest.
  assert.equal(receiptOf(u1, { steps: [working], working: true }), null);
  assert.equal(receiptOf(u2, { steps: [{ ...working, completedAt: at(20), status: "completed" }], working: false }), null);
  // Mid-work, not read yet.
  assert.deepEqual(receiptOf(u2, { steps: [working], working: true }), { state: "wait" });
  assert.equal(receiptKey(receiptOf(u2, { steps: [working], working: true })), "wait");
  // The conversation waits for your OK: it is held behind it.
  assert.deepEqual(receiptOf(u2, { steps: [working], working: true, held: true }), { state: "hold" });
  // The bot took it in at its next step (its 👍 on the message)…
  const read = { ...u2, reactions: [{ emoji: "👍", by: "nora" }, { emoji: "❤️", by: "user" }] };
  assert.deepEqual(receiptOf(read, { steps: [working], working: true, held: true }), { state: "read", botId: "nora" });
  assert.equal(receiptKey(receiptOf(read, { steps: [working] })), "read:nora");
  // …or the turn that answers it has started (queued behind the work, «Cuando acabe»).
  const queued = { id: "s2", botId: "nora", status: "pending", startedAt: null, completedAt: null, acks: ["u2"] };
  assert.deepEqual(receiptOf(u2, { steps: [working, queued], working: true }), { state: "wait" });
  assert.deepEqual(receiptOf(u2, { steps: [{ ...working, completedAt: at(60), status: "completed" }, { ...queued, status: "running", startedAt: at(61) }], working: true }), { state: "read", botId: "nora" });
  // A turn dropped by an interruption read nothing; a person's own reaction is not the bot's.
  assert.deepEqual(receiptOf({ ...u2, reactions: [{ emoji: "👍", by: "user" }] }, { steps: [working, { ...queued, skipped: true, startedAt: at(40) }], working: true }), { state: "wait" });
  // Stopped with nothing pending: no mark left behind. Unsent messages never have one.
  assert.equal(receiptOf(u2, { steps: [working], working: false }), null);
  assert.equal(receiptOf({ ...u2, optimistic: true }, { steps: [working], working: true }), null);
  assert.equal(receiptOf({ id: "b1", role: "assistant", at: at(30) }, { steps: [working], working: true }), null);
  assert.equal(receiptKey(null), null);
});

// ---------- a finished turn, folded ----------

const tool = (type, card = {}, extra = {}) => ({ id: Math.random().toString(36).slice(2), name: extra.name || type, status: "done", card: { type, ...card }, ...extra });

test("a finished turn folds to «Usó N herramientas · tiempo», singular and plural", () => {
  const four = [tool("web"), tool("websearch", { query: "x" }), tool("project", { step: "edit", path: "a.js" }), tool("deliverable", { title: "Informe" })];
  assert.deepEqual(turnSummary(four, 12 * 60), { text: "Usó 4 herramientas · 12 min", count: 4, failed: 0, quiet: false });
  assert.equal(turnSummary([tool("command", { program: "node" })], 40).text, "Usó 1 herramienta · 40 s");
  assert.equal(turnSummary(four, null).text, "Usó 4 herramientas");
  assert.equal(turnSummary([], 30), null);
  // Plumbing, questions and calls still running are not the turn's work.
  assert.equal(turnSummary([tool("app", {}, { name: "apps_accounts" }), tool("question", {}, { name: "ask_user" }), tool("web", {}, { status: "running" })], 30), null);
  assert.equal(shortDuration(59), "59 s");
  assert.equal(shortDuration(725), "12 min");
  assert.equal(shortDuration(3900), "1 h 5 min");
  assert.equal(shortDuration(7200), "2 h");
  assert.equal(shortDuration(0), "");
});

test("a lone quick read shows no line; failed tools are counted and keep the line open", () => {
  assert.equal(turnSummary([tool("web", { ms: 900 })], 8).quiet, true);
  assert.equal(turnSummary([tool("file", { name: "a.pdf" })], 12).quiet, true, "no call time: the turn was short");
  assert.equal(turnSummary([tool("app", { app: "Gmail", action: "leer correos", count: 3 })], 10).quiet, true);
  // Slow, or not a read, or not alone: its line is there.
  assert.equal(turnSummary([tool("web", { ms: 20000 })], 25).quiet, false);
  assert.equal(turnSummary([tool("file", { name: "a.pdf" })], 90).quiet, false);
  assert.equal(turnSummary([tool("app", { app: "Gmail", action: "enviar correo" })], 5).quiet, false);
  assert.equal(turnSummary([tool("web", { ms: 500 }), tool("web", { ms: 400 })], 5).quiet, false);
  const failed = turnSummary([tool("web"), tool("command", { program: "node" }, { status: "error" })], 95);
  assert.deepEqual(failed, { text: "Usó 2 herramientas · 2 min · 1 no salió", count: 2, failed: 1, quiet: false });
  assert.equal(turnSummary([tool("web", {}, { status: "error" }), tool("file", {}, { status: "error" })], 5).text, "Usó 2 herramientas · 5 s · 2 no salieron");
  assert.equal(turnSummary([tool("web", { ms: 300 }, { status: "error" })], 5).quiet, false, "a failed read is never hidden");
});

// ---------- «qué está haciendo ahora» ----------

test("who is at work and what each one does; a lone chat falls back to its bot", () => {
  const steps = [
    { id: "s1", botId: "nora", status: "running", startedAt: "2026-11-12T10:00:00Z", narration: { text: "Ya tengo dos tarifas" } },
    { id: "s0", botId: "nora", status: "completed", startedAt: "2026-11-12T09:00:00Z" },
    { id: "s2", botId: "tomas", status: "running", startedAt: "2026-11-12T10:00:30Z", narration: null },
  ];
  const activity = [{ botId: "tomas", verb: "leyendo", detail: "informe.pdf" }, { botId: "vera", verb: "escribiendo", detail: "" }];
  assert.deepEqual(workingNow(activity, steps), [
    { botId: "tomas", verb: "leyendo", detail: "informe.pdf", narration: null, since: "2026-11-12T10:00:30Z" },
    { botId: "vera", verb: "escribiendo", detail: "", narration: null, since: null },
    { botId: "nora", verb: null, detail: "", narration: "Ya tengo dos tarifas", since: "2026-11-12T10:00:00Z" },
  ]);
  assert.deepEqual(workingNow([], [], "nora"), [{ botId: "nora", verb: null, detail: "", narration: null, since: null }]);
  assert.deepEqual(workingNow([], []), []);
  assert.equal(moreText(2), null);
  assert.equal(moreText(4), "y 2 más");
  const t0 = Date.parse("2026-11-12T10:00:00Z");
  assert.equal(elapsedText("2026-11-12T10:00:00Z", t0 + 42_000), "0:42");
  assert.equal(elapsedText("2026-11-12T10:00:00Z", t0 + 725_000), "12:05");
  assert.equal(elapsedText("2026-11-12T10:00:00Z", t0 + 3_730_000), "1:02:10");
  assert.equal(elapsedText(null, t0), "");
});
