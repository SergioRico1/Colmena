# Colmena in the cloud

Status: **Phase 1** (accounts, companies and the real server in each workspace, deployed; Phase 0
proved the store on Durable Objects). This document is the start of
the cloud architecture; it grows with each phase. The desktop stays as it is: everything here is
additive, and the desktop's default paths do not change.

## Target shape

| Piece | Cloudflare product | Holds |
| --- | --- | --- |
| One workspace (a team, a company) | Durable Object `Workspace`, SQLite-backed, EU jurisdiction | the store (`records`, `events`), live sockets, the scheduler's alarms |
| Accounts, sign-in, workspace directory | Worker + Durable Object `Directory` (SQLite, EU) | people, sessions, memberships, invitations (Phase 1 › Accounts: why not D1) |
| Files (uploads, deliverables, spilled tool output, generated documents) | R2 | blobs, addressed from records |
| Processes (code engines, project dev servers, office conversions, CLIs) | Containers | anything that spawns or needs a real filesystem |
| The desktop | Electron + the local agent | what must run on the person's computer |

## Phase 0: the store runs on DO SQLite unchanged

The bet: `node:sqlite`'s `DatabaseSync` is synchronous, and so is DO SQL
(`ctx.storage.sql.exec`, `ctx.storage.transactionSync`). The store (about 2,200 call sites in
77 files) can therefore move to a Durable Object without any call site becoming async.

**Verdict: the bet holds.** The real `server/store.mjs`, bundled by wrangler, runs in workerd on a
Durable Object's SQLite, encrypted, with its listeners driving WebSocket fan-out. Results below.

### The driver seam (`server/store-driver.mjs`)

`Store` runs on a small driver, the slice of `DatabaseSync` the store and its raw-SQL callers use:

```
driver = { kind, prepare(sql) → {all, get, run, iterate}, exec(sql), transaction(fn),
           isTransaction, setup({fresh}), maintain(), close(), native? }
```

- `NodeDriver(file)`: `node:sqlite`, the default. `setup` applies the desktop's PRAGMAs (WAL,
  `synchronous=NORMAL`, `journal_size_limit`, incremental `auto_vacuum` on a new file);
  `transaction` is `BEGIN IMMEDIATE … COMMIT` / `ROLLBACK`, exactly what `Store.tx` did before;
  `native` is the `DatabaseSync` (online backups need it).
- `DoDriver(ctx.storage)`: DO SQL. A statement is just its text (DO caches plans); `run()` drains
  the cursor and reads `changes()` / `last_insert_rowid()` (DO cursors have neither; `rowsWritten`
  counts index writes too, so it is not `changes`); blobs bind as `ArrayBuffer`; `transaction` is
  `transactionSync`; `setup` and `maintain` do nothing (the platform owns journaling and vacuum).
- `node:sqlite` and `node:fs` are reached through `process.getBuiltinModule`, never imported, so
  `store.mjs`, `db-crypto.mjs` and the driver module load in workerd.

`new Store(directory, { key, keyProvider, driver })`:

- `driver` given → `directory` may be `null` (a DO has no data folder).
- `keyProvider: () => Buffer(32)`: the host owns the key (the cloud: one per workspace, derived
  from a secret, no DPAPI). A new database is created encrypted from its first row
  (`db-crypto.mjs › initEncrypted`: the same tables, indexes and canary `encryptDatabase` leaves);
  a plain existing database refuses to open (`StoreKeyError`) instead of silently staying plain.
- "New database" now means "no `records` table" rather than "no table at all": a DO's database is
  never empty (the platform and miniflare keep tables of their own in it). On the desktop the two
  are the same.

Raw-SQL callers outside the store, checked one by one:

| File | Use | On DO |
| --- | --- | --- |
| `tools.mjs` (history search) | FTS5 table kept in sync with messages; opened its own `BEGIN` | now `db.transaction(…)` unless already in one; FTS5 works in DO SQLite |
| `wiki.mjs`, `histories.mjs`, `routes/missions.mjs` | `store.sql(text)` prepared statements | unchanged, go through the driver |
| `encryption.mjs` | reads `colmena_meta` | unchanged |
| `backup.mjs` | `node:sqlite`'s `backup()` of the live database | uses `store.db.native`; refuses on DO (cloud backups are a platform concern: DO point-in-time recovery, R2 exports) |

