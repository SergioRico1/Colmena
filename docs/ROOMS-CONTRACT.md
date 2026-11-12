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
| `POST /api/rooms/:id/messages` | Send, routed as above |
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
  Trabajo (`Tareas.jsx`) still lists salas too: it was not this task's file.
- **A room and its share always have the same id.** It follows from the id rules, and the code
  relies on it: `ensureForShare` adopts the room with the share's id.
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
- **What is relayed.** The final answer of every completed step that left a message, except a
  plan step, once (`peerId`, and `peerParts` when it went in several). While the step runs the
  others see the bot thinking. A relay that fails (no mailbox) is logged and not retried.
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
- **Decision 2 (`room.bots`).** Team profiles cover every member of a room of a team, and
  contacts get `profile`. `room.bots` is sent only to people you share a room with who are
  neither. Their presence stays unknown (shown offline).
- **Decision 3.** Parts as above. Deliverables are not sent: next task.
- **Decision 4 (`step.capabilities`).** Not built: nothing of another person starts a turn with
  tools yet.
- **Decision 5.** `addMessage` takes `to`, `author {address, name}` and `peerId`. Rooms use `to`
  and `peerId` for your own messages; `author` is ready (never your word, addressees only from
  `to`, text wrapped as outside content) and unused until other people's requests run with tools.
- **Decision 6.** Index `(kind, shareId, at)` over `data` (over `meta` when encrypted), created
  on open, and `Store#ordered`. A room with 5,000 peer messages among 25,000: the latest page of
  the timeline takes 47 ms without the index and 7 ms with it (56 → 15 ms encrypted); the old
  page (`where` + sort of the whole conversation) 33 → 16 ms (172 → 155 ms encrypted, where
  decrypting every row is what costs).
- **`GET /api/sidebar`** was not built: the sidebar reads `rooms` from `/api/state`
  (`src/lib/sidebar.js`), which changes live.
- **`/api/state` budget.** The room list costs about 100 bytes a room. The older `peers` view
  (every conversation with every member in full) is what does not fit with a team: ~63 KB with 30
  people. `tests/perf-budget.test.mjs` pins it; the room screen can drop it by reading members
  with the room.
