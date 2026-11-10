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
