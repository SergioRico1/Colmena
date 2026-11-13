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
// - New installation (`botLooks.state: "fresh"`, set by Store#migrate): every built-in bot gets a
//   NAME from its role's pool and a COLOUR from BOT_PALETTE, all distinct. The shape keeps marking
//   the role; the coordinator keeps its ink and hexagon (design rule: ink is for the coordinator,
//   honey only means «te necesita»).
// - Existing installation (`"update"`): names are kept (decided by the owner: «Solo nuevo color»).
//   Every built-in bot, except the coordinator, whose colour is still the factory one gets a
//   colour from the seed, distinct from all your other bots; a colour you chose is left alone. The
//   factory colours are kept in `botLooks.previous` for «Deshacer».
//
// Each bot has its own deterministic sequence of names and of colours (a permutation of the pool
// and the palette seeded by key + bot id); «Otro nombre» / «Otro color» walk it (`bot.look`), so a
// choice is reproducible, and skip what another of your bots already has.
import { createHash, randomUUID } from "node:crypto";

/** The ink of the coordinator (never in the palette) and honey, which is never a bot's colour. */
export const INK = "#12131A";
export const HONEY = "#FFC93C";

/**
 * Colmena's bot palette: twelve colours, none honey nor of its amber family, each at least 3:1
 * against the light surfaces where avatars sit (#FFFFFF, #F5F5F2, #F6F6F3). [hex, name in Spanish].
 */
export const BOT_PALETTE = Object.freeze([
  ["#2F6BFF", "azul"],
  ["#7B4DFF", "violeta"],
  ["#B4236E", "frambuesa"],
  ["#0B8A5F", "verde"],
  ["#0E7C86", "verde azulado"],
  ["#C0392B", "teja"],
  ["#1F5F8B", "petróleo"],
  ["#4A7A1A", "verde hoja"],
  ["#5B6478", "pizarra"],
  ["#8A4B2E", "tierra"],
  ["#B62FC4", "magenta"],
  ["#5B2A86", "berenjena"],
]);

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
const colorsFor = (key, botId) => sequence(key, botId, "color", BOT_PALETTE.length).map((i) => BOT_PALETTE[i][0]);

/**
 * The looks a key gives each built-in bot, all distinct: {botId: {name, color, look: {name, color}}}
 * (`look`: the position in the bot's own sequences). The coordinator keeps its ink (`look.color`
 * null). `keep` {botId: color}: colours already taken that stay as they are (only colours are
 * given then; see `ensureBotLooks`).
 */
export function seededLooks(key, ids = LOOK_ORDER, { taken = [] } = {}) {
  const usedColors = [...taken];
  const usedNames = [];
  const out = {};
  for (const botId of LOOK_ORDER.filter((b) => ids.includes(b))) {
    const names = namesFor(key, botId);
    const ni = names.findIndex((n) => !usedNames.some((u) => sameName(u, n)));
    const name = ni >= 0 ? names[ni] : FACTORY[botId]?.name;
    usedNames.push(name);
    if (botId === COORDINATOR) { out[botId] = { name, color: INK, look: { name: ni, color: null } }; continue; }
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
    if (bot.id === COORDINATOR) return null;
    const colors = colorsFor(key, bot.id);
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
      store.patch("settings", "main", { botLooks: { state: "done", mode: "fresh", key, at, ...(leo ? { leo } : {}) } });
      return "fresh";
    }
    const factory = builtin.filter((b) => b.id !== COORDINATOR && sameColor(b.color, FACTORY[b.id].color));
    const ids = factory.map((b) => b.id);
    const looks = seededLooks(key, ids, { taken: bots.filter((b) => !ids.includes(b.id)).map((b) => b.color) });
    const previous = {};
    for (const botId of ids) {
      previous[botId] = store.get("bots", botId).color;
      store.patch("bots", botId, { color: looks[botId].color, look: { name: null, color: looks[botId].look.color } });
    }
    store.patch("settings", "main", { botLooks: { state: "done", mode: "update", key, at, previous, notice: ids.length > 0 } });
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
