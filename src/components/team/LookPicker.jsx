import BotFace from "../BotFace.jsx";

// A bot's look from Colmena's own options: its shape (the silhouette of its role) and its colour,
// each drawn as the bot will look. Shared by «Nuevo bot» (NewBot.jsx) and the profile's
// «Nombre y aspecto» (BotLookDialog.jsx). Honey and ink are not offered: honey means «te
// necesita» and ink marks who coordinates.
export const SHAPE_LIST = [["hex", "hexágono"], ["square", "cuadrado"], ["diamond", "rombo"], ["arch", "arco"], ["leaf", "hoja"], ["capsule", "cápsula"]];
export const COLORS = [["#0E7C86", "verde azulado"], ["#2F6BFF", "azul"], ["#7B4DFF", "violeta"], ["#FF5CA8", "rosa"], ["#FF7A1A", "naranja"], ["#0B8A5F", "verde"], ["#B4236E", "frambuesa"]];

const heading = { fontSize: "var(--t-ui)", fontWeight: "600", color: "var(--c-text-2)" };
const tile = (on) => ({ width: "52px", height: "52px", display: "grid", placeItems: "center", padding: "0", border: `${on ? 2 : 1}px solid ${on ? "var(--c-text)" : "var(--c-line)"}`, borderRadius: "var(--r-md)", background: on ? "var(--c-hover)" : "var(--c-card)", cursor: "pointer" });

export function ShapePicker({ bot, value, onChange, disabled = false }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <span style={heading}>{"Forma"}</span>
      <div role="radiogroup" aria-label="Forma" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {SHAPE_LIST.map(([id, l]) => {
          const on = value === id;
          return (
            <button key={id} type="button" role="radio" aria-checked={on ? "true" : "false"} aria-label={l} title={l} disabled={disabled} onClick={() => onChange(id)} style={tile(on)}>
              <BotFace bot={{ ...bot, shape: id, portrait: null }} size={32} decorative />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ColorPicker({ bot, value, onChange, disabled = false }) {
  const current = String(value || "").toUpperCase();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <span style={heading}>{"Color "}<span style={{ fontWeight: "400", color: "var(--c-text-3)" }}>{"· la miel es para «te necesita» y la tinta, para quien coordina"}</span></span>
      <div role="radiogroup" aria-label="Color" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {COLORS.map(([hex, l]) => {
          const on = current === hex;
          return (
            <button key={hex} type="button" role="radio" aria-checked={on ? "true" : "false"} aria-label={l} title={l} disabled={disabled} onClick={() => onChange(hex)} style={tile(on)}>
              <BotFace bot={{ ...bot, color: hex, portrait: null }} size={32} decorative />
            </button>
          );
        })}
      </div>
    </div>
  );
}
