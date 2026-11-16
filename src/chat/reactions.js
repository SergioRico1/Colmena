// Reactions of a chat message as the screen shows them (src/chat/Message.jsx).
/**
 * The reactions with your own clicks already in ({emoji: on}), so a click shows at once instead of
 * after the server's round trip; the server's view takes over as soon as it agrees.
 */
export function withMine(reactions, mine, me) {
  const out = (reactions || []).map((r) => ({ ...r, people: [...r.people] }));
  for (const [emoji, on] of Object.entries(mine || {})) {
    const r = out.find((x) => x.emoji === emoji);
    if (on === !!r?.people.includes(me)) continue;
    if (on && r) { r.people.push(me); r.count += 1; }
    else if (on) out.push({ emoji, people: [me], count: 1 });
    else { r.people = r.people.filter((p) => p !== me); r.count -= 1; }
  }
  return out.filter((r) => r.count > 0);
}
