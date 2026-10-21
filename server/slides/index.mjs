// A presentation from the bot's script: validated, laid out once, drawn as HTML and as .pptx.
import { readMissionBytes } from "../files.mjs";
import { parseDeck } from "./spec.mjs";
import { layoutWarnings, slideElements, themeOf } from "./layout.mjs";
import { deckHtml } from "./html.mjs";
import { deckPptx } from "./pptx.mjs";

const MAX_IMAGE = 8 * 1024 * 1024;

function imageMime(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  return null;
}

/** data: URIs of the slides' images (PNG or JPG of the mission folder), and what failed. */
async function loadImages(deck, root) {
  const images = {}, problems = [];
  for (const [i, s] of deck.slides.entries()) {
    if (!s.image || images[s.image]) continue;
    try {
      const { bytes } = await readMissionBytes(root, s.image);
      const mime = imageMime(bytes);
      if (!mime) throw Error("no es PNG ni JPG");
      if (bytes.length > MAX_IMAGE) throw Error("pesa más de 8 MB");
      images[s.image] = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
    } catch (e) {
      problems.push(`Diapositiva ${i + 1}: no puedo usar la imagen «${s.image}» (${e.message}).`);
    }
  }
  return { images, problems };
}

/** Everything a presentation is made of. Throws (in Spanish) when the script is incomplete. */
export async function buildDeck(input, { root } = {}) {
  const deck = parseDeck(input);
  const { images, problems } = root ? await loadImages(deck, root) : { images: {}, problems: [] };
  if (problems.length) throw Error(problems.join(" ") + " Crea la imagen con create_image y usa la ruta que devuelve.");
  const theme = themeOf(deck);
  const laid = deck.slides.map((s, i) => slideElements(s, i, deck.slides.length, theme, images));
  return {
    deck, theme, laid,
    warnings: layoutWarnings(laid),
    html: (o) => deckHtml(deck, laid, theme, o),
    pptx: () => deckPptx(deck, laid, theme),
  };
}

/** The outline of a deck in plain text (search, the bot's memory of what it made). */
export function deckOutline(deck) {
  return deck.slides.map((s, i) => {
    const bits = [s.title, s.subtitle, ...s.bullets, s.quote, ...(s.stats || []).map((x) => x.value + " " + x.label),
      s.left?.heading, ...(s.left?.bullets || []), s.right?.heading, ...(s.right?.bullets || [])].filter(Boolean);
    return `${i + 1}. [${s.layout}] ${bits.join(" · ")}`.slice(0, 600);
  }).join("\n");
}
