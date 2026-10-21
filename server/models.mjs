// Model choice per bot, ported from NEXO (app/ai/router.mjs, same author): the person
// never picks a model. Families: Luna (everyday, writing), Sol (complex work, code,
// analysis), Astra (routing and the hardest work). Each family always resolves to the
// highest version the account exposes.
export const FAMILIES = ["luna", "sol", "astra"];
export const FAMILY_LABEL = { luna: "Luna", sol: "Sol", astra: "Astra" };

export function parseModel(slug) {
  const match = /^gpt-(\d+(?:\.\d+)*)-(luna|sol|astra)$/i.exec(String(slug || ""));
  return match ? { version: match[1].split(".").map(Number), family: match[2].toLowerCase() } : null;
}
function newer(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * Families of a model: ChatGPT slugs carry it in the name (gpt-6-sol); catalogue models of
 * other providers (providers/catalog.mjs) list theirs with a rank to order versions.
 */
export function familiesOf(model) {
  if (Array.isArray(model?.families)) return model.families.filter((f) => FAMILIES.includes(f)).map((family) => ({ family, version: [Number(model.rank) || 0] }));
  const parsed = parseModel(model?.slug);
  return parsed ? [parsed] : [];
}

/** Highest available version of each family: { luna: model, sol: model, astra: model }. */
export function familyModels(models) {
  const best = {};
  for (const model of Array.isArray(models) ? models : []) {
    for (const parsed of familiesOf(model)) {
      if (!best[parsed.family] || newer(parsed.version, best[parsed.family].version)) best[parsed.family] = { model, version: parsed.version };
    }
  }
  return Object.fromEntries(Object.entries(best).map(([family, x]) => [family, x.model]));
}

const ROUTER = /coordin|enrut|reparte|orquest|dirige al equipo/i;
const CODE = /c[oó]digo|program|sistemas|desarroll|software|script|inform[aá]tic|t[eé]cnic/i;
const ANALYSIS = /datos|finanz|investig|an[aá]lis|legal|contrat|jur[ií]dic|contab|econom|estrateg|cient[ií]f/i;

/** Families in order of preference for a bot, from its role and description. */
export function familyPreference(bot) {
  if (FAMILIES.includes(bot?.modelFamily)) {
    const first = bot.modelFamily;
    return [first, ...{ luna: ["sol", "astra"], sol: ["astra", "luna"], astra: ["sol", "luna"] }[first]];
  }
  const role = String(bot?.role || "");
  const about = role + " " + String(bot?.instructions || "").slice(0, 600);
  if (bot?.id === "atlas" || ROUTER.test(role)) return { order: ["astra", "sol", "luna"], reason: "coordina el equipo" };
  if (CODE.test(role) || (!role && CODE.test(about))) return { order: ["sol", "astra", "luna"], reason: "programa" };
  if (ANALYSIS.test(role) || (!role && ANALYSIS.test(about))) return { order: ["sol", "astra", "luna"], reason: "analiza e investiga" };
  return { order: ["luna", "sol", "astra"], reason: "redacta y ayuda en el día a día" };
}

const prefOf = (bot) => {
  const p = familyPreference(bot);
  return Array.isArray(p) ? { order: p, reason: "elegido en su perfil" } : p;
};

/**
 * Model for a bot: its preferred family at the highest version available; falls back
 * to the nearest family, then to `fallback` (account default) so work never stalls.
 */
export function chooseModel(bot, models, fallback = "") {
  const families = familyModels(models);
  const { order, reason } = prefOf(bot);
  const family = order.find((f) => families[f]);
  if (family) {
    const chosen = families[family];
    const version = parseModel(chosen.slug)?.version?.join(".") || "";
    // Other providers' models keep their own name («Claude Opus 5.5»).
    const label = Array.isArray(chosen.families) ? chosen.label || chosen.slug : FAMILY_LABEL[family] + (version ? " " + version : "");
    return { slug: chosen.slug, family, label, wanted: order[0], reason };
  }
  const slug = fallback || models?.[0]?.slug || "";
  return { slug, family: null, label: models?.find?.((m) => m.slug === slug)?.label || slug, wanted: order[0], reason };
}
