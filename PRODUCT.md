# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Desktop only: the interface is web technology (React + Vite) inside an Electron window on Windows and
Mac, with a frameless window and Colmena's own window controls. There is no browser or phone version.

## Users

Two audiences, equally important (confirmed by the owner, 2026-11-12):

- A non-technical professional (self-employed, or running a small business) who hands office work to a
  team of bots (mail, documents, calendar, spreadsheets, research) and supervises them without
  knowing how to program.
- A technical person who uses the same app for «Código» (coding engines working in git worktrees),
  routines, tools and «Modo experto».

Day-to-day screens must be usable by the first without jargon; «Código» and «Modo experto» are core
parts of the product, not extras. One person per installation: Colmena is single-user.

## Product Purpose

Colmena is a desktop app where one person works with a team of AI bots on their own computer. The
bots chat, split up assignments, use the person's connected apps and a browser of their own, and stop
to ask only for what leaves the computer (send, buy, publish, pay). Success is being able to hand
over a piece of work and find it finished, with nothing left half-done and nothing sent that was not
asked for.

## Positioning

A team, not one bot (confirmed by the owner as the thing to protect). Several bots with roles share
the work and collaborate as a team the person directs: a coordinator (Atlas) plans and splits jobs,
specialists answer what is theirs, they can consult and hand off to each other, and the person sees
who is doing what. This is neither a single-assistant chat nor a multi-person workspace with agents
added: there is one human, and the team is made of bots.

## Operating Context

- Runs locally: a local service plus the desktop window. Bots, chats and accounts live in the
  person's data folder; uninstalling does not delete them.
- Works on the person's own AI account: ChatGPT, Claude (Claude Code, subscription token or API key)
  or OpenCode Go. Plan limits are real and shape behaviour (work pauses near the limit).
- Six fixed places in the sidebar: Inicio, Chats, Trabajo, Código, Equipo, Biblioteca.
- Inicio shows what is waiting for the person («Te necesitan»), what is running and today's activity.
- Work happens in 1:1 chats and in rooms with several bots; the person approves or answers through
  cards in the conversation and on Inicio.
- Routines and triggers start work without the person (schedule, mail, files, webhooks).
- Biblioteca holds deliverables, files, memory and notes.
- «Personas»: optional collaboration with other Colmena users through an end-to-end encrypted relay.

## Capabilities and Constraints

- Red lines always ask: sending, buying, publishing and paying need the person's OK. Browsing never
  asks. Each bot has an autonomy level.
- Bots: chat, team mode with a plan, debate mode, memory with provenance, skills that are proposed
  for approval, connected apps, MCP servers, files and documents (Word, Excel, decks), computer use
  and a browser the person can watch and take over, voice and dictation.
- «Código»: Claude Code, Codex and OpenCode engines in git worktrees, with restore points and pull
  request follow-up.
- Undo: per-turn restore points («Deshacer cambios») and short undo windows on automatic actions.
- The interface language is Spanish (plain, addressed as «tú»); code, comments and commits are in
  English.
- Terminology in use: bot, sala, encargo, rutina, «Te necesitan», línea roja, Modo experto.
- Not decided in this interview: whether the product's own design system and the desktop-only scope
  are binding commitments for future work. Today the design canvas in `design/*.dc.html` is the
  working source of truth and the app is desktop only; treat both as current facts, not as recorded
  commitments.

## Brand Commitments

- Honey `#FFC93C` means only «te necesita»: something is waiting for the person. It is never used as
  decoration or as a focus colour. (Made binding by the owner, 2026-11-12.)
- Name and mark: «Colmena», a hexagon mark with eyes and the wordmark in Poppins ExtraBold
  (`src/components/Logo.jsx`, `public/logo-mark-*.png`, `desktop/icons/`).
- Icons come from Lucide; icons that ship with the design canvas stay as drawn there.

## Evidence on Hand

- The running app and its design canvas (`design/*.dc.html`, generated into `src/design/`).
- Product docs: `README.md`, `docs/ARCHITECTURE.md`, `docs/SCREENS.md`, `docs/CONTRACT.md`,
  `docs/COMPUTER.md`, `docs/PROVIDERS.md`, `docs/PEOPLE.md`.
- Isolated demo data for screenshots and QA (`scripts/seed-qa.mjs`, the `fake` and `qa` launch
  configurations).
- There are no testimonials, customer names, usage figures, pricing or press. Do not invent any.

## Product Principles

1. The team finishes the job. What the person asks for gets done completely, or the bot says exactly
   what it could not do.
2. The person decides what leaves the computer. Red lines ask; everything else moves without
   friction.
3. It is a team: always show who is doing what, who was chosen and why, and let the person address
   one bot or all of them.
4. Only interrupt for what needs the person. Waiting items are few, clear and answerable in one step.
5. One product for both audiences: plain by default, depth one step away in «Modo experto» and
   «Código».

## Accessibility & Inclusion

Keyboard operation throughout (dialogs keep focus, visible focus on keyboard use only), small text at
4.5:1 contrast or better, and reduced motion respected. No formal standard has been set as a
requirement.
