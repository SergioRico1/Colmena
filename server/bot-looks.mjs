// Bots unique per person (critique 2026-11-13, P0). Every Colmena used to start with the same six
// bots (names, colours, shapes): in a room of three people there were three «Vera». Bot ids never
// change (they are keys everywhere); what changes is how they look and are called.
//
// The seed is the person's «Personas» identity: the public signing key (`peers.address`), which
// `Peers#start` loads or creates on the first start, before the window opens onboarding. It is
// the same key on any machine that restores the identity, so the same person gets the same bots.
// When the identity cannot be loaded (no vault, a broken file) a random install id kept in
// `settings.installId` stands in. Whichever key was used is written to `settings.botLooks.key`
// and never read again from the identity: once applied, the looks only change by the person's hand
// («Otro nombre», «Otro color», editing the bot).
//
// - Colours (decided by the owner, 2026-11-13): the seed picks ONE colour family for the person
//   from FAMILIES (twelve, never honey nor amber: hues 25°-70° are out), and each of the person's
//   bots gets its own TONE of that family (tonesOf: lightness, saturation and a hue shift of at
//   most ±12°, every tone at 3:1 or more on the light and on the dark surfaces). So a person's
//   bots are told apart from each other and read as one person's family. The coordinator gets the
//   deepest tone (it was ink); the person's own round avatar a light tint of the family.
// - New installation (`botLooks.state: "fresh"`, set by Store#migrate): every built-in bot gets a
//   NAME from its role's pool and a TONE of the family, all distinct. The shape keeps marking the
//   role.
// - Existing installation (`"update"`): names are kept (decided by the owner: «Solo nuevo color»).
//   Every built-in bot whose colour is still the factory one gets a tone of the family; a colour
//   you chose is left alone. The factory colours are kept in `botLooks.previous` for «Deshacer».
//
// Each bot has its own deterministic sequence of names and of tones (a permutation seeded by key +
// bot id); «Otro nombre» / «Otro color» walk it (`bot.look`), so a choice is reproducible, and skip
// what another of your bots already has.
import { createHash, randomUUID } from "node:crypto";

/** The ink the coordinator was drawn in (its factory colour) and honey, never a bot's colour. */
export const INK = "#12131A";
export const HONEY = "#FFC93C";

/** The twelve colour families, one per person: [hex, name]. None in hues 25°-70° (honey, amber). */
export const FAMILIES = Object.freeze([
  ["#E5484D", "Coral"],
  ["#C4552B", "Teja"],
  ["#6E8F1A", "Musgo"],
  ["#2E9A3E", "Hoja"],
  ["#0E8C6A", "Esmeralda"],
  ["#0A8C9E", "Turquesa"],
  ["#1F8FD8", "Cielo"],
  ["#3A5BE8", "Cobalto"],
  ["#6E48F0", "Violeta"],
  ["#A445D6", "Orquídea"],
  ["#D43C86", "Frambuesa"],
  ["#5B6680", "Pizarra"],
]);

/* ── colour arithmetic ── */
const hexRgb = (hex) => { const n = parseInt(String(hex).replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbHex = (rgb) => "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
export function hsl(hex) {
  const [r, g, b] = hexRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? (((g - b) / d) % 6) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return { h: (h + 360) % 360, s, l };
}
function fromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}
/** WCAG relative luminance. */
export function luminance(hex) {
  const [r, g, b] = hexRgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** Never into honey's band: a hue that a shift takes into 25°-70° stops at its edge. */
const safeHue = (h) => { const x = ((h % 360) + 360) % 360; return x > 23 && x < 72 ? (x - 23 < 72 - x ? 23 : 72) : x; };
/** The lightness that gives hue h and saturation s the luminance `target`. */
function toneAt(h, s, target) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (luminance(fromHsl(h, s, mid)) < target) lo = mid; else hi = mid; }
  return fromHsl(h, s, (lo + hi) / 2);
}
// Eight tones of a family: [hue shift, saturation × , luminance]. Luminance between 0.12 and 0.27
// keeps every tone at 3:1 or more both on the light surfaces (#F5F5F2) and on the dark (#12131A).
// The first, the deepest, is the coordinator's.
const TONE_RECIPES = [[0, 0.8, 0.12], [-12, 1, 0.245], [10, 1, 0.15], [0, 1, 0.2], [-6, 0.55, 0.135], [6, 0.6, 0.265], [-10, 0.7, 0.175], [12, 0.75, 0.225]];
const toneCache = new Map();
/** The tones of family `i` (index in FAMILIES), the deepest first. */
export function tonesOf(i) {
  if (toneCache.has(i)) return toneCache.get(i);
  const { h, s } = hsl(FAMILIES[i][0]);
  const tones = TONE_RECIPES.map(([dh, ks, target]) => toneAt(safeHue(h + dh), Math.min(1, Math.max(0.12, s * ks)), target));
  toneCache.set(i, tones);
  return tones;
}
/** A light tint of a colour (the person's round avatar): `amount` of white. */
export const tintOf = (hex, amount = 0.8) => rgbHex(hexRgb(hex).map((v) => v + (255 - v) * amount));
/** The family a key gives a person: its index, the same on any machine. */
export const familyIndex = (key) => Math.floor(generator(`colmena-family-v1|${key}`)() * FAMILIES.length);
export function familyOf(key) {
  const i = familyIndex(key);
  return { index: i, name: FAMILIES[i][1], color: FAMILIES[i][0], tint: tintOf(FAMILIES[i][0]) };
}

