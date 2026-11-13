import test from "node:test";
import assert from "node:assert/strict";
import { pixelBotSpec, pixelBotSvg, botFaceSpec, inHoneyBand, paintOf, roleKey, moodOf, gridFor, SHAPES, MOODS, ROLES } from "../src/lib/pixelBot.js";
import { FAMILIES, tonesOf } from "../server/bot-looks.mjs";

// Colmena 4 pixel bots (src/lib/pixelBot.js, src/components/BotFace.jsx): Colmena's own design,
// deterministic, every shape × mood drawn, never honey, named for screen readers, and the owner's
// round chip only on someone else's bot.
const SHAPE_ROLE = [["hex", "coordinador"], ["capsule", "investigacion"], ["square", "datos"], ["diamond", "diseno"], ["leaf", "redaccion"], ["arch", "codigo"]];
const fills = (spec) => [...spec.rects, ...spec.spark].map((r) => r.fill);

test("the same inputs draw the same bot; seed and colour change it", () => {
  const a = pixelBotSvg({ shape: "hex", color: "#6E48F0", role: "coordinador", seed: 3, size: 32, mood: "libre" });
  const b = pixelBotSvg({ shape: "hex", color: "#6E48F0", role: "coordinador", seed: 3, size: 32, mood: "libre" });
  assert.equal(a, b);
  assert.notEqual(a, pixelBotSvg({ shape: "hex", color: "#6E48F0", role: "coordinador", seed: 4, size: 32, mood: "libre" }), "the seed moves the dither");
  assert.notEqual(a, pixelBotSvg({ shape: "hex", color: "#0A8C9E", role: "coordinador", seed: 3, size: 32, mood: "libre" }));
  assert.equal(pixelBotSpec({ shape: "leaf", color: "#D43C86", size: 24 }), pixelBotSpec({ shape: "leaf", color: "#D43C86", size: 24 }), "cached: the very same drawing");
  assert.match(a, /shape-rendering="crispEdges"/);
});

test("every shape × mood × size renders a body, a dark visor and eyes", () => {
  for (const [shape, role] of SHAPE_ROLE) for (const mood of MOODS) for (const size of [20, 24, 32, 48, 96]) {
    const spec = pixelBotSpec({ shape, color: FAMILIES[8][0], role, seed: 1, size, mood });
    assert.equal(spec.n, gridFor(size));
    const cells = spec.rects.reduce((n, r) => n + r.w, 0);
    assert.ok(cells > spec.n * spec.n * 0.3, `${shape} ${mood} ${size}: a body (${cells} cells)`);
    assert.ok(new Set(fills(spec)).size >= 5, `${shape} ${mood} ${size}: outline, rim, base, shade and visor`);
  }
  assert.ok(Object.keys(SHAPES).includes("capsule") && !Object.keys(SHAPES).includes("circle"), "Investigación is a capsule (circles are people)");
  const circle = pixelBotSvg({ shape: "circle", color: "#1F8FD8", size: 32 });
  assert.equal(circle, pixelBotSvg({ shape: "capsule", color: "#1F8FD8", size: 32 }), "an old «circle» bot draws as the capsule");
});

test("shapes stay apart at 24 px: no two silhouettes are the same", () => {
  const silhouette = (shape) => pixelBotSpec({ shape, color: "#5B6680", size: 24 }).rects.map((r) => `${r.x},${r.y},${r.w}`).join(";");
  const outline = (shape) => {
    const rows = new Map();
    for (const r of pixelBotSpec({ shape, color: "#5B6680", size: 24 }).rects) {
      const [a, b] = rows.get(r.y) || [99, -1];
      rows.set(r.y, [Math.min(a, r.x), Math.max(b, r.x + r.w - 1)]);
    }
    return [...rows].sort((p, q) => p[0] - q[0]).map(([y, [a, b]]) => `${y}:${a}-${b}`).join(" ");
  };
  const all = Object.keys(SHAPES).map(outline);
  assert.equal(new Set(all).size, all.length, "six different outlines");
  assert.ok(new Set(Object.keys(SHAPES).map(silhouette)).size === Object.keys(SHAPES).length);
});

test("no pixel in honey's or amber's band, for every family tone, mood and prop", () => {
  for (let f = 0; f < FAMILIES.length; f++) for (const color of [FAMILIES[f][0], ...tonesOf(f)]) for (const [shape, role] of SHAPE_ROLE) for (const mood of MOODS) {
    for (const fill of fills(pixelBotSpec({ shape, color, role, seed: f, size: 48, mood, owner: { initials: "LM", color } }))) {
      assert.ok(!inHoneyBand(fill), `${color} ${shape} ${mood}: ${fill} is honey or amber`);
    }
    const drop = paintOf(color);
    assert.ok(!inHoneyBand(drop), `Diseño's drop for ${color}: ${drop}`);
  }
  // A colour chosen by hand in honey's band is moved out of it.
  for (const fill of fills(pixelBotSpec({ shape: "hex", color: "#FFC93C", size: 32 }))) assert.ok(!inHoneyBand(fill), "honey itself never paints a bot: " + fill);
});