### The in-Node fake of DO SQL (`server/do-sql-fake.mjs`)

`FakeDurableStorage(file)` gives `{sql, transactionSync}` on a `node:sqlite` file with the DO rules
the store must live with: cursors (`toArray`, `one`, `raw`, `next`, iteration, `columnNames`,
`rowsRead`, `rowsWritten`); several statements per `exec` (no bindings then);
`BEGIN`/`COMMIT`/`ROLLBACK`/`SAVEPOINT`/`RELEASE` refused with DO's own message; journal, sync,
vacuum and checkpoint PRAGMAs, `ATTACH` and `VACUUM` refused; blobs in and out as `ArrayBuffer`
(typed arrays refused, so an adapter that forgets to convert fails in tests); plain-object rows;
nested `transactionSync` as savepoints; a platform table present from the start. `rowsRead` /
`rowsWritten` are approximations.

`COLMENA_STORE_DRIVER=do-fake npm test` runs the whole suite with every default-constructed Store
on `DoDriver(FakeDurableStorage)`.

### Test results

| Driver | Tests | Pass | Fail | Skipped |
| --- | --- | --- | --- | --- |
| `node` (default), before the change (`a362647`) | 1527 | 1525 | 1 | 1 |
| `node` (default), after | 1532 | 1532 | 0 | 0 |
| `do-fake` | 1532 | 1516 | 14 | 2 |

The 14 `do-fake` failures, none of them a gap in the adapter:

- 9 are file-level desktop features: online backups (`backup.test.mjs` ×5, the backup parts of
  `encryption.test.mjs` ×2 and `wiki.test.mjs` ×1) need `node:sqlite`'s `backup()`, and the
  file-level migration to encryption (`encryptDatabase`) opens the file with `node:sqlite` on its
  own.
- 2 run desktop PRAGMAs from the test itself (`wal_checkpoint` in `encryption.test.mjs`,
  `synchronous` in `t3-harness.test.mjs`): refused by DO, as intended.
- 3 are timing-sensitive tests that also fail now and then on the default driver under a full
  parallel run (`router`, `office-preview`, `teams`); each passes when run again on `do-fake`.

The skips: one environment-dependent test of the suite, and the "default driver is node:sqlite" check of
`store-driver.test.mjs`. Adapter gaps found and fixed on the way: the store's "new database" test
(DO databases are never empty), and closing the fake's file when a test closes its store.

### The workerd smoke (`cloud/`)

`cloud/` is a package of its own (wrangler 4.150.0, like `relay/cloudflare`):

- `wrangler.toml`: `nodejs_compat`, a SQLite-backed DO class `Workspace`, `JURISDICTION = "eu"`.
  Jurisdiction is not a `wrangler.toml` field: the Worker picks
  `env.WORKSPACE.jurisdiction("eu")` at runtime. workerd does not implement jurisdictions
  ("Jurisdiction restrictions are not implemented in workerd"), so `npm run dev` clears the var.
- `src/worker.js`: `/w/:workspace/*` → that workspace's DO (`idFromName`). The DO opens the real
  `server/store.mjs` on `DoDriver(ctx.storage)` with a `keyProvider` (HMAC-SHA256 of the workspace
  name under the `WORKSPACE_KEYS` secret), and exposes `GET /info`, `GET /records/:kind`,
  `GET|PUT /records/:kind/:id`, `POST /bench` and `GET /ws` (hibernation API: `acceptWebSocket`,
  `webSocketMessage`; the workspace name rides in the socket's attachment so a woken object can
  reopen its store). Store listeners broadcast every change to every socket: the replacement for
  SSE.
- Every request needs the shared token (`CLOUD_TOKEN` secret): `Authorization: Bearer …`, or the
  WebSocket subprotocols `["colmena.v1", "token.<token>"]`. Without `CLOUD_TOKEN` or
  `WORKSPACE_KEYS` the Worker refuses everything (fail closed).
