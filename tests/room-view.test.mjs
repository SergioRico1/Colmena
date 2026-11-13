// The one room screen's model (src/lib/roomView.js, src/lib/identity.js): who wrote a row, how
// rows group, the quiet lines about other owners' bots, the member panel, the invite sheet's
// candidates and what «@» lists. Pure functions: no browser, no server.
import test from "node:test";
import assert from "node:assert/strict";
import { botShape, firstName, initialsOf, listNames } from "../src/lib/identity.js";
import {
  askChoices, askWaiting, noBotsText, roomEmpty, liveLines, thinkingLeft, withoutRepeats, authorKey, authorOf, authorView, continues, durationText, groupFlags, handoffLine, inviteCandidates, inviteTruth, itemType, joinItems,
  memberPanel, mentionGroups, mentionTargets, requestHint, presenceWord, roomPlace, roomRole, stackLabel, stateWord, statusLine,
} from "../src/lib/roomView.js";
import { mentionItems } from "../src/lib/mentionMenu.js";
import { roomLinks, tasksOf } from "../src/lib/rooms.js";

const ME = "me-address", LUCIA = "lucia-address", MARTA = "marta-address";
const sergio = { address: ME, name: "Sergio Rico", you: true };
const lucia = { address: LUCIA, name: "Lucía Martín", you: false };
const vera = { id: "vera", name: "Vera", role: "Redacción", shape: "leaf", color: "#7B4DFF" };
const at = (min) => new Date(Date.parse("2026-11-12T10:00:00Z") + min * 60000).toISOString();
const view = () => ({
  id: "room-1", title: "lanzamiento", private: false, mine: true, teamId: "t1", missionId: "m1", shareId: "room-1",
  people: [
    { address: MARTA, name: "Marta Soler", role: "guest", presence: "offline", status: { mode: "available" }, you: false },
    { address: LUCIA, name: "Lucía Martín", role: "member", presence: "online", status: { mode: "dnd" }, you: false },
    { address: ME, name: "Sergio Rico", role: "owner", presence: "online", status: { mode: "available" }, you: true },
  ],
  bots: [
    { owner: lucia, bots: [{ id: "vera", name: "Vera", role: "Legal", shape: "circle", color: "#0E7C86" }, { id: "leo", name: "Leo", role: "Datos", shape: "hex", state: "working" }] },
    { owner: sergio, bots: [{ id: "atlas", name: "Atlas", role: "Coordinador", shape: "hex" }, vera, { id: "nora", name: "Nora", role: "Investigación", shape: "circle" }] },
  ],
});

test("circles are people: a bot that is a circle, or has no known shape, is a capsule or a rounded square", () => {
  assert.equal(botShape("circle"), "capsule", "Investigación's silhouette");
  assert.equal(botShape(undefined), "square");
  assert.equal(botShape("blob"), "square");
  for (const s of ["hex", "diamond", "square", "leaf", "arch", "capsule"]) assert.equal(botShape(s), s);
  assert.equal(initialsOf("Lucía Martín Gómez"), "LM");
  assert.equal(initialsOf(""), "?");
  assert.equal(firstName("Lucía Martín"), "Lucía");
  assert.equal(listNames(["Ana"]), "Ana");
  assert.equal(listNames(["Ana", "Luis", "Marta"]), "Ana, Luis y Marta");
});

