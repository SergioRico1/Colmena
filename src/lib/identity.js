// Person or bot, the same everywhere (docs/PLAN-equipo-y-salas.md, scope 4). Circles are people.
// A bot keeps its shape; a «circle» (what Investigación was) is drawn as the capsule and anything
// unknown as a rounded square, so nobody takes a bot for a person. Pure: no React, no network.

const BOT_SHAPES = ["hex", "diamond", "square", "leaf", "arch", "capsule"];

/**
 * The shape a bot is drawn with: its own; a «circle» (what Investigación was, and what older peers
 * still send) is the capsule; anything unknown a rounded square.
 */
export const botShape = (shape) => (shape === "circle" ? "capsule" : BOT_SHAPES.includes(shape) ? shape : "square");

/** A light tint of a colour (a person's round avatar from their bots' family). */
export function lightTint(hex, amount = 0.8) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return "#" + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * amount).toString(16).padStart(2, "0")).join("").toUpperCase();
}
/** A person's tint from their bots: the coordinator's tone (the family's deepest), else the first. */
export const familyTint = (bots = []) => lightTint((bots.find((b) => b?.id === "atlas") || bots[0])?.color);

/** «LM» from «Lucía Martín»; «?» when there is no name. */
export const initialsOf = (name) => String(name || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";

/** «Lucía» from «Lucía Martín». */
export const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "Alguien";

/** «Ana», «Ana y Luis», «Ana, Luis y Marta». */
export const listNames = (list) => (list.length <= 1 ? list.join("") : list.slice(0, -1).join(", ") + " y " + list.at(-1));

/** Accents and case out: «Tomás» and «tomas» are one name. */
export const foldName = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** The neutral tint of a person's circle when they bring no colour of their own. */
const TINTS = ["#EFE2D3", "#DCE6F2", "#E3EEDF", "#EEE0EC", "#E9E6DA"];
export const personTint = (name) => TINTS[[...String(name || "")].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length];

/* ───────────── whose bot: names and marks (critique 2026-11-13, P0) ───────────── */

/**
 * How an owner is called next to a bot: «Lucía», or «Lucía M.» when another owner in sight
 * shares the first name. `owners`: every owner visible in the same place.
 */
export function ownerShort(owner, owners = []) {
  const first = firstName(owner?.name);
  const twin = owners.some((o) => o && o !== owner && (o.address || o.name) !== (owner?.address || owner?.name) && !o.you && foldName(firstName(o.name)) === foldName(first));
  if (!twin) return first;
  const last = String(owner?.name || "").trim().split(/\s+/)[1];
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}

/**
 * The names bots go by in one place (a room, a list): a bot whose name another visible bot also
 * has is called «Vera · de Lucía»; your own bots never need «de ti». `groups`: [{owner: {address,
 * name, you}, bots: [{id, name}]}]. Returns {label(owner, bot) → string, clashes(name) → bool}.
 */
export function botNameLabels(groups = []) {
  const count = new Map();
  for (const g of groups || []) for (const b of g?.bots || []) count.set(foldName(b.name), (count.get(foldName(b.name)) || 0) + 1);
  const owners = (groups || []).map((g) => g?.owner).filter((o) => o && !o.you);
  const clashes = (name) => (count.get(foldName(name)) || 0) > 1;
  const label = (owner, bot) => {
    const name = bot?.name || "Bot";
    if (!owner || owner.you || !clashes(name)) return name;
    const found = owners.find((o) => (o.address && o.address === owner.address) || (!o.address && o.name === owner.name)) || owner;
    return `${name} · de ${ownerShort(found, owners)}`;
  };
  return { label, clashes };
}

/** The accessible name of a bot: «Vera, bot de Lucía» (someone else's) or «Vera, bot tuyo». */
export const botA11yName = (bot, owner = null) => `${bot?.name || "Bot"}, ${!owner || owner.you ? "bot tuyo" : "bot de " + firstName(owner.name)}`;

/** The text of the corner badge on someone else's bot: their initials («LM»), or one letter when small. */
export const ownerBadgeText = (owner, size = 20) => {
  const all = initialsOf(owner?.name);
  return size < 20 ? all.slice(0, 1) : all;
};
