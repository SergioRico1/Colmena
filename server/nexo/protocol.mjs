/** Private local IPC framing. No tokens or diagnostics are written to stdout. */
export function encodeFrame(value) {
  const body = Buffer.from(JSON.stringify(value));
  if (body.length > 1000000) throw Error("Respuesta local demasiado grande.");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}
export class FrameDecoder {
  constructor(onMessage, maxBytes = 4 * 1024 * 1024) {
    this.buffer = Buffer.alloc(0);
    this.onMessage = onMessage;
    this.maxBytes = maxBytes;
  }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const len = this.buffer.readUInt32LE(0);
      if (len < 2 || len > this.maxBytes)
        throw Error("Longitud de mensaje no permitida.");
      if (this.buffer.length < 4 + len) break;
      const body = this.buffer.subarray(4, 4 + len);
      this.buffer = this.buffer.subarray(4 + len);
      let value;
      try {
        value = JSON.parse(body.toString("utf8"));
      } catch {
        throw Error("Mensaje JSON no válido.");
      }
      this.onMessage(value);
    }
  }
}
export async function consumeSSE(body, onEvent, { maxBuffer = 1000000 } = {}) {
  if (!body) throw Error("Respuesta vacía.");
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    if (buffer.length > maxBuffer) throw Error("Evento demasiado grande.");
    let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const raw = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const data = raw
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data && data !== "[DONE]") {
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          throw Error("Evento del modelo mal formado.");
        }
        await onEvent(event);
      }
    }
  }
  buffer += decoder.decode();
  if (buffer.trim() && buffer.trim() !== "data: [DONE]")
    throw Error("La transmisión terminó a mitad de un evento.");
}