test("the author of a row: a person, a bot of yours, a bot of someone else", () => {
  // A row of the sala alone.
  assert.deepEqual(authorView(authorOf({ role: "user", text: "hola" })), { kind: "person", you: true, name: "Tú", sub: "", label: "Tú" });
  const own = authorView(authorOf({ role: "assistant", botId: "vera" }, [vera]));
  assert.equal(own.name, "Vera");
  assert.equal(own.sub, "Redacción"); // your own bot does not say «bot tuyo» on every row
  assert.equal(own.label, "Vera, bot tuyo"); // …but its text alternative says what it is
  // A timeline item brings its author; someone else's bot says whose it is.
  const theirs = authorView(authorOf({ engine: "peer", author: { kind: "bot", botId: { owner: LUCIA, bot: "vera" }, name: "Vera", role: "Legal", owner: lucia } }));
  assert.equal(theirs.sub, "Legal · bot de Lucía");
  assert.equal(theirs.label, "Vera, bot de Lucía");
  assert.equal(authorView(authorOf({ engine: "peer", author: { kind: "person", ...lucia } })).label, "Lucía Martín, persona");
  // A message of a conversation with people (the direct chat): from / author / bot.
  assert.equal(authorView(authorOf({ from: "me", author: { name: "Sergio" } })).name, "Tú");
  assert.equal(authorView(authorOf({ from: LUCIA, author: { name: "Lucía Martín" }, bot: { id: "leo", name: "Leo", role: "Datos" } })).sub, "Datos · bot de Lucía");
  assert.equal(authorView(authorOf({ from: LUCIA, author: { name: "Lucía Martín" }, bot: { id: "leo", name: "Leo" } })).sub, "bot de Lucía");
  // Notes of the system have no author.
  assert.equal(authorView(authorOf({ role: "system" })).kind, "system");
  assert.equal(authorKey(authorOf({ role: "system" })), null);
  // Two «Vera» of two owners are two authors.
  assert.notEqual(authorKey(authorOf({ role: "assistant", botId: "vera" }, [vera])), authorKey({ kind: "bot", botId: { owner: LUCIA, bot: "vera" }, name: "Vera", owner: lucia }));
});

test("consecutive messages by one author within five minutes share a header", () => {
  const mine = (min, extra = {}) => ({ id: "u" + min, role: "user", text: "x", at: at(min), ...extra });
  const theirs = (min, extra = {}) => ({ id: "p" + min, engine: "peer", from: LUCIA, author: { kind: "person", ...lucia }, text: "x", at: at(min), ...extra });
  assert.equal(continues(mine(0), mine(4)), true);
  assert.equal(continues(mine(0), mine(5)), false, "five minutes later is a new group");
  assert.equal(continues(mine(0), theirs(1)), false, "another author");
  assert.equal(continues(theirs(0), theirs(1)), true, "people group the same way as your own rows");
  assert.equal(continues(mine(0), mine(1), { hasReplies: true }), false, "a thread under the first one breaks the group");
  assert.equal(continues(mine(0), mine(1, { kind: "question" })), false, "a card is never a continuation");
  assert.equal(continues(theirs(0), theirs(1, { errand: { id: "e" } })), false);
  assert.equal(continues({ ...mine(0), at: "2026-11-12T23:58:00" }, { ...mine(1), at: "2026-11-13T00:01:00" }), false, "midnight starts again");
  assert.equal(continues(null, mine(0)), false);
  // A bot's progress lines group with its answer; the same bot of another owner does not.
  const bot = (min, extra = {}) => ({ id: "b" + min, role: "assistant", botId: "vera", text: "x", at: at(min), ...extra });
  assert.equal(continues(bot(0, { kind: "progress" }), bot(1), { bots: [vera] }), true);
  assert.equal(continues(bot(0), { id: "pb", engine: "peer", author: { kind: "bot", botId: { owner: LUCIA, bot: "vera" }, name: "Vera", owner: lucia }, text: "x", at: at(1) }, { bots: [vera] }), false);
  assert.deepEqual(groupFlags([mine(0), mine(1), theirs(2), theirs(3), mine(4)]), [false, true, false, true, false]);
});

