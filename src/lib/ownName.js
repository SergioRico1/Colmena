// Whether Colmena knows what to call you towards other people. Pure: no React, no network.

/** What you are called on your own screens when you have not set a name: one word everywhere. */
export const SELF_FALLBACK = "Tú";
const PLACEHOLDERS = new Set(["", "Tu cuenta", "Sin nombre", "Tú"]);
/** Your name as your screens show it: the one you set, the AI account's, or «Tú». */
export function selfName({ peers = null, settings = {}, account = null } = {}) {
  const own = String(settings?.userName || "").trim();
  if (!PLACEHOLDERS.has(own)) return own;
  const shown = String(peers?.me?.name || "").trim();
  if (!PLACEHOLDERS.has(shown)) return shown;
  return String(account?.name || "").trim() || SELF_FALLBACK;
}
/** A person row of yours whose name is a placeholder reads as yourself: «Tú». */
export const selfLabel = (name) => (PLACEHOLDERS.has(String(name || "").trim()) ? SELF_FALLBACK : String(name).trim());

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
