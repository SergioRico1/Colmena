import test from "node:test";
import assert from "node:assert/strict";
import { needsCount, needsOf } from "../src/components/v2/needs.js";
import { ROOMS_SHOWN, chatsTarget, conversationPath, foldRooms, rowLabel, sidebarModel, sidebarShape, summaryOf, teamHeader } from "../src/lib/sidebar.js";

const NOW = Date.parse("2026-11-12T10:00:00Z");
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const later = (min) => new Date(NOW + min * 60000).toISOString();

// A store snapshot as /api/state gives it: a team room that waits for a plan, a debate that
// waits for a choice, a task, a chat with one bot, two conversations with people.
function snapshot() {
  return {
    bots: [
      { id: "atlas", name: "Atlas", role: "Coordinación", shape: "hex", color: "#12131A", status: "espera", enabled: true },
      { id: "nora", name: "Nora", role: "Investigación", shape: "leaf", color: "#0B8A5F", status: "libre", enabled: true },
      { id: "bruno", name: "Bruno", role: "Código", shape: "square", color: "#7B4DFF", status: "trabaja", enabled: true },
      { id: "vera", name: "Vera", role: "Redacción", shape: "arch", color: "#FF5CA8", status: "espera", enabled: true },
      { id: "leo", name: "Leo", role: "Asistente legal", shape: "circle", color: "#0E7C86", status: "libre", enabled: true },
      { id: "off", name: "Apagado", role: "", shape: "hex", status: "libre", enabled: false },
    ],
    missions: [
      { id: "m-q3", room: "informe-q3", title: "Informe", botIds: ["atlas", "nora", "vera"], conversation: false, status: "awaiting_plan", updatedAt: ago(10) },
      { id: "m-camp", room: "campaña-primavera", title: "Portada", botIds: ["vera", "bruno"], conversation: false, status: "awaiting_choice", updatedAt: ago(200) },
      { id: "m-fact", room: "facturación", title: "Macros", botIds: ["bruno"], conversation: false, status: "running", updatedAt: ago(5) },
      { id: "m-chat", room: "oferta", title: "Oferta", botIds: ["nora"], conversation: true, thread: true, status: "completed", updatedAt: ago(60) },
      { id: "m-old", room: "archivada", title: "Vieja", botIds: ["nora", "vera"], conversation: false, status: "completed", archived: true, updatedAt: ago(9000) },
      { id: "m-auto", room: "rutina", title: "Rutina", botIds: ["vera"], conversation: false, status: "completed", automationId: "a1", updatedAt: ago(30) },
      { id: "m-priv", room: "privado", title: "Privado", botIds: ["nora"], conversation: true, incognito: true, status: "completed", updatedAt: ago(1) },
    ],
    approvals: [
      { id: "ap-plan", missionId: "m-q3", botId: "atlas", kind: "plan", status: "pending" },
      { id: "ap-send", missionId: "m-q3", botId: "vera", kind: "send", status: "pending" },
      { id: "ap-q", missionId: "m-q3", botId: "vera", kind: "question", status: "pending" },
      { id: "ap-perm", missionId: "m-fact", botId: "bruno", kind: "permission", status: "pending" },
      { id: "ap-later", missionId: "m-chat", botId: "nora", kind: "permission", status: "pending", snoozedUntil: later(60) },
      { id: "ap-done", missionId: "m-chat", botId: "nora", kind: "permission", status: "approved" },
    ],
    watchNotes: [],
    notifications: [
      { id: "n1", missionId: "m-q3", kind: "mention", read: false },
      { id: "n2", missionId: "m-q3", kind: "message", read: false },
      { id: "n3", missionId: "m-q3", kind: "message", read: true },
      { id: "n4", missionId: "m-chat", kind: "message", read: false },
      { id: "n5", missionId: "m-fact", kind: "done", read: false },
    ],
    peers: {
      me: { address: "me", name: "Sergio", status: { mode: "available", until: null } },
      relay: { status: "online" },
      contacts: [
        { id: "lucia", name: "Lucía Paz", initials: "LP", color: "#EFE2D3", status: "active", online: true, dm: "dm-lucia", away: null },
        { id: "marta", name: "Marta Gil", initials: "MG", color: "#DCE6F2", status: "active", online: false, dm: "dm-marta", away: { mode: "dnd", until: null } },
        { id: "pend", name: "Pendiente", status: "pending", dm: null },
      ],
      shares: [
        { id: "dm-lucia", kind: "dm", title: "Lucía Paz", unread: 2, lastAt: ago(3), members: [{ id: "me", me: true, name: "Sergio" }, { id: "lucia", name: "Lucía Paz", initials: "LP", color: "#EFE2D3", online: true, away: null }] },
        { id: "g-obra", kind: "group", title: "obra-nueva", unread: 4, lastAt: ago(2), members: [{ id: "me", me: true }, { id: "lucia", name: "Lucía Paz" }, { id: "marta", name: "Marta Gil" }] },
        { id: "g-left", kind: "group", title: "dejada", unread: 1, left: true, lastAt: ago(1), members: [] },
      ],
    },
  };
}