test("the status line of another owner's bot, for every state, in neutral words", () => {
  const item = (state, extra = {}) => ({ kind: "status", id: "s", at: at(0), owner: { address: "x", name: "Sergio Rico", you: false }, bot: vera, state, ...extra });
  assert.equal(statusLine(item("thinking")), "Vera está pensando");
  assert.equal(statusLine(item("working")), "Vera está trabajando");
  assert.equal(statusLine(item("done", { tools: 4, ms: 12 * 60000 })), "Vera usó 4 herramientas · 12 min");
  assert.equal(statusLine(item("done", { tools: 1 })), "Vera usó 1 herramienta");
  assert.equal(statusLine(item("done")), "Vera ha terminado");
  assert.equal(statusLine(item("done", { ms: 45000 })), "Vera ha terminado · 45 s");
  assert.equal(statusLine(item("waiting")), "Vera espera el OK de Sergio");
  assert.equal(statusLine(item("declined")), "Sergio ha dicho que ahora no");
  assert.equal(statusLine(item("stopped")), "Sergio ha parado a Vera");
  assert.equal(statusLine(item("limited")), "Vera está en pausa: límite del plan de Sergio");
  assert.equal(statusLine(item("failed")), "Vera no ha podido terminar");
  assert.equal(statusLine(item("away")), "Sergio no está; Vera seguirá cuando vuelva");
  // When the owner is you the line says so (the honey card is separate: this stays a line).
  const own = (state) => statusLine({ ...item(state), owner: sergio });
  assert.equal(own("waiting"), "Vera espera tu OK");
  assert.equal(own("declined"), "Has dicho que ahora no");
  assert.equal(own("stopped"), "Has parado a Vera");
  assert.equal(own("limited"), "Vera está en pausa: límite de tu plan");
  // A state this Colmena does not know is not drawn; missing fields never throw.
  assert.equal(statusLine(item("teleporting")), null);
  assert.equal(statusLine({}), null);
  assert.equal(statusLine({ state: "working" }), "El bot está trabajando");
  assert.equal(durationText(0), "");
  assert.equal(durationText(65 * 60000), "1 h 5 min");
  assert.equal(durationText(120 * 60000), "2 h");
  assert.equal(statusLine(item("throttled")), "Vera está en pausa un momento: demasiadas peticiones seguidas");
  assert.match(statusLine(item("expired")), /no llegó a tener el OK de|No llegaste a dar el OK/);
  // As built the server writes the sentence: it is used as it comes, whatever the state.
  assert.equal(statusLine({ engine: "line", kind: "status", state: "done", text: "Vera usó 4 herramientas · 12 min", bot: vera }), "Vera usó 4 herramientas · 12 min");
  assert.equal(statusLine({ engine: "line", kind: "status", state: "a-new-state", text: "Vera espera tu OK" }), "Vera espera tu OK");
  // A handoff as built: the bot that hands over is `bot`.
  const hand = handoffLine({ engine: "line", kind: "handoff", bot: vera, to: { id: "atlas", name: "Atlas" }, text: "Vera ⇄ Atlas" });
  assert.deepEqual([hand.from, hand.to, hand.label, hand.fromBot.id, hand.toBot.id], ["Vera", "Atlas", "Vera pasa el trabajo a Atlas", "vera", "atlas"]);
  assert.equal(handoffLine({ from: { name: "Vera" }, to: { name: "Atlas" } }).label, "Vera pasa el trabajo a Atlas");
  assert.equal(handoffLine({ from: { name: "Vera" } }), null);
});

test("unknown kinds of timeline items are left out, known ones go to who draws them", () => {
  assert.equal(itemType({ engine: "mission", role: "user", kind: "message" }), "mission");
  assert.equal(itemType({ engine: "mission", role: "assistant", kind: "plan" }), "mission");
  assert.equal(itemType({ role: "assistant" }), "mission");
  assert.equal(itemType({ engine: "peer", from: "me", text: "hola" }), "peer");
  assert.equal(itemType({ kind: "status", state: "working", bot: vera, owner: lucia }), "status");
  assert.equal(itemType({ kind: "status", state: "who-knows" }), null);
  assert.equal(itemType({ kind: "handoff", from: vera, to: { name: "Atlas" } }), "handoff");
  assert.equal(itemType({ kind: "handoff", from: vera }), null);
  assert.equal(itemType({ engine: "mission", kind: "hologram" }), null);
  assert.equal(itemType({ engine: "line", kind: "status", role: "system", state: "done", text: "Vera ha terminado", bot: vera, owner: lucia }), "status");
  assert.equal(itemType({ engine: "line", kind: "handoff", role: "system", bot: vera, to: { name: "Atlas" }, text: "Vera ⇄ Atlas" }), "handoff");
  assert.equal(itemType({ engine: "line", kind: "a-line-of-tomorrow", role: "system", text: "?" }), null, "a line this Colmena does not know is not drawn as a message");
  assert.equal(itemType({ engine: "peer", kind: "poll" }), null);
  assert.equal(itemType(null), null);
});