- Local secrets live in `.local/cloud.env` (gitignored), passed with `--env-file`.
- `scripts/smoke.mjs`: auth refusals, put/get/list, encryption on, seeding, workspace isolation,
  two WebSocket clients seeing each other's writes (one writing over the socket, one over HTTP),
  1,000 sequential puts and gets, an in-object bench and a 50-client fan-out.

(Phase 1 replaced this smoke and its routes with `cloud/scripts/e2e.mjs`; the numbers below are Phase 0's.)

Local results (`wrangler dev --local`, Windows laptop, encrypted workspace, 200-byte records,
all 16 checks passing):

| Measure | Result |
| --- | --- |
| Empty round trip (`/health`, Worker only) | p50 2.6 ms |
| 1,000 sequential HTTP puts (Worker → DO → encrypted store) | 6.6 s total; mean 6.6 ms, p50 5.5 ms, p95 7.5 ms |
| 1,000 sequential HTTP gets | 4.5 s total; mean 4.5 ms, p50 4.1 ms, p95 5.5 ms |
| 1,000 puts + 1,000 gets inside the object (one request) | 308 ms wall; in-object 86 ms puts (86 µs each, AES-GCM included), 46 ms gets, 28 ms `list` of 1,000 |
| Fan-out: one write to 50 connected sockets | all 50 received in p50 7.3 ms (first round 17.6 ms, cold) |

The per-request cost is HTTP and the Worker → DO hop, not the store: the store itself costs
under 0.1 ms per encrypted write. Deployed numbers will add network round trips, not store time.

What the real workerd DO SQL showed (`POST /w/:ws/selftest`), compared with the fake:

| Behaviour | workerd | fake |
| --- | --- | --- |
| `BEGIN` | refused with the transactionSync message | same |
| `PRAGMA journal_mode` | `not authorized: SQLITE_AUTH` | same |
| several statements in one `exec` | runs all, cursor of the last | same |
| FTS5 with `unicode61 remove_diacritics 2`, `bm25` | works | works (node:sqlite) |
| blobs out | `ArrayBuffer` | same |
| typed-array bindings | accepted | refused (stricter on purpose) |
| more than 100 bindings | `too many SQL variables` | same |
| a 2 MB+ string | accepted locally (production documents a 2 MB limit) | refused (production's rule) |
| nested `transactionSync` | works | works (savepoints) |
| rows | plain objects | same |
| an "empty" database | has `__miniflare_do_name` locally (and the platform's `_cf_` tables in production) | has `_cf_KV` |

### Risks found and what is left for the store

1. **Value size.** DO SQL documents 2 MB per string/BLOB/row. Most records are small, but step
   histories (`histories`), receipts and tool outputs can grow past it before `pruneReceipts`
   slims them (after 7 days). No test hit the limit with the fake enforcing it, but real
   conversations will. Needed: a size guard in `Store.put` on DO (spill the body to R2, keep a
   pointer), the same idea as `spill.mjs`.
2. **One thread per workspace.** A DO is single-threaded: every member's request to a workspace
   queues behind the others. `list(kind)` of a big kind decrypts every row synchronously (the
   encrypted path cannot filter in SQL except on `meta` fields). Fine at the measured ~30 µs per
   row (encrypted `list` of 1,000 in 28 ms) for thousands of rows, a problem for 100k. Needed: keep hot paths on `where` / `ordered`
   over `meta`, and audit `list()` callers on big kinds (messages, receipts, events).
3. **Memory and CPU limits.** 128 MB per isolate and a CPU budget per request; the desktop has
   neither. The same `list()` callers are the risk.
4. **Encryption key custody.** Workspace keys derive from one master secret (HMAC-SHA256 of the
   name). Rotation means re-encrypting a workspace (the `encryptDatabase` path is file-based and
   node-only today); a per-workspace wrapped key in D1 would make rotation cheap. Encryption at
   rest is also provided by the platform; the app-level layer is what keeps operators out.
5. **Backups.** `node:sqlite`'s `backup()` does not exist on a DO. DO point-in-time recovery
   covers disasters; a user-facing export needs a records-level dump to R2.
6. **Jurisdiction cannot be tested locally.** workerd throws on `jurisdiction()`; the EU binding
   is only exercised when deployed.
7. **Things the desktop does with the database file** (WAL tuning, `incremental_vacuum`,
   checkpoints, the file-level encryption migration, `EXPLAIN QUERY PLAN` in tests) are no-ops or
   refused on DO. They are already isolated behind the driver or are desktop-only.

Left for the store: the R2 spill for large values, a records-level export, a migration path for
existing desktop data into a workspace (upload + re-encrypt with the workspace key), and running
listeners' consumers (live snapshots, notifications) inside the DO.

## Portability of the rest of the server

Method: a static import graph of `server/` (243 modules) plus an actual wrangler bundle of
`runtime.mjs`, `scheduler.mjs`, `rooms.mjs` and `routes/missions.mjs` loaded in
`wrangler dev --local`.

- **The runtime core is not separable today.** Starting from `runtime.mjs`, `scheduler.mjs`,
  `room.mjs`, `rooms.mjs` and the mission/room routes, the static closure is **149 of 243
  modules**: the runtime imports its tools, which import code engines, computer use, projects,
  documents, dictation and the CLI providers. 31 modules in that closure touch `node:fs`,
  `node:child_process`, `node:os`, `node:net`/`http` or DPAPI.
- **It bundles** (6.5 MB, 1.46 MB gzipped, within the 3 MB Free and 10 MB paid limits) but
  **does not load**: workerd stops at module evaluation with
  `TypeError: Invalid URL string` from top-level `new URL(…, import.meta.url)` /
  `fileURLToPath(import.meta.url)`. Module-scope hazards in the core:
  `runtime.mjs` (`SKILLS_DIR`), `soul.mjs` (prompt templates read from `prompts/`),
  `nexo/credential-vault.mjs` (the Python helper's URL), `dictation/index.mjs`,
  `projects/files.mjs` (`HERE`), `documents.mjs` (`createRequire`). The `createRequire` ones in
  `media.mjs`, `office/common.mjs`, `sheets/xlsx.mjs`, `slides/pptx.mjs` are lazy and only fail
  when called.

Grouping of the 76 modules that touch the filesystem, processes, the OS or DPAPI
(`C` = in the runtime core's closure):

**1. Fine with `nodejs_compat` after small seams** (module-scope paths made lazy, prompts and
skills bundled as text through wrangler `rules` instead of read from disk):
`runtime.mjs` (C, skills dir), `soul.mjs` (C, prompt templates), `routes/missions.mjs` (C),
`web.mjs` (C; `node:http`/`net` only for the SSRF-checked fetch: replace with `fetch`),
`triggers.mjs` (C), `watch-sources.mjs` (C), `peers/service.mjs` (C, its state files become
records), `instance.mjs`, `search.mjs`, `core-routes.mjs`, `mcp/routes.mjs`, `computer/routes.mjs`.

**2. Needs R2 or a virtual filesystem** (they read and write files that are data, not code):
`files.mjs` (C, mission files), `spill.mjs` (C, large tool output), `media.mjs` (C),
`memory.mjs` (C), `mention-refs.mjs` (C), `room-work.mjs` (C), `tools.mjs` (C, file tools),
`docs/make.mjs`, `sheets/make.mjs`, `slides/make.mjs` (C, generated deliverables),
`projects/files.mjs`, `projects/tools.mjs` (C, read side), `peers/files.mjs`, `portraits.mjs`,
`workfiles.mjs`, `wiki-import.mjs`, `memory-import.mjs`, `dragout.mjs`, `turn-changes.mjs`,
`backup.mjs`, `backup-service.mjs`, `encryption.mjs`, `code/archive.mjs`, `code/pr-watch.mjs`,
`code/routes.mjs`, `code/terminal.mjs`, `code/policy.mjs`, `code/context.mjs`.

**3. Needs a Container** (spawns processes, opens ports or needs a real POSIX filesystem):
`checkpoints.mjs` (C, hidden Git), `projects/run.mjs`, `projects/servers.mjs` (C, dev servers
and ports), `providers/claude-cli.mjs` (C, Claude Code CLI + local MCP over HTTP),
`code/claude.mjs`, `code/codex.mjs`, `code/opencode.mjs`, `code/git.mjs`, `code/files.mjs`,
`code/ports.mjs`, `code/processes.mjs`, `code/service.mjs`, `code/shared.mjs`,
`officepdf.mjs` (LibreOffice), `peers/codeshare.mjs`, `managers/cli.mjs`,
`diagnostics.mjs` (`worker_threads`), and the native modules behind lazy `createRequire`
(`@napi-rs/canvas`, used by `media.mjs` and `office/common.mjs`).

**4. Desktop-only** (stay in the desktop local agent; the cloud gets its own equivalents):
DPAPI and the OS vault: `nexo/credential-vault.mjs` (C), `vault.mjs` (C), `provider.mjs` (C, its
API-key vault: in the cloud keys are per-workspace secrets), `db-key.mjs`, `secrets.mjs`,
`nexo/import.mjs`, `nexo/oauth.mjs` (loopback OAuth), `mcp/hub.mjs` (local MCP servers);
computer use: `computer/system.mjs` (C), `computer/sandbox.mjs` (C), `computer/tools.mjs` (C),
`computer/desktop.mjs`; voice and dictation on OS recognizers: `voice.mjs` (C), `voice-live.mjs`,
`dictation/index.mjs` (C); password managers: `managers/bw-window.mjs`,
`managers/bw-unlock-helper.mjs`; the shell: `app.mjs`, `index.mjs`.

### What this means for Phase 1

The store moves as is. The runtime does not, until its tool registry stops importing every
tool's implementation: tools need to be registered by capability (cloud-safe, needs-R2,
needs-container, desktop-only) so that the DO bundle imports only the first two groups and
forwards the rest to a Container or to the person's desktop agent. The concrete first steps:

1. Make module-scope paths lazy and bundle `prompts/` as text (unblocks loading).
2. Split `tools.mjs`'s registry from the tool implementations.
3. A files seam (`files.mjs`, `spill.mjs`, deliverables) with a local-disk and an R2 backend.
4. Scheduler timers → DO alarms; in-memory runtime state that must survive eviction → records.

## Phase 1: a hosted Colmena a team signs into

Deployed as the Worker `colmena-nube` (https://colmena-nube.klast-lab-fa693a.workers.dev). The
Phase 0 routes (`/w/:workspace/*` with the shared `CLOUD_TOKEN`) are gone: people sign in.

```
browser ──► Worker colmena-nube (cloud/src/worker.js)
             ├─ /auth/*    ──RPC──► Directory DO (one, EU): people, links, sessions, companies, roles, invitations
             ├─ /api/*     ──fetch─► Workspace DO "ws:<id>" (one per company, EU): server/cloud/host.mjs
             │                       = the desktop's Express app (server/app.mjs) on the encrypted store
             ├─ /api/live  ──WebSocket (hibernation)──► the same object: each person's live frames
             └─ pages      ──► static assets (../dist): the app behind sign-in; cloud.html for
                               /entrar, /entrar/verificar, /empresa, /invitacion
Workspace DO ──► R2 colmena-nube-files (EU), workspaces/<id>/<mission>/<file>
```

### Accounts and companies (`cloud/src/directory-core.js`, `directory.js`)

- **Why a Durable Object and not D1.** When this was built the deploy token had no D1 scope; it
  has since been widened, but the directory stayed a SQLite DO on purpose: every operation is a
  synchronous `transactionSync` (a link used once, a session rotated, the last owner kept), it
  lives in the EU like the workspaces, and the same code runs on `server/do-sql-fake.mjs` in the
  tests. Moving it to D1 means making `DirectoryCore` async; nothing else would change. One object
  serialises every sign-in of the deployment; fine for a few hundred people, a D1 move (or a
  shard per email domain) before it is thousands.
- **Better Auth** was considered and not used: it wants a Kysely/Drizzle database adapter (D1 or
  Postgres), not a DO's synchronous SQL, and brings far more than magic links. The own
  implementation is small and keeps the shape the other providers need: an `identities` table
  (provider, subject → person) and `signInWith({provider, subject, email})`, so Google,
  Microsoft and GitHub are an OAuth callback each (phase 2).
- **Sign-in link.** `POST /auth/link {email, next}` answers the same whether the address exists.
  32 random bytes; the directory keeps their SHA-256. Valid 15 minutes, once; using one closes
  every other open link of that address. Limits: 5 per address and 20 per IP per 15 minutes; 60
  verifications per IP. The link is `/entrar/verificar#t=…`: the token is in the fragment (never
  sent to the server in a URL, never logged) and is used with one press of a button
  (`POST /auth/verify`), so mail scanners that open links do not burn it. `next` is only ever a
  path of this site.
- **Sessions.** Cookie `__Host-colmena` (HttpOnly, Secure, SameSite=Lax, Path=/, no Domain; on
  plain-HTTP `wrangler dev` it is `colmena_local` without Secure). Stored hashed; 30 days at most,
  ended after 14 days unused; the token is replaced every 6 hours of use (the old one works one
  more minute for requests in flight); logout deletes it. **CSRF:** every write needs an
  `Origin` equal to the site (or `Sec-Fetch-Site: same-origin`) and the session's CSRF token in
  `X-Colmena-Token` (the desktop's header, served by `/api/bootstrap` as before); the WebSocket
  needs the Origin.
- **Roles.** owner, admin, member, guest. Owners name admins and owners and the last owner always
  stays; admins invite, remove and switch people between member and guest; members use the
  company; guests read and write in the conversations they can see and change nothing else
  (`server/cloud/host.mjs › GUEST_WRITES`).
- **Invitations.** By email, 7 days, bound to that address (accepting needs to be signed in with
  it), once; a new one replaces the open one. Whoever invites also gets the link to pass on.
  **Removing someone** deletes the membership, ends every session they have and closes their
  open sockets in the company (`Workspace#revokePerson`).
- **Directory.** `GET /auth/workspace` lists the people of the current company with their roles;
  the company keeps its own copy (`members` records, `syncMembers` after every change), which is
  what the app shows and what the workspace checks every request against.

Routes: `POST /auth/link|verify|logout|workspaces|workspaces/select|invitations/preview|
invitations/accept|workspace/invitations|workspace/leave`, `GET|PATCH /auth/me`,
`GET|PATCH /auth/workspace`, `PATCH|DELETE /auth/workspace/members/:id`,
`DELETE /auth/workspace/invitations/:id`, `GET /auth/dev/mail` (admin token only).

### Mail (`cloud/src/mail.js`)

First provider configured wins: Cloudflare Email Sending (a `[[send_email]]` binding named
`SEND_EMAIL` plus the var `MAIL_FROM_ADDRESS`), then a Resend-shaped HTTP API (secret
`RESEND_API_KEY`, sender `MAIL_FROM`). With neither, the **dev fallback**: the link goes to the
Worker's log (`wrangler tail colmena-nube`) and to a 30-minute outbox in the directory, readable
only with `Authorization: Bearer <ADMIN_BOOTSTRAP_TOKEN>` at `GET /auth/dev/mail?email=…`. The
public response never contains it. Invitations also show their link to whoever invited.

Today there is no sending domain: `wrangler email sending list` finds none and no zone has Email
Routing. To turn real mail on, the owner:

1. adds (or picks) a domain as a zone in this Cloudflare account;
2. `wrangler email sending enable <domain>` and adds the DNS records it lists
   (`wrangler email sending dns …`);
3. in `cloud/wrangler.toml`: `[[send_email]] name = "SEND_EMAIL"` and
   `MAIL_FROM_ADDRESS = "colmena@<domain>"` under `[vars]`; `npm run deploy`.

(Or, with Resend: `wrangler secret put RESEND_API_KEY` and a verified `MAIL_FROM`.) The dev
outbox and `/auth/dev/mail` switch themselves off as soon as a provider is configured.

### The real server in each company (`cloud/src/workspace.js`, `server/cloud/host.mjs`)

- **Loading.** The desktop's server bundles (9.4 MB, 2.2 MB gzipped) and loads in workerd: the
  module-scope `new URL(…, import.meta.url)` calls became `modulePath()` (null where modules are
  not files), `prompts/` and the seed skills are read through `server/bundled.mjs` (the cloud
  build registers them as text: `cloud/scripts/gen-assets.mjs`), the `createRequire`s are lazy,
  and `app.mjs`'s optional modules are static imports.
- **Serving.** `createApp` runs unchanged behind Cloudflare's Node HTTP server support: the
  object listens on a port of its isolate and hands each request to `handleAsNodeRequest`
  (bodies are read whole first: a refusal that never reads its body must not leave a half-read
  stream). `createApp({hosted})` swaps the loopback/token check for the host's guard, adds the
  host's routes and overlays `/api/state` (the person's name, `cloud: {workspace, me, members,
  hidden}`, the company as the sidebar's one team, the desktop welcome skipped).
- **Who asks.** The Worker sends `X-Colmena-Person` ({id, name, email, role}) and drops any such
  header a browser sent; the guard checks the person is in the company's own list and runs the
  whole request as them (`asPerson`, AsyncLocalStorage).
- **Live channel.** `/api/events`' body became `openFeed(write)`; the object opens one feed per
  socket (hibernation API, tagged with the person) and filters what each person may see. The
  client keeps EventSource's shape (`src/lib/cloud.js › liveSource`); keep-alives are answered by
  `setWebSocketAutoResponse` without waking the object. Measured deployed: a message appears on
  the other person's screen 0.8–1.2 s after the send starts (one POST plus the fan-out, from a
  client in Spain to the EU object).
- **Desktop-only places** answer 404 `{desktopOnly: true}` (`/api/peers`, `teams`, `code`,
  `computer`, `projects`, `voice`, `voice-live`, `dictation`, `backup`, `encryption`,
  `password-managers`, `browser-sessions`, `vault`, `logins`, `sign-in-grants`, `folders`,
  `webhooks`, `diagnostics`, `drag`, `auth`), and the screens hide «Código». Bots and providers
  load with no AI account (`noProvider`): rooms and chats open; a bot named in a message waits
  (phase 3).
- **Files** (`server/file-store.mjs`): the store's folder is mounted on a backend, so
  `files.mjs` (attachments, deliverables, read_file) and the work-file routes read and write
  there instead of a disk. Deployed: R2 `colmena-nube-files` (EU), `workspaces/<id>/…`; without
  the binding (`wrangler dev`) the object's own SQLite (`colmena_files`, 1.5 MB per file).
  Editing a work file in place (`PUT …/workfiles/file`) and Office previews still use the disk:
  not available in the cloud yet.
- **Timers.** The scheduler is not started (no AI yet); `Workspace#alarm` is the place routines
  come back to in phase 3 (it runs the question sweep as background work today).

### Identity (`server/identity.mjs`)

`currentPerson()` is `DESKTOP_PERSON` everywhere on the desktop; the host runs each request,
socket flush and alarm as a person (or `SYSTEM_PERSON`). What is per person:

- **Who wrote a message:** a hosted person's message gets `by` {id, name}; the screens show
  someone else's by name and avatar and yours as «Tú» (`authorView`).
- **Who decided an approval:** `decidedBy`.
- **Read state:** notifications' `read`/`readAt` → `readBy` {person: at}; rooms' `seenAt` →
  `seenBy`. Read as a person, a record shows their own values; the stored ones stay what
  background work set. `unread` in a room counts other people's messages too.
- Workspace-wide: settings, bots, skills, memory, notes.
- **Conversations of people** (`mission.people`): a hosted sala is shared by the whole company;
  what names no bot is only said (no turn). **Direct messages** (`POST /api/cloud/dm {person}`)
  have an `audience`: only those two see them in `/api/state`, open them or get their live
  frames. The E2EE mailbox stays desktop ⇄ desktop.

### Secrets (`server/envelope-vault.mjs`)

Master secret `VAULT_MASTER_KEY` (Worker secret) → per-company key (random, wrapped AES-256-GCM
under the master, stored in the company's store as `cloud/vault-key` with the master's id) →
per-secret data key (random, wraps the secret; both bound to company, namespace and profile).
It has the shape of the DPAPI vault (`load/save/remove`), so `SiteVault`, `SecretStore` and
`McpHub` take it unchanged. Rotating the master: list the new one first and the old one after;
each company's key is rewrapped the first time it is opened. The database itself stays
encrypted as in Phase 0 (key derived from `WORKSPACE_KEYS` and the company id).

### Web (`cloud.html`, `src/cloud/`)

A second Vite entry (built with the app into `dist/`): sign-in, «Revisa tu correo», the link,
companies (create, open, people with roles, invite with a copyable link, pending invitations,
direct message, remove, leave) and the invitation. Spanish, Colmena's tokens, Phosphor icons,
light and dark, one column from 390 px up. The app itself is the desktop's UI, marked as hosted
by the Worker (`<meta name="colmena-host" content="cloud">`); on phones it still has the
desktop layout until the responsive shell lands (separate work).

### Secrets and resources

| Name | What | Where |
| --- | --- | --- |
| `WORKSPACE_KEYS` | master of the per-company database keys (Phase 0) | Worker secret |
| `VAULT_MASTER_KEY` | master of the envelope vault | Worker secret, `.local/cloud-phase1.env` |
| `ADMIN_BOOTSTRAP_TOKEN` | reads the dev mail | Worker secret, `.local/cloud-phase1.env` |
| `RESEND_API_KEY` or `SEND_EMAIL` + `MAIL_FROM_ADDRESS` | real mail | not set yet |
| `CLOUD_TOKEN` | Phase 0's shared token | still set, unused: can be deleted |
| R2 `colmena-nube-files` (EU) | mission files | bound as `FILES` |
| DO classes `Workspace` (v1), `Directory` (v2) | | migrations in `cloud/wrangler.toml` |

### Running and testing

- Desktop: `npm test` adds `tests/cloud-directory.test.mjs` (links, limits, sessions, rotation,
  roles, invitations, isolation, other providers), `tests/cloud-host.test.mjs` (identity seam,
  per-person fields, the guard, rooms of people, direct messages, guests, the live feed per
  person, two companies, files without a disk, the envelope vault) and
  `tests/cloud-auth.test.mjs` (cookie, origin and CSRF, mail fallback, envelope encryption).
- Local: `npm run build` at the root, then in `cloud/`: `npm run dev` (secrets from
  `../.local/cloud.env`: `WORKSPACE_KEYS`, `VAULT_MASTER_KEY`, `ADMIN_BOOTSTRAP_TOKEN`).
- `npm run e2e -- --url … --env …` (44 checks: sign-in, single use, CSRF, company, invitation
  bound to its address, room in real time over the socket, authors, files, direct messages,
  guests, isolation between two companies, a forged person header, removal ending sessions and
  sockets, logout) and `node scripts/e2e-browser.mjs --url … --env … --shots …` (the same story
  in Chromium: a laptop and a phone, screenshots of every step).
- Deploy: `npm run build` at the root, then `cd cloud && npm run deploy`.

### Left for phase 2

- Slack replacement: channels public and private with membership (today every sala is the whole
  company's), threads and mentions of people, presence and typing over the socket, search across
  the history filtered by what each person may see (`/api/search` and the bots' history search do
  not filter by audience yet), Web Push and mail of unread, retention and export, the Slack
  import and bridge.
- The sidebar's «Personas» group and «Nuevo mensaje directo» inside the app (today the company
  page lists people and opens direct messages); a profile page to rename yourself
  (`PATCH /auth/me` exists).
- Google, Microsoft and GitHub sign-in on `signInWith` (an OAuth callback each).
- A real mail provider (above), then dropping the dev outbox.
- Notifications per person (who they are for) and per-person settings beyond the name (theme,
  sidebar) — today those are the company's.
- Big values: the R2 spill of records over 2 MB, a records-level export, importing desktop data.
- The directory as one object: shard or move to D1 before thousands of people.
- Editing work files and Office previews without a disk; generated documents need phase 4.
