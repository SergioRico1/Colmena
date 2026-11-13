# Room data contract

Technical contract for the plan in `docs/PLAN-equipo-y-salas.md` (2026-11-12). Derived from reading
the code at 18d9bc2. The room is the parent object; a mission (the local bot engine) and a peer
share (the transport between people) hang off it as optional links. The two message stores are not
merged.

## Facts today

**Mission room.** `missions` (`server/runtime.mjs:271-294`): `id` (uuid), `title`, `room` (slug,
always set), `mode` solo|equipo|debate, `botIds` (max 4), `conversation` (solo only), `status`,
`incognito`/`expiresAt`, `automationId`; later `archived`, `snoozedUntil`, `thread`, `capabilities`,
`peerErrand`. There is no "is a room" field: a bot chat is `conversation && botIds.length === 1`
(`src/components/v2/chat/ChatsHome.jsx:60`); everything else is a sala. `messages`, `steps` and
`approvals` carry `missionId` (the only SQL-indexed field, `server/store.mjs:138`). Rooms have no
unread count today.

**Peer share.** A direct is `dmId(a,b)` = `"dm-"+hash` (`server/peers/service.mjs:47`); a group is
`randomUUID()`. Record: `kind` dm|group, `title`, `owner`, `version`, `members:[{id,role}]` (owner,
member, guest), `unread`, `seenBy`, `seenSent`, `leftAt`, `removedAt`, `hidden`. `roster()` is signed
by the owner; `onRoster` requires `kind === "group"`, the owner as sender and a higher version. Add,
rename, role change and remove are owner-only.

**Peer message.** `id`, `shareId`, `from`, `text` (max 8000), `at` (sender clock), `receivedAt`,
`status`, `pendingTo`, `bot`, `mentions[{owner,bot}]`, `people`, `thread`, `replyTo`, `editedAt`,
`deletedAt`, `reactions`, `card` (file|meeting|errand), `local`.

**Bots and errands.** `myProfile()` announces your bots to active contacts only (stored as
`contact.bots`). A mention is answered with `runtime.infer` and `tools: []`
(`server/peers/bots.mjs:96-107`). An errand creates an incognito solo mission with `capabilities`
and `peerErrand` (`server/peers/errands.mjs:203-205`); narrowing is mission-wide
(`server/runtime/context.mjs:405`).

## The contract: kind `rooms`

```
{ id, title, slug, teamId|null, missionId|null, shareId|null,
  general: false, createdBy: <address>, createdAt, archived: false,
  snoozedUntil: null, seenAt: null }
```

- `private` is derived (`!shareId`), never stored.
- Ids: a migrated local room has `id = missionId`; a room from a group has `id = shareId`; a new
  room gets a fresh uuid; the first invitation creates the share with `id = room.id`
  (`createGroup` takes an optional id).
- `resolveRoom(x)`: `rooms.get(x)`, then `missionId == x`, then `shareId == x`. `/sala/:id` and
  `/con/:id` keep resolving. A `dm-…` id is never a room: directs stay «Personas».
- Across computers the room is the `shareId`. `missionId` is local and never sent.
- Invariants:
  1. At least one link exists.
  2. A private room has a mission only.
  3. A room that came from a group gets its mission lazily, the first time one of your bots works
     there with tools.
  4. With a share, `share.title` is the truth and `room.title` mirrors it.
  5. On the wire the share stays `kind: "group"`; `teamId` rides as an extra roster field. Old
     clients verify the whole object and keep only the fields they know.
- Trabajo tasks are not rooms. A mission becomes a room when
  `!incognito && !automationId && !(conversation && botIds.length === 1)` and it is a sala, not a
  task: store a `kind` on the mission to tell them apart.

## Merged timeline

- A private room stores the person's message in `messages` only. A room with a share always goes
  through `peers.post`; a `messages` row with `peerId: <peer id>` is added only when a local bot
  turn must start.
- A bot's final answer is posted with `peers.post(shareId, text, { bot, replyTo })` and the returned
  id is saved as `peerId` on the mission message.
- Dedupe: drop a peer message whose id is some mission message's `peerId`. The mission row is the
  body; the peer row overlays `status`, `seenBy`, `edited`, `reactions`.
- Never forwarded: progress, plan, question and approval rows, and steps. Others get a status line.
- Order: `(at, engine, position in engine)`.
- Cursor: opaque `{at, id}`. Take N top-level items below the cursor from each engine, merge, keep
  the last N; then attach mission replies, progress and steps for the span.