/** What every Colmena wrote before: the colours «Deshacer» restores and «factory» means. */
export const FACTORY = Object.freeze({
  atlas: { name: "Atlas", color: "#12131A" },
  nora: { name: "Nora", color: "#2F6BFF" },
  tomas: { name: "Tomás", color: "#0B8A5F" },
  iris: { name: "Iris", color: "#FF5CA8" },
  vera: { name: "Vera", color: "#7B4DFF" },
  bruno: { name: "Bruno", color: "#FF7A1A" },
  leo: { name: "Leo", color: "#0E7C86" },
});

/**
 * Names per role: plain Spanish first names, varied, none famous, none of the factory names and
 * no name in two pools (so the first pick of each is already distinct). Words that read as
 * something else when a message starts with them («Dolores, …», «Abril, …») are left out.
 */
export const NAME_POOLS = Object.freeze({
  atlas: ["Adela", "Ramiro", "Olga", "Gonzalo", "Inés", "Emilio", "Pilar", "Héctor", "Rosario", "Fermín", "Carmela", "Leandro"],
  nora: ["Marina", "Julián", "Celia", "Damián", "Lorena", "Ezequiel", "Noelia", "Rodrigo", "Alba", "Matías", "Sabina", "Ulises"],
  tomas: ["Aurelio", "Berta", "Ciro", "Elvira", "Germán", "Irene", "Jacinto", "Leonor", "Nicanor", "Paula", "Simón", "Teresa"],
  iris: ["Valeria", "Hugo", "Candela", "Óscar", "Mireia", "Telmo", "Noa", "Gael", "Luna", "Darío", "Ainhoa", "Iker"],
  vera: ["Amaia", "Silvia", "Bernardo", "Esther", "Rubén", "Julia", "Manuel", "Cristina", "Tobías", "Adriana", "Raúl", "Begoña"],
  bruno: ["Álvaro", "Nuria", "Joaquín", "Sonia", "Iván", "Lidia", "Pablo", "Carlota", "Martín", "Eva", "Samuel", "Greta"],
  leo: ["Ernesto", "Edurne", "Fidel", "Fabiola", "Benito", "Elisa", "Eloy", "Ramona", "Gregorio", "Montse", "Anselmo", "Severino"],
});

/** The order bots are given looks in (the first ones get their first choice). */
export const LOOK_ORDER = Object.freeze(["atlas", "nora", "tomas", "iris", "vera", "bruno", "leo"]);
const COORDINATOR = "atlas";

/** Accents and case out: «Tomás» and «tomas» are the same name. */
export const foldName = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
export const sameName = (a, b) => !!foldName(a) && foldName(a) === foldName(b);
const sameColor = (a, b) => String(a || "").toUpperCase() === String(b || "").toUpperCase();
/** Honey and its amber family are never a bot's colour (hue 30°-60°, saturated and light). */
export function amberish(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return false;
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 0.25 || max < 0.55) return false;
  const h = max === r ? (((g - b) / d) % 6) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  const hue = (h + 360) % 360;
  return hue >= 30 && hue <= 60;
}

