---
version: 1
slug: "src-cloud-signin-jsx"
primary_target: "src/cloud/SignIn.jsx"
related_targets: ["src/cloud/Companies.jsx","src/cloud/Invitation.jsx","src/cloud/cloud.css","src/components/v3/Sidebar.jsx"]
---

# Hosted onboarding (cloud.html: /entrar, /entrar/verificar, /empresa, /empezar, /invitacion)

Scope: the hosted web onboarding of app.colmena.team, from the sign-in to the first request in
#general, plus the sidebar's honeycomb corner. Mode: persuade (first impression) carrying an
operate core (a fast, accessible magic-link form; steps that do real work).

Audience: a small-business owner creating a company for their people and bots; an invited
teammate joining one. Job: get in, name the company, connect an AI account (API key), meet and
shape the six seeded bots, invite people, ask a bot something in #general. Every step skippable.

Constraints: magic link in the fragment used on a button press, rate limits, CSRF, invitations
bound to their address, «Tu nombre»; input usable before any animation; reduced motion; 375 px;
light and dark; honey only for what waits for the person; API keys only on the web (provider
terms), subscriptions only in the desktop app on the person's own computer.

## Direction contract

THESIS: Your team is already here, in the hive. Every onboarding page is the same living
honeycomb (the home page's hive, redrawn in the app's tokens), and the steps are things the hive
does: bots fly waiting while you sign in, they gather while the mail travels, they take their
cells asleep as you name the company, they wake when the AI is connected. It refuses the
centred SaaS form on a blank page and the split hero with an illustration.

OWN-WORLD: the app's own tokens (paper or ink ground, Geist, Poppins wordmark), a full-bleed
hex lattice in hairline ink at 4 to 9 percent, cells lit in each bot's own colour, the real
pixel bots (pixelBot.js) as the only figures, a clearing in the comb under a solid card, the
roster: a row of hex cells holding the team. Honey lights only the cell that waits for you.

STORY: a visitor sees bots alive before typing a letter, understands Colmena is a team of
people and bots, signs in with one field, watches their team arrive, wakes it with an AI key,
keeps or renames each bot, invites people and sends a first request.

FIRST VIEWPORT: the comb fills the viewport; the wordmark top-left; a card left of centre on
laptops (centred on phones) with the heading, one sentence, the email field and the button,
usable at first paint; six pixel bots fly between cells around the clearing; on laptops the
roster of six cells sits under the card.

FORM: dealt structure 5 of 7 (the roster forming), fused with 1 (the hive as stage) and 4 (bots
react to what you type). seed:46a45babd0799efd. Declined challengers:
crouwel-grid-specimen (kept: the grid stays visible as the armature; everything snaps to cells),
signals-instruments-drum-machine-step-row (kept: one lit cell always says where now is, the step
row of the flow). The others declined on both axes.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