- Unread: `share.unread` plus mission assistant rows (message, deliverable, question, plan) with
  `at > room.seenAt`. `POST …/seen` sets `seenAt` and calls `peers.seen`.

## Migration

- Startup sweep in one `store.tx`, plus a lazy `ensureRoom` in `resolveRoom` and `onRoster`
  (groups arrive later). Deterministic ids make it idempotent without a marker.
- A group becomes `{ id: share.id, shareId, teamId: null }`. Directs get no room.
- Downgrade: an older Colmena ignores `rooms`; missions and shares are untouched. A room with both
  links shows twice there (a sala and a group). New wire types are ignored by its dispatch.

## API

| Route | Purpose |
|---|---|
| `GET /api/teams` | `[{id, name, people, bots, admin, current}]`; with no team, one synthetic «Solo tú» entry |
| `GET /api/sidebar?team=` | `{rooms:[{id,href,title,unread,waiting}], bots:[{id,name,role,shape,color,state}], people:[{id,href,name,presence,status,unread}], waitingCount}` |
| `GET /api/rooms?team=` | Rooms of a team, or the private and team-less ones |
| `GET /api/rooms/:id` | Room with `people[{address,name,role,presence}]` and `bots[{owner,bots}]` |
| `GET /api/rooms/:id/timeline?cursor=` | Merged page |
| `POST /api/rooms/:id/messages` | Send, routed as above. `POST /api/missions/:id/messages` and `/queue` answer 409 for the sala of a room with a share |
| `POST /api/rooms/:id/people` | Invite; creates the share on first use |
| `POST /api/rooms/:id/leave`, `PATCH /api/rooms/:id`, `POST /api/rooms/:id/seen` | Leave, rename or archive, mark read |

## One count of what waits for you

Built (`server/waiting.mjs`, `tests/waiting.test.mjs`). Before, four counters disagreed: the
Inicio badge, the footer and Equipo (bots with status `espera`), the Trabajo column and the
taskbar (raw approvals), and none counted people-side asks.

`waitingCount` is the length of one server list, `waitingItems(store, now)` (peer state is read
from the stored records, so it takes no `peers` argument):

- approvals that are pending, not snoozed and not expired;
- unarchived `awaiting_plan` / `awaiting_choice` missions without such an approval;
- open watch notes;
- inbound errands in state `asked`.

Each item is `{kind, id, missionId, roomId, botId, what, at}` (an errand also has `title`); the
list travels in `/api/state` as `waiting`, each mission summary says how many of its own items
wait (`waiting`) and a bot's `waitingIn` counts its rooms on the list. Every surface filters
this list (`src/components/v2/needs.js`): Inicio and the sidebar show its length, Trabajo the
part that is in tasks («3 de 5 · ver todo»), Equipo and Actividad the same number and each
bot's own items, the taskbar and tray `pendingCount`, which is its length. A room-level
decision (a plan, a choice) waits as a room: it names a bot only in that bot's own chat.

## Teams as built (`server/peers/teams.mjs`, `docs/PEOPLE.md` › Equipos)

- Store kinds `teams` (the last roster verified, signed by the creator) and `teamMemberships`
  (your state in each); `settings.currentTeam`.
- Someone who is not a member (taken out, or asking again with `team.req` / `team.sync` while in
  `gone`) gets `Teams#outRoster`: a signed roster of the current version with `name: ""` and the
  creator as its only member. The full roster only ever goes to current members.
- `team.req {team, op, v, made?, …}`: `v` is the roster version the sender had, `made` (with
  `add`) when the code was made. The creator keeps `teams.goneAt {address: {v, at}}` (when each
  person was taken out) and `Teams#stale` refuses: `add`/`remove`/`admin` about someone with
  `v < goneAt.v` or `made <= goneAt.at`; `add`/`admin` with no `v` or more than
  `TEAM_LIMITS.staleVersions` (8) behind. `leave` and `rename` are always taken. A refused
  request is answered with the current roster (and `team.no` for an `add`).
- «general» is a `peerShares` group whose id is the team roster's `room`; its record and
  `shareView` carry `teamId` and `general: true`. Other rooms of a team carry `teamId` only
  (`createGroup(title, members, { teamId })`). Adopt them by those fields.
