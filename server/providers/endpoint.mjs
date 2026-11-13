// «Servidor propio»: the base URL the person types for an OpenAI-compatible server (vLLM,
// LM Studio, Ollama, LiteLLM, a company gateway…). Colmena only ever calls that base URL plus
// «/models» and «/chat/completions», never follows a redirect, and never sends any other key.
//
// Plain http is only allowed on this computer or the local network (a key or a conversation
// must not cross the internet unencrypted); link-local addresses (169.254.x, cloud metadata)
// and URLs with a user, password, query or fragment are refused.

const PRIVATE_V4 = [
  [10, 0, 8], [172, 16, 12], [192, 168, 16], [127, 0, 8], [100, 64, 10], // RFC 1918, loopback, CGNAT (Tailscale)
];

function ipv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

const inRange = ([a, b], [base, second, bits]) => {
  const value = (a << 8) | b, start = (base << 8) | second;
  const mask = bits >= 16 ? 0xffff : (0xffff << (16 - bits)) & 0xffff;
  return (value & mask) === (start & mask);
};

/** 'loopback' | 'lan' | 'link-local' | 'public' for a URL hostname (no DNS lookups). */
export function hostKind(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return "loopback";
  const v4 = ipv4(host);
  if (v4) {
    if (v4[0] === 127) return "loopback";
    if (v4[0] === 169 && v4[1] === 254) return "link-local";
    if (v4[0] === 0) return "link-local";
    return PRIVATE_V4.some((r) => inRange(v4, r)) ? "lan" : "public";
  }
  if (host.includes(":")) {
    if (host === "::1") return "loopback";
    if (/^fe[89ab]/.test(host)) return "link-local";
    if (/^f[cd]/.test(host)) return "lan";
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
    return mapped ? hostKind(mapped[1]) : "public";
  }
  // Single-label names (a machine on the network) and mDNS / home-router suffixes.
  if (!host.includes(".") || /\.(local|lan|home|internal|home\.arpa)$/.test(host)) return "lan";
  return "public";
}

/**
 * The normalised base URL («https://host[:port]/path», no trailing slash) or an Error with the
 * sentence to show. `/chat/completions` or `/models` pasted at the end is removed.
 */
export function validateBaseUrl(raw) {
  const text = String(raw ?? "").trim();
  if (!text) throw Error("Escribe la dirección de tu servidor.");
  let url;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : "http://" + text); } catch { throw Error("Esa dirección no es válida. Ejemplo: http://192.168.1.20:8000/v1"); }
  if (!["http:", "https:"].includes(url.protocol)) throw Error("La dirección tiene que empezar por http:// o https://.");
  if (url.username || url.password) throw Error("Quita el usuario y la contraseña de la dirección: la clave va en su propio campo.");
  if (url.search || url.hash) throw Error("Quita lo que va detrás de «?» o «#» en la dirección.");
  const kind = hostKind(url.hostname);
  if (kind === "link-local") throw Error("Esa dirección no es la de un servidor de modelos.");
  if (url.protocol === "http:" && kind === "public") throw Error("Fuera de tu red, la dirección tiene que empezar por https:// para que la clave y las conversaciones viajen cifradas.");
  const path = url.pathname.replace(/\/+$/, "").replace(/\/(chat\/completions|models)$/i, "");
  return url.origin + path;
}
