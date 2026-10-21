// «Denegar» with a reason (Hermes): the bot learns why, so it can correct course instead of
// trying the same thing again or giving up.
export const DENY_REASON_MAX = 500;

/** What a bot receives when the person denied (or let expire) one of its actions. */
export function deniedResult(approval, { expired = false } = {}) {
  const reason = String(approval?.denyReason || "").trim();
  if (reason)
    return {
      denied: true,
      reason,
      message: "La persona denegó esta acción y explica por qué: «" + reason + "». Tenlo en cuenta: corrige lo que pide o pregúntale; no repitas lo mismo.",
    };
  return { denied: true, message: expired ? "La persona no lo aprobó a tiempo. No lo repitas sin preguntarle." : "La persona denegó esta acción. No la repitas." };
}
