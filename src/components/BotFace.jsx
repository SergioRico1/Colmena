import { memo } from "react";
import { botFaceSpec } from "../lib/pixelBot.js";
import { botShape } from "../lib/identity.js";
import { portraitOf } from "../lib/bots.js";
import { SHAPES } from "./v2/Presence.jsx";
import { familyInk } from "../lib/personColor.js";
import "../styles/conversation.css";

// A bot, drawn as Colmena's pixel character (Colmena 4; lib/pixelBot.js; docs/SCREENS.md › v4).
//
//   <BotFace bot={bot} size={32} />                     its live state picks the mood
//   <BotFace bot={bot} size={24} state="work" />        rest | work | wait | pause (Presence states)
//   <BotFace bot={bot} size={48} owner={owner} />       someone else's bot: their round chip
//   <BotFace bot={bot} size={20} decorative />          the name is already written beside it
//
// Sizes: 20 · 24 · 32 · 48 · 96 (any size works; those are whole pixels per cell). The shape
// marks the role (hex Coordinador, capsule Investigación, square Datos, diamond Diseño, leaf
// Redacción, arch Código; a role of your own keeps its shape and wears no prop), the colour is
// the bot's own tone of its person's family. People are never drawn here: they are circles.
// The «trabajando» twinkle blinks unless the system asks for reduced motion (base.css).
// A portrait the person chose for the bot (server/portraits.mjs) still shows, in its shape.
function BotFace({ bot, size = 32, state = null, mood = null, owner = null, decorative = false, label = null, style = null, className }) {
  const portrait = portraitOf(bot);
  const face = portrait ? null : botFaceSpec({ bot, size, state, mood, owner });
  const name = label || face?.label || bot?.name || "Bot";
  const a11y = decorative ? { "aria-hidden": "true" } : { role: "img", "aria-label": name };
  if (portrait) {
    const shape = SHAPES[botShape(bot?.shape)];
    return <span {...a11y} className={className} style={{ display: "inline-block", flex: "none", width: size + "px", height: size + "px", background: `${bot?.color || "var(--c-chip)"} url("${portrait}") center / cover no-repeat`, clipPath: shape.clip, borderRadius: shape.radius, ...style }} />;
  }
  const { spec } = face;
  const b = spec.badge;
  const row = (r) => <rect key={r.y * 100 + r.x} x={r.x} y={r.y} width={r.w} height="1" fill={r.fill} />;
  return (
    <svg {...a11y} className={className} width={size} height={size} viewBox={`0 0 ${spec.n} ${spec.n}`} shapeRendering="crispEdges" overflow="visible" focusable="false" data-bot-face="" style={{ display: "block", flex: "none", ...style }}>
      {spec.rects.map(row)}
      {spec.spark.length ? <g className="pb-spark">{spec.spark.map(row)}</g> : null}
      {b ? (
        <g shapeRendering="geometricPrecision" data-owner-badge="">
          {/* The owner's chip in their family's deep colour (a pastel would not carry white letters). */}
          <circle cx={b.cx} cy={b.cy} r={b.r} fill={familyInk(b.color)} stroke="var(--c-cut)" strokeWidth={b.ring} />
          {b.text ? <text x={b.cx} y={b.cy} dy=".36em" textAnchor="middle" fontFamily="Geist, sans-serif" fontWeight="700" fontSize={b.fontSize} fill="var(--c-badge-text)">{b.text}</text> : null}
        </g>
      ) : null}
    </svg>
  );
}

export default memo(BotFace);
