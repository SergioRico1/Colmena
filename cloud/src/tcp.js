// The TCP seam of the mail connector (server/mcp/mail.mjs) in the Worker: `connect()` from
// cloudflare:sockets (https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/).
// secureTransport "on" for implicit TLS (IMAP 993, SMTP 465) or "starttls" for 587; port 25 is
// blocked by the platform, and so are private addresses and Cloudflare's own ranges.
import { connect } from "cloudflare:sockets";

function adapt(socket) {
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder();
  return {
    async read() {
      const { value, done } = await reader.read();
      return done ? null : value;
    },
    write: (data) => writer.write(typeof data === "string" ? encoder.encode(data) : new Uint8Array(data)),
    async startTls() {
      reader.releaseLock();
      writer.releaseLock();
      return adapt(socket.startTls());
    },
    close() { try { socket.close(); } catch {} },
  };
}

export function workerTcp() {
  return async ({ host, port, tls = "on" }) => {
    if (tls === "off") throw Error("El correo tiene que ir cifrado (TLS).");
    if (Number(port) === 25) throw Error("El puerto 25 no se puede usar: usa 465 o 587.");
    const socket = connect({ hostname: host, port: Number(port) }, { secureTransport: tls === "starttls" ? "starttls" : "on", allowHalfOpen: false });
    try { await socket.opened; } catch (e) { throw Error("No se pudo conectar con " + host + ":" + port + ": " + (e?.message || e)); }
    return adapt(socket);
  };
}
