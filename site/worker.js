// colmena.team: www goes to the apex; everything else is the static site in ./dist.
const APEX = "colmena.team";

const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Strict-Transport-Security": "max-age=31536000",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

// /descargar/<platform>: straight to that installer of the latest release, so nobody has to pick
// from a GitHub page of blockmaps. The release list is cached for ten minutes; if GitHub cannot
// be read, the release page itself.
const REPO = "SergioRico1/Colmena";
const RELEASES = `https://github.com/${REPO}/releases/latest`;
const INSTALLERS = { windows: /-win-x64\.exe$/, mac: /-mac-arm64\.dmg$/, "mac-intel": /-mac-x64\.dmg$/ };

async function download(platform, ctx) {
  const pattern = INSTALLERS[platform];
  if (!pattern) return null;
  const api = `https://api.github.com/repos/${REPO}/releases/latest`;
  const cache = caches.default;
  const key = new Request(api);
  let res = await cache.match(key);
  if (!res) {
    res = await fetch(api, { headers: { Accept: "application/vnd.github+json", "User-Agent": "colmena-home" } }).catch(() => null);
    if (res?.ok) {
      res = new Response(res.body, res);
      res.headers.set("Cache-Control", "public, max-age=600");
      ctx?.waitUntil?.(cache.put(key, res.clone()));
    }
  }
  const release = res?.ok ? await res.json().catch(() => null) : null;
  const asset = (release?.assets || []).find((a) => pattern.test(a.name || ""));
  return Response.redirect(asset?.browser_download_url || RELEASES, 302);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname === "www." + APEX) {
      url.hostname = APEX;
      return Response.redirect(url.toString(), 301);
    }
    // /descargar alone: the installer for the visitor's system (Windows or Mac); phones and
    // anything else get the list of downloads.
    if (/^\/descargar\/?$/.test(url.pathname)) {
      const ua = request.headers.get("User-Agent") || "";
      const platform = /Android|iPhone|iPad|iPod/i.test(ua) ? null : /Windows/i.test(ua) ? "windows" : /Macintosh|Mac OS X/i.test(ua) ? "mac" : null;
      if (platform) return (await download(platform, ctx)) || Response.redirect(RELEASES, 302);
      return Response.redirect("https://" + APEX + "/#descargar", 302);
    }
    const dl = /^\/descargar\/([a-z-]+)\/?$/.exec(url.pathname);
    if (dl) return (await download(dl[1], ctx)) || Response.redirect(RELEASES, 302);
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(HEADERS)) out.headers.set(k, v);
    // Fonts and images never change under the same name; pages are revalidated.
    if (/^\/fonts\/|\.(png|svg)$/.test(url.pathname)) out.headers.set("Cache-Control", "public, max-age=604800");
    return out;
  },
};