test("«en pausa»: the «z» only from 32 px; dimmed body and closed eyes below", () => {
  // The top-left corner above the body is empty unless the «z» is drawn there.
  const z = (size) => pixelBotSpec({ shape: "square", color: "#3A5BE8", size, mood: "pausa" }).rects.some((r) => r.y <= 1 && r.x <= 2);
  assert.equal(z(24), false, "no «z» at 24 px: it read as «I»");
  assert.equal(z(32), true);
  const libre = pixelBotSpec({ shape: "square", color: "#3A5BE8", size: 24, mood: "libre" });
  const pausa = pixelBotSpec({ shape: "square", color: "#3A5BE8", size: 24, mood: "pausa" });
  assert.notDeepEqual(fills(libre), fills(pausa), "a paused bot is dimmed");
  assert.ok(pixelBotSpec({ shape: "hex", color: "#3A5BE8", size: 32, mood: "trabajando" }).spark.length > 0, "working: the twinkle (static with reduced motion, base.css)");
});

test("accessible names: the bot, «bot» and whose it is", () => {
  const vera = { id: "vera", name: "Vera", role: "Redacción", shape: "leaf", color: "#D43C86" };
  assert.equal(botFaceSpec({ bot: vera, owner: { you: true, name: "Sergio" } }).label, "Vera, bot tuyo");
  assert.equal(botFaceSpec({ bot: vera }).label, "Vera, bot tuyo");
  assert.equal(botFaceSpec({ bot: vera, owner: { name: "Lucía Martín", color: "#D43C86" } }).label, "Vera, bot de Lucía");
  assert.match(pixelBotSvg({ shape: "leaf", color: "#D43C86", size: 24 }, "Vera, bot de Lucía"), /role="img" aria-label="Vera, bot de Lucía"/);
  assert.match(pixelBotSvg({ shape: "leaf", color: "#D43C86", size: 24 }), /aria-hidden="true"/, "decorative without a label");
});

test("the owner's round chip only on someone else's bot, with their initials from 48 px", () => {
  const vera = { id: "vera", name: "Vera", role: "Redacción", shape: "leaf", color: "#D43C86" };
  assert.equal(botFaceSpec({ bot: vera, size: 48 }).spec.badge, null, "your own bot: no chip");
  assert.equal(botFaceSpec({ bot: vera, size: 48, owner: { you: true, name: "Sergio Rico" } }).spec.badge, null);
  const theirs = botFaceSpec({ bot: vera, size: 48, owner: { name: "Lucía Martín", color: "#D43C86" } }).spec.badge;
  assert.ok(theirs && theirs.color === "#D43C86" && theirs.text === "L", "a chip with her initial at 48 px");
  assert.equal(botFaceSpec({ bot: vera, size: 96, owner: { name: "Lucía Martín", color: "#D43C86" } }).spec.badge.text, "LM");
  assert.equal(botFaceSpec({ bot: vera, size: 24, owner: { name: "Lucía Martín", color: "#D43C86" } }).spec.badge.text, "", "a dot at 24 px");
});

test("the prop follows the role; other roles wear none", () => {
  assert.equal(roleKey({ role: "Coordinador" }), "coordinador");
  assert.equal(roleKey({ role: "Investigación" }), "investigacion");
  assert.equal(roleKey({ role: "Datos y finanzas" }), "datos");
  assert.equal(roleKey({ role: "Diseño" }), "diseno");
  assert.equal(roleKey({ role: "Redacción" }), "redaccion");
  assert.equal(roleKey({ role: "Código" }), "codigo");
  assert.equal(roleKey({ role: "Legal" }), null, "Legal: no prop");
  assert.equal(roleKey({ id: "nora" }), "investigacion", "a built-in bot without a role text");
  assert.ok(ROLES.length === 6);
  const plain = pixelBotSpec({ shape: "leaf", color: "#0E8C6A", role: null, size: 48 });
  const quill = pixelBotSpec({ shape: "leaf", color: "#0E8C6A", role: "redaccion", size: 48 });
  assert.notDeepEqual(plain.rects, quill.rects);
  assert.equal(moodOf("work"), "trabajando");
  assert.equal(moodOf(null, { status: "espera" }), "espera");
  assert.equal(moodOf(null, { status: "pausado" }), "pausa");
  assert.equal(moodOf(null, { enabled: false }), "pausa");
  assert.equal(moodOf("rest", {}), "libre");
});
