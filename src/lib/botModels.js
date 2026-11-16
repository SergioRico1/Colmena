// The model picker of one bot (Ajustes › Tu cuenta de IA › «Qué usa cada bot» and the bot's
// profile › «Piensa con»): «Automático» (Colmena chooses by role, server/models.mjs) or one exact
// model of the engine the bot thinks with. The server keeps it as `modelPin`; a model its engine
// no longer offers falls back to «Automático» by itself.

/**
 * The engine a bot really thinks with now (/api/state › bots[].model.engine): its own, else the
 * team's. null when none of them is connected: then there is no model to choose.
 */
export function botEngine(store, bot) {
  if (bot?.model && "engine" in bot.model) return bot.model.engine || null;
  return bot?.engine || store?.ai?.primary || null;
}

/** The models a bot may pin: its engine's list, without the internal utility ones. */
export function botModelList(store, bot) {
  const engine = botEngine(store, bot);
  if (!engine) return [];
  const list = store?.ai?.catalog?.[engine] || (engine === "openai" ? store?.models : null) || [];
  return list.filter((m) => m?.slug && !m.utility);
}

/** `{ value, options }` for a Select: "" is «Automático», with what it chooses now. */
export function botModelChoice(store, bot) {
  const list = botModelList(store, bot);
  const pinned = bot?.model?.pinned && list.some((m) => m.slug === bot.modelPin) ? bot.modelPin : "";
  const auto = bot?.model?.pinned ? bot.model.auto : bot?.model?.label;
  return {
    value: pinned,
    options: [["", auto ? `Automático (${auto})` : "Automático"], ...list.map((m) => [m.slug, m.label || m.slug])],
    label: (slug) => (slug ? list.find((m) => m.slug === slug)?.label || slug : "automático"),
  };
}