test("rooms: every room of the team and every group with people, by name, without chats, archives or routines", () => {
  const { rooms } = sidebarModel(snapshot(), { now: NOW });
  assert.deepEqual(rooms.map((r) => r.title), ["campaña-primavera", "facturación", "informe-q3", "obra-nueva"]);
  assert.deepEqual(rooms.map((r) => r.href), ["/sala/m-camp", "/sala/m-fact", "/sala/m-q3", "/con/g-obra"]);
});

test("rooms: unread counts mentions and messages not opened; waiting counts what Inicio lists there", () => {
  const { rooms } = sidebarModel(snapshot(), { now: NOW });
  const by = Object.fromEntries(rooms.map((r) => [r.id, r]));
  assert.deepEqual([by["m-q3"].unread, by["m-q3"].waiting], [2, 3], "two unread, three requests");
  assert.deepEqual([by["m-camp"].unread, by["m-camp"].waiting], [0, 1], "a debate that waits for your choice");
  assert.deepEqual([by["m-fact"].unread, by["m-fact"].waiting], [0, 1], "a «done» notice is not unread");
  assert.deepEqual([by["g-obra"].unread, by["g-obra"].waiting], [4, 0], "people: unread from the mailbox, nothing waits");
});

test("a room you put off leaves the list until its time, unless it waits for you", () => {
  const s = snapshot();
  s.missions.find((m) => m.id === "m-fact").snoozedUntil = later(30);
  s.missions.push({ id: "m-zzz", room: "pospuesta", botIds: ["nora", "vera"], conversation: false, status: "completed", snoozedUntil: later(30), updatedAt: ago(4) });
  const titles = sidebarModel(s, { now: NOW }).rooms.map((r) => r.title);
  assert.ok(titles.includes("facturación"), "it waits for a permission: stays");
  assert.ok(!titles.includes("pospuesta"));
  assert.ok(sidebarModel(s, { now: NOW + 31 * 60000 }).rooms.some((r) => r.title === "pospuesta"), "back when its time comes");
});

test("bots: your enabled bots with their state in words; honey only when one of their requests waits", () => {
  const { bots } = sidebarModel(snapshot(), { now: NOW });
  assert.deepEqual(bots.map((b) => [b.name, b.state, b.waiting]), [["Atlas", "waiting", 1], ["Nora", "free", 0], ["Bruno", "working", 1], ["Vera", "waiting", 2], ["Leo", "free", 0]]);
  assert.equal(bots.find((b) => b.id === "nora").unread, 1, "its chat has a message not opened");
  assert.equal(bots[0].href, "/chat/atlas");
  assert.equal(rowLabel("bot", bots[1]), "Nora, bot, libre, 1 sin leer");
  assert.equal(rowLabel("bot", bots[2]), "Bruno, bot, trabajando, te espera");
  assert.equal(rowLabel("bot", bots[3]), "Vera, bot, te espera");
});

test("bots: a request put off does not make its bot wait, and a paused team says so", () => {
  const s = snapshot();
  assert.equal(sidebarModel(s, { now: NOW }).bots.find((b) => b.id === "nora").state, "free");
  assert.equal(sidebarModel(s, { now: NOW + 61 * 60000 }).bots.find((b) => b.id === "nora").state, "waiting", "its time came");
  const paused = sidebarModel({ ...s, paused: true }, { now: NOW });
  assert.ok(paused.bots.every((b) => b.state === "paused"));
  assert.equal(paused.summary.text, "Equipo en pausa · 5 te esperan");
});

