---
version: 1
slug: "site-index-html"
primary_target: "site/index.html"
related_targets: []
---

## Scope

colmena.team product home page (`site/`), Spanish. Mode: Persuade. Static, self-hosted fonts, light and dark by `prefers-color-scheme`. Lives beside the app (`app.colmena.team`).

## Audience and job

Small-business owners and team leads who run their team on Slack (or nothing) and would hand office work to bots if nothing left without their OK. They must believe: people and bots share one chat; bots finish real work; nothing is sent, bought, published or deleted without a person's OK; data is encrypted in the EU. Action: «Crear mi empresa» (app sign-in), or «Entrar».

Proof on hand: the product itself (synthetic demo conversation, labelled «Ejemplo»), the real pixel bot drawings (`src/lib/pixelBot.js`), the real desktop download (GitHub Releases). No customers, numbers, prices or testimonials exist; none are shown.

## Direction contract

THESIS: The page is the product's own sidebar-and-channel world: every section is a channel the visitor opens, and the first one already shows people and bots working, with one honey item that needs the visitor. It refuses the SaaS hero of headline, screenshot and a row of feature cards.

OWN-WORLD: Colmena 4 tokens: ink sidebar (#12131A) against paper (#F5F5F2) and white panes; Bricolage Grotesque display, Geist body, Poppins ExtraBold wordmark beside the honey hexagon mark; pixel bots in their role shapes and own colours; Phosphor icons; blue #2F6BFF only for links and focus; honey #FFC93C only where something waits for the person.

STORY: Visitor sees a team channel where a person asks, bots answer with real deliverables, and a draft mail waits under honey for an OK; they press it and it goes. Then they open channels for what bots do, red lines, team chat features, where it runs, privacy, own AI account, and act.

FIRST VIEWPORT: Top bar: wordmark left, «Entrar» and «Crear mi empresa» right. Left (desktop): ink sidebar with the channel list (one honey item, «Te necesita 1»). Centre: headline «Tu equipo y tus bots, en el mismo chat.» with one line and both actions, then the live #general channel demo with the honey draft card and a working «Enviar» button. Phone: sidebar becomes a horizontal channel strip; the demo follows the headline.

FORM: «The sidebar is the navigation»: sections as channels with scroll-tracked active state. Grounded list position 7 of 7 (dealt lead). seed:3bbd13b4c2783350. Raises: from the red-line split (5): one full-width ruled section that divides «Sin preguntar» from «Espera tu OK». From the roster (3): bots presented as a member list with their deliverables, not cards. Declined challengers kept: loteria tabla (each character named and its role said in the same breath).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Bots in web channels are «phase 3» in docs/CLOUD.md at this revision; copy avoids claiming bots answer in the web app today.
- Owner data for legal pages is pending (`[PENDIENTE: datos del titular]`).