- Decisions 1 and 2 below are done at team level: admins ask the creator (`team.req`), and
  teammates who are not contacts get `team.profile` / `team.presence`, so `contact.bots`,
  `peers.online()` and `contact.away` are filled for every teammate. No per-room `room.bots`
  message was needed for rooms of a team; a room without a team still has none.

## Technical decisions

1. Rosters stay owner-signed for launch. Others send a "please add" request to the owner; team
   admins come with the team roster.
2. Bots and presence of people who are not your contacts are unknown today: add a per-room
   `room.bots` message sent to all members.
3. A peer message holds 8000 characters and an envelope 48 KB; mission text allows 20000. Long bot
   answers are split into parts and deliverables go as files.
4. Capabilities are per mission, so a teammate's request would narrow your own turns in the same
   room: add `step.capabilities` and intersect it in `toolsForStep`.
5. `addMessage` finds addressees from the text and `origin` demotes the author: add an explicit
   `to` and `author: {address}`, with other people's text wrapped as outside content.
6. `where("peerMessages", "shareId")` has no index and every page sorts the full list: add an index
   before launch.

## Rooms as built (`server/room.mjs`, `server/room-timeline.mjs`, `docs/PEOPLE.md` › Salas)

The server side of the room is built as above. Where it differs, or where the contract left a
choice open:

- **Mission kind.** `mission.kind` is `"chat"` (one bot), `"sala"` or `"tarea"`
  (`server/mission-kind.mjs`). Stored on creation (`POST /api/missions` takes `kind`; without it a
  team mission that was given a `title` is a sala, which is what «Nueva sala» sends, and anything
  else a task) and backfilled in the sweep without touching `updatedAt`. For older missions it is
  inferred: a named team mission is a sala, one titled from its prompt, with a due date or for one
  bot is a task; in doubt, a sala. `/api/state` only says a kind the shape does not give away.
  Trabajo (`Tareas.jsx`) lists tasks only, by this kind (`src/lib/rooms.js › tasksOf`).
- **A room and its share always have the same id.** It follows from the id rules, and the code
  relies on it: `ensureForShare` adopts the room with the share's id.

  Trabajo (`Tareas.jsx`) still lists salas too: it was not this task's file.
- **A room and its share have the same id**, with one exception. `ensureForShare` adopts a
  share-less room with the share's id only when this Colmena owns that share (its first
  invitation). A group of somebody else that arrives with the id of a private room gets a room
  with a fresh id (`ofShare` finds it by `shareId`); the private room is untouched.
- **`createdBy`** is null for a private room made before «Personas» had its keys; views fill in
  your address.
- **Titles.** A private room is named after its sala's `#slug` (what salas show today), and
  follows it when it is renamed from today's screen.
- **Unread and `seenAt: null`.** A room nobody has marked seen counts nothing from the mission
  side (`at > null` is never true). Rooms never had unread, and today's sala screen does not call
  `POST …/seen`, so nothing piles up until the room screen does. «Personas» marking a
  conversation read marks its room seen. An answer said in parts counts once.
- **When your bots take a turn in a room with a share.** Only when you name them (picked with
  «@», `to`, or «@Nombre» in a message with no picks) or reply in the thread of one of their
  messages. No router and no Atlas by default there: a message that names nobody is for the
  people. One decision (`Rooms#ownTurn`, called from `PeerBots#handle`) for every route. Asking a
  bot to find a meeting slot still goes to meetings. Personal bots («solo para mí») never work in
  a room. The turn is told the room is shared and gets the last 30 messages of the people as
  outside content.
- **What is relayed.** The final answer of every completed step of the shared conversation
  (`Rooms#throughShare`: it has `roomAsk`, or it started at or after `share.createdAt` and the
  message it answers — followed back through a teammate that passed the word or a late answer; for
  a step with no `ackOn`, the last user message before it began — has `peerId`) that left a
  message without `stall`, except a plan step, once (`peerId`, and `peerParts` when it went in several). While the step runs the
  others see the bot thinking. A posted answer waits in `peerOutbox` like any message. One that
  could not be posted, and a request's deliverable that could not be uploaded, are kept in
  `roomUnsent {id: answer:step | file:artifact, kind, shareId, stepId|artifactId, askId?, botId,
  replyTo?, t}` and tried again by `RoomWork#unsent` every tick and after a restart, for
  `ROOM_WORK.unsentMs` (7 days).
