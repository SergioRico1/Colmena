import { siClaude, siOpencode } from "simple-icons";

// The official marks of the providers Colmena thinks with, on one quiet tile so the three
// read as a set: the same box, the same size, each mark in its own brand colour.
// - OpenAI: the OpenAI mark as published in simple-icons 9.21.0 (CC0), before the brand
//   asked for its removal from the package; path unchanged.
// - Claude and OpenCode: simple-icons (CC0), current package.
const OPENAI = {
  hex: "000000",
  path: "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z",
};
const MARKS = { openai: OPENAI, anthropic: siClaude, "opencode-go": siOpencode };
export const PROVIDER_NAME = { openai: "ChatGPT", anthropic: "Claude", "opencode-go": "OpenCode Go" };
// Optical size inside the same box, scaled as a whole (never stretched): OpenCode's mark is a
// solid block that fills its square edge to edge, so at full size it reads heavier than
// OpenAI's knot and Claude's burst.
const OPTICAL = { openai: 1, anthropic: 1, "opencode-go": 0.8 };

/** «anthropic/claude-opus-5-5» → anthropic; a bare ChatGPT slug → openai. */
export function engineOfModel(slug) {
  const prefix = String(slug || "").split("/")[0];
  return MARKS[prefix] && String(slug).includes("/") ? prefix : "openai";
}

/**
 * A provider's mark. `tile` (default) puts it on the 40-px soft tile of Colmena's account
 * rows (radius 30 % of the side, mark at 55 %); without it the bare mark sits inline next to
 * a model or provider name. `light` draws it white, for dark surfaces.
 */
export default function ProviderMark({ engine, size = 40, tile = true, light = false, title = null, style = null }) {
  const mark = MARKS[engine];
  if (!mark) return null;
  const glyph = Math.round((tile ? size * 0.55 : size) * OPTICAL[engine]);
  const svg = (
    <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill={light ? "#FFFFFF" : "#" + mark.hex} aria-hidden={title ? undefined : "true"} role={title ? "img" : undefined} aria-label={title || undefined} style={tile ? null : { display: "block", flex: "none", margin: (size - glyph) / 2 + "px", ...style }}>
      {title ? <title>{title}</title> : null}
      <path d={mark.path} />
    </svg>
  );
  if (!tile) return svg;
  return (
    // Small tiles live in pick lists (grey rows, a white selected row): white with a hairline
    // there, so every row shows the same box.
    <span aria-hidden={title ? undefined : "true"} style={{ width: size + "px", height: size + "px", flex: "none", display: "grid", placeItems: "center", borderRadius: Math.round(size * 0.3) + "px", background: light ? "rgba(255,255,255,.1)" : size <= 32 ? "#FFFFFF" : "#F6F6F3", boxShadow: !light && size <= 32 ? "inset 0 0 0 1px rgba(18,19,26,.08)" : "none", ...style }}>
      {svg}
    </span>
  );
}

/** A name with its provider's small mark in front («[mark] Claude Opus 5.5»). */
export function WithMark({ engine, children, size = 14, gap = "7px" }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap, minWidth: 0 }}>
      <ProviderMark engine={engine} tile={false} size={size} />
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</span>
    </span>
  );
}
