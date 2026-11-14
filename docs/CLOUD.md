# Colmena in the cloud

Status: **Phase 2** (team messaging: channels, threads, search, notifications, the Slack import and
sign-in with Google, Microsoft and GitHub, deployed). Phase 1: accounts, companies and the real server
in each workspace; Phase 0 proved the store on Durable Objects. This document is the start of the
cloud architecture; it grows with each phase. The desktop stays as it is: everything here is
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

(Phase 2 below did most of this list; what is still open is under «Left for phase 3».)

## Phase 2: team messaging, so a company can leave Slack

```
browser ──► Worker colmena-nube
             ├─ /auth/oauth/:provider[/callback]   Google, Microsoft, GitHub (cloud/src/oauth.js)
             ├─ /auth/workspace/…                  members, roles, deactivation, domains, invitations
             ├─ /api/chat/*  ──► Workspace DO: server/cloud/chat-routes.mjs over chat.mjs (own tables)
             │                   PUT /api/chat/files, …/import/:id/parts/:n and GET /api/chat/files/:id
             │                   are streamed by the object itself to/from R2 (cloud/src/workspace.js)
             └─ /api/live    ──► the same socket as Phase 1: chat.* frames per person, typing, presence
Workspace DO alarm ──► Slack import steps · mail digest of unread mentions · hourly retention
```

### The model (`server/cloud/chat.mjs`)

Team messaging keeps its own tables in the workspace's SQLite instead of the store's records: a
channel of 50,000 messages is read by pages over `(channel, top, seq)` without decrypting the rest.
Every body (message, channel, profile, draft, file name, audit entry) is sealed with the store's
own AES-256-GCM cipher, bound to its table and id; operators see ids, sequence numbers, times and
flags only.

