"use strict";
// CommonJS copy of the address policy in server/web.mjs for the bots' browser.
// Only public http(s) pages; loopback, LAN, link-local, reserved, file: and
// browser-internal schemes are refused. Keep in sync with server/web.mjs.
const net = require("node:net");
const dns = require("node:dns");

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10],
  ["ff00::", 8], ["2001:db8::", 32], ["100::", 64], ["2002::", 16],
]) blocked.addSubnet(address, prefix, "ipv6");

function embeddedIPv4(address) {
  const lower = address.toLowerCase();
  const mapped = lower.match(/^(?:::ffff:(?:0:)?|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  const hex = lower.match(/^(?:::ffff:(?:0:)?|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const a = parseInt(hex[1], 16), b = parseInt(hex[2], 16);
    return [a >> 8, a & 255, b >> 8, b & 255].join(".");
  }
  return null;
}

/** True for loopback, private, link-local, multicast, reserved and mapped variants. */
function isBlockedAddress(address) {
  const raw = String(address || "").replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const family = net.isIP(raw);
  if (!family) return true;
  if (family === 4) return blocked.check(raw, "ipv4");
  const v4 = embeddedIPv4(raw);
  if (v4) return blocked.check(v4, "ipv4");
  return blocked.check(raw, "ipv6");
}

const LOCAL_NAME = /^localhost$|\.(localhost|local|internal|lan|home|corp|intranet|arpa)$/i;

/**
 * Synchronous check of a URL the browser is about to load.
 * Returns null when allowed, or a Spanish reason when refused.
 * `subresource` allows data:/blob: for images, fonts and scripts inside a public page.
 */
function urlProblem(raw, { subresource = false } = {}) {
  let url;
  try { url = new URL(String(raw)); } catch { return "Dirección web no válida."; }
  if (subresource && ["data:", "blob:"].includes(url.protocol)) return null;
  if (url.protocol === "about:" && url.href === "about:blank") return null;
  const web = subresource ? ["http:", "https:", "ws:", "wss:"] : ["http:", "https:"];
  if (!web.includes(url.protocol)) return "Solo se pueden abrir páginas http o https.";
  if (url.username || url.password) return "La dirección no puede incluir credenciales.";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || LOCAL_NAME.test(host)) return "Dirección no permitida: solo páginas públicas.";
  if (net.isIP(host) && isBlockedAddress(host)) return "Dirección no permitida: solo páginas públicas.";
  // Bare single-label names (intranet hosts) are never public.
  if (!net.isIP(host) && !host.includes(".")) return "Dirección no permitida: solo páginas públicas.";
  return null;
}

/** Resolves a host name and refuses it if any address is private (DNS rebinding guard). */
function makeResolver({ lookup = (host) => dns.promises.lookup(host, { all: true, verbatim: true }), ttlMs = 60000 } = {}) {
  const cache = new Map();
  return async function hostProblem(hostname) {
    const host = String(hostname || "").replace(/^\[|\]$/g, "");
    if (net.isIP(host)) return isBlockedAddress(host) ? "Dirección no permitida: solo páginas públicas." : null;
    const hit = cache.get(host);
    if (hit && hit.until > Date.now()) return hit.problem;
    let problem = null;
    try {
      const list = await lookup(host);
      const addresses = (Array.isArray(list) ? list : [list]).map((a) => (typeof a === "string" ? a : a.address));
      if (!addresses.length || addresses.some(isBlockedAddress)) problem = "Dirección no permitida: solo páginas públicas.";
    } catch {
      problem = "No se encontró la página (" + host + ")."; // fail closed
    }
    if (cache.size > 2000) cache.clear();
    cache.set(host, { problem, until: Date.now() + ttlMs });
    return problem;
  };
}

module.exports = { isBlockedAddress, urlProblem, makeResolver };
