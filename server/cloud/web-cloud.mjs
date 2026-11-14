// web_fetch in a hosted workspace: the desktop's reader (server/web.mjs › webFetch: public pages
// only, every redirect hop checked, 2 MB, 15 s, text or PDF) over `fetch` instead of node:http.
// Before each hop the host is resolved with DNS over HTTPS and refused when any address is
// private, loopback, link-local, CGNAT, multicast or reserved; a literal address is judged as it
// is. Workers cannot open connections to private networks at all, so a DNS answer that changes
// between the check and the request still cannot reach one.
import { webFetch } from "../web.mjs";
import { dohResolve } from "./link-preview.mjs";

const HEADERS = {
  "User-Agent": "Colmena/0.1 (lector de páginas publicas)",
  Accept: "text/html,application/xhtml+xml,text/plain,application/json,application/xml;q=0.9,*/*;q=0.1",
  "Accept-Language": "es,en;q=0.8",
};

/** One GET without following redirects, at most `maxBytes` of body (the rest is cut). */
export function fetchGet(fetchImpl = fetch) {
  return async (url, { signal, maxBytes }) => {
    const response = await fetchImpl(url.href, { method: "GET", redirect: "manual", signal, headers: HEADERS });
    const headers = {};
    for (const [k, v] of response.headers) headers[k.toLowerCase()] = v;
    const status = response.status;
    if (status >= 300 && status < 400 && headers.location) {
      try { await response.body?.cancel(); } catch {}
      return { status, location: headers.location, headers };
    }
    // fetch has already decoded the body: the reader must not decompress it again.
    delete headers["content-encoding"];
    const chunks = [];
    let size = 0, truncated = false;
    const reader = response.body?.getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        truncated = true;
        chunks.push(value.subarray(0, value.length - (size - maxBytes)));
        try { await reader.cancel(); } catch {}
        break;
      }
      chunks.push(value);
    }
    return { status, headers, body: Buffer.concat(chunks.map((c) => Buffer.from(c))), truncated };
  };
}

/** `resolve(host)` for webFetch's checks: every A and AAAA address, by DNS over HTTPS. */
export const dohLookup = (fetchImpl = fetch) => async (host) => (await dohResolve(host, { fetchImpl })).map((address) => ({ address }));

/** The runtime's `web` (Runtime option) in the cloud. */
export function cloudWebFetch({ fetchImpl = fetch } = {}) {
  const get = fetchGet(fetchImpl), resolve = dohLookup(fetchImpl);
  return (url, options = {}) => webFetch(url, { ...options, resolve, get });
}
