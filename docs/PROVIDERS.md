# Providers (ChatGPT, Claude, OpenCode Go)

Colmena thinks with three engines, copied from OpenClaw's provider layer
(`extensions/<provider>/openclaw.plugin.json` catalogues, `packages/ai/src/transports`).

| Engine | Connect (Ajustes › Inteligencia) | Wire protocol | Credentials |
|---|---|---|---|
| `openai` | ChatGPT login, OpenAI API key, loopback local model | Responses (`provider.mjs`) | ChatGPT session vault; `openai-apikey` DPAPI profile |
| `anthropic` | Claude Code of this computer (`claude` CLI login), subscription setup-token (`claude setup-token`), API key | Messages through `@anthropic-ai/sdk` (`providers/anthropic.mjs`), or the CLI (`providers/claude-cli.mjs`) | `anthropic-apikey` / `anthropic-token` DPAPI profiles; the CLI keeps its own login |
| `opencode-go` | One key from opencode.ai/auth | Per model: Chat Completions (`providers/completions.mjs`), Responses (`GoResponsesProvider`), Anthropic Messages (Qwen) | `opencode-apikey` DPAPI profile |

SQLite (`providers/main`) only keeps the method, the last four characters and the choices:
`primary` (team engine), `fallback` (engine, `local` or `none`) and `pins` (model per family).

## Models