- **Parts.** `part: {of, n, total, glue}` on bot messages; `of` is the id of the first part and
  `glue` what stood between two parts, so the text joins back as it was. Later parts neither
  count as unread nor notify.
- **Cursor.** `{at, id, engine}`, base64url. Thread replies among people are not items: their
  root carries `replies`, as in «Personas».
- **Decision 1 («please add»).** Built: `room.req` to the owner, an informative notice and a
  `roomRequests` record (`roomId`, `missionId`, `status: asked|added|declined`) the owner decides
  with `POST /api/rooms/:id/requests/:request`. One thing the contract did not foresee: a
  Colmena only takes a group's roster from someone it knows, so the requester also sends the
  person `room.intro` with the owner's address and key. A code (`invite`) is still the owner's
  alone: 403 «Pídele a <dueño> que le invite.». `roomRequests` are not in any «what waits for
  you» list yet: `waitingItems` belongs to another task.
- **Cards.** `room.req.member` and `room.intro.owner` carry `card` (the person's own signed `{kind, id, box, name, at, sig}`: `protocol.mjs`); `Rooms#onRequest`, `Rooms#onIntro` and `Teams#vouched` take the key and name from a verified card (or from a contact already held) and ignore the rest. `Rooms#askOwner` answers 409 while either card is missing. `ROOM_LIMITS.intros` (10 a day per sender).
- **Decision 2 (`room.bots`).** Team profiles cover every member of a room of a team, and
  contacts get `profile`. `room.bots` is sent only to people you share a room with who are
  neither. Their presence stays unknown (shown offline).
- **Decision 3.** Parts as above. Deliverables: see «Bots in shared rooms as built».
- **Decision 4 (`step.capabilities`).** Built: see «Bots in shared rooms as built».
- **Decision 5.** `addMessage` takes `to`, `author {address, name}` and `peerId`. Rooms use `to`
  and `peerId` for your own messages, and `author` for what other people ask your bots.
- **Decision 6.** Index `(kind, shareId, at)` over `data` (over `meta` when encrypted), created
  on open, and `Store#ordered`. A room with 5,000 peer messages among 25,000: the latest page of
  the timeline takes 47 ms without the index and 7 ms with it (56 → 15 ms encrypted); the old
  page (`where` + sort of the whole conversation) 33 → 16 ms (172 → 155 ms encrypted, where
  decrypting every row is what costs).
- **Roster version on messages.** `msg.v` is the sender's `share.version`. `Peers#newerRoster`: `v > share.version` (not the owner's own room) sets `wantVersion`, `heldUntil` (`rosterHoldMs`, 30 s) and `newerFrom` on the share and sends the owner `room.sync {share, v}`. While held, `post` queues the envelopes for everyone but the owner and `newerFrom` with `peerOutbox.hold = shareId` and `nextAt = heldUntil`; `onRoster` (a newer roster, or the owner repeating the same version) clears the three fields and `releaseHeld` sends what waited to current members and drops the rest. `RoomWork#incoming` takes no request from a held sender. An unresolved hold is not started again for `rosterHoldGap` (10 min). `Rooms#onSync`: the owner answers a member with `share` (the roster as it is) and a non-member with a roster of the owner alone and `title: ""`, once every 10 s per person and room.
- **`GET /api/sidebar`** was not built: the sidebar reads `rooms` from `/api/state`
  (`src/lib/sidebar.js`), which changes live.
- **`/api/state` budget.** The room list costs about 100 bytes a room. The older `peers` view
  (every conversation with every member in full) is what does not fit with a team: ~63 KB with 30
  people. `tests/perf-budget.test.mjs` pins it; the room screen can drop it by reading members
  with the room.

## Bots in shared rooms as built (`server/room-work.mjs`, `docs/PEOPLE.md` › «Bots trabajando en salas compartidas»)

Step 2 of the plan: bots work with tools in rooms with other people. Tests:
`tests/room-bots.test.mjs`.

**A request to another person's bot.** B names A's bot with a picked mention in a room (a group
share; directs are untouched). `Peers#post` marks such a message `req: 1`. On A's computer
`PeerBots#handle` asks `RoomWork#incoming`, which decides by A's rule for B
(`peerContacts[B].asks.encargos`: `pregunta` default, `siempre`, `nunca`; a teammate or roommate
who is not a contact is a `known` contact and has the same field, so the rule is per address):

