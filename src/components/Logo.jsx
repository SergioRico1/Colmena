// Colmena brand: the hexagon mark with eyes + the wordmark in Poppins ExtraBold.
export const LOGO_FONT = "'Poppins', 'Bricolage Grotesque', sans-serif";

export function LogoMark({ size = 30, style }) {
  const src = size > 64 ? "/logo-mark-256.png" : size > 32 ? "/logo-mark-128.png" : "/logo-mark-64.png";
  return <img src={src} width={size} height={size} alt="" aria-hidden="true" draggable="false" style={{ display: "block", flex: "none", ...style }} />;
}

/** tone "light" = white wordmark (dark backgrounds), "dark" = ink wordmark. */
export default function Logo({ size = 30, fontSize = 22, tone = "light", gap = 10, style }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: gap + "px", ...style }}>
      <LogoMark size={size} />
      <span style={{ font: `800 ${fontSize}px/1 ${LOGO_FONT}`, letterSpacing: "-0.02em", color: tone === "light" ? "#FFFFFF" : "#12131A" }}>Colmena</span>
    </span>
  );
}
