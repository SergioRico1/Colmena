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

Today four counters disagree: the Inicio badge (`needsCount`, `src/components/v2/needs.js`), the
footer and Equipo («N te esperan»: bots with status `espera`), the Trabajo column (`columnOf`,
missions) and the taskbar (`pendingCount`, raw approvals). None counts people-side asks.

`waitingCount` is the length of one server list, `waitingItems(store, peers, now)`:

- approvals that are pending, not snoozed and not expired;
- unarchived `awaiting_plan` / `awaiting_choice` missions without such an approval;
- open watch notes;
- inbound errands in state `asked`.

Each item carries `roomId` and `botId`; every surface filters this list.

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
