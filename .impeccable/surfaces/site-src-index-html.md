---
version: 1
slug: "site-src-index-html"
primary_target: "site/src/index.html"
related_targets: ["site/src/styles.css","site/build.mjs"]
---

## Scope

colmena.team product home page (`site/src/index.html`, built by `site/build.mjs`), Spanish. Mode: Persuade. Static, self-hosted fonts, light and dark by `prefers-color-scheme`. Lives beside the app (`app.colmena.team`). Replaces the 2026-11-13 «sidebar is the navigation» page, which the owner judged not eye-catching or explanatory enough.

## Audience and job

Small-business owners and team leads who run their team on Slack (or nothing) and would hand office work to bots if nothing left without their OK. In five seconds they must know: a team chat where people and their AI bots work together, which replaces Slack; and see it working. They must believe: bots finish real work (files, not answers); sending, buying, publishing and deleting wait for a person; data is encrypted per company in the EU; Slack history comes along. Action: «Crear mi empresa» (app sign-in), or «Entrar». Desktop download stays.

Proof on hand: the product itself (synthetic demo, labelled «Ejemplo»), the real pixel bots (`src/lib/pixelBot.js`, colours per person from `server/bot-looks.mjs`), the real Slack import and team messaging (docs/CLOUD.md Phase 2), the real desktop download. No customers, numbers, prices or testimonials exist; none are shown.

## Direction contract

THESIS: The page shows one encargo travelling through Colmena, live: a person asks in a channel, a bot works in visible steps, delivers a file, and the outbound mail stops at the line under honey until someone presses Enviar. Every later section is a smaller working demo of one capability. It refuses the SaaS hero of headline beside a static screenshot over a row of same-size icon cards.

OWN-WORLD: Colmena 4 tokens. Ink (#12131A) owns the hero, the red-lines band, the Slack band and the close, with a faint hexagon lattice from the mark; paper (#F5F5F2) and white panes between. Bricolage Grotesque display, Geist body, Poppins ExtraBold wordmark. Pixel bots in role shapes, coloured per person (Lucía purple, Marcos teal, Ana blue). Honey #FFC93C is the only warm colour and appears only where something waits for a person. Phosphor icons.

STORY: The visitor watches the hero encargo play (Pides, Trabaja, Entrega, Apruebas), reads the same four beats as setup steps, then scrolls a run of capability demos (documents, routines, red lines, team chat, apps, Código, devices, privacy, own AI), the Slack move, real objections, and acts.

FIRST VIEWPORT: Ink band. Top bar: wordmark left; Cómo funciona, Qué hace, Slack, Preguntas; «Entrar» and «Crear mi empresa» right. Left: H1 «Tu equipo y sus bots, en el mismo chat.» at up to 88px, one line saying it replaces Slack, both actions, a sign-in fine line. Right: a light app window (mini sidebar with «Te necesita», #compras) playing the encargo, with a four-beat progress legend and a pause control under it. Phone: text, actions, then the window full width.

FORM: Grounded structure 1 of 7, «the live encargo» (story told as one task's journey, capability chapters as working mini-demos). seed:e4611b7fa85d012e. The dealt lead (7, «the red line as the page's spine») lost on product clarity and was not built whole; raise kept from it: one ruled line that every outbound action visibly crosses and stops at, drawn in the hero demo and as the red-lines band's central rule. Raise from challenger kinetic-sculpture automata (declined): one shared timeline drives the hero, with a labelled keyframe legend beside its control. Declined: split-flap concourse, chromatophore skin, fluid ink basin, Saul Bass title cards, teen-magazine quiz.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Bots in web channels are phase 3 in docs/CLOUD.md at this revision; copy says bots work from the desktop app today and are on their way to web channels.
- Owner data for legal pages is pending (`[PENDIENTE: datos del titular]`).
- Prices are not published; the FAQ says so.
