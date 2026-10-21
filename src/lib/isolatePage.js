// The policy a bot-made web page runs under in «Vista previa» (PagePreview.jsx).

const POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'";
const META = `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`;

/** The page with the policy as the very first thing in <head> (pages may add theirs: both apply). */
export function isolatedPage(html) {
  const text = String(html || "");
  if (/<head[^>]*>/i.test(text)) return text.replace(/<head[^>]*>/i, (m) => m + META);
  if (/<html[^>]*>/i.test(text)) return text.replace(/<html[^>]*>/i, (m) => m + "<head>" + META + "</head>");
  return META + text;
}
