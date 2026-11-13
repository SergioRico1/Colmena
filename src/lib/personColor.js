// A person's colour in Colmena 4 (design/v4/colmena-v4.html › .av): every person has a family
// colour; their round avatar is a soft tint of it with the initials in a deep shade of it, and
// someone else's bot wears it in the owner's chip. The server hands out light pastels
// (server/peers/service.mjs › PERSON_COLORS) or a bot family's tint; this turns any of them into
// the family's saturated ink, and the avatar's two colours come from the theme
// (src/styles/conversation.css › --c-av-*), so light and dark both hold.

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function toRgb(hex) {
  const m = HEX.exec(String(hex || "").trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

function toHsl([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** The family's saturated colour behind a pastel (or any colour): its hue, a clear mid tone. */
export function familyInk(color) {
  const rgb = toRgb(color);
  if (!rgb) return "var(--c-text-3)";
  const [h, s] = toHsl(rgb);
  // A near-grey stays a calm slate; anything with a hue keeps it, saturated enough to read.
  if (s < 0.08) return fromHsl(225, 0.16, 0.44);
  return fromHsl(h, Math.min(0.62, Math.max(0.34, s * 1.35)), 0.47);
}

/** The round avatar's ground and initials for a person colour, following the theme. */
export function avatarColors(color) {
  const ink = familyInk(color);
  return {
    background: `color-mix(in oklab, ${ink} var(--c-av-mix), var(--c-av-base))`,
    color: `color-mix(in oklab, ${ink} var(--c-av-ink-mix), var(--c-av-ink))`,
  };
}