test("the member panel: people with their role and presence in words, bots grouped by owner", () => {
  const panel = memberPanel(view(), { working: ["vera"], waiting: ["atlas"], activity: [{ owner: lucia, bot: { id: "vera" }, state: "waiting" }] });
  assert.deepEqual(panel.people.map((p) => [p.name, p.roleWord, p.presenceWord]), [
    ["Sergio Rico", "creaste la sala", "aquí"],
    ["Lucía Martín", "miembro", "No molestar"],
    ["Marta Soler", "invitado", "sin conexión"],
  ]);
  assert.deepEqual(panel.groups.map((g) => g.label), ["Tus bots", "Bots de Lucía"]);
  assert.deepEqual(panel.groups[0].bots.map((b) => [b.name, b.stateWord]), [["Atlas", "te espera"], ["Vera", "trabajando"], ["Nora", "libre"]]);
  // What waits for someone else is said in neutral words, never «te espera».
  assert.deepEqual(panel.groups[1].bots.map((b) => [b.name, b.role, b.stateWord]), [["Vera", "Legal", "espera a Lucía"], ["Leo", "Datos", "trabajando"]]);
  assert.equal(panel.botCount, 5);
  assert.equal(stackLabel(panel), "Personas: tú, Lucía Martín y Marta Soler. Bots: Atlas, Vera, Nora, Vera (de Lucía) y Leo (de Lucía)");
  assert.equal(roomRole({ role: "owner", you: false }), "creó la sala");
  assert.equal(presenceWord({ presence: "online", status: { mode: "away" } }), "Fuera");
  assert.equal(stateWord("limited"), "en pausa");
  assert.equal(stateWord("done"), "libre");
  // A private room: Atlas coordinates; an empty view never throws.
  const solo = memberPanel({ private: true, people: [{ address: ME, name: "Sergio", role: "owner", you: true }], bots: [{ owner: sergio, bots: [{ id: "atlas", name: "Atlas" }] }] });
  assert.equal(solo.groups[0].bots[0].stateWord, "coordina");
  assert.deepEqual(memberPanel(null), { people: [], groups: [], botCount: 0 });
  assert.deepEqual(roomPlace({ private: true }), { text: "Privada", private: true, hint: "Solo tú y tus bots" });
  assert.equal(roomPlace(view(), [{ id: "t1", name: "Acme" }]).text, "Acme");
  assert.equal(roomPlace({ ...view(), teamId: null }).text, "Por invitación");
});

test("the invite sheet: teammates and contacts, each once, never you nor who is already in", () => {
  const team = { members: [{ address: ME, name: "Sergio Rico", you: true }, { address: LUCIA, name: "Lucía Martín", presence: "online" }, { address: "pablo", name: "Pablo Ruiz", presence: "offline" }, { address: "alvaro", name: "Álvaro Gil", presence: "online" }] };
  const contacts = [{ id: "pablo", name: "Pablo Ruiz", status: "active", online: true }, { id: "zoe", name: "Zoe Lara", status: "active" }, { id: "pending", name: "Sin aceptar", status: "pending" }, { id: MARTA, name: "Marta Soler", status: "active" }];
  const list = inviteCandidates({ view: view(), team, contacts });
  assert.deepEqual(list.map((p) => [p.name, p.source, p.presence]), [["Álvaro Gil", "equipo", "online"], ["Pablo Ruiz", "equipo", "offline"], ["Zoe Lara", "contacto", "offline"]]);
  assert.deepEqual(inviteCandidates({ view: view(), team, contacts, query: "ALVARO" }).map((p) => p.name), ["Álvaro Gil"]);
  assert.deepEqual(inviteCandidates({ view: view(), team, contacts, query: "nadie" }), []);
  assert.deepEqual(inviteCandidates({ view: { people: [] }, contacts }).map((p) => p.name), ["Marta Soler", "Pablo Ruiz", "Zoe Lara"]);
  // The truth, said before adding; whoever did not make the room asks its owner.
  assert.deepEqual(inviteTruth(view()), { asks: false, owner: null, line: "Verá lo que se escriba a partir de ahora, no lo anterior.", ask: null });
  const notMine = { ...view(), mine: false, people: [{ address: LUCIA, name: "Lucía Martín", role: "owner", you: false }, { address: ME, name: "Sergio", role: "member", you: true }] };
  assert.equal(inviteTruth(notMine).asks, true);
  assert.equal(inviteTruth(notMine).ask, "Se lo pediremos a Lucía");
  assert.equal(inviteTruth({ private: true, mine: true, people: [] }).asks, false);
});

