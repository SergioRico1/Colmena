# Third-party notices

Colmena includes code and material from other projects. Their licenses apply to those parts.

## Code adapted into Colmena

| Project | License | What | Full text |
| --- | --- | --- | --- |
| [OpenClaw](https://github.com/openclaw/openclaw) | MIT | `prompts/SOUL.md` (verbatim) and `prompts/SOUL.colmena.md`; native web search and image generation in `server/provider.mjs`; Readability extraction in `server/web.mjs`; image checks in `server/images.mjs`; initial skills in `prompts/skills/` | [licenses/OpenClaw.txt](licenses/OpenClaw.txt) |
| OpenClaw `skills/skill-creator` | Apache-2.0 | `prompts/skills/crear-habilidades.md` (translated and adapted) | [licenses/OpenClaw-skill-creator-Apache-2.0.txt](licenses/OpenClaw-skill-creator-Apache-2.0.txt) |
| [OpenMuse](https://github.com/CopilotKit/openmuse) | MIT | page diff in `server/triggers.mjs`; approvals tied to a content revision; background notices; the message queue; PDF forms in `server/pdfforms.mjs` | [licenses/OpenMuse.txt](licenses/OpenMuse.txt) |
| NEXO | MIT | ChatGPT sign-in, Composio import and model routing (`server/nexo/`, `server/models.mjs`) | [licenses/NEXO.txt](licenses/NEXO.txt) |
| [simple-icons](https://github.com/simple-icons/simple-icons) | CC0-1.0 | app and provider logos (`src/components/settings/AppLogo.jsx`, `src/components/v2/ProviderMark.jsx`) | public domain |

Several features follow ideas from [T3 Code](https://github.com/pingdotgg/t3code) (MIT) and
OpenClaw, noted in the source comments. They were written again for Colmena, not copied.

Brand logos shown through simple-icons belong to their owners and are used only to name the
service they stand for.

## Fonts

Geist, Geist Mono, Bricolage Grotesque and Poppins (via Fontsource) are licensed under the
SIL Open Font License 1.1. They are bundled in the app.

## Dependencies

The installers bundle the production dependencies listed in `package.json` and the Electron
runtime (MIT, with Chromium and Node.js under their own licenses, listed in the app's
`LICENSES.chromium.html`). As of this release they are under permissive licenses: MIT, ISC,
BSD-2-Clause, BSD-3-Clause, Apache-2.0 (pdfjs-dist, @mozilla/readability and others),
BlueOak-1.0.0, 0BSD, Unlicense and CC0-1.0; `jszip` is used under MIT (dual MIT/GPL-3.0) and
`dompurify` under Apache-2.0 (dual MPL-2.0/Apache-2.0). Each package keeps its license file in
`node_modules`.

The design references in `references/designs/` include React (MIT) as their viewer.
