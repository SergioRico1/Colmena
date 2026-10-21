// Formatting helpers shared by the Ajustes screens.

/** 1234567 → «1,2 M», 45000 → «45 mil», 900 → «900». */
export function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toLocaleString("es-ES", { maximumFractionDigits: 1 })} M`;
  if (v >= 1e4) return `${Math.round(v / 1e3).toLocaleString("es-ES")} mil`;
  return v.toLocaleString("es-ES");
}

/** Escapes a value for CSV (RFC 4180, semicolon-friendly for Spanish Excel). */
export function csvCell(value) {
  const s = String(value ?? "");
  return /[";\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