test("«@» lists your bots first, then the people, then each owner's bots", () => {
  const groups = mentionGroups({ view: view() });
  assert.deepEqual(groups.map((g) => g.label), ["Tus bots", "Personas", "Bots de Lucía"]);
  assert.deepEqual(groups[0].items.map((x) => [x.type, x.bot.name]), [["bot", "Atlas"], ["bot", "Vera"], ["bot", "Nora"]]);
  assert.deepEqual(groups[1].items.map((x) => x.person.name), ["Lucía Martín", "Marta Soler"], "never you");
  assert.deepEqual(groups[2].items.map((x) => [x.type, x.bot.name, x.owner.address]), [["peerbot", "Vera", LUCIA], ["peerbot", "Leo", LUCIA]]);
  // What you type narrows every group; a surname finds a person.
  assert.deepEqual(mentionGroups({ view: view(), query: "ve" }).map((g) => [g.label, g.items.length]), [["Tus bots", 1], ["Bots de Lucía", 1]]);
  assert.deepEqual(mentionGroups({ view: view(), query: "sol" }).map((g) => g.items[0].person.name), ["Marta Soler"]);
  assert.deepEqual(mentionGroups({ view: view(), limit: 1 }).map((g) => g.items.length), [1, 1, 1]);
  assert.deepEqual(mentionGroups({ view: null }), []);
  // The composer's menu takes these groups in place of its plain «Bots» one.
  const menu = mentionItems({ query: "", bots: [vera], who: groups });
  assert.deepEqual(menu.filter((x) => x.type === "head").map((x) => x.label), ["Tus bots", "Personas", "Bots de Lucía"]);
  assert.deepEqual(mentionItems({ query: "", bots: [vera] }).filter((x) => x.type === "head").map((x) => x.label), ["Bots"]);
});

test("what a message names travels structured: your bots, other people's bots, people", () => {
  const picks = [
    { type: "bot", id: "vera", owner: ME, label: "Vera" },
    { type: "peerbot", id: "leo", owner: LUCIA, label: "Leo" },
    { type: "person", id: LUCIA, label: "Lucía" },
    { type: "person", id: MARTA, label: "Marta" },
  ];
  assert.deepEqual(mentionTargets("@Vera y @Leo, mirad esto. @lucia, ¿te va?", picks), { to: ["vera"], mentions: [{ owner: LUCIA, bot: "leo" }], people: [LUCIA] });
  // A pick whose «@name» was deleted does not count; «@Veranito» is not «@Vera».
  assert.deepEqual(mentionTargets("@Veranito hola", picks), {});
  assert.deepEqual(mentionTargets("nada", picks), {});
  assert.deepEqual(mentionTargets("@Vera @Vera", [picks[0], picks[0]]), { to: ["vera"] });
});

test("naming someone else's bot is a request to its owner, said once; the owner's four answers", () => {
  const leo = { type: "peerbot", id: "leo", owner: LUCIA, ownerName: "Lucía Martín", label: "Leo" };
  const veraL = { type: "peerbot", id: "vera", owner: LUCIA, ownerName: "Lucía Martín", label: "Vera" };
  const mine = { type: "bot", id: "atlas", owner: ME, label: "Atlas" };
  assert.equal(requestHint("@Leo mira esto", [leo, mine]), "Leo es de Lucía: le llegará a Lucía para que decida");
  assert.equal(requestHint("@Leo y @Vera", [leo, veraL]), "Leo y Vera son de Lucía: le llegará a Lucía para que decida");
  assert.equal(requestHint("@Leo y @Tom", [leo, { type: "peerbot", id: "tom", owner: MARTA, ownerName: "Marta Soler", label: "Tom" }]), "Esos bots son de otras personas: le llegará a cada una para que decida");
  assert.equal(requestHint("@Atlas hola", [mine, leo]), "", "your own bot, or a pick no longer written, says nothing");
  assert.deepEqual(askChoices({ from: { name: "Lucía Martín" } }), [["go", "Adelante"], ["later", "Ahora no"], ["always", "Siempre para Lucía"], ["never", "Nunca para Lucía"]]);
  // The member panel reads the live states as built (`activity` with `text`), throttled included.
  const panel = memberPanel(view(), { activity: [{ owner: lucia, bot: { id: "leo", name: "Leo" }, state: "throttled", text: "Leo está en pausa" }] });
  assert.equal(panel.groups[1].bots.find((b) => b.id === "leo").stateWord, "en pausa");
});