| Table | Holds |
| --- | --- |
| `chat_channels` | public, private, `dm`, `group`; archived; `last_seq`; `dm_key` (the people of a DM, sorted) |
| `chat_members` | who is in which channel; `read_seq` (unread, «marcar como leído», unread from a message), notify (`default`/`all`/`mentions`/`nothing`), muted, the sealed draft |
| `chat_messages` | `seq` (order), `thread` (the first message's seq), `top` (shown in the channel: not a reply, or a reply also sent to it), author, times, edited, deleted, reply count, pinned, has file/link, sealed body (text, files, reactions, repliers, link preview) |
| `chat_terms` | the search index: `HMAC(word prefix)` → seq |
| `chat_mentions` | what was «para ti» (mention, DM, @canal, @aquí, thread, keyword): badges, «Para ti», the mail digest |
| `chat_people`, `chat_push` | profiles (title, time zone, status, «ausente», «no molestar» and its schedule, keywords, digest) and Web Push subscriptions |
| `chat_files` | uploads (blob key in R2, sealed name and type) |
| `chat_audit`, `chat_kv` | the audit log; settings (default channels, retention, digest minutes), import state, the term key |
| `chat_ghosts`, `chat_import_map` | people of a Slack import (original name; linked to a member by email), Slack ids → ours |

**Who sees what** is decided in one place and applied to every way out:

- A public channel: everyone in the workspace who is not a guest. Guests, private channels, DMs and
  groups: their members only.
- API: every route goes through `mustRead` / `mustPost` (404 for what you may not see).
- Live socket: frames carry an audience. The host sends each socket only frames for its person,
  plus «watching» frames for the channel it has open, after checking it may read that channel.
- Search: only channels the person may read.
- Admins manage every channel (archive, rename, members, default) without reading private ones.
- Deactivated people (`deactivated` from the directory) are refused everywhere; their name stays on
  what they wrote.

**Messages.** Stored in Slack's own format: `&lt;` escaping, `<@persona>`, `<#canal>`,
`<!channel>`, `<!here>`, `<url|texto>`, `*negrita*`, `_cursiva_`, `~tachado~`, code. That makes the
import lossless. Mentions of anyone who is not a member (or an import ghost) become plain text.
Threads have replies with «también enviar al canal». Messages support reactions, pins, edits by
their author, and deletes by their author or an admin (audited). A first message with replies stays
as «Mensaje eliminado». Link previews are fetched by the server after the message is out
(`link-preview.mjs`):
- only http(s) on ports 80/443, no credentials, no private, loopback, link-local, CGNAT or multicast
  address, as a literal or after DNS-over-HTTPS resolution;
- the same checks on each of at most 3 redirects;
- 4 s and 512 KB at most, HTML only.

Files go to R2 (`workspaces/<id>/chat/<channel>/<file>/<name>`, 100 MB each). They are served inline
only for images, audio, video and PDF; everything else downloads, with `sandbox` CSP and `nosniff`.
An upload never sent is deleted after a day.

**Search** (`GET /api/chat/search?q=`): words by prefix (accents and case folded, every word must
match), `from:@persona` (including what they wrote before joining, through the import),
`in:#canal` / `in:@persona`, `has:file|link|pin`, `before:` / `after:` / `on:` (YYYY-MM-DD), and
`during:` (YYYY-MM or YYYY), with Spanish aliases (de:, en:, tiene:, antes:, después:, el:, durante:).

FTS5 works in DO SQLite (Phase 0 checked it) but is **not used**: its index keeps every word in
the clear and would undo the encryption. Instead, `chat_terms` keeps an HMAC (under a per-workspace
key) of each word's 3- and 5-letter prefix, or of the whole word under 3 letters. The candidates
are decrypted and checked word by word.

**Unread and drafts.** Each person has `read_seq` per channel. Unread counts stop at 100 («99+»).
Your own message reads everything before it. «Marcar como leído», and «marcar como no leído desde
aquí» (sets `read_seq` to the message before). The channel opens at the first unread with a «Nuevo»
line, and «Ir a lo no leído» / «Ir al final». Drafts are per person and channel (sealed).

**Notifications.**
- A new message makes a `chat_mentions` row for the people it is for: a DM, a direct mention,
  @canal, @aquí (only who is active), replies in a thread they took part in, or their keywords.
- Preferences per channel: `all` / `mentions` (the default for channels; DMs are `all`) /
  `nothing`, plus mute (only direct mentions get through).
- A Web Push goes to their devices when the preferences allow it, they are not in «no molestar»
  (until a time, or a daily schedule in their own time zone), and **no screen of theirs is active**.
  Presence comes from the sockets: `active`, or `away` when every screen of theirs says so (hidden
  tab or 10 minutes idle).
- Push (`server/cloud/webpush.mjs`): VAPID ES256 and aes128gcm with WebCrypto only. It posts only to
  the known push services (FCM, Mozilla, Windows, Apple) and deletes a subscription on 404/410.
  The service worker is `public/colmena-sw.js`, registered only in the hosted app.
- The mail digest: mentions still unseen after `digestMinutes` (default 30, 5–1440) are mailed once
  through the mail provider (`cloud/src/mail.js`, kind `digest`). On the dev fallback they go to
  the dev outbox. A person can turn it off; «no molestar» delays it.

**Typing and presence** never touch storage:
- A screen sends `{type:"typing", channel}` at most every 3 s; the object relays it to the channel's
  other people (and whoever watches it).
- `{type:"presence", state}` and `{type:"watch", channel}` live in the socket's attachment, so they
  survive hibernation.
- Keep-alives are still answered by `setWebSocketAutoResponse` without waking the object.

**Admin** (owners and admins):
- The directory side, in the Worker: roles; deactivate/reactivate (every session ends, sockets
  close, the name stays); allowed email domains (public mail providers refused; someone an admin
  removed does not come back on their own); invitations, including the ones an import makes.
- The workspace side: channels (archive, default for newcomers); retention (`retentionDays`, 0 =
  forever: older messages, their index entries, mentions and files go, 500 at a time, hourly).
- `GET /api/chat/admin/export.zip`: a streamed ZIP with `workspace.json`, `people.json`,
  `channels.json`, `channels/<name>/messages-NNNN.json` (5,000 each), `audit.json` and `files/`
  (`?files=0` without them).
- The audit log covers every admin action, from the Worker (`Workspace#audit`) and from the
  workspace (archive, rename, default, members of a channel someone is not in, settings, export,
  import, retention, deleting someone else's message).

### Slack import (`server/cloud/slack-import.mjs`, `slack-export.mjs`, `zip.mjs`)

The admin uploads the export ZIP in parts of 64 MB (`POST /api/chat/import` → `PUT …/parts/:n`,
streamed to R2), then starts it. The object reads the ZIP with range reads: the central directory
(ZIP64 supported), then one day file at a time, so memory stays at about one day file. It runs in
steps from the alarm (2,000 messages per step, the next one 250 ms later). The state (phase, cursor,
counts) is saved after every day file, and each message is keyed by (import, channel, ts), so a
repeated or resumed step never imports twice.

- **Users** become «ghosts» with their original name, title and colour. Those whose email is a
  member are linked to them at once. The rest (not bots, not deleted) become **pending invitations**
  (`importInvitations` in the directory, never mailed; the person sees them under «Invitaciones
  para ti» when signing in with that address). When someone joins later with that email, the ghost
  is linked, they get its channels, and `from:` finds what they wrote.
- **Channels**: `channels.json` (public), `groups.json` (private), `dms.json`, `mpims.json`, with
  their members. Name clashes get a suffix, and an empty channel with the same name (the seeded
  #general) is reused. Archived channels stay archived.
- **Messages**:
  - mention markup is converted (`<@U…>` to our person or ghost; `<#C…|name>` to our channel;
    `<!channel>`, `<!here>`, links and emoji shortcodes kept or converted);
  - threads (with broadcasts), reactions, edits and pins are kept;
  - joins, leaves, topic changes and the like are skipped;
  - bot messages keep their bot's name, and the original author and time are kept;
  - imported history is not unread to anyone.
- **Files**: copied to R2 when the export holds them (`__uploads/<id>/<name>`); otherwise the
  message keeps a link to the original.
- The screen (`/admin/importar`) shows upload progress, the import's progress (it survives a reload)
  and a summary. Test data comes only from `server/cloud/slack-synthetic.mjs`
  (`node cloud/scripts/slack-export.mjs --out x.zip [--big 50000]`), which also states the exact
  counts a correct import must find.

### Sign-in with Google, Microsoft and GitHub (`cloud/src/oauth.js`)

Each provider appears on `/entrar` («Continuar con …») only when both its client id and secret
are set (`GET /auth/providers`).

- **The flow**: the authorization code flow with PKCE (S256), plus:
  - a `state` of 32 random bytes, kept hashed in the directory (10 minutes, single use);
  - an OIDC `nonce` (Google, Microsoft);
  - a browser-binding cookie `__Host-colmena-oauth` (HttpOnly, SameSite=Lax, 10 minutes; its hash
    is stored with the state), so a callback finished in another browser (login CSRF) fails.
- **The id_token** comes straight from the token endpoint over TLS, so its signature is not verified
  (OIDC Core 3.1.3.7); `iss`, `aud`, `exp`, `iat` and `nonce` are.
- **Accounts are linked by verified email**: only verified emails get in, and signing in with Google
  as `ana@…` opens the account `ana@…` already has.
- **Failures** land on `/entrar?error=<code>` (`denied`, `state`, `unverified`, `ms-email`,
  `provider`, `rate`, `account`). No token ever goes into a URL or a log.
- **Outgoing requests** go only to the providers' fixed URLs, with a 10 s timeout.

Redirect URIs (exactly these):

- `https://colmena-nube.klast-lab-fa693a.workers.dev/auth/oauth/google/callback`
- `https://colmena-nube.klast-lab-fa693a.workers.dev/auth/oauth/microsoft/callback`
- `https://colmena-nube.klast-lab-fa693a.workers.dev/auth/oauth/github/callback`

(For `wrangler dev`, add `http://127.0.0.1:8790/auth/oauth/<provider>/callback`, or use a separate
dev app. GitHub OAuth apps take only one callback URL each.)

**Google.**
1. https://console.cloud.google.com/ → pick or create a project → *Google Auth Platform* (APIs &
   Services → OAuth consent screen).
2. User type *External*, app name «Colmena», a support email.
3. Scopes `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`. They are non-sensitive,
   so no review is needed.
4. *Publish app*: in *Testing*, only listed test users can sign in.
5. *Clients* → *Create client* → Application type **Web application** → Authorized redirect URI:
   the Google one above.
6. Copy the client ID and secret.

**Microsoft.**
1. https://entra.microsoft.com/ → *Identity* → *Applications* → *App registrations* → *New
   registration*, name «Colmena».
2. Supported account types: **Accounts in any organizational directory and personal Microsoft
   accounts**. That matches `MICROSOFT_TENANT` unset (`common`). For one company only, pick
   *single tenant* and set `MICROSOFT_TENANT` to its tenant ID.
3. Redirect URI: platform **Web**, with the Microsoft URI above.
4. *Certificates & secrets* → *New client secret*: copy its **Value**, and renew it before it
   expires.
5. *Token configuration* → *Add optional claim* → **ID** → tick **`email`** and **`xms_edov`**. Work
   and school accounts are trusted only when `xms_edov` («email domain owner verified») is true;
   without that claim they are refused. Personal accounts (tenant
   `9188040d-6c67-4c5b-b112-36a304b66dad`) are trusted as they are.
6. The client ID is the *Application (client) ID* on *Overview*.

**GitHub.**
1. https://github.com/settings/developers (or the organization's *Developer settings*) → *OAuth
   Apps* → *New OAuth App*.
2. Name «Colmena»; Homepage URL `https://colmena-nube.klast-lab-fa693a.workers.dev`;
   Authorization callback URL: the GitHub one above.
3. *Generate a new client secret*.

Scopes are asked per sign-in (`read:user user:email`), and only the **primary, verified** address is
used.

Secrets, from `cloud/` (each command asks for the value; nothing is echoed):

    E:\NexoBot\relay\cloudflare\node_modules\.bin\wrangler secret put GOOGLE_CLIENT_ID
    E:\NexoBot\relay\cloudflare\node_modules\.bin\wrangler secret put GOOGLE_CLIENT_SECRET
    E:\NexoBot\relay\cloudflare\node_modules\.bin\wrangler secret put MICROSOFT_CLIENT_ID
    E:\NexoBot\relay\cloudflare\node_modules\.bin\wrangler secret put MICROSOFT_CLIENT_SECRET
    E:\NexoBot\relay\cloudflare\node_modules\.bin\wrangler secret put GITHUB_CLIENT_ID
    E:\NexoBot\relay\cloudflare\node_modules\.bin\wrangler secret put GITHUB_CLIENT_SECRET

Optional: `MICROSOFT_TENANT`, a tenant ID, `organizations` or `consumers`. A secret takes effect
without a redeploy; to switch a provider off, delete either of its pair with `wrangler secret delete`.

### Big values (`Store#spill`)

A Durable Object row holds 2 MB at most. On the DO driver, a stored body over 1.8 MB (step
histories, receipts) is cut into 1 MB rows of `colmena_spill`, and the record keeps a marker.
Reading puts it back together, encrypted or not. Rewriting it smaller or removing it deletes the
pieces.

**Why not R2.** The store is synchronous on purpose (about 2,200 call sites; Phase 0), and an R2
read cannot be awaited inside `Store.get`. The bytes therefore stay in the object's own SQLite (10 GB
per object). What is binary and large by nature already goes to R2: uploads, import parts, mission
files. The desktop (node:sqlite) has no such limit and never spills.

### Screens (`src/chat/`, `src/screens/Canal*.jsx`, `Buscar`, `Personas`, `AdminEmpresa`)

- **Places**:
  - `/canal/:id`: the timeline by pages, the «Nuevo» line, a thread panel (`?hilo=`), a message in
    context (`?m=`), the composer (mentions, files by button, paste or drop, drafts, typing),
    reactions, pins, edit and delete, people and pins dialogs, notification preferences, archive,
    leave;
  - `/canales`: browse, join, create, new message or group, «Para ti»;
  - `/buscar`: search;
  - `/personas`: the directory, profiles, local time, status, «ausente», «no molestar»,
    keywords, digest and push on this device;
  - `/admin/personas|canales|ajustes|importar|registro`.
- **The sidebar** (hosted only) adds search, people, the company, «Canales» and «Mensajes directos»
  with unread and «para ti» counts.
- **The phone**: the top bar carries the channel's name; the heading stays for screen readers
  (`.r-sr-phone`, also used by rooms now).
- **Hooks into shared files** are small: `Sidebar.jsx` (two lines), `lib/store.jsx` (chat frames),
  `lib/cloud.js` (`sendLive`), `routes.jsx`, `responsive.css` (one helper).
- Everything works at 375 px, in light and dark.

### Secrets and resources (added)

| Name | What | Where |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web Push | Worker secrets, made by `cloud/scripts/vapid-keys.mjs` into `.local/cloud-vapid.env`, set with `wrangler secret bulk` from a file |
| `VAPID_SUBJECT`, `PUBLIC_URL` | push contact; the site for links in mails sent from alarms | `[vars]` |
| `GOOGLE_*`, `MICROSOFT_*`, `GITHUB_*` | sign-in providers | not set yet (above) |

No new Cloudflare resources: the R2 bucket `colmena-nube-files` and the two DO classes are Phase 1's.

### Tests and measurements

- **Node**: `npm test` (1,616 tests, all passing) adds:
  - `tests/cloud-chat.test.mjs`: visibility through API, feed and search; DMs; threads, mentions,
    unread and drafts; edits, deletes, reactions and pins; search filters and the keyed index;
    files and their headers; notification rules, «no molestar» and the digest; retention; admin,
    deactivation and export; the Slack import of the synthetic export in small steps; link-preview
    SSRF; 50,000 messages by pages; big values.
  - `tests/cloud-slack-export.test.mjs` (ZIP, parsing, conversion), `tests/cloud-webpush.test.mjs`
    (RFC 8291 vector, VAPID, allowlist), `tests/cloud-oauth.test.mjs` (URLs, PKCE, state, nonce,
    claims, verified email) and more cases in `tests/cloud-directory.test.mjs`.
- **Deployed**:
  - `node scripts/e2e-chat.mjs --url … --env … --big 50000 --sockets 50`: 48/48 checks with three
    test people (channels public and private, isolation over API, socket and search, DMs, threads,
    mentions, unread, typing, presence, files, previews, push subscriptions, the import, admin
    settings, export, deactivation, audit);
  - `node scripts/e2e.mjs`: Phase 1, 44/44;
  - `node scripts/e2e-browser-chat.mjs --shots …`: 13/13 in Chromium, laptop and 375 px phone,
    screenshots in `.local/shots/cloud-phase2/`.

Measured on the deployed Worker from a client in Spain (2026-11-14):

| Measure | Result |
| --- | --- |
| A round trip to the workspace (`GET /api/chat/presence`: Worker, directory session, object) | p50 337 ms |
| Fan-out: one post to 50 open sockets, post start → last socket | p50 380 ms, max 616 ms (first round, cold) |
| … of which first socket → last socket | p50 9 ms |
| Open a channel of 50,000 messages (first page of 50) | p50 341 ms, max 348 ms; an older page 337 ms; a page in the middle 330 ms |
| Search inside it | 349 ms |
| Slack import of a synthetic export with 50,023 messages (554 KB ZIP) | 53 s, in the background |
| Same tests in Node (no network): first page of 50,000 | 5 ms; search 45 ms |

The fan-out itself costs about 40 ms over one request's round trip, and the 50 sockets get the
frame within 9 ms of each other. The rest of every number is the network and the per-request
directory lookup.

### Left for phase 3

- Bots in channels (the runtime has no AI account in the cloud yet).
- Real mail: a sending domain (Phase 1 › Mail), so links, invitations and the digest leave the dev
  outbox.
- The OAuth apps (above): the code is deployed, the buttons appear once the secrets exist.
- Push is checked as far as headless Chromium allows: the worker registers, but headless refuses
  `pushManager.subscribe` («permission denied» in incognito). A real phone or desktop browser
  should be tried once.
- A per-request directory round trip dominates latency: cache sessions in the Worker
  (a few seconds) or move the directory to D1 read replicas.
- Search ranks by recency, not relevance; a `-palabra` exclusion and phrase search are not there.
- Imports: Enterprise Grid exports (one folder per workspace) are not split; very large file
  copies happen inside steps (no per-file resume).
- Slack bridge (live two-way) was not built; the import is one-off.
- Each DO is single-threaded: very busy companies (hundreds of people) should watch CPU per request.
