# Colmena in the cloud

Status: **Phase 5** (the desktop app is a client of the cloud plus a local agent that lends the
person's cloud bots what only their computer has, deployed). Phase 4: the machine parts in the
cloud (a container per company for «Código», commands and Office previews; the bots' browser on
Browser Rendering; company time zones). Phase 3: bots work in the cloud
(per-person AI accounts, durable runtime on alarms, routines, approvals, connectors and bots in
channels). Phase 2: team messaging, the Slack
import and OAuth sign-in. Phase 1: accounts, companies and the real server
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

(Phase 3 below did the first item; the rest is still open.)

## Phase 3: the bots work in the cloud

```
browser ──► Worker colmena-nube (app.colmena.team)
             ├─ /api/*                     ──► Workspace DO: runtime, scheduler and connections
             │                                  (server/cloud/bots-host.mjs) beside team messaging
             ├─ /api/mcp/oauth/callback    ──► an MCP server's sign-in back on the public site
             ├─ /hooks/<workspace>/h/<id>  ──► a routine's webhook address (public, 64 KB)
             └─ /auth/dev/test/*           ──► tests only (FAKE_MODEL_TOKEN): fake model, probe, eviction
Workspace DO alarm   ──► routines due · question waits · renewed limits · polled triggers ·
                         a heartbeat every 20 s while bots work · Phase 2's upkeep
Workspace DO wake-up ──► work an eviction cut goes on by itself (Runtime#resumeInterrupted)
```

### AI accounts, per person (`server/cloud/ai.mjs`)

Each person thinks with their own account. A bot's turn uses the account of **the person who
asked**: whoever last wrote in that conversation or named the bot (`mission.askedBy`); for a routine,
its owner (`automation.ownerId`, stamped when it is made). Limits and errors are theirs: the
usage-limit pause («Limitado») and its renewal live in their own config.

- `PersonHub` is the desktop's `ProviderHub` for one person: choices in `providers/person:<id>`
  (method, last four characters, pins, limits), secrets in the envelope vault under `ai-<id>`. No
  local model, no Claude Code CLI; «Servidor propio» only on a public `https://` address (`cloudBaseUrl`).
- `personalProviders()` has ProviderHub's surface and answers as the hub of `currentPerson()`.
  `Runtime#launch` runs each mission as its owner (`bots-host.mjs`), so every model call of the turn
  (side jobs included) uses that person's account. Background work as nobody reports «connected»
  when anyone in the company has an account, so routines start.
- API keys: OpenAI, Anthropic, OpenCode Go, Gemini, OpenRouter, DeepSeek, Kimi and a public custom
  server, through the desktop's own routes (`/api/auth/apikey|anthropic|opencode`, `/api/ai/accounts/*`).
  Desktop-only ones (`/api/auth/start|cancel|logout|models|local|anthropic/cli`) answer 404.
- **ChatGPT by device code** (`CodexDeviceSession`, what `codex login --device-auth` does):
  `POST https://auth.openai.com/api/accounts/deviceauth/usercode {client_id}` → `device_auth_id`,
  `user_code`, `interval`; the person types the code at `https://auth.openai.com/codex/device`; the
  screen polls `…/deviceauth/token {device_auth_id, user_code}` (403/404 = pending) →
  `authorization_code`, `code_verifier`; then `POST https://auth.openai.com/oauth/token` with
  `redirect_uri=https://auth.openai.com/deviceauth/callback` and the Codex client id. Tokens go to the
  vault; calls go to `https://chatgpt.com/backend-api/codex/responses` with `chatgpt-account-id`. Each
  person must turn on «device code login» in their ChatGPT security settings. Checked against a fake
  auth server only: no real account was used.
- **Claude setup-token**: the desktop's path (`connectAnthropic({method: "token"})`).
- Both subscription paths are **off** until an owner or admin turns them on (Empresa › «IA y apps»,
  `PUT /api/cloud/ai/policy`) after reading the warning; turning one off stops saved credentials at
  once. Routes: `GET /api/cloud/ai`, `POST /api/cloud/ai/chatgpt/device`, `…/device/poll`.
- Screens: Ajustes › «Tu cuenta de IA» (`src/components/v2/settings/CloudAccount.jsx`) and Empresa ›
  «IA y apps» (`AdminEmpresa.jsx`).

#### What the providers' terms say (read 2026-11-14)

| Provider | A hosted multi-user service using a person's consumer subscription | Sources |
| --- | --- | --- |
| Anthropic | **Forbidden.** The Claude Code legal page says Anthropic does not permit developers to route requests through Free, Pro, Max or Ultra plan credentials on behalf of their users, nor to collect, store or intermediate those credentials, and may enforce without notice (narrow exception: hosting the unmodified Claude Code binary with each user signing in through Anthropic). `claude setup-token` is documented for CI and scripts. | https://code.claude.com/docs/en/legal-and-compliance · https://code.claude.com/docs/en/authentication · https://www.anthropic.com/legal/consumer-terms |
| OpenAI | **Not permitted in practice.** The Terms of Use forbid sharing credentials or making an account available to anyone else; the Codex auth docs say to treat its tokens like a password and to use API keys for programmatic use. OpenAI's route for other apps, «Sign in with ChatGPT», asks paid or remotely hosted apps to join a waitlist (commercial access is a limited trial). | https://openai.com/policies/row-terms-of-use/ · https://learn.chatgpt.com/docs/auth · https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt · https://developers.openai.com/siwc/quickstart.md |
| Both | **Allowed:** API keys under each provider's commercial terms, used by the key owner's own people. | https://www.anthropic.com/legal/commercial-terms · https://openai.com/policies/services-agreement/ |

So both subscription paths ship disabled behind the admin switch with that warning
(`SUBSCRIPTION_WARNING`). The clean way to offer ChatGPT plans is to apply for «Sign in with ChatGPT»
as a hosted app (its own OAuth client and public redirect), not the Codex client.

### The runtime made durable (`server/cloud/bots-host.mjs`, `cloud/src/workspace.js`)

- **Nothing waits on a timer of the object.** What must happen later is in the store: missions,
  steps and histories, approvals with `waitUntil`, routines with `nextRun` and `queue`, limits with
  `resumeAt`. `host.nextAlarm()` is the earliest of those, plus a 20 s heartbeat while bots work and a
  60 s poll for email/calendar/web triggers; the object sets its alarm after every write and every
  alarm. `host.tick()` runs `Scheduler#tick` (routines, snoozed rooms, `resumeLimited`, notice rounds),
  `Runtime#sweepQuestions`, the rooms' work tick and the trigger poll. Scheduler, watcher and trigger
  engine are never `start()`ed in the cloud. The in-memory timers left (a turn's idle watchdog, a
  question's wake-up, the 1.5 s approval notice) are shortcuts the alarm also covers.
- **Eviction.** A new `Runtime` marks running missions `paused` + `interrupted`; when the object boots,
  `host.resume()` → `resumeInterrupted()` relaunches each as its owner and tells the steps that were
  half-way to check before repeating anything (at most 3 times in 15 minutes). App actions caught
  half-way stay «sin confirmar» and are never repeated. A deploy does the same as the test route
  (`DurableObjectState#abort`).
- **CPU and concurrency.** A model call is I/O: the runtime awaits it and the object keeps serving.
  Measured below, messaging latency does not move with 6 bots working, so bot turns stay in the
  workspace object; a DO per mission or Queues are not needed yet.

### Routines, triggers and approvals

- Routines fire from the alarm with nobody connected, as their owner.
- **Webhooks**: no longer desktop-only. A routine's address is
  `https://<site>/hooks/<workspace>/h/<43 random characters>`; the Worker takes at most 64 KB, drops
  cookies, authorization and Cloudflare headers and always answers 202; the workspace runs the
  desktop's checks (`Webhooks#handle`: signature, filters, duplicates, brakes).
- **Approvals reach the right person.** Each approval gets `for`: the person who asked, or for a
  routine its owner and their delegate (`approver: {personId}`, a member of the same company, set on
  the same screen as the desktop: `PUT /api/automations/:id/approver {contactId: <person id>}`). They get
  it in their Bandeja (a `notifications` record with the same `for`) and by Web Push. Nobody else sees
  it in `/api/state`; deciding it (`/api/approvals/*`, `/api/connections/review/*`) answers 403 to
  anyone else. No mailbox is involved.
- **Pre-approvals** apply unchanged in a routine's runs.
- **Routine times are UTC** in the cloud: the calendar arithmetic uses the machine's local time,
  which is UTC in a Worker. A company time zone is left for phase 4.

### Connectors

- **Composio**: one key per company (`PUT /api/cloud/apps/key`, admins), in the vault.
- **MCP over HTTP/SSE**: the redirect is `https://<site>/api/mcp/oauth/callback` (`McpHub({redirect})`);
  the PKCE verifier is kept with its state in the vault, so a callback that lands on a fresh object
  still finishes. The Worker lets that one GET through without the origin check (it only completes a
  sign-in whose state the workspace holds).
- **web_fetch** (`server/cloud/web-cloud.mjs`): the desktop's reader over `fetch`; each hop's host is
  resolved by DNS over HTTPS and refused when any address is private, loopback, link-local, CGNAT,
  multicast or reserved (Workers cannot reach private networks anyway). Search is each provider's
  hosted search, as on the desktop.
- **Deliverables**: `create_document`, `create_spreadsheet` and decks write the .docx/.xlsx/.pptx and
  their companion files through the mounted file store (R2, `writeCompanionFile`). Office→PDF
  previews and computer use stay off; the screens hide them (and the terminal, browser and folders).

### Bots in channels (`server/cloud/channel-bots.mjs`)

- `<@bot:nora>` in a channel or thread starts (or continues) the conversation behind that thread; the
  answer is posted in the thread by `bot:nora` with the bot's name, and notifies who took part. Several
  bots named at once work as a team (Atlas plans). Later replies in the thread go on with the same bots.
- A private channel's, group's or DM's conversation has the channel's people as its audience.
- Every company has the seeded bots (Atlas, Nora, Tomás, Iris, Vera, Bruno) plus its own; memory,
  SOUL and learning are the workspace's records.
- **Roles**: owners, admins and members use bots; guests read what bots say and never start bot
  work. Owners and admins edit any bot; members create bots and edit their own (`createdBy`).
- Hosted copy no longer says «tu ordenador» (bots work «en la nube de tu empresa, con la cuenta de IA
  de quien les pide algo»); Ajustes hides this computer's places.

### The fake model (`server/cloud/fake-model.mjs`)

Deterministic answers (`[[plan:a,b]]`, `[[app:SLUG]]`, `[[slow:ms]]`) and a Composio-shaped test
app whose actions only record that they ran. Used only when the Worker has the secret
`FAKE_MODEL_TOKEN` **and** that workspace's flag was set with it (`POST /auth/dev/test/fake-model`);
without the secret the test routes answer 404.

| Name | What | Where |
| --- | --- | --- |
| `FAKE_MODEL_TOKEN` | tests only: the fake model, probe and eviction routes | Worker secret, `.local/cloud-phase3.env` |

No new Cloudflare resources or DO classes.

### Tests and measurements

- **Node**: `tests/cloud-bots.test.mjs` (12): the fake model and its flag; per-person accounts, vault
  namespaces and the terms switch; the device-code exchange; a mention answered in its thread; a plan
  with two bots while messaging stays fast; an eviction resumed on the next wake-up; a routine on the
  alarm with the approval for owner and delegate only and a pre-approval; bots by role; webhooks at
  the public address; MCP on a public redirect across a restart; web_fetch SSRF. Plus the 429 case in
  `tests/usage-limits.test.mjs`.
- **Deployed** (app.colmena.team, 2026-11-14): `node scripts/e2e-bots.mjs --url … --env …` 34/34;
  `node scripts/e2e-browser-bots.mjs --shots ../.local/shots/cloud-phase3` 9/9 (laptop and 375 px phone);
  regressions `e2e.mjs` 44/44, `e2e-chat.mjs` 48/48.

| Measure (deployed, client in Spain) | Result |
| --- | --- |
| A mention in a channel → the bot's answer in the thread (fake model) | 0.37–0.47 s |
| A plan with two bots (plan, two parts, synthesis) → all three bots in the thread | 0.95–1.2 s |
| Posting a message, idle | p50 350 ms, p95 425 ms |
| Posting a message with 6 bots of 3 people working | p50 345 ms, p95 361 ms |
| Object evicted mid-turn → the answer arrives (12 s turn, nobody asking) | 17.1 s |
| A routine at its minute with nobody connected | its approval was there at the minute |

### Left for phase 4

- Office→PDF previews and computer use (Containers); editing work files in place.
- Routine times in the company's time zone (today UTC in the cloud).
- Per-person Composio accounts; Composio and real OAuth apps verified with real accounts.
- «Sign in with ChatGPT» as an approved hosted app instead of the Codex device code.
- The Claude Code / Codex / OpenCode engines («Código») in Containers.
- Event triggers that listen live (a room message, files) instead of the 60 s poll.
- Real accounts: no real API key or subscription was used; adapters are tested against fakes.

(Phase 4 below did the containers, «Código», the browser, Office previews, time zones and apps
per person; what is still open is under «Left after phase 4».)

## Phase 4: the machine parts work in the cloud

```
browser ──► Worker colmena-nube (app.colmena.team)
             ├─ /api/code/*                 ──► Workspace DO ──► Machine DO "machine:<id>" ──► container :8080
             │                                   (person, API keys, GitHub token in headers)   server/machine/serve.mjs
             ├─ /vista/<workspace>/<token>/ ──► Workspace DO (checks the link) ──► Machine ──► 127.0.0.1:<port> in the container
             ├─ /api/computer/*             ──► Workspace DO: the bots' browser (Browser Rendering, CDP)
             └─ /prueba/*                   ──► fixture pages for the e2e (only with FAKE_MODEL_TOKEN)
Machine DO alarm ──► idle for MACHINE_SLEEP_AFTER_S → work folder packed to R2 → container destroyed
```

### The process seam (`server/machine/seam.mjs`)

One small interface for «run a program / have a filesystem»:

| | Desktop | Cloud |
| --- | --- | --- |
| `spawn(file, args, {cwd, env})` | `node:child_process` (`localMachine`, unchanged) | `/machine/run` in the company's container, output as NDJSON; a ChildProcess look-alike, so `runProgram` drives it unchanged |
| `run({…})` | `server/computer/system.mjs › runProgram` | same result shape (`exitCode, stdout, stderr, truncated, timedOut, seconds`) |
| `office()` | `createOfficeConverter` (this computer's Office or LibreOffice) | `remoteOfficeConverter`: LibreOffice in the container, newest PDFs kept in memory; pages counted and drawn there too |
| «Código» | `CodeService` in the desktop's server | the same `CodeService`, unchanged, inside the container (below) |

The machine server (`server/machine/serve.mjs`) is the desktop's own code on a Linux disk: it does not
re-implement «Código», it hosts it. Before anything opens it answers only `/machine/health`,
`/machine/restore` (the work folder back from R2) and `/machine/begin`; then the store (encrypted with
a key derived from `WORKSPACE_KEYS` for the machine), `CodeService` and its routes, `/machine/run`,
`/machine/office/pdf`, `/machine/pdf/pages|page`, `/machine/port/:n/*` and `/machine/backup`. Every
request needs the token the Machine DO generated at start (`X-Machine-Token`); the port is reachable only
through `getTcpPort` of that DO.

The desktop seams this needed are small: `CodeService#engineEnv` (null on the desktop), `ctx.machine` in
run_command (`server/computer/tools.mjs › commandPlace`), `office.pages/renderPage` in the work-file
routes, frames on the hosted feed (`app.mjs`). `npm test` passes unchanged.

### Containers (`cloud/src/machine.js`, `cloud/container/`)

- **One container per company**, the Durable Object Container API with the `durable_object` scheduling
  policy (`ctx.container.start({image, instance, enableInternet, env})`). DO-managed containers take no
  placement constraints; the Machine DO lives in the EU jurisdiction (`MACHINE_JURISDICTION = "eu"`) and
  the container beside it. Instance `standard-1` (½ vCPU, 4 GiB, 8 GB disk), `MACHINE_INSTANCE`.
- **Image**: `node:24-bookworm-slim` + git, gh, lsof, LibreOffice (writer, calc, impress, nogui) with
  metric-compatible fonts, Codex CLI 0.166.0, Claude Code 2.1.314, OpenCode 1.19.5, the repository's
  runtime dependencies (node-pty built for Linux) and `server/`. 933 MB compressed. Built by wrangler from
  the repository root (`build_context = ".."`, `Dockerfile.dockerignore`). Check it locally before a
  deploy with `cloud/scripts/machine-smoke.mjs` (12 checks).
- **Persistence**: snapshots (`snapshotContainer`) were considered and not used: a restored snapshot keeps
  the image it was taken from, so a new image would never reach a company. Instead, before stopping, the
  machine packs `/work` (projects, worktrees, the store, engine homes; not caches) into
  `workspaces/<id>/machine/work.tar.gz` in R2 with a multipart upload (atomic: a cut backup changes
  nothing), and a fresh container restores it before `/machine/begin`. If a container dies without its
  alarm, what changed since the last backup is lost (the tasks show as cut and can be resent).
- **Sleep**: activity is any request; open streams (live events, a terminal, a command) keep it awake;
  the alarm asks `/machine/health` and waits while an engine turn or a command runs. After
  `MACHINE_SLEEP_AFTER_S` (600) quiet seconds it backs up and `destroy()`s. `setInactivityTimeout` is set
  5 minutes past that, so the platform never stops it before the backup.
- **Quotas**: minutes per month per company (`MACHINE_MINUTES_PER_MONTH`, 600, or the company's own
  `settings.machineMinutes`), counted from start to stop (`server/cloud/machine-quota.mjs`); past it the
  machine does not start and the request answers 429 «Tu empresa ha usado sus N minutos de máquina de este
  mes…». Concurrency is one container per company by construction (all of a company's tasks share it).
  A deployment-wide cap on containers is not built (the platform's account limits apply).

### «Código» in the cloud

- The hosted app shows «Código» when the workspace has a machine (`state.cloud.hidden` no longer lists it).
  Projects come from «Clonar de GitHub», «Empezar de cero» (in the machine) or a git bundle
  (`POST /api/code/cloud/import?name=&origin=local`, used by the e2e: the bundle's repository plus a bare
  «origin» inside the machine, so pushes go nowhere real). A folder of someone's computer is refused.
- **Engines with API keys only.** The Workspace sends the asking person's keys on the calls that can
  start a turn (`X-Colmena-Engine-Keys`): Anthropic API key → Claude Code (`ANTHROPIC_API_KEY`, a
  `CLAUDE_CONFIG_DIR` per person), OpenAI API key → Codex (an `auth.json` of type apikey in a `CODEX_HOME`
  per person), any of them → OpenCode. A Claude setup-token or ChatGPT sign-in never goes there (the
  providers' terms, Phase 3). Without a key the turn ends with «En la nube, Código trabaja con tu propia
  clave de API…», also said on the Código home and in Ajustes.
- **GitHub**: a token per person or per company (`PUT /api/cloud/github {scope, token}`, sealed in the
  vault, namespace `github`); the person's wins. It travels with each «Código» call
  (`X-Colmena-GitHub-Token`) and git and `gh` read it from the environment through a credential helper in
  the image; nothing is written to disk. A GitHub App's installation token works the same way; the App
  itself (installation flow, short-lived tokens) is not built.
- **Terminals**: node-pty inside the container; the existing SSE stream and input routes, proxied.
- **Previews**: `POST /api/code/tasks/:id/preview-link {port}` makes a link
  `/vista/<workspace>/<token>/` (24 random bytes, one task and port, 12 hours). It needs no session, carries
  none (cookies are not forwarded) and is served with `Content-Security-Policy: sandbox …` (no
  `allow-same-origin`): the page runs in an opaque origin and cannot read or act on the app as whoever
  opens it. The machine proxies it to `127.0.0.1:<port>`, so dev servers bound to localhost work. Apps
  that use absolute paths (`/assets/…`) need a base path to load their assets under the link.
- **Tests**: the fake Claude Code (`cloud/container/fake-claude-code.mjs`, the test fixture plus
  «arregla»: edits the fixture's bug and runs its tests for real) runs only when the workspace's test flag
  is on.

### run_command in the cloud

The computer tools take `ctx.machine`: the program is a bare name (looked up on the container's PATH) or
an absolute `/usr`, `/bin`, `/opt` path; npm and scripts are refused as on the desktop; it runs in
`/work/missions/<mission>` with the minimal environment, 120 s and 200 KB. Policy, red lines,
approvals («Aprobado por adelantado» included) are the desktop's, unchanged; there is no host to reach.

### The bots' browser (`server/cloud/browser-cloud.mjs`, `cloud/src/browser.js`)

- Cloudflare Browser Rendering (`[browser] binding = "BROWSER"`, `@cloudflare/puppeteer` 2.0.0): one
  Chromium per workspace object (keep-alive 10 minutes), a page per mission and bot, driven over CDP
  exactly like the desktop's Electron browser: the same accessibility snapshot and blocker detection
  (`desktop/axsnapshot.cjs`, imported), references, `inspect`, `formSummary`, a click on «Enviar» turned
  into `browser_submit` (a red line), fill, keys, waits, sign-in and downloads (into the mission's files
  in R2, 10 MB). Pages idle for 10 minutes close.
- **Cookie jars**: a named session (the bot's or the mission's, «principal» otherwise) is loaded from the
  envelope vault (namespace `browser-jars`) into a fresh page and saved back, sealed, after each action. A
  turn for another person (`args.session`) starts empty and is never saved.
- **Saved passwords** (`browser_sign_in`, the cloud vault): the desktop's rules unchanged (granted bots
  only, never in a turn for another person or in incognito), and the cloud browser refuses a password in
  a turn's own session as a second wall.
- **Live view**: a JPEG after each action (at most one a second per mission) as `browser_frame` on the
  live socket. «Tomar el control» pauses the bot; the person clicks on the frame, types and presses keys
  (`POST /api/computer/input`), then gives it back with an optional note. Desktop control (Cua) stays
  desktop-only.
- Public pages only: `browser_open` checks the host by DNS over HTTPS (private, loopback, link-local,
  CGNAT addresses refused).

### Office → PDF previews

The work-file previews (`/api/missions/:id/workfiles/visual|page/:n`) convert Word, Excel and PowerPoint
with LibreOffice in the container and draw the pages there (pdf.js and the canvas are not in the Worker).

### Time zones (`server/timezone.mjs`)

- `zoned(tz)`: wall-clock times in an IANA zone. A time in the spring-forward gap (02:30 in Madrid on the
  last Sunday of March) moves forward by the gap; a repeated autumn time is the first one. Without a zone
  it is the local-time code the desktop always ran (tested to give the same instants).
- Routines (`triggers.mjs › nextRun`), holidays and weekdays, the «laborable» window of calendar triggers
  and the routine subtitles use `settings.timezone`. A 9:00 routine in Madrid is 08:00Z in winter and
  07:00Z in summer, also on the days the clocks change.
- The company's zone starts as its first owner's browser (`X-Colmena-Time-Zone`, adopted once, owners
  and admins only) and an admin changes it in Empresa › Hora y máquina (`PUT /api/cloud/timezone`), which
  moves every timed routine's next run. People keep their own zone in their profile (Phase 2) for display
  and «no molestar»; who set none uses the company's (it was UTC).

### Apps per person

`PUT /api/cloud/apps/mine {on}` gives a person a Composio profile of their own: the company's key, a
Composio user of theirs. Their bots' turns and routines (which run as their owner) then use the accounts
they connected; everyone else keeps the company's. A new company key carries over to them.
Not checked with a real Composio account.

### Screens

- «Código»: the API-key note and no «Abrir una carpeta» in the cloud; previews through their link in a
  sandboxed frame.
- The live browser (`BrowserLive.jsx`, `LiveStage.jsx`): the frame at the page's own aspect ratio, «Ampliar» (the
  whole screen on a phone; it opens by itself when you take the control of a frame too narrow to read). With the
  control the frame is the page: a click lands there and focuses it, typing goes straight to the page (Esc twice,
  Mayús+Tab or «Soltar el teclado» give the keyboard back), wheel or finger scroll; a toolbar for Tab, Esc,
  arrows, Subir/Bajar and «Acercar» (2×, where a phone and a tablet start); reload in the address bar (`open`
  of the same address; the protocol has no «back»). The note and «Devolver el control a Nora» are one step.
- Empresa › «Hora y máquina»: the zone with the time there, the machine (on or off, minutes this month,
  last cold start) and the company's GitHub token.
- Ajustes › «Tu cuenta de IA» › «Código y apps en la nube»: your GitHub token and «Mis propias apps».

### Secrets and resources (added)

| Name | What | Where |
| --- | --- | --- |
| DO class `Machine` (migration v3) + container application `colmena-nube-machine` | one container per company | `cloud/wrangler.toml` |
| `BROWSER` | Browser Rendering | `[browser]` binding |
| `MACHINE_SLEEP_AFTER_S`, `MACHINE_MINUTES_PER_MONTH`, `MACHINE_INSTANCE`, `MACHINE_JURISDICTION` | sleep, quota, size, EU | `[vars]` |
| R2 `workspaces/<id>/machine/work.tar.gz` | the work folder while the machine sleeps | the existing bucket |

No new secrets: the machine's store key derives from `WORKSPACE_KEYS`.

### Tests and measurements

- **Node** (`npm test`: 1,663 tests, all passing, with phase 5 merged) adds `tests/cloud-timezone.test.mjs` (9: zones,
  offsets, gaps and repeats, 9:00 Madrid across both changes, weekdays and holidays by the zone's day,
  weekly and one-off, local time unchanged), `tests/cloud-machine.test.mjs` (8: the seam against a real
  machine server, restore before begin, run_command with approval through the machine, «Código» with a
  bundled repo, the fake engine, the diff and live events, the API-key rule, preview links, Office
  conversion, settings, GitHub tokens sealed, apps per person, quotas) and `tests/cloud-browser.test.mjs`
  (4: references, fill and submit rules, frames, sealed jars, passwords rules, take control).
- **Image**: `cloud/scripts/machine-smoke.mjs` 12/12 against the image on this computer (Docker).
- **Deployed** (app.colmena.team, 2026-11-14, with phase 5 merged): `node scripts/e2e-machine.mjs --url …
  --env … --out ../.local/shots/cloud-phase4` 38/38 (a fresh company each run, the fake model and the
  fake Claude Code, a real container and real Browser Rendering); screens with
  `node scripts/e2e-browser-machine.mjs` (laptop and 375 px phone: «Código» home and task, the live
  browser taken over, an Office file drawn as pages, Empresa › Hora y máquina; 17/17 screen checks) in
  `.local/shots/cloud-phase4/`.
  Earlier runs found and fixed: approvals have no `tool` in `/api/state` (the test), the machine backup
  depended on an in-memory flag (lost when the object restarted: the work was not kept), Puppeteer 2's
  `connected` property (a second page failed), tools behind `use_tool` in the fake model.

| Measure (deployed, client in Spain) | Result |
| --- | --- |
| First start of a company's machine (image pulled to a new place; nothing to restore) | 38.5 s to ready, 39.0 s to the first answer |
| Waking a sleeping machine with its work folder (318 KB) back from R2 | 2.7 s to ready (1.8 s container, 0.1 s restore), 3.1 s to the first answer |
| A «Código» request to a running machine | 335 ms (Worker → Workspace → Machine → container) |
| «arregla la suma y prueba» (fake engine: edit, `node --test` in the container) → done | 0.8 s |
| A dev server preview through its link | 313 ms |
| run_command: approve → the bot's answer with the output | 0.8 s |
| Browser Rendering: first page (launch 0.9–2.2 s) / read a page via the bot / open+fill a form via the bot | 3.5–4.4 s / 4.4 s / 1.9 s |
| Office → PDF with LibreOffice (first, a small .docx) / page 1 as PNG | 4.3 s / 0.76 s |
| Sleep: pack the work folder into R2 and stop | 1.4 s (backup 0.8 s) |
| A routine at its minute in Europe/Madrid | fired 0–64 ms after the minute; 9:00 Madrid planned at 08:00Z (November) |

**Costs** (Workers Paid list prices, 2026-11: memory $0.0000025/GiB-s, CPU $0.000020/vCPU-s, disk
$0.00000007/GB-s, 25 GiB-h memory, 375 vCPU-min and 200 GB-h disk included per month; Browser
Rendering 10 h included then $0.09/h):

- `standard-1` (½ vCPU, 4 GiB, 8 GB) running for an hour: memory $0.036, disk $0.002, CPU up to $0.036
  when busy the whole hour → **$0.04–0.07 per machine-hour**.
- A typical «Código» task: the machine wakes (3 s), works ~10 minutes and sleeps 10 minutes after the last
  request → ~20 machine-minutes ≈ **$0.015–0.025**. The 600-minute default quota is at most ~$0.75 a month
  per company.
- The e2e itself used 3.6 machine-minutes. Browser pages close after 10 idle minutes; the browser closes
  with its last page (each new launch ~1–2 s).
- R2: a work folder of ~0.3 MB here; real repositories with `node_modules` are tens to hundreds of MB
  (storage $0.015/GB-month; class A operations per backup part).

### Left after phase 4

- Live triggers: Composio trigger webhooks (and Gmail push) delivered to `/hooks/<workspace>/…` instead
  of the 60 s poll; room and file events are already instant. Not built: it needs a Composio account to
  check the payloads and signatures.
- A GitHub App (installation flow, short-lived installation tokens) instead of pasted tokens; PRs were
  not opened against GitHub in tests (no real credentials).
- Per-task containers (parallel heavy tasks of one company), a deployment-wide cap on running containers
  and billing for minutes beyond the quota.
- Backups more often than at sleep (a crash loses what changed since the last one); trimming the image
  (build tools are kept).
- Previews of apps that need absolute paths; WebSocket hot reload through `/vista/`.
- The text of a Word file is not read in the Worker («No pude leer su contenido» above its pages): the
  pages show (converted in the machine) but text extraction for .docx should move to the machine too.
- (Done) The live view names the bot from the frame when no activity names it.
- Real accounts: no real API key, GitHub token or Composio account was used.

## Phase 5: the desktop app is a client of the cloud plus a local agent

```
Colmena.exe (cloud mode)
 ├─ window (partition persist:colmena-cloud) ──https──► app.colmena.team (the company's workspace)
 ├─ «Este ordenador» (desktop/cloud/agent.html, local page) ─IPC─┐
 └─ agent process (server/agent-link/main.mjs) ◄──────────────────┘
      └─ wss ► Worker /agent/connect?workspace&device ► Workspace DO (hibernating socket, tag agent:<device>)
           DO → agent  {type:"call", id, cap, op, args, bot, mission, person, exp}
           agent → DO  {type:"result", id, ok, result|error}
```

### Desktop modes (`desktop/mode.cjs`, `desktop/cloud.cjs`)

- **Which mode.** `COLMENA_MODE` (tests) → the saved choice (`userData/colmena-mode.json`) → a new
  installed copy with no local data shows the first-run choice (`desktop/cloud/mode.html`:
  «Usar Colmena en la nube» / «Solo en este ordenador»). Anything else opens the local mode exactly
  as before (the repository and every existing install keep it). Switching from Ajustes asks with a
  native dialog and restarts.
- **Cloud mode.** The window loads the workspace in its own partition with Colmena's own frameless
  chrome (`desktop/preload-cloud.cjs`): title bar, theme, sounds, updates, captures, «Pregunta
  rápida» (the quick window shares the partition) and, from the page (`src/lib/desktopCloud.jsx`),
  the tray's face and taskbar counter (what waits for you, bots at work) and system notifications
  for your new notices. The local server does not run; the local mode's data folder is never
  opened except, read-only, for «Llevar mis datos a la nube». Data never mixes: the cloud session
  lives only in its partition, the agent's files in `<data>/nube/`.
- **Updates.** `desktop/updater.cjs` runs before the mode branch, so it works the same in both;
  «Reiniciar para actualizar» waits while the cloud app reports bots at work.

### Signing in from the desktop (`/auth/desktop/*`, `src/cloud/Desktop.jsx`)

1. The window shows `/entrar/escritorio`: `POST /auth/desktop/start {name}` → `{id, poll, code}`
   (`poll`: 32 random bytes only the app's window holds; the directory keeps its hash; 10 minutes).
2. The app opens the system browser at `/entrar/escritorio/aprobar?c=<id>`. The person signs in
   there as usual (magic link, Google…), sees «¿Abrir Colmena en "<name>"?» with the same code,
   and confirms: `POST /auth/desktop/approve` (session + CSRF) → a **hand-back code**, stored hashed.
3. The browser goes to `colmena://entrar?c=<id>&k=<hand-back>`; the running app gets it
   (second-instance / open-url) and its window polls `POST /auth/desktop/poll {id, poll, handback}`.
   If the link does not open, the browser shows the code and the person types it in the app.
4. With both the poll token and the hand-back, the Worker makes **a new session** and sets it as the
   window's own HttpOnly cookie. No cookie or token is copied between the browser and the app.

Why the hand-back: without it, someone could send you their app's code, you would approve it, and
their computer would get your session (device-code phishing). The hand-back travels to the
computer where you approved, so it only works there. Five wrong codes close the request; it works once.

### Devices and the agent socket (`server/agent-link/hub.mjs`, `protocol.mjs`)

- **Device key.** Ed25519, made by the desktop once; the private half sealed with Electron
  `safeStorage` (DPAPI / Keychain) in `<data>/nube/device.json` and handed to the agent process in
  memory only. The cloud keeps the public half (`agentDevices` records, per person).
- **Registration and approval.** In «Tus dispositivos» inside the app, «Añadir este ordenador»
  registers it (`POST /api/agent/devices {name, publicKey, platform}`, pending; the same key again is
  the same device, a key someone else registered is refused, guests cannot). The person approves it
  (`POST /api/agent/devices/:id/approve`), comparing the fingerprint both screens show. Pending
  requests expire after a day. «Quitar» revokes it: its socket closes, calls in flight fail and the
  key never connects again (the agent is told `revoked` and stops trying).
- **Handshake.** `GET /agent/connect?workspace&device` (WebSocket; the Worker checks the company
  exists, passes no cookie, refuses a foreign Origin). The DO accepts only a known, non-revoked
  device of that company, sends `{challenge, nonce}` (24 random bytes, for this socket only); the
  agent answers `{hello, at, lends, sig}` with `sig = Ed25519("colmena-agent-v1\nhello\n<ws>\n<device>\n<nonce>\n<at>\n<sha256(lends)>")`.
  The nonce is used up by the first hello (a replayed hello closes the socket), `at` must be within
  2 minutes, the device must be approved and its person a member who is not a guest. Then
  `{welcome, person, workspace, bots}`. One socket per device (a new one replaces the old).
- **Online.** From the sockets themselves: authenticated within 90 s, or a keep-alive
  (`{"type":"ping"}` every 25 s, answered by the platform without waking the object;
  `getWebSocketAutoResponseTimestamp`).
- **Calls.** Unique ids and an expiry (at most 15 minutes); the agent refuses an id it has seen or a
  call past its expiry. Results stop at 900 KB (the platform's frames stop at 1 MiB): a big image
  is dropped with a note, anything else is refused with «pide una parte más pequeña».

### Routing rules (`server/agent-link/cloud-tools.mjs`)

- A bot reaches a computer only in a turn **of the person whose computer it is**: the turn runs as
  them (`Runtime#launch` as `mission.askedBy`), `mission.askedBy` is them, they are a member and not
  a guest, and it is not a turn for someone else (`peerErrand`). Another member's request, a
  guest, background work for nobody: nothing of anyone's computer is offered or routed.
- Only what that person's computer lends **to that bot** (`lends` per capability and per folder).
- **Red lines and approvals stay in the cloud**: browser, apps and commands are planned on the
  computer (`planComputerCall` there: it knows the folders, the programs and the page) and the cloud
  makes the approval card, applies rules and «Permitir siempre», and decides as on the desktop
  (`approvals` with `agent: true`, for the person who asked); only then does it send `execute`
  with `approved`. Claude Code of that computer always asks first.
- **The agent's own allowlist** (`refusalFor` in `agent.mjs`) is the last word: the capability on,
  that bot listed, that folder lent to that bot, that login lent to that bot, the tool matching
  the capability. Whatever the cloud asks (or believes it may ask), anything else is refused there.
- **Offline**: the tool answers «El ordenador de la persona («<name>») está apagado o sin conexión:
  ahora no puedo usarlo…»; a call in flight when the socket drops fails at once; a silent computer
  times out (30 s for folders, 2–5 minutes for the browser and commands, 10 for Claude Code).

What a computer lends (`desktop/cloud/agent.html`, «Este ordenador»), each per bot:

| Capability | On the computer | In the cloud |
| --- | --- | --- |
| Carpetas | `listFolder` / `readFolderFile` (server/tools.mjs) inside the lent folder | `list_folder` / `read_folder_file` with ids `pc.<device>.<folder>` (`Runtime#agentFolders`, a seam in `runtime/effects.mjs`) |
| Navegador con tus sesiones | the Electron bot browser (`desktop/browser.cjs`) with this computer's partitions, through the computer bridge's IPC | `browser_*` tools |
| Apps y programas | `open_file`, `open_app` (the apps the person ticks), `run_command` (approval as on the desktop) | the same tools |
| Gestor de contraseñas | 1Password / Bitwarden (`server/managers`, an agent-local store of chosen logins and grants); the password goes straight to the browser here | `browser_sign_in` with the lent logins (id, title, domain, masked user only) |
| Claude Code de este ordenador | `claude -p … --permission-mode acceptEdits --disallowedTools Bash` in a lent project folder, with the person's own login | `code_local {folderId, task}`, always approved first |

Lends travel as labels, ids and bot ids only (`cleanLends`): never a path, a password or a key.
A new binding (another company, another device id) starts lending nothing, so a page cannot move
the device to another company and inherit what it lent. The cloud page cannot reach the allowlist:
«Este ordenador» is a local window with its own preload, and the cloud window's preload exposes no
call that changes it.

### «Llevar mis datos a la nube» (`server/agent-link/migrate.mjs`)

From «Este ordenador», over the approved device's socket (`{type:"import", batch}` → `import-result`):
bots (with their SOUL), skills, memories, goals, routines, conversations, rooms, messages and notes
pages, in batches of at most 350 KB.

- **Secrets stay home**: only those kinds travel; fields that look like keys or only make sense on
  the computer (`apiKey`, `password`, `vault`, `grants`, `folders`, `path`, `browserSession`…) are
  dropped; memories that contain a secret, incognito conversations and errands stay. The person
  enters their API keys again in the cloud (provider logins are not portable).
- **Idempotent**: records keep their ids; a ledger row per (install, kind, id) keeps the hash of
  what was imported. Again: unchanged. Changed: only what this import made is updated. A record the
  workspace already had (a seeded bot, someone else's import) is never overwritten; a seeded bot keeps
  the cloud's version and the memories that name it attach to it.
- **Private by default**: imported conversations get `audience: [person]`, and messages and rooms only
  join a conversation that same person brought; routines arrive paused and owned by the person; bots
  are `createdBy` them; skills (they shape every bot of the company) arrive switched off. Memories are the workspace's (as every memory in
  the cloud): the screen says so before uploading.
- Tested only with seeded data under `.local/` (`COLMENA_DATA_DIR`); never with a real install.

### Screens

- Web: `/entrar/escritorio` (in the app) and `/entrar/escritorio/aprobar` (in the browser);
  Ajustes › «Tus dispositivos» (`src/components/v2/settings/Devices.jsx`): this computer (add, its
  status, «Elegir qué presta», «Usar solo en este ordenador…») and your computers (on or off, what
  each lends, fingerprint, approve, rename, remove). In the local desktop mode the same section is
  «Colmena en la nube» with «Usar Colmena en la nube…».
- Desktop: the first-run choice and «Este ordenador» (`desktop/cloud/*.html`), light and dark.

### Tests and measurements

- **Node** (`tests/agent-link.test.mjs`, 11): protocol pieces (canonical JSON, fingerprints,
  signatures, replay guard); lends without paths and the local allowlist; devices (pending, approve
  once, idempotent, never someone else's, expiry, revoke); the handshake (pending, approved, a
  replayed hello, a late one, a forged key, revoked); calls (lent folder read, a folder the cloud
  forged refused by the agent, other people, replayed and expired calls, offline in plain words, a
  call in flight failing on disconnect, a silent one timing out); routing rules; a real hosted
  workspace where a fake-model bot reads a lent folder through the agent, a folder lent to another
  bot is refused, another member's request is not routed and offline is said; migration
  (secrets, idempotence, privacy, paused routines, someone else's import); the directory's desktop
  sign-in (poll token, hand-back, five wrong codes, once, expiry); computer tools offered only to the
  lending person's bots, planned on the computer, approved in the cloud, then run there.
- **Deployed** (app.colmena.team, 2026-11-14):
  - `node scripts/e2e-agent.mjs --url … --env …`: 36/36 (the desktop sign-in hand-off, devices,
    signed hello and a forged key, a bot reading a lent folder, refusals by the cloud and by the
    agent, another member, migration twice, offline, revocation).
  - `node scripts/e2e-desktop.mjs --url … --env … --shots ../.local/shots/cloud-phase5`: 18/18 with a
    real Electron in cloud mode (isolated `COLMENA_USER_DATA` and `COLMENA_DATA_DIR` under `.local/`,
    a test person on example.com, the fake model, Chromium as the system browser, the `colmena://`
    hand-back through a second instance): first-run choice, sign-in, device approved, «Este ordenador»,
    a cloud bot reads a file in the enabled test folder through the agent, a folder not enabled is
    refused, migration of seeded test data twice, the app closed and the bot saying the computer is off.
  - Regressions, same deploy: `e2e.mjs` 44/44, `e2e-chat.mjs` 48/48, `e2e-bots.mjs` 34/34.

| Measure (deployed, client in Spain) | Result |
| --- | --- |
| Device approved → agent online (signed hello) | 3.6 s, including the agent's reconnect |
| A mention → a bot's answer with a file read on the person's computer | 1.1 s |

### Left for later

- **Dictation** lent from the computer to the cloud app's microphone button: the agent can run the
  system recognizer, but the hosted page's dictation still uses `/api/voice/*` on the workspace
  (desktop-only there). Needs a small bridge (the cloud window's preload → the agent) and the page
  choosing it.
- **Live view of the bot browser** (`BrowserLive` frames) is not forwarded to the cloud; approval
  cards for browser actions carry no screenshot (the picture stays on the computer).
- Codex / OpenCode engines of this computer (only Claude Code is lent), and Claude Code tasks
  that need to run commands (refused by design for now).
- The packaged installer should register the `colmena://` scheme (electron-builder `protocols`); at
  runtime only packaged copies register it (development runs never take it from an installed copy).
- One device belongs to one company at a time; moving it starts it lending nothing.
- Imported files (attachments, deliverables) are not uploaded, only the records.