test("pages of the timeline join into one list, each row once, in order", () => {
  const older = [{ id: "a", at: at(0) }, { id: "b", at: at(1) }];
  const latest = [{ id: "b", at: at(1), text: "editado" }, { id: "c", at: at(2) }];
  const attached = [{ id: "p", at: at(1.5), kind: "progress" }];
  assert.deepEqual(joinItems(older, latest, attached).map((m) => m.id), ["a", "b", "p", "c"]);
  assert.equal(joinItems(older, latest).find((m) => m.id === "b").text, "editado", "the newest copy wins");
  // Rows of the same instant keep the order the server gave them (the sala before the people).
  assert.deepEqual(joinItems([{ id: "m", at: at(0), engine: "mission" }, { id: "q", at: at(0), engine: "peer" }]).map((m) => m.id), ["m", "q"]);
  assert.deepEqual(joinItems(null, undefined, [{ at: at(0) }]), []);
});

test("live lines: what other owners' bots are doing now, never yours, never what already ended", () => {
  const vera = { id: "vera", name: "Vera" }, sergio = { address: "s", name: "Sergio Rico", you: false };
  const activity = [
    { owner: sergio, bot: vera, state: "waiting", text: "Vera espera el OK de Sergio" },
    { owner: sergio, bot: { id: "atlas", name: "Atlas" }, state: "done", tools: 2, text: "Atlas usó 2 herramientas" },
    { owner: { address: "me", name: "Yo", you: true }, bot: { id: "nora", name: "Nora" }, state: "waiting", text: "Nora espera tu OK" },
    { owner: { address: "l", name: "Luis" }, bot: { id: "vera", name: "Vera" }, state: "away", text: "Luis no está; Vera seguirá cuando vuelva" },
    { owner: sergio, state: "working" },
  ];
  const lines = liveLines(activity);
  assert.deepEqual(lines.map((l) => [l.id, l.kind, l.state, l.at]), [["live:s:vera", "status", "waiting", null], ["live:l:vera", "status", "away", null]]);
  assert.equal(itemType(lines[0]), "status");
  assert.equal(statusLine(lines[0]), "Vera espera el OK de Sergio");
  assert.deepEqual(liveLines(null), []);
});

test("«está pensando» is not said twice: a bot with a state of its own, or one of yours at work, is left out", () => {
  const activity = [{ owner: { address: "s", name: "Sergio" }, bot: { name: "Vera" }, state: "stopped" }, { owner: { you: true }, bot: { name: "Nora" }, state: "waiting" }];
  assert.deepEqual(thinkingLeft(["Vera (de Sergio)", "Íris (de Luis)", "Nora"], activity), ["Íris (de Luis)", "Nora"]);
  assert.deepEqual(thinkingLeft(["Vera", "Vera (de Luis)", "Atlas"], [], ["vera"]), ["Vera (de Luis)", "Atlas"], "your own bot by its exact name only");
  assert.deepEqual(thinkingLeft(["Veranito (de Sergio)"], activity), ["Veranito (de Sergio)"]);
  assert.deepEqual(thinkingLeft(undefined, undefined), []);
});

test("the same ended state twice in a row about one bot shows once", () => {
  const line = (id, when, bot = "vera") => ({ id, engine: "line", kind: "status", state: "stopped", at: when, owner: { address: "s" }, bot: { id: bot }, text: "x" });
  const rows = [{ id: "m1", engine: "peer", at: "2026-11-13T10:00:00.000Z" }, line("a", "2026-11-13T10:00:01.000Z"), line("b", "2026-11-13T10:00:01.004Z"), line("c", "2026-11-13T10:00:01.100Z", "atlas"), line("d", "2026-11-13T10:02:00.000Z")];
  assert.deepEqual(withoutRepeats(rows).map((r) => r.id), ["m1", "a", "c", "d"]);
  const clean = rows.slice(0, 2);
  assert.equal(withoutRepeats(clean), clean, "nothing to drop: the same list");
});

