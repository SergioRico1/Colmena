// Whether Colmena knows what to call you towards other people. Pure: no React, no network.

/**
 * The name other people would see is missing: an invitation would read «soy Sin nombre»
 * (server/peers falls back to that when there is no name in Ajustes nor in the AI account).
 * `store` is the /api/state snapshot.
 */
export function lacksOwnName({ peers = null, settings = {}, account = null } = {}) {
  const shown = String(peers?.me?.name || "").trim();
  if (shown) return shown === "Sin nombre";
  const own = String(settings?.userName || "").trim();
  return !((own && own !== "Tu cuenta") || account?.name || account?.email);
}