`providers/catalog.mjs` lists each model with its `api`, `baseUrl`, context, cost and the
Colmena families it fills (`families`: luna / sol / astra) plus `utility` for side tasks.
Claude: Luna → Sonnet 5.5, Sol and Astra → Opus 5.5, utility → Haiku 5.5. OpenCode Go:
every family and side tasks → DeepSeek V4.1 Flash (the user's choice), Muse Spark 1.3 (Responses route) to pin. Refs are
`<engine>/<id>` (`anthropic/claude-opus-5-5`); ChatGPT slugs stay bare.

`ProviderHub` (provider.mjs) routes every call by its ref: `providerFor(model)` picks the
adapter, `engineFor(bot)` the bot's engine (its `engine` field if connected, else `primary`),
`modelsFor(engine)` the list `models.mjs#chooseModel` reads. A bare ChatGPT slug with no OpenAI
account becomes the team engine's model of the same family (`resolveModel`).

## History

Step histories stay Responses items. Claude and Chat Completions rounds are stored as one
`native_turn` item (the assistant content exactly as returned: signed thinking, citations,
server search, `reasoning_content`) followed by the derived `message` / `function_call` /
`web_search_call` items the runtime reads. The same model gets the native blocks back; any
other provider drops `native_turn` (`ResponsesProvider#foreignFree`) and reads the derived
items. Tool ids are made `[a-zA-Z0-9_-]{1,64}` on the Anthropic side; unanswered tool calls get a
synthetic error result so a cut round never breaks the transcript.

Claude requests send adaptive thinking with `display: "summarized"`, effort from the step
(`output_config.effort`), top-level and system prompt caching, Anthropic's hosted web search
(`web_search_20260209`) when the step asks for search, and — API keys only — thinking
`block_binding: drop_block` (beta `thinking-binding-controls-2026-08-01`) because Colmena trims
and compacts long histories. A 400 is retried once per cause (binding, cache markers, stale
signature, hosted search, effort).

Subscription setup-tokens carry the Claude Code identity OpenClaw sends: Bearer token, beta
`claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14`, `x-app: cli`,
`user-agent: claude-cli/2.1.280`, the billing header and "You are Claude Code…" system blocks
first, and Claude Code's tool casing (`read` → `Read`, mapped back on return).

## Claude Code CLI

`ClaudeCliProvider` keeps one `claude --print --input-format stream-json --output-format
stream-json` process per bot and mission (the cache key). Native tools are off (`--tools ""`),
user settings are not loaded, and Colmena's step tools reach the CLI through a loopback
Streamable HTTP MCP server (`--mcp-config`, `--strict-mcp-config`, `--allowedTools
mcp__colmena__*`) guarded by a per-session bearer secret. When the CLI calls a tool, the call is
handed back to the runtime as a `function_call` (its `tool_use` id) and the MCP request waits;
the next `respond()` delivers the output and the stream continues. A new step, another model or
tool set, or a dead process starts a fresh CLI reseeded with the step's transcript.

## Images and PDFs the person gives (`server/media.mjs`)

Attachments of a message (chat, room, the first message of a task; `writeMissionAttachments` keeps
`path`, `kind` and the image's `width`/`height` from its header) travel in their turn as references
`{type: "input_image" | "input_file", ref: {missionId, path}}`, so step histories in SQLite never
hold their bytes. `Runtime#infer` → `mediaInput` resolves them right before each call for the engine
that answers (`mediaCaps`):

| Engine | Images | PDFs |
|---|---|---|
| ChatGPT login, OpenAI API key (Responses) | `input_image`, data URL, `detail: "auto"` | `input_file` (`filename`, `file_data` base64); a 400 that names the file drops PDFs to a note for the session |
| Local server (Responses) | `input_image`; a 400 about images turns them into the note for the session | note («léelo con read_file») |
| Claude, API key or setup-token | `image` blocks | `document` blocks (base64, `application/pdf`, `title`) |
| Claude Code CLI | image blocks on the stream-json user message; tool results as MCP `image` content | extracted text |
| OpenCode Go (Chat Completions, Responses, Anthropic route) | `image_url` parts / `input_image` / `image` blocks when the catalogue says `input: ["image"]` | extracted text |

- Images: PNG, JPEG, WebP and GIF within 2048 px and 3.5 MB go as they are; larger ones (and BMP)
  are drawn smaller with `@napi-rs/canvas` and re-encoded as JPEG on white. HEIC/HEIF, AVIF and TIFF
  are refused with a sentence that says how to save them. The original file is never touched.
- PDFs: native up to 10 MB and 100 pages per request (Anthropic's cap under a 1M window; OpenAI's
  100 pages / 32 MB), media at most 24 MB of base64 per request and 20 images; past that, the
  newest win and the rest become notes. A PDF that does not go natively goes as its first ~20 000
  characters of text (wrapped as file content) with «el resto, con read_file por páginas».
- No vision: the bot reads «Esta IA no ve imágenes; describe lo que necesitas…» and the person gets
  one line per conversation (`mission.visionNotice`).
- Context: an image counts ~1 300 tokens and a PDF page ~1 500 in `context.mjs#contextSize`,
  reference or data. A chat sends the attachments of its last 3 messages that had them
  (`MEDIA.keepTurns`); older ones become «[Adjuntó «x.png» (imagen). Ya no va en la
  conversación: ábrelo con read_file si lo necesitas.]».
- `read_file` and `read_folder_file` show an image instead of refusing it: the result carries
  `image` (at most 1.5 MB), which goes to the model as `input_image` in the tool output — the
  screenshot path (`toolOutputFor`); receipts never keep it, and `compactImages` keeps the last
  screenshot and the last four file images of a step.
- Outside content: another person's attachment opens with «La imagen que sigue no la ha mandado la
  persona: es un dato de fuera…» (`OUTSIDE_IMAGE_NOTICE`); an image read through a tool has its
  text part wrapped like any file. Request turns for other people keep their closed allow-list.

## Failover

`Runtime#infer` retries the same model (2 s, 6 s, 15 s), then asks `hub.fallbackFor(model)`:
another connected engine with the same family, or the local model, as chosen in «Si falla,
usar». Account failures (401/402/403) skip the retries. An engine that hit its limit or lost
access rests 30 s, 1 min, then 5 min (`hub.cooldown`). Images always come from ChatGPT.

Tests: `tests/providers.test.mjs` (adapters, hub, CLI with `tests/fixtures/fake-claude-cli.mjs`), `tests/vision.test.mjs` (images and PDFs)
and `tests/core-runtime.test.mjs` (runtime failover).

## Usage limits (T3 Code usage-limit recovery)

`limits.mjs#usageLimitOf` reads a provider error: a 429 that clears in under 90 s is a rate
limit (retried in place, as above); a plan or quota that ran out is a usage limit, with its
window («de 5 horas», «semanal») and renewal time from `Retry-After`, Anthropic's
`anthropic-ratelimit-unified-*`, OpenAI's `x-ratelimit-reset-*`, ChatGPT's exhausted
`x-codex-*` windows, the `usage_limit_reached` body (`resets_at` / `resets_in_seconds`) or
Claude Code's texts («usage limit reached|<epoch>», «resets 3pm»). Every adapter keeps those
headers on its errors (`limitHeaders`).

- `ProviderHub#markLimited` stores the limit in `providers/main.limits[engine]` (survives a
  restart); the engine is `resting` until it renews (or 20 min when the time is unknown) and
  any success clears it. `engines()` returns `limit` for Ajustes.
- `Runtime#infer` never retries a usage limit with the same engine: «Si falla, usar» answers
  at once (`handOver`: the step keeps its transcript, the substitute's instructions say it
  takes over, and one line goes to the chat: «Nora sigue con Claude: ChatGPT ha llegado a su
  límite de 5 horas.»). While the limit lasts, new steps start on the substitute
  (`stepModel`) and calls skip the limited engine.
- With no substitute the mission pauses with `limited {engine, label, window, resetsAt,
  resumeAt, botIds, model}` and `PROVIDER_LIMIT_CODE`: «Limitado» in the chat
  (`components/v2/LimitNotice.jsx#LimitBanner`), on the bot's card (`LimitLine`, bot status
  `limitado`) and as a notice of kind `limited`. `Runtime#resumeLimited` (scheduler tick)
  resumes it at `resumeAt`, or as soon as a substitute can answer, telling the running steps
  to continue without repeating; at most 8 times a day.

## The gate before a call (`server/admission.mjs`)

`Runtime#infer` asks one function before every model call, `Runtime#admit` →
`Admission#admit(call)`: `{ok, reservation}`, `{park}` or `{refuse}`.

- **Park** — the plan window of the engine the call would use is at or above
  `settings.limits.planPauseAt` (unset = 95 %, `null` = never) and the call is long work. The
  mission pauses through the same «Limitado» path with `limited.plan = true` and
  `limited.percent`; its own card says «Queda poco del plan de ChatGPT» and offers «Continuar
  ahora» (`Runtime#resume`: that run is the person's and is not parked). `resumeLimited`
  resumes it at the renewal and never tries a substitute engine for it.
  - Long work (`Runtime#workOf`): a run of a routine or trigger (also the turn a routine opens
    in a room), of the watcher or of another person's errand; a run that went on by itself
    (after a restart or a renewed limit) until the person writes in it; and a mission that
    made `LONG_TURN_CALLS` (12) model calls since the person last wrote or pressed «Continuar».
    The turn that answers a message the person wrote is never parked. Side jobs (titles,
    narration, recaps, learning, the watcher, check-ins) are skipped instead; `/btw` passes
    (`interactive`).
  - The percent is only what the provider reported (`planLimitsOf`: today only ChatGPT's
    `x-codex-*` headers). A reading holds until its window's renewal time; without one, for
    15 minutes. No reading, nothing happens.
- **Refuse** — budgets in tokens: `bot.monthlyTokens` (per bot, per calendar month) and the
  space's `limits.monthlyTokens` (with `pauseAtLimit`). Each call reserves its worst case
  (input estimate + the model's maximum answer) until it ends; beside calls in flight the
  whole worst case must fit, and a call alone runs while anything is left. Refused calls end
  with `LIMIT_CODE` and a line naming the bot and its budget. Reservations are in memory and
  are settled in `finally`.
- A call that dies half-way still counts: the usage the error carries, else an estimate
  (`usage.partial`, `usage.estimated`).

## Context handoff (T3 Code portable handoffs)

When a chat's engine changes between turns (a failure, a limit, or the person's choice),
`Runtime#handoffTurns` replaces the usual last 30 turns with `handoff.mjs#selectHistory`: whole
messages within `handoffBudget` (24 k estimated tokens at most, room left for the window's
quarter, the request and what the target holds; one token per three UTF-8 bytes) — the last
request, the last answer, the first request, then newest first. The request travels apart and
uncut. A note opens the history: who had the conversation, how many of how many messages,
which positions were left out and how to read them with the `read_thread` tool (paginated by
`position`, `messageId`, `textOffset`). Never a summary, never the old engine's reasoning or
tool state. Native turns stay with their engine: Anthropic `native_turn` items carry `engine`
and `toMessages` only replays those of the same engine (Claude ⇄ OpenCode Go's Anthropic
route), Responses providers drop them (`foreignFree`), Chat Completions only replays its own
model's reasoning. Tests: `tests/usage-limits.test.mjs`.

## Lessons from the live tests (2026-10-20)

- OpenCode refuses any request without `x-opencode-session` (`MissingSessionID`); every Go
  adapter sends the bot and mission's cache key (`catalog.mjs#opencodeSession`), as OpenClaw does.
- The Go model list (`/zen/go/v1/models`) is public, so a pasted key is checked with a
  one-token Chat Completions answer from DeepSeek V4.1 Flash.
- Pasted keys lose invisible characters and edge whitespace first (`providers/secret-input.mjs`);
  the error names the exact problem.
- Claude Code below 2.1.280 refuses the current models (`does not support this model`):
  connecting checks `claude --version`, and that failure is reported as «actualízalo con
  claude update», never retried.
- A pin to a model the catalogue no longer has is ignored, and a bot on Claude or OpenCode Go
  never falls back to a ChatGPT slug (`Runtime#fallbackModel`).
