// Person or bot, the same everywhere (docs/PLAN-equipo-y-salas.md, scope 4). Circles are people.
// A bot keeps its shape; one whose shape is a circle (or unknown) is drawn as a rounded square,
// so nobody takes it for a person. Pure: no React, no network.

const BOT_SHAPES = ["hex", "diamond", "square", "leaf", "arch"];

/** The shape a bot is drawn with: its own, or a rounded square when it is a circle or unknown. */
export const botShape = (shape) => (BOT_SHAPES.includes(shape) ? shape : "square");

/** «LM» from «Lucía Martín»; «?» when there is no name. */
export const initialsOf = (name) => String(name || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";

/** «Lucía» from «Lucía Martín». */
export const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "Alguien";

/** «Ana», «Ana y Luis», «Ana, Luis y Marta». */
export const listNames = (list) => (list.length <= 1 ? list.join("") : list.slice(0, -1).join(", ") + " y " + list.at(-1));