/** A small deterministic generator from a string (sha256 → mulberry32). */
function generator(text) {
  let a = createHash("sha256").update(String(text)).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A permutation of 0..n-1, the same for the same key, bot and kind on any machine. */
export function sequence(key, botId, kind, n) {
  const rand = generator(`colmena-bot-looks-v1|${key}|${botId}|${kind}`);
  const out = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const namesFor = (key, botId) => (NAME_POOLS[botId] ? sequence(key, botId, "name", NAME_POOLS[botId].length).map((i) => NAME_POOLS[botId][i]) : []);
/** The tones a bot may wear, in its own order: the coordinator its deepest one, the others a permutation of the rest. */
const colorsFor = (key, botId) => {
  const tones = tonesOf(familyIndex(key));
  if (botId === COORDINATOR) return [tones[0]];
  return sequence(key, botId, "color", tones.length - 1).map((i) => tones[i + 1]);
};

/**
 * The looks a key gives each built-in bot, all distinct: {botId: {name, color, look: {name, color}}}
 * (`look`: the position in the bot's own sequences). Every colour is a tone of the person's family.
 */
export function seededLooks(key, ids = LOOK_ORDER, { taken = [] } = {}) {
  // `taken`: colours your other bots keep (one you chose stays; nobody gets it twice).
  const usedColors = [...taken];
  const usedNames = [];
  const out = {};
  for (const botId of LOOK_ORDER.filter((b) => ids.includes(b))) {
    const names = namesFor(key, botId);
    const ni = names.findIndex((n) => !usedNames.some((u) => sameName(u, n)));
    const name = ni >= 0 ? names[ni] : FACTORY[botId]?.name;
    usedNames.push(name);
    const colors = colorsFor(key, botId);
    const ci = colors.findIndex((c) => !usedColors.some((u) => sameColor(u, c)));
    const color = colors[ci >= 0 ? ci : 0];
    usedColors.push(color);
    out[botId] = { name, color, look: { name: ni, color: ci >= 0 ? ci : 0 } };
  }
  return out;
}

/**
 * «Otro nombre» / «Otro color»: the next one in this bot's own sequence that none of your other
 * bots has. `bots`: all your bots. Returns {name} or {color} plus the new `look`, or null when the
 * bot has no sequence (a bot you made; the coordinator's colour).
 */
export function nextLook(key, bot, bots, what) {
  const look = { name: null, color: null, ...(bot?.look || {}) };
  const others = (bots || []).filter((b) => b.id !== bot.id);
  if (what === "name") {
    const names = namesFor(key, bot.id);
    if (!names.length) return null;
    const from = Number.isInteger(look.name) ? look.name : -1;
    for (let k = 1; k <= names.length; k++) {
      const i = (from + k + names.length) % names.length;
      if (sameName(names[i], bot.name) || others.some((b) => sameName(b.name, names[i]))) continue;
      return { name: names[i], look: { ...look, name: i } };
    }
    return null;
  }
  if (what === "color") {
    const colors = colorsFor(key, bot.id);
    if (colors.length < 2) return null; // the coordinator keeps the family's deepest tone
    const from = Number.isInteger(look.color) ? look.color : -1;
    for (let k = 1; k <= colors.length; k++) {
      const i = (from + k + colors.length) % colors.length;
      if (sameColor(colors[i], bot.color) || others.some((b) => sameColor(b.color, colors[i]))) continue;
      return { color: colors[i], look: { ...look, color: i } };
    }
    return null;
  }
  return null;
}

/** The name of one of your bots that another of yours already has, or null. */
export function nameClash(bots, name, exceptId = null) {
  return (bots || []).find((b) => b.id !== exceptId && sameName(b.name, name)) || null;
}
/** A name nobody of yours has: «Vera (copia)», «Vera (copia 2)»… */
export function freeName(bots, base) {
  if (!nameClash(bots, base)) return base;
  for (let n = 2; n < 100; n++) { const name = `${base} ${n}`; if (!nameClash(bots, name)) return name; }
  return base + " " + randomUUID().slice(0, 4);
}
/** A bot's names, the current one first: what «@Nombre» typed by hand may still mean. */
export function namesOf(bot) {
  const out = [];
  for (const n of [bot?.name, ...(Array.isArray(bot?.previousNames) ? bot.previousNames : [])]) if (n && !out.some((x) => sameName(x, n))) out.push(n);
  return out;
}
/**
 * The names each bot answers to in a list: its current name, then its previous ones unless another
 * bot of the list is called that now (a current name always wins). [{bot, names}].
 */
export function answeringNames(bots) {
  const current = (bots || []).map((b) => b?.name).filter(Boolean);
  return (bots || []).filter((b) => b?.name).map((bot) => ({ bot, names: namesOf(bot).filter((n, i) => i === 0 || !current.some((c) => sameName(c, n))) }));
}
/** `previousNames` after a rename: the old name kept (newest first, at most five, never the new one). */
export function renamed(bot, name) {
  if (!bot || sameName(bot.name, name)) return Array.isArray(bot?.previousNames) ? bot.previousNames : [];
  return namesOf({ name: bot.name, previousNames: bot.previousNames }).filter((n) => !sameName(n, name)).slice(0, 5);
}

const settingsOf = (store) => store.get("settings", "main") || { id: "main" };
/** The key that seeds this person's bots: the identity's when it is known, else an install id. */
export function seedKey(store, identityKey = null) {
  const s = settingsOf(store);
  if (s.botLooks?.key) return s.botLooks.key;
  if (identityKey) return identityKey;
  if (s.installId) return s.installId;
  const installId = randomUUID();
  store.patch("settings", "main", { installId });
  return installId;
}

/**
 * Applies the looks once (idempotent). New installation: names and colours to every built-in bot
 * still as it came. Existing: a colour to every built-in bot (not the coordinator) still at its
 * factory colour, and a quiet notice with «Deshacer». Returns what it did: "fresh" | "update" | null.
 */
export function ensureBotLooks(store, identityKey = null) {
  const s = settingsOf(store);
  const state = s.botLooks?.state;
  if (state !== "fresh" && state !== "update") return null;
  const key = seedKey(store, identityKey);
  return store.tx(() => {
    const bots = store.list("bots");
    const builtin = bots.filter((b) => b.builtin && FACTORY[b.id]);
    const at = new Date().toISOString();
    if (state === "fresh") {
      const asCame = (b) => sameName(b.name, FACTORY[b.id].name) && sameColor(b.color, FACTORY[b.id].color);
      const ids = builtin.filter(asCame).map((b) => b.id);
      // Leo comes later (a legal team at onboarding): its look is kept ready for then.
      const looks = seededLooks(key, [...ids, ...(ids.includes("leo") ? [] : ["leo"])], { taken: bots.filter((b) => !ids.includes(b.id)).map((b) => b.color) });
      for (const botId of ids) store.patch("bots", botId, { name: looks[botId].name, color: looks[botId].color, look: looks[botId].look });
      const leo = ids.includes("leo") ? null : looks.leo;
      store.patch("settings", "main", { botLooks: { state: "done", mode: "fresh", key, at, family: familyOf(key), ...(leo ? { leo } : {}) } });
      return "fresh";
    }
    const factory = builtin.filter((b) => sameColor(b.color, FACTORY[b.id].color) || (b.id === COORDINATOR && sameColor(b.color, HONEY)));
    const ids = factory.map((b) => b.id);
    const looks = seededLooks(key, ids, { taken: bots.filter((b) => !ids.includes(b.id)).map((b) => b.color) });
    const previous = {};
    for (const botId of ids) {
      previous[botId] = store.get("bots", botId).color;
      store.patch("bots", botId, { color: looks[botId].color, look: { name: null, color: looks[botId].look.color } });
    }
    store.patch("settings", "main", { botLooks: { state: "done", mode: "update", key, at, family: familyOf(key), previous, notice: ids.length > 0 } });
    return "update";
  });
}

/** The look a built-in bot gets when it is created later (Leo, at onboarding), or null. */
export function lookForNew(store, botId) {
  const s = settingsOf(store);
  if (s.botLooks?.mode !== "fresh" || !s.botLooks.key || !FACTORY[botId]) return null;
  const bots = store.list("bots").filter((b) => b.id !== botId);
  // The look onboarding already showed for it, while nobody of yours took that name or colour.
  const ready = s.botLooks[botId];
  if (ready?.name && !nameClash(bots, ready.name) && !bots.some((b) => sameColor(b.color, ready.color))) return { name: ready.name, color: ready.color, look: ready.look };
  const names = namesFor(s.botLooks.key, botId);
  const ni = names.findIndex((n) => !nameClash(bots, n));
  const colors = colorsFor(s.botLooks.key, botId);
  const ci = colors.findIndex((c) => !bots.some((b) => sameColor(b.color, c)));
  return { ...(ni >= 0 ? { name: names[ni] } : {}), ...(ci >= 0 ? { color: colors[ci] } : {}), look: { name: ni >= 0 ? ni : null, color: ci >= 0 ? ci : null } };
}

/** «Deshacer» of the notice: the factory colours back, on the bots still at the colour we gave. */
export function undoBotLooks(store) {
  const s = settingsOf(store);
  const looks = s.botLooks || {};
  if (looks.mode !== "update" || !looks.previous) return 0;
  return store.tx(() => {
    let n = 0;
    for (const [botId, color] of Object.entries(looks.previous)) {
      const bot = store.get("bots", botId);
      if (!bot || bot.look?.color == null) continue;
      const given = colorsFor(looks.key, botId)[bot.look.color];
      if (!sameColor(bot.color, given)) continue;
      const { look: _look, ...rest } = bot;
      store.put("bots", { ...rest, color, updatedAt: new Date().toISOString() });
      n++;
    }
    store.patch("settings", "main", { botLooks: { ...looks, notice: false, undone: true } });
    return n;
  });
}

/** The notice was seen and closed (or its time ran out). */
export function closeBotLooksNotice(store) {
  const looks = settingsOf(store).botLooks;
  if (looks?.notice) store.patch("settings", "main", { botLooks: { ...looks, notice: false } });
}

/** The coordinator's name as the person sees it («Atlas» before the looks, or its own). */
export const coordinatorName = (store) => store?.get?.("bots", COORDINATOR)?.name || FACTORY.atlas.name;