- `nunca`, a personal bot, a guest, or a message without `req` (an older Colmena): not taken;
  the tool-less answer of `bots.mjs` applies as before (unless `asks.bots` is `nunca`).
- `pregunta`: a `roomAsks` record `{id, roomId, shareId, from, fromName, botId, peerId, text,
  peerThread?, rule, state, approvalId, at}` (`state`: asked, working, done, declined, failed,
  stopped) and an approval `{id: "roomask:"+ask, kind: "question", tool: "room_request", status:
  "pending", botId, roomId, missionId|null, stepId: null, options: go|later|always|never,
  roomRequest: {id, roomId, shareId, from: {address, name}, bot: {id, name}, peerId}}`. It is an
  ordinary pending approval: every surface that counts pending approvals counts it.
  `Runtime#answer` closes it without writing a message (an «Adelante» row would read as the
  owner's word in the room) and `RoomWork#decided` hears it through the store.
- `siempre`, or approved: `RoomWork#begin` → `Rooms#missionFor` (invariant 3: the sala is made
  now) → `addMessage(mission, text, [], {to: [bot], author: {address, name}, peerId,
  capabilities, roomAsk, attended, context})`.

**Never the owner's words.** The row is `role: "user"` with `author`, `said` (what was written)
and `text` (the same wrapped as outside content: every reader of the sala gets it marked).
`origin.mjs`: `isOtherPerson`; `isPersonMessage` false, `personWords` empty, `isOutsideOrigin`
true, and `worksFromOutside` true for any step with `roomAsk`. Send guards, `personTurnText`,
the notes' and blocks' «the person asked» and the mission brief skip it. In such a turn
(`mission.peerErrand`) `Connections#request` approves nothing by itself except a read: no
standing write grant, no «escribe» access of the bot, no `ownAppTarget`, no auto-send; every
write, send and delete is a pending approval of the owner. A turn for another person never merges with one of the
owner's (`deliverTurn`), is never routed, and a lost one is never given to Atlas.

**Decision 4.** `step.capabilities` (plus `step.roomAsk`, `step.attended`) come from the message
(`Runtime#messageLimits`) and are inherited by whatever goes on from the step
(`Runtime#turnLimits`: a teammate it names, a delegate, the turn after a late answer).
`Runtime#turnMission(mission, step)` gives that step the mission with `capabilities` intersected
and `peerErrand` set, so every rule of an errand applies to that turn only (no notes, blocks,
Código, errands, memory or soul tools; hosted web search follows `web`). It is used by
`toolsForStep`, `runStep` and `tool`; nothing is stored on the mission. The capabilities are the
errand ones (`settings.peerErrandTools`: web, carpetas, apps, ordenador).

**A request turn (`server/request-turn.mjs`).** With `peerErrand` set (a request in a room, or an
errand between bots) `toolsForStep` ends with an allow-list, closed by default:

- always (`REQUEST_ALWAYS`): `ask_room`, `ask_user`, `create_deliverable`, `create_document`,
  `create_spreadsheet`, `create_presentation`, `create_image`, `read_deliverable`, `read_file`;
- by capability (`REQUEST_BY_CAPABILITY`): web → `web_fetch` (and hosted search); carpetas →
  `list_folder`, `read_folder_file` over every folder connected to that bot (the setting is
  on/off, `ERRAND_TOOLS_DEFAULT.carpetas: false`; there is no per-folder choice, in the API
  or the screen); apps → `apps_accounts`, `apps_search`, `apps_describe`,
  `apps_execute`, `apps_table` and the direct app tools (`isAppToolName`: the registry of real
  app tools in `server/apptools.mjs`, never a name that only starts like one); ordenador →
  `browser_open|read|screenshot|act|fill|submit|download` only, in a browser session of that
  step's own (`session: "req-<step id>"` on every bridge call, `server/computer/wire.mjs`): an
  in-memory Electron partition, empty, keyed apart from the bots' persistent one, closed and
  wiped (`clearStorageData`, `clearCache`) when the step ends (`desktop/browser.cjs`). Never
  `desktop_*` nor `open_app`;
- everything else is neither offered nor run, whatever adds it (`extraTools`, `stepTools`, a new
  built-in). `use_tool` and `find_tools` read the same list.

`read_file`, `read_deliverable`, the files a deliverable tool embeds (`image`, `rows_from`) and
the version a deliverable follows are scoped to the artifacts of that request
(`EffectMethods#requestArtifacts`: steps with the same `roomAsk`; an errand's own mission). A
request's `create_deliverable` writes no working file in the sala's folder.

What such a step reads (`ContextMethods#requestHistory`): one message with `step.request` — the
requester's words wrapped as outside content, the room's title and `Rooms#sharedNote(…, {reader})`,
i.e. up to 30 messages of the share (`peerMessages`: not local, not failed, not in a thread) sent
since the requester was first seen in the room (`roomMembers {id: share:address, shareId, address,
since}`, kept by `RoomWork#sawMembers`). A turn that goes on from the request (a teammate named,
a late answer) gets the first turn's `request` before its own. Never: `priorMessages`, the brief,
«Resultados previos», hints, reactions, sibling answers. While it runs nothing of the sala is
injected (`injectHints`, `injectMessages`, `injectRelays`, `injectBrief`, `injectPermissionChange`
are skipped; `injectLateAnswers` adds the owner's late answer to a question of that very step).
`composeInstructions` leaves out memory, profile, standing orders, the skill index and the sala's
slug. Attachments never reach a request turn (`Rooms#send` refuses them in a room with people).

**A request turn's prompt, exactly** (`soul.mjs › composeInstructions` with `mission.peerErrand`):

1. the SOUL every bot starts with (`renderSoulTemplate`: its name and role), never `SOUL.md` as
   edited: the owner edits it by hand, and an approved proposal of the learning loop
   (`learning.mjs › proposeSoulChange`) is written from the owner's own conversations, so it can
   carry what is theirs;
2. the AGENTS rules with the bot's autonomy;
3. «# Identidad»: «Eres <bot>, <its role>. Forma: <shape>. Trabajas para <owner's name>.», without
   the owner's role (`settings.userRole`) or the space's name (`settings.spaceName`);
4. «# Personalidad» from the bot's sliders, when set;
5. Colmena's fixed sections (questions, reactions, speed, sending, finishing, the latest word,
   code, talking while working), «# Habilidades activas: Ninguna en este turno.» and a fixed
   «# Memoria» note saying there is none here;
6. «# Contexto»: today's date and the time zone of the owner's computer (and the mission's
   «ask before sending» line when set), never the sala's `#slug`;
7. `OTHER_PERSON_NOTE` («# Petición de otra persona»), then the tools note and the web search
   note when they apply.

Never: «# Tus instrucciones» (`bot.instructions`), the memory digest, USER.md, standing orders,
the skill index, related memories. Its input is one message, as above (`requestHistory`). The
tool-less answer to another person's mention (`peers/bots.mjs › sharedInstructions` with
`forOther`) follows the same rule for the SOUL and «Tus instrucciones».

**Questions.** `ask_user` is unchanged (a local approval of the owner). `ask_room {question}`
exists only in a step with `roomAsk` (`Runtime#stepTools`): it posts the question as a plain
message of the bot addressed to the requester and the step ends without relaying its closing
line. The requester's reply (linked, a mention of that bot, or their next plain message within
10 minutes) starts a new turn of the same request, outside content again; at most 3 per request.