test("a request that waits for you is pointed at from its message", () => {
  assert.deepEqual(askWaiting({ asks: [{ id: "q1", state: "done" }, { id: "q2", state: "asked", bot: { name: "Vera" } }] }), { id: "q2", anchor: "peticion-q2", text: "Vera espera tu OK" });
  assert.equal(askWaiting({ asks: [{ id: "q1", state: "working" }] }), null);
  assert.equal(askWaiting({}), null);
});

test("every room opens at /sala/:id, private or with people", () => {
  assert.equal(roomLinks({ id: "r1", shareId: "r1", title: "general" }).href, "/sala/r1");
  assert.equal(roomLinks({ id: "r2", missionId: "m9", shareId: "r2", title: "x" }).href, "/sala/r2");
  assert.deepEqual(roomLinks({ id: "m1" }, [{ id: "m1", room: "informe" }]), { missionId: "m1", shareId: null, title: "informe", href: "/sala/m1" });
});

test("Trabajo lists tasks by their stored kind: never a sala, a chat or a cancelled task", () => {
  const missions = [
    { id: "t1", kind: "tarea", botIds: ["vera"], status: "running" },
    { id: "t2", automationId: "a1", botIds: ["vera"], status: "completed" }, // a routine's run says no kind: its shape does
    { id: "s1", kind: "sala", botIds: ["vera", "nora"], status: "completed" },
    { id: "s2", botIds: ["vera", "nora"], status: "waiting" }, // no kind: a room
    { id: "c1", conversation: true, botIds: ["vera"], status: "completed" },
    { id: "t3", kind: "tarea", botIds: ["vera"], status: "cancelled" },
  ];
  assert.deepEqual(tasksOf(missions).map((m) => m.id), ["t1", "t2"]);
  assert.deepEqual(tasksOf(), []);
});

test("a room with nothing said yet says what it is for and the one thing to do", () => {
  const me = { address: "me", you: true }, lucia = { address: "l", name: "Lucía" };
  // A new team with nobody else: «general» invites, with the code action.
  assert.deepEqual(roomEmpty({ title: "general", general: true, teamId: "t", people: [me] }, { teamName: "Lumbre" }), {
    title: "De momento solo estás tú en «Lumbre»", text: "Invita a alguien: le das un código, lo pega en su Colmena y entra aquí, en «general», con sus bots.", action: "invite", actionLabel: "Invitar al equipo",
  });
  // «general» with people and no messages.
  const general = roomEmpty({ title: "general", general: true, people: [me, lucia] });
  assert.deepEqual([general.title, general.action], ["Aún no hay mensajes en #general", null]);
  assert.match(general.text, /todo el equipo/);
  // A room with people where you are still alone, one with company, and a private one.
  assert.equal(roomEmpty({ title: "Legal", shareId: "x", people: [me] }).actionLabel, "Invitar a una persona");
  assert.match(roomEmpty({ title: "Legal", shareId: "x", people: [me, lucia] }).text, /nombra a un bot con @/);
  assert.deepEqual([roomEmpty({ title: "informe", private: true, people: [me] }).action, roomEmpty(null).action], [null, null]);
  // No bots in the room yet.
  assert.match(noBotsText({ private: true }), /Añade uno/);
  assert.match(noBotsText({ private: false }), /nómbralos con @/);
});

test("«Solo para mí»: one control, one label, in every room kind and for everyone", async () => {
  const { ONLY_ME, onlyMe } = await import("../src/lib/roomView.js");
  const kinds = [onlyMe({ mission: { id: "m" }, shared: false }), onlyMe({ mission: { id: "m" }, shared: true }), onlyMe({ mission: null, shared: true })];
  assert.deepEqual(kinds.map((k) => k.label), [ONLY_ME, ONLY_ME, ONLY_ME]);
  assert.equal(ONLY_ME, "Solo para mí");
  assert.ok(kinds.every((k) => k.available), "private, yours with people, and one you were invited to");
  assert.ok(kinds.every((k) => /no se envía a nadie/i.test(k.hint) && /tus bots/.test(k.hint)));
  assert.deepEqual(kinds.map((k) => k.needsSala), [false, false, true], "where your bots never worked, its sala is made first");
  assert.equal(onlyMe({ mission: { id: "m" }, shared: true, gone: true }).available, false, "not in a room you left");
  assert.equal(onlyMe({}).available, false, "no room yet");
});