test("a circle is a person: a bot with a circle (or no shape) is drawn as a rounded square", () => {
  assert.equal(sidebarShape("circle"), "square");
  assert.equal(sidebarShape(undefined), "square");
  assert.equal(sidebarShape("hex"), "hex");
  assert.equal(sidebarModel(snapshot(), { now: NOW }).bots.find((b) => b.id === "leo").shape, "square");
});

test("people: direct conversations and connected contacts, with presence, status and unread", () => {
  const { people } = sidebarModel(snapshot(), { now: NOW });
  assert.deepEqual(people.map((p) => [p.name, p.href, p.presence, p.status, p.unread]), [
    ["Lucía Paz", "/con/dm-lucia", "online", null, 2],
    ["Marta Gil", "/con/dm-marta", "offline", "dnd", 0],
  ]);
  assert.equal(rowLabel("person", people[0]), "Lucía Paz, persona, en línea, 2 sin leer");
  assert.equal(rowLabel("person", people[1]), "Marta Gil, persona, sin conexión, No molestar");
  assert.deepEqual(sidebarModel({ ...snapshot(), peers: null }, { now: NOW }).people, [], "without «Personas» the group is empty");
});

test("row names for a screen reader carry the state", () => {
  assert.equal(rowLabel("room", { title: "informe-q3", unread: 3, waiting: 1 }), "informe-q3, sala, 3 sin leer, te espera");
  assert.equal(rowLabel("room", { title: "general", unread: 0, waiting: 0 }), "general, sala");
});

test("one number: the sidebar's count is the count of Inicio, and the foot says the same", () => {
  const s = snapshot();
  const model = sidebarModel(s, { now: NOW });
  const { asks, choices, notes } = needsOf(s, NOW);
  assert.equal(model.waitingCount, asks.length + choices.length + notes.length, "what Inicio lists");
  assert.equal(model.waitingCount, needsCount(s, NOW));
  assert.equal(model.waitingCount, 5);
  assert.equal(model.summary.waiting, model.waitingCount);
  assert.equal(model.summary.text, "1 trabajando · 5 te esperan");
  // Every request lands in a room or in a bot's chat: the marks add up to the same number.
  assert.equal(model.rooms.reduce((n, r) => n + r.waiting, 0), 5);
  // The old foot counted bots whose status was «espera»: 2 here, never the 5 of Inicio.
  assert.equal(s.bots.filter((b) => b.status === "espera").length, 2);
});

test("the foot never contradicts the Bots group", () => {
  const model = sidebarModel(snapshot(), { now: NOW });
  assert.equal(model.summary.working, model.bots.filter((b) => b.state === "working").length);
  assert.equal(summaryOf([{ state: "free" }], 0).text, "Nadie trabajando");
  assert.equal(summaryOf([{ state: "working" }, { state: "working" }], 1).text, "2 trabajando · 1 te espera");
  assert.equal(summaryOf([], 0).text, "Sin bots");
  const noted = sidebarModel({ ...snapshot(), watchNotes: [{ id: "w1", missionId: "m-chat", botId: "nora" }] }, { now: NOW });
  assert.equal(noted.waitingCount, 6, "a question about something new counts too");
  assert.equal(noted.bots.find((b) => b.id === "nora").state, "waiting");
});

test("folding: up to eight rooms show; beyond that the quiet ones fold behind «Ver todas»", () => {
  const few = Array.from({ length: ROOMS_SHOWN }, (_, i) => ({ id: "r" + i, href: "/sala/r" + i, title: "r" + i, unread: 0, waiting: 0, at: i }));
  assert.deepEqual(foldRooms(few), { shown: few, hidden: 0 });
  const many = Array.from({ length: 20 }, (_, i) => ({ id: "r" + i, href: "/sala/r" + i, title: "r" + String(i).padStart(2, "0"), unread: 0, waiting: 0, at: i }));
  many[0].unread = 2; // old, but with something new
  many[1].waiting = 1;
  const folded = foldRooms(many, { current: "/sala/r2" });
  assert.equal(folded.shown.length, ROOMS_SHOWN);
  assert.equal(folded.hidden, 12);
  assert.deepEqual(folded.shown.map((r) => r.id), ["r0", "r1", "r2", "r15", "r16", "r17", "r18", "r19"], "what is new, the one open, then the latest; in the list's own order");
  assert.equal(foldRooms(many, { all: true }).shown.length, 20);
  const busy = many.map((r) => ({ ...r, unread: 1 }));
  assert.equal(foldRooms(busy).shown.length, 20, "nothing with news is ever hidden");
});