**Limits** (`ROOM_WORK`, `RoomWork#overLimit`). Counted over the stored `roomAsks` (each keeps
`t`, the clock when it came), so they survive a restart: 6 per person, room and hour (`perHour`);
12 per person and hour and 40 per day over all rooms (`personHour`, `personDay`); 30 per hour for
everybody (`allHour`); 5 requests of one person in state `asked` at once (`open`). A request
counts when it reaches a rule other than `nunca`; over a limit it is not taken and the requester
gets `throttled`: one `room.status` to the requester only, once per requester, room and hour
(`RoomWork#throttled`, `roomThrottled {id: share:address, shareId, from, t}`, `throttledMs`). A reply to `ask_room` is not a request: it adds to `roomAsks.replies`, at most
3 (`replies`) start a turn. In a room made by someone else where the owner of the bot has not
taken part (`RoomWork#takesPart`: owns it, it is a team's «general», wrote there, or approved a
request there by hand) a `siempre` request is stored with `rule: "pregunta", held: true` and
asks. A message signed by a
bot, a card or a guest's message never gets here. Admission: a `siempre` request is `long` work
(parked when the plan window is almost used: status `limited`); one approved just now is
`attended` and counts as the owner's turn. Brakes for self-started work do not apply; the step's
own loop guard does.

**What leaves (wire).** Besides the final answer (unchanged):

- `room.status {share, bot, state, at, tools?, ms?}`: `bot` an id, `state` one of thinking,
  working, waiting, limited, done, declined, stopped, failed, throttled, expired; `at` the sender's clock
  in ms; `tools`/`ms` integers, only with `done`. Built and accepted by `cleanStatus`, which
  copies those fields and nothing else. `thinking`/`working` are ephemeral (not kept by the
  mailbox, refreshed every 30 s to whoever is connected); the rest are queued like any message.
  Not remembered in `peerSeen`: a status older than the last one known is ignored. The newest
  `at` heard of each (room, owner, bot) is kept in `roomHeard {id: share:owner:bot, shareId, at}`,
  across restarts and after the status itself is dropped.
- `room.handoff {share, from, to, at}`: two bot ids of the sender (pass-the-word, a plan's
  work step, `ask_bot`/`message_bot` through the `thread` records), once a minute per pair.
- Deliverables made in a step with `roomAsk` (its `deliverable` messages) go as files after the
  answer (`PeerFiles#sendArtifact`, signed as the bot, `replyTo` the answer). A deliverable of a
  format in `FILE_KINDS` travels as such; any other text (code, json, html, svg…, with or
  without a file) travels as plain text named `<title>.<format>.txt` (`travelName`): every
  Colmena takes it and nobody receives a file that runs. One that cannot travel (gone, or a
  file that is not text) is tried once (`roomAsks.unshared`) and leaves the owner a local line
  in the room («No he podido compartir «…» en la sala: …»; `RoomWork#notShared`, never sent),
  also when a retry or an approved «Compartir» fails that way. `POST /api/rooms/:id/share` is
  the manual way.
  Capped (`RoomWork#shareOver`): 3 files and 25 MB per request (`roomAsks.shared`, `sharedBytes`),
  10 files and 100 MB per requester and day. What is over stays (`roomAsks.kept`) and asks the
  owner: approval `{id: "roomshare:"+ask, kind: "question", tool: "room_share", options: share|no,
  roomShare: {askId, shareId, artifactIds, bot, replyTo}}`, closed by `Runtime#answer` like a
  `roomRequest` card (no message is written).
- Nothing from a routine's turn or an incognito conversation (`RoomWork#silent`).

**Receiving.** `roomStatus {id: share:owner:bot, shareId, owner, bot, state, since, at, tools?,
ms?}` is the latest per (room, owner, bot); `roomLines {id, shareId, kind: status|handoff, owner,
bot, state?, tools?, ms?, to?, at}` are the lines of the conversation (ended states and
hand-offs; at most 400 a room). Names come from the bots the owner announced, never from the
status. Live states are dropped after 90 s without a refresh, or shown as `away` while their
owner is offline (up to 12 h); ended ones stay 2 minutes as the status; waiting/limited 7 days.
`RoomWork#tick` (every 10 s) refreshes and sweeps.

**Expiry and start** (`RoomWork#sweepOwn`, every tick, from the store). An own `waiting` status whose pending approvals of that bot have all expired (`approvalExpiresAt`) becomes `expired`; an approval of a step with `roomAsk` is denied (`decidedBy: "colmena"`), its step is completed as skipped and the request ends as `expired`. `ROOM_WORK.settleMs` (30 s) after start, a `roomAsks` still `working` whose sala is neither running nor waiting ends as `failed` (or `done` when no step of it is open). `roomAsks.state`: asked, working, done, declined, failed, stopped, expired.

**Old peers.** They ignore `room.status` and `room.handoff` (the `room.*` dispatch falls through)
and see final answers and files, as before. Their mention carries no `req`, so it gets the
tool-less answer whatever the rule: they could not see «waiting for the owner».

**For `waitingItems`.** Read pending approvals with `roomRequest` (they are already in the first
bullet of «One count»): `roomId` is on the approval and in `roomRequest.roomId`, `botId` on the
approval. Questions and red lines raised inside a request turn are ordinary approvals of the
room's mission (`missionId`; the room is `rooms.ofMission(missionId)`).

**Not done.** Today's sala screen
(`/sala/:mission`) shows a request as a message of its author; statuses of a room without a
share do not exist. Ajustes › Personas lists the rule for contacts; a teammate who is not a
contact gets theirs from the card («Siempre/Nunca para…») or `PATCH /api/peers/contacts/:id`.