test("the header: «Solo tú» without teams, else the current team and the others to switch to", () => {
  assert.deepEqual(teamHeader([], { bots: 6 }), { solo: true, id: null, name: "Colmena", line: "Solo tú · 6 bots", admin: false, others: [] });
  assert.equal(teamHeader([], { bots: 1 }).line, "Solo tú · 1 bot");
  assert.equal(teamHeader(null, { bots: 0 }).line, "Solo tú");
  const teams = [{ id: "t1", name: "Operaciones", people: 5, bots: 12, admin: true, current: false }, { id: "t2", name: "Familia", people: 1, bots: 1, admin: false, current: true }];
  const head = teamHeader(teams, { bots: 6 });
  assert.deepEqual([head.solo, head.id, head.name, head.line, head.admin], [false, "t2", "Familia", "1 persona · 1 bot", false]);
  assert.deepEqual(head.others, [{ id: "t1", name: "Operaciones" }]);
  const chosen = teamHeader(teams, { chosen: "t1" });
  assert.deepEqual([chosen.id, chosen.line, chosen.admin], ["t1", "5 personas · 12 bots", true]);
  assert.equal(teamHeader(teams, { chosen: "gone" }).id, "t2", "a team you left falls back to the current one");
});

test("a team narrows rooms and people that belong to one; what has no team is yours everywhere", () => {
  const s = snapshot();
  s.peers.shares.find((x) => x.id === "g-obra").teamId = "t1";
  assert.ok(sidebarModel(s, { now: NOW, team: "t1" }).rooms.some((r) => r.id === "g-obra"));
  const other = sidebarModel(s, { now: NOW, team: "t2" });
  assert.ok(!other.rooms.some((r) => r.id === "g-obra"));
  assert.ok(other.rooms.some((r) => r.id === "m-q3"), "your own rooms stay");
  assert.equal(other.bots.length, 5, "your bots are the same in every team");
});

test("/chats opens the last conversation, else the first room, else nothing", () => {
  const model = sidebarModel(snapshot(), { now: NOW });
  assert.equal(chatsTarget(model, "/sala/m-q3"), "/sala/m-q3");
  assert.equal(chatsTarget(model, "/chat/nora"), "/chat/nora", "a chat with a bot");
  assert.equal(chatsTarget(model, "/con/dm-lucia"), "/con/dm-lucia", "a person");
  assert.equal(chatsTarget(model, "/con/g-obra"), "/con/g-obra", "a room with people");
  assert.equal(chatsTarget(model, "/sala/m-old"), "/sala/m-camp", "archived since: the first room");
  assert.equal(chatsTarget(model, "/chat/off"), "/sala/m-camp", "a bot switched off");
  assert.equal(chatsTarget(model, null), "/sala/m-camp");
  assert.equal(chatsTarget(model, "/trabajo"), "/sala/m-camp", "not a conversation");
  assert.equal(chatsTarget(sidebarModel({ bots: snapshot().bots }, { now: NOW }), "/sala/x"), null, "no rooms: the empty state");
  assert.equal(chatsTarget(sidebarModel({ bots: snapshot().bots }, { now: NOW }), "/chat/nora"), "/chat/nora");
});

test("which addresses are a conversation", () => {
  assert.equal(conversationPath("/sala/m-q3/directo"), "/sala/m-q3");
  assert.equal(conversationPath("/chat/nora"), "/chat/nora");
  assert.equal(conversationPath("/con/dm-1"), "/con/dm-1");
  assert.equal(conversationPath("/sala/nueva"), null);
  assert.equal(conversationPath("/chats"), null);
  assert.equal(conversationPath("/"), null);
});
